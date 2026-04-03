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
import { createBackgroundHousekeeping } from './runtime/backgroundHousekeeping.js'
import { CircuitBreaker } from './runtime/circuitBreaker.js'
import { hashExtractionContext } from './runtime/network.js'
import {
  bootstrapPlugin,
  type DirectorPostResponseInput,
  type DirectorPreRequestInput
} from './runtime/plugin.js'
import { openDashboard, createDashboardStore } from './ui/dashboardApp.js'

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// safeLocalStorage keys for extraction hot cache
const LS_LAST_EXTRACTION_TS = 'director:extraction:lastTs'
const LS_LAST_PROCESSED_CURSOR = 'director:extraction:cursor'

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
  const store = new CanonicalStore(api.pluginStorage, {
    storageKey: scopeResolution.storageKey,
    migrateFromFlatKey: !scopeResolution.isFallback,
  })
  const turnCache = new TurnCache()
  const initialState = await store.load()
  const circuitBreaker = new CircuitBreaker(
    initialState.settings.cooldownFailureThreshold,
    initialState.settings.cooldownMs
  )

  // Memdir store for extracted document persistence
  const memdirScopeKey = scopeResolution.isFallback
    ? 'default'
    : scopeResolution.storageKey
  const memdirStore = new MemdirStore(api.pluginStorage, memdirScopeKey)

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
        const result = await service.postResponse({
          responseText: ctx.content,
          brief: ctx.brief,
          messages: ctx.messages,
          directorState: state.director,
          memory: state.memory,
          assertiveness: state.settings.assertiveness,
          promptPreset,
        })

        if (!result.ok) {
          return { applied: false, memoryUpdate: null }
        }

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

        for (const doc of docs) {
          await memdirStore.putDocument(doc)
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
  const housekeeping = createBackgroundHousekeeping({
    submitExtraction: (ctx) => extractionWorker.submit(ctx),
    flushExtraction: () => extractionWorker.flush(),
    getExtractionMinTurnInterval: () => initialState.settings.extractionMinTurnInterval,
    log(message: string): void {
      api.log(message)
    },
  })

  const director = {
    async preRequest(input: DirectorPreRequestInput) {
      const state = await store.load()
      if (!state.settings.enabled) return null

      const retrieved = retrieveMemory({
        state,
        messages: input.messages
      })
      turnCache.patch(input.turnId, { retrieval: retrieved })
      const promptPreset = resolvePromptPreset(state.settings)

      const service = createDirectorService(api, state.settings)
      const result = await service.preRequest({
        messages: input.messages,
        directorState: state.director,
        memory: projectRetrievedMemory(state, retrieved),
        assertiveness: state.settings.assertiveness,
        briefTokenCap: state.settings.briefTokenCap,
        promptPreset,
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
    onTurnFinalized: (ctx) => housekeeping.afterTurn(ctx),
    openSettings: async () => {
      const dashboardStore = createDashboardStore(
        api,
        (mutator) => store.writeFirst(mutator),
        store.stateStorageKey,
      )
      await openDashboard(api, dashboardStore)
    }
  })
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
