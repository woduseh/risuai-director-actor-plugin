import type { RisuaiApi } from './contracts/risuai.js'
import type {
  CanonicalMemory,
  DirectorPluginState,
  MemdirDocument,
  MemoryUpdate,
  OpenAIChat
} from './contracts/types.js'
import { createDirectorService } from './director/service.js'
import { resolvePromptPreset } from './director/prompt.js'
import { CanonicalStore } from './memory/canonicalStore.js'
import { resolveScopeStorageKey } from './memory/scopeResolver.js'
import { applyMemoryUpdate } from './memory/applyUpdate.js'
import { retrieveMemory } from './memory/retrieval.js'
import { TurnCache } from './memory/turnCache.js'
import {
  createExtractionWorker,
  type ExtractionContext,
  type ExtractionResult,
} from './memory/extractMemories.js'
import { MemdirStore } from './memory/memdirStore.js'
import { buildMemoryMd } from './memory/memoryDocuments.js'
import {
  findRelevantMemories,
  formatRecalledDocsBlock,
  RecallCache,
  type RecallDeps,
  type FindRelevantMemoriesInput,
} from './memory/findRelevantMemories.js'
import { makeRecallRequest, isTransientError } from './runtime/network.js'
import { SessionNotebook, formatNotebookBlock } from './memory/sessionMemory.js'
import { createBackgroundHousekeeping } from './runtime/backgroundHousekeeping.js'
import { createAutoDreamWorker, type DreamResult } from './memory/autoDream.js'
import { ConsolidationLock } from './memory/consolidationLock.js'
import {
  loadDreamState,
  saveDreamState,
  type DreamRuntimeState,
} from './ui/dashboardState.js'
import { CircuitBreaker } from './runtime/circuitBreaker.js'
import { hashExtractionContext } from './runtime/network.js'
import {
  bootstrapPlugin,
  type DirectorPostResponseInput,
  type DirectorPreRequestInput
} from './runtime/plugin.js'
import {
  createTurnRecoveryManager,
  attemptStartupRecovery,
} from './runtime/turnRecovery.js'
import { DiagnosticsManager } from './runtime/diagnostics.js'
import { RefreshGuard } from './runtime/refreshGuard.js'
import { openDashboard, createDashboardStore } from './ui/dashboardApp.js'
import { createEmbeddingClient, isProviderSupported, type EmbeddingClient } from './memory/embeddingClient.js'
import { computeVectorVersion } from './memory/vectorVersion.js'
import { embedSingleDocument, embedDocuments, computeEmbeddingCacheStatus } from './memory/embeddingIntegration.js'

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Build an embedding client from current settings, or null if embeddings
 * are disabled or the provider is unsupported.
 */
function buildEmbeddingClient(
  api: RisuaiApi,
  settings: { embeddingsEnabled: boolean; embeddingProvider: string; embeddingBaseUrl: string; embeddingApiKey: string; embeddingModel: string; embeddingDimensions: number },
): EmbeddingClient | null {
  if (!settings.embeddingsEnabled) return null
  if (!isProviderSupported(settings.embeddingProvider)) return null
  if (!settings.embeddingApiKey || !settings.embeddingBaseUrl || !settings.embeddingModel) return null

  return createEmbeddingClient(
    {
      provider: settings.embeddingProvider,
      baseUrl: settings.embeddingBaseUrl,
      apiKey: settings.embeddingApiKey,
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensions,
    },
    (url, opts) => api.nativeFetch(url, opts),
  )
}

function getVectorVersion(
  settings: { embeddingsEnabled: boolean; embeddingProvider: string; embeddingBaseUrl: string; embeddingModel: string; embeddingDimensions: number },
): string {
  if (!settings.embeddingsEnabled) return ''
  return computeVectorVersion({
    provider: settings.embeddingProvider,
    baseUrl: settings.embeddingBaseUrl,
    model: settings.embeddingModel,
    dimensions: settings.embeddingDimensions,
  })
}

// safeLocalStorage keys for extraction hot cache
const LS_LAST_EXTRACTION_TS = 'director:extraction:lastTs'
const LS_LAST_PROCESSED_CURSOR = 'director:extraction:cursor'

/** Timeout for the recall prefetch before falling back to deterministic retrieval. */
const RECALL_TIMEOUT_MS = 3000

function latestUserText(messages: readonly OpenAIChat[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return messages[index]!.content
    }
  }
  return ''
}

function projectRetrievedMemory(
  state: DirectorPluginState,
  retrieved: ReturnType<typeof retrieveMemory>
): CanonicalMemory {
  const selectedTexts = new Set([
    ...retrieved.mustInject,
    ...retrieved.highPriority,
    ...retrieved.opportunistic.slice(0, 5)
  ])

  if (selectedTexts.size === 0) {
    return structuredClone(state.memory)
  }

  return {
    ...structuredClone(state.memory),
    summaries: state.memory.summaries.filter((entry) => selectedTexts.has(entry.text)),
    worldFacts: state.memory.worldFacts.filter((entry) => selectedTexts.has(entry.text))
  }
}

function recordDirectorFailure(
  state: DirectorPluginState,
  reason: string
): DirectorPluginState {
  const next = structuredClone(state)
  const now = Date.now()

  next.metrics.totalDirectorFailures += 1
  next.director.cooldown.failures += 1
  next.director.failureHistory.unshift({
    timestamp: now,
    reason,
    severity: 'medium'
  })
  next.director.failureHistory = next.director.failureHistory.slice(0, 50)

  if (next.director.cooldown.failures >= next.settings.cooldownFailureThreshold) {
    next.director.cooldown.untilTs = now + next.settings.cooldownMs
  }

  return next
}

function recordDirectorSuccess(
  state: DirectorPluginState
): DirectorPluginState {
  const next = structuredClone(state)
  next.metrics.totalDirectorCalls += 1
  next.director.cooldown.failures = 0
  next.director.cooldown.untilTs = null
  return next
}

export async function registerDirectorActorPlugin(api: RisuaiApi): Promise<void> {
  const scopeResolution = await resolveScopeStorageKey(api)

  // Create memdir store first so CanonicalStore can migrate into it on load
  const memdirScopeKey = scopeResolution.isFallback
    ? 'default'
    : scopeResolution.storageKey
  const memdirStore = new MemdirStore(api.pluginStorage, memdirScopeKey)

  const store = new CanonicalStore(api.pluginStorage, {
    storageKey: scopeResolution.storageKey,
    migrateFromFlatKey: !scopeResolution.isFallback,
    memdirStore,
    onMigrationError: (err) => api.log(`Memdir migration error: ${err}`),
  })
  const turnCache = new TurnCache()
  const initialState = await store.load()
  const circuitBreaker = new CircuitBreaker(
    initialState.settings.cooldownFailureThreshold,
    initialState.settings.cooldownMs
  )

  // ── Recall cache & session notebook ───────────────────────────────
  const recallCache = new RecallCache(initialState.settings.recallCooldownMs)
  const sessionNotebook = new SessionNotebook(memdirScopeKey)

  // ── Extraction worker ─────────────────────────────────────────────
  const seenHashes = new Set<string>()

  const extractionWorker = createExtractionWorker(
    {
      async runExtraction(ctx: ExtractionContext): Promise<ExtractionResult> {
        const state = await store.load()
        if (!state.settings.postReviewEnabled) {
          return { applied: false, memoryUpdate: null }
        }

        const promptPreset = resolvePromptPreset(state.settings)
        const service = createDirectorService(api, state.settings)
        let result
        try {
          result = await service.postResponse({
            responseText: ctx.content,
            brief: ctx.brief,
            messages: ctx.messages,
            directorState: state.director,
            memory: state.memory,
            assertiveness: state.settings.assertiveness,
            promptPreset,
          })
        } catch (err) {
          await diagnostics.recordWorkerFailure('extraction', err)
          throw err
        }

        if (!result.ok) {
          await diagnostics.recordWorkerFailure('extraction', result.error)
          if (isTransientError(result.error)) {
            throw new Error(result.error)
          }
          return { applied: false, memoryUpdate: null }
        }

        await diagnostics.recordWorkerSuccess('extraction', `applied=${true}`)
        return { applied: true, memoryUpdate: result.update }
      },

      async persistDocuments(update: MemoryUpdate, ctx: ExtractionContext): Promise<void> {
        const now = Date.now()
        const docs: MemdirDocument[] = []

        for (const fact of update.durableFacts) {
          docs.push({
            id: `ext-fact-${createId('f')}`,
            type: 'plot',
            title: fact.slice(0, 60),
            description: fact,
            scopeKey: memdirScopeKey,
            updatedAt: now,
            source: 'extraction',
            freshness: 'current',
            tags: [],
          })
        }

        for (const entityData of update.entityUpdates) {
          const name = typeof entityData.name === 'string' ? entityData.name : 'unknown'
          const facts = Array.isArray(entityData.facts) ? (entityData.facts as string[]).join('; ') : ''
          docs.push({
            id: `ext-entity-${createId('e')}`,
            type: 'character',
            title: name,
            description: facts || name,
            scopeKey: memdirScopeKey,
            updatedAt: now,
            source: 'extraction',
            freshness: 'current',
            tags: [],
          })
        }

        // Load settings/client/version once, reuse for all docs
        const settings = (await store.load()).settings
        const client = buildEmbeddingClient(api, settings)
        const version = client ? getVectorVersion(settings) : ''

        for (const doc of docs) {
          await memdirStore.putDocument(doc)

          // Embed newly persisted doc if embeddings are enabled
          if (client) {
            await embedSingleDocument(doc, memdirStore, client, version, (msg) => api.log(msg))
          }
        }
      },

      log(message: string): void {
        api.log(message)
      },

      async getLastExtractionTs(): Promise<number> {
        const raw = await api.safeLocalStorage.getItem<number>(LS_LAST_EXTRACTION_TS)
        return typeof raw === 'number' ? raw : 0
      },

      async setLastExtractionTs(ts: number): Promise<void> {
        await api.safeLocalStorage.setItem(LS_LAST_EXTRACTION_TS, ts)
      },

      async getLastProcessedCursor(): Promise<number> {
        const raw = await api.safeLocalStorage.getItem<number>(LS_LAST_PROCESSED_CURSOR)
        return typeof raw === 'number' ? raw : 0
      },

      async setLastProcessedCursor(cursor: number): Promise<void> {
        await api.safeLocalStorage.setItem(LS_LAST_PROCESSED_CURSOR, cursor)
      },

      hashRequest: hashExtractionContext,
    },
    {
      extractionMinTurnInterval: initialState.settings.extractionMinTurnInterval,
      seenHashes,
    },
  )

   // ── Background housekeeping ───────────────────────────────────────
  const dreamState: DreamRuntimeState = await loadDreamState(api.pluginStorage)
  let lastUserInteractionTs = Date.now()

  // ── Refresh guard ─────────────────────────────────────────────────
  const refreshGuard = new RefreshGuard(
    api.safeLocalStorage,
    scopeResolution.storageKey,
  )
  await refreshGuard.load()
  await refreshGuard.markStartup()

  const dreamWorker = createAutoDreamWorker({
    memdirStore,
    log(message: string): void {
      api.log(message)
    },
    async runConsolidationModel(prompt: string): Promise<string> {
      const state = await store.load()
      const result = await api.runLLMModel({
        messages: [
          { role: 'system', content: 'You are a memory consolidation assistant.' },
          { role: 'user', content: prompt },
        ],
        staticModel: state.settings.directorModel,
        mode: state.settings.directorMode,
      })
      if (result.type === 'fail') {
        throw new Error(`Consolidation model call failed: ${result.result}`)
      }
      return result.result
    },
  })

  const consolidationLock = new ConsolidationLock(
    api.pluginStorage,
    memdirScopeKey,
    `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  const housekeeping = createBackgroundHousekeeping(
    {
      submitExtraction: (ctx) => extractionWorker.submit(ctx),
      flushExtraction: () => extractionWorker.flush(),
      getExtractionMinTurnInterval: () => initialState.settings.extractionMinTurnInterval,
      log(message: string): void {
        api.log(message)
      },
    },
    {
      async buildCadenceGate() {
        const freshState = await store.load()
        return {
          enabled: freshState.settings.enabled && freshState.settings.postReviewEnabled,
          lastDreamTs: dreamState.lastDreamTs,
          dreamMinHoursElapsed: freshState.settings.dreamMinHoursElapsed,
          turnsSinceLastDream: dreamState.turnsSinceLastDream,
          dreamMinTurnsElapsed: freshState.settings.extractionMinTurnInterval * 3,
          sessionsSinceLastDream: dreamState.sessionsSinceLastDream,
          dreamMinSessionsElapsed: freshState.settings.dreamMinSessionsElapsed,
          userInteractionGuardMs: 10_000,
          lastUserInteractionTs: Math.max(lastUserInteractionTs, refreshGuard.latestGuardTs()),
        }
      },
      dreamWorker,
      consolidationLock,
      async onDreamComplete(result: DreamResult): Promise<void> {
        dreamState.lastDreamTs = Date.now()
        dreamState.turnsSinceLastDream = 0
        dreamState.sessionsSinceLastDream = 0
        await saveDreamState(api.pluginStorage, dreamState)
        await diagnostics.recordWorkerSuccess('dream', `merged=${result.merged}`)
      },
      async onDreamFailure(error: unknown): Promise<void> {
        await diagnostics.recordWorkerFailure('dream', error)
      },
      log(message: string): void {
        api.log(message)
      },
    },
  )

  // ── Turn recovery manager ──────────────────────────────────────────
  const turnRecovery = createTurnRecoveryManager(
    api.pluginStorage,
    scopeResolution.storageKey,
  )

  // ── Runtime diagnostics ───────────────────────────────────────────
  const diagnostics = new DiagnosticsManager(
    api.pluginStorage,
    scopeResolution.storageKey,
  )
  await diagnostics.loadSnapshot()

  const director = {
    async preRequest(input: DirectorPreRequestInput) {
      const state = await store.load()
      if (!state.settings.enabled) return null

      // Deterministic retrieval — always computed, used as projection fallback
      const retrieved = retrieveMemory({
        state,
        messages: input.messages
      })
      turnCache.patch(input.turnId, { retrieval: retrieved })

      // ── Start recall prefetch asynchronously ───────────────────────
      const recentText = input.messages.map((m) => m.content).join(' ')
      const memDocs = await memdirStore.listDocuments()
      const storedMd = await memdirStore.getMemoryMd()
      const memoryMdContent =
        storedMd ?? buildMemoryMd(memDocs, { tokenBudget: state.settings.briefTokenCap })

      const recallDeps: RecallDeps = {
        runRecallModel: (manifest, text) =>
          makeRecallRequest(api, manifest, text, {
            model: state.settings.directorModel,
            mode: state.settings.directorMode,
          }),
        log: (msg) => api.log(msg),
      }

      const recallAbort = new AbortController()

      // ── Compute query embedding for vector prefilter ─────────────
      let queryVector: number[] | undefined
      let vectorVersion: string | undefined
      const settings = state.settings
      const embeddingClient = buildEmbeddingClient(api, settings)
      if (embeddingClient) {
        vectorVersion = getVectorVersion(settings)
        try {
          const embResult = await embeddingClient.embed(recentText.slice(0, 2000))
          if (embResult.ok) {
            queryVector = embResult.vector
          }
        } catch (err) {
          api.log(`Query embedding failed: ${err}`)
        }
      }

      const recallInput: FindRelevantMemoriesInput = {
        docs: memDocs,
        recentText,
        memoryMdContent,
        ...(queryVector && vectorVersion ? { queryVector, vectorVersion } : {}),
      }

      const recallPromise = findRelevantMemories(
        recallDeps,
        recallInput,
        recallCache,
        { signal: recallAbort.signal },
      )

      // ── Join recall with timeout / fallback budget ─────────────────
      let recalledDocsBlock = memoryMdContent // always inject MEMORY.md at minimum
      try {
        const recallResult = await Promise.race([
          recallPromise,
          new Promise<null>((resolve) => setTimeout(() => {
            recallAbort.abort()
            resolve(null)
          }, RECALL_TIMEOUT_MS)),
        ])

        if (recallResult) {
          recalledDocsBlock = formatRecalledDocsBlock(recallResult)
        }
      } catch (err) {
        api.log(`Recall prefetch failed: ${err}`)
      }

      // ── Assemble Director prompt ───────────────────────────────────
      const promptPreset = resolvePromptPreset(state.settings)
      const notebookBlock = formatNotebookBlock(sessionNotebook.snapshot())

      const service = createDirectorService(api, state.settings)
      const result = await service.preRequest({
        messages: input.messages,
        directorState: state.director,
        memory: projectRetrievedMemory(state, retrieved),
        assertiveness: state.settings.assertiveness,
        briefTokenCap: state.settings.briefTokenCap,
        promptPreset,
        notebookBlock: notebookBlock || '',
        recalledDocsBlock,
      })

      if (!result.ok) {
        await store.writeFirst((current) => recordDirectorFailure(current, result.error))
        throw new Error(result.error)
      }

      await store.writeFirst((current) => recordDirectorSuccess(current))
      return result.brief
    },

    async postResponse(input: DirectorPostResponseInput) {
      const state = await store.load()
      if (!state.settings.postReviewEnabled) return null

      const promptPreset = resolvePromptPreset(state.settings)
      const service = createDirectorService(api, state.settings)
      const result = await service.postResponse({
        responseText: input.content,
        brief: input.brief,
        messages: input.messages,
        directorState: state.director,
        memory: state.memory,
        assertiveness: state.settings.assertiveness,
        promptPreset,
      })

      if (!result.ok) {
        await store.writeFirst((current) => recordDirectorFailure(current, result.error))
        throw new Error(result.error)
      }

      const userText = latestUserText(input.originalMessages)
      let warnings: string[] = []
      const applied = await store.writeFirst((current) => {
        const appliedResult = applyMemoryUpdate(current, result.update, {
          turnId: input.turnId,
          userText,
          actorText: input.content,
          brief: input.brief
        })
        warnings = appliedResult.warnings
        return appliedResult.state
      })

      for (const warning of warnings) {
        await api.log(`Director memory warning: ${warning}`)
      }

      return result.update
    }
  }

  await bootstrapPlugin(api, {
    director,
    includeTypes: initialState.settings.includeTypes,
    injectionMode: initialState.settings.injectionMode,
    outputDebounceMs: initialState.settings.outputDebounceMs,
    circuitBreaker,
    turnCache,
    sessionNotebook,
    turnRecovery,
    diagnostics,
    onTurnFinalized: (ctx) => {
      lastUserInteractionTs = Date.now()
      dreamState.turnsSinceLastDream += 1
      return housekeeping.afterTurn(ctx)
    },
    onShutdown: async () => {
      try {
        await refreshGuard.markShutdown()
      } catch {
        // Guard stamp failure must not prevent pending extraction flush
      }
      await housekeeping.shutdown()
    },
    openSettings: async () => {
      const dashboardStore = createDashboardStore(
        api,
        (mutator) => store.writeFirst(mutator),
        store.stateStorageKey,
      )
      dashboardStore.forceExtract = async () => {
        await extractionWorker.flush()
      }
      dashboardStore.forceDream = async () => {
        const blockStatus = refreshGuard.checkBlocked()
        if (blockStatus.blocked) {
          throw new Error(`blocked:${blockStatus.reason}`)
        }
        await refreshGuard.markMaintenance('force-dream')
        const result = await consolidationLock.withLock(() => dreamWorker.run())
        if (result == null) {
          throw new Error('Consolidation lock is held by another worker')
        }
      }
      dashboardStore.getRecalledDocs = async () => {
        const cached = recallCache.get()
        if (!cached) return []
        return cached.selectedDocs.map((d) => ({
          id: d.id,
          title: d.title,
          freshness: d.freshness,
        }))
      }
      dashboardStore.isMemoryLocked = () => consolidationLock.isHeld()
      dashboardStore.loadDiagnostics = () => diagnostics.loadSnapshot()
      dashboardStore.checkRefreshGuard = () => refreshGuard.checkBlocked()
      dashboardStore.markMaintenance = (kind) => refreshGuard.markMaintenance(kind)
      dashboardStore.refreshEmbeddings = async () => {
        const currentState = await store.load()
        const client = buildEmbeddingClient(api, currentState.settings)
        if (!client) return 0
        const version = getVectorVersion(currentState.settings)
        return embedDocuments({
          memdirStore,
          embeddingClient: client,
          vectorVersion: version,
          log: (msg) => api.log(msg),
        })
      }
      dashboardStore.getEmbeddingCacheStatus = async () => {
        const currentState = await store.load()
        const docs = await memdirStore.listDocuments()
        const version = getVectorVersion(currentState.settings)
        const enabled = currentState.settings.embeddingsEnabled
        const supported = isProviderSupported(currentState.settings.embeddingProvider)
        const status = computeEmbeddingCacheStatus(docs, version, enabled)
        return { ...status, supported }
      }
      await openDashboard(api, dashboardStore)
    }
  })

  // ── Startup recovery ─────────────────────────────────────────────
  try {
    await attemptStartupRecovery(turnRecovery, {
      postResponse: (input) => director.postResponse(input).then(() => {}),
      runHousekeeping: (ctx) => housekeeping.afterTurn(ctx),
      log: (msg) => api.log(msg),
    })
    await diagnostics.recordRecovery('ok', 'startup recovery completed')
  } catch (err) {
    await diagnostics.recordRecovery('error', err instanceof Error ? err.message : String(err))
  }
}

export default registerDirectorActorPlugin

function isRisuaiApiLike(value: unknown): value is RisuaiApi {
  if (value == null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.addRisuReplacer === 'function' &&
    typeof candidate.addRisuScriptHandler === 'function' &&
    typeof candidate.runLLMModel === 'function' &&
    candidate.pluginStorage != null
  )
}

const autoApiCandidates = [
  (globalThis as Record<string, unknown>).risuai,
  (globalThis as Record<string, unknown>).Risuai,
  (globalThis as Record<string, unknown>).RisuAI
]

for (const candidate of autoApiCandidates) {
  if (!isRisuaiApiLike(candidate)) continue
  void registerDirectorActorPlugin(candidate).catch((error) => {
    console.error('RisuAI Director Actor Plugin bootstrap failed:', error)
  })
  break
}
