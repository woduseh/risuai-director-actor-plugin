import type { RisuaiApi } from '../contracts/risuai.js'
import type {
  HookRequestType,
  InjectionMode,
  MemoryUpdate,
  OpenAIChat,
  RetrievalResult,
  SceneBrief,
  TurnContext,
} from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'
import { injectDirectorBrief, injectDirectorArtifacts } from '../adapter/universalPromptAdapter.js'
import type { ExtractionContext } from '../memory/extractMemories.js'
import { TurnCache } from '../memory/turnCache.js'
import { registerPluginUi, showSettingsOverlay } from '../ui/settings.js'
import type { TurnRecoveryManager } from './turnRecovery.js'
import type { DiagnosticsManager } from './diagnostics.js'

// ---------------------------------------------------------------------------
// Public contracts
// ---------------------------------------------------------------------------

export interface DirectorPreRequestInput {
  turnId: string
  type: HookRequestType
  messages: OpenAIChat[]
}

export interface DirectorPostResponseInput {
  turnId: string
  type: HookRequestType
  content: string
  brief: SceneBrief
  messages: OpenAIChat[]
  originalMessages: OpenAIChat[]
  retrieval?: RetrievalResult
}

export interface DirectorPreRequestResult {
  brief: SceneBrief
  /** Actor-visible long-memory context block carried for dual injection. */
  actorMemoryContext?: string
}

export interface DirectorFunctions {
  preRequest(input: DirectorPreRequestInput): Promise<DirectorPreRequestResult | null>
  postResponse(input: DirectorPostResponseInput): Promise<MemoryUpdate | null>
}

export interface CircuitBreakerLike {
  isOpen(): boolean
  recordSuccess(): void
  recordFailure(reason: string): void
}

export interface BootstrapOptions {
  director: DirectorFunctions
  includeTypes?: HookRequestType[]
  injectionMode?: InjectionMode
  circuitBreaker?: CircuitBreakerLike
  outputDebounceMs?: number
  turnCache?: TurnCache
  openSettings?: () => Promise<void> | void
  /** Called after a turn is finalized, for background extraction. */
  onTurnFinalized?: (ctx: ExtractionContext) => Promise<void> | void
  /** Called during plugin unload to flush pending background work. */
  onShutdown?: () => Promise<void> | void
  /** Optional session notebook for tracking turn activity thresholds. */
  sessionNotebook?: { recordTurn(estimatedTokens: number): void }
  /** Optional durable turn recovery manager for crash-safe turn processing. */
  turnRecovery?: TurnRecoveryManager
  /** Optional diagnostics manager for recording runtime breadcrumbs. */
  diagnostics?: DiagnosticsManager
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function safeLog(api: RisuaiApi, message: string): Promise<void> {
  await api.log(message)
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function bootstrapPlugin(
  api: RisuaiApi,
  options: BootstrapOptions
): Promise<void> {
  const { director } = options
  const includeTypes =
    options.includeTypes ?? [...DEFAULT_DIRECTOR_SETTINGS.includeTypes]
  const injectionMode =
    options.injectionMode ?? DEFAULT_DIRECTOR_SETTINGS.injectionMode
  const outputDebounceMs =
    options.outputDebounceMs ?? DEFAULT_DIRECTOR_SETTINGS.outputDebounceMs
  const circuitBreaker = options.circuitBreaker ?? null
  const turnCache = options.turnCache ?? new TurnCache()
  const openSettings =
    options.openSettings ?? (async () => showSettingsOverlay(api))
  const onTurnFinalized = options.onTurnFinalized ?? null
  const onShutdown = options.onShutdown ?? null
  const sessionNotebook = options.sessionNotebook ?? null
  const turnRecovery = options.turnRecovery ?? null
  const diagnostics = options.diagnostics ?? null

  let currentTurnId: string | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let turnIndex = 0

  // ── helpers ──────────────────────────────────────────────────────────

  function clearActiveTurn(): void {
    if (currentTurnId !== null) {
      turnCache.drop(currentTurnId)
      currentTurnId = null
    }
  }

  function getCurrentTurn() {
    return currentTurnId ? turnCache.get(currentTurnId) ?? null : null
  }

  async function finalizeTurn(content?: string): Promise<void> {
    const activeTurn = getCurrentTurn()
    if (!activeTurn || activeTurn.finalized) return

    turnIndex += 1

    // Record turn activity for session notebook threshold tracking
    if (sessionNotebook) {
      const estimatedTokens = Math.ceil((content ?? '').length / 4)
      sessionNotebook.recordTurn(estimatedTokens)
    }

    try {
      const finalizePatch: { finalized: true; lastOutputText?: string } = {
        finalized: true
      }
      const finalOutput = content ?? activeTurn.lastOutputText
      if (finalOutput !== undefined) {
        finalizePatch.lastOutputText = finalOutput
      }
      turnCache.patch(activeTurn.turnId, finalizePatch)
      const finalizedTurn = turnCache.get(activeTurn.turnId)

      if (!finalizedTurn?.brief) {
        clearActiveTurn()
        return
      }

      const postInput: DirectorPostResponseInput = {
        turnId: finalizedTurn.turnId,
        type: finalizedTurn.type,
        content: content ?? finalizedTurn.lastOutputText ?? '',
        brief: finalizedTurn.brief,
        messages: finalizedTurn.latestMessages ?? finalizedTurn.originalMessages,
        originalMessages: finalizedTurn.originalMessages
      }
      if (finalizedTurn.retrieval !== undefined) {
        postInput.retrieval = finalizedTurn.retrieval
      }

      // Persist recovery record before the potentially-failing postResponse
      if (turnRecovery) {
        await turnRecovery.persist(turnIndex, postInput)
      }

      await director.postResponse(postInput)
      circuitBreaker?.recordSuccess()

      // Advance recovery record — postResponse succeeded
      if (turnRecovery) {
        await turnRecovery.advance(postInput.turnId)
      }

      // Notify housekeeping for background extraction
      let housekeepingFailed = false
      if (onTurnFinalized && finalizedTurn.brief) {
        try {
          await onTurnFinalized({
            turnId: finalizedTurn.turnId,
            turnIndex,
            type: finalizedTurn.type,
            content: postInput.content,
            messages: postInput.messages,
            brief: finalizedTurn.brief,
          })
        } catch (hkErr) {
          housekeepingFailed = true
          await safeLog(api, `Housekeeping afterTurn failed: ${hkErr}`)
        }
      }

      // Clear recovery record only when the full lifecycle completed.
      // When housekeeping failed the record stays at housekeeping-pending
      // so startup recovery can replay just the housekeeping stage.
      if (turnRecovery && !housekeepingFailed) {
        await turnRecovery.clear()
      }
    } catch (err) {
      await safeLog(api, `Director postResponse failed: ${err}`)
      circuitBreaker?.recordFailure(String(err))
    } finally {
      clearActiveTurn()
    }
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  // ── beforeRequest ────────────────────────────────────────────────────

  await api.addRisuReplacer('beforeRequest', async (messages, type) => {
    if (!includeTypes.includes(type)) return messages

    clearDebounce()
    clearActiveTurn()

    if (circuitBreaker?.isOpen()) return messages

    const turn = turnCache.begin(type, messages)
    currentTurnId = turn.turnId

    try {
      const result = await director.preRequest({
        turnId: turn.turnId,
        type,
        messages
      })

      await diagnostics?.recordHook('beforeRequest', type)

      if (!result) {
        clearActiveTurn()
        return messages
      }

      const injected = result.actorMemoryContext
        ? injectDirectorArtifacts(messages, result.brief, result.actorMemoryContext, injectionMode)
        : injectDirectorBrief(messages, result.brief, injectionMode)
      const turnPatch: Partial<TurnContext> = {
        brief: result.brief,
        latestMessages: injected.messages,
      }
      if (result.actorMemoryContext !== undefined) {
        turnPatch.actorMemoryContext = result.actorMemoryContext
      }
      turnCache.patch(turn.turnId, turnPatch)

      return injected.messages
    } catch (err) {
      clearActiveTurn()
      await safeLog(api, `Director preRequest failed: ${err}`)
      await diagnostics?.recordError('preRequest', err)
      circuitBreaker?.recordFailure(String(err))
      return messages
    }
  })

  // ── afterRequest (non-streaming finalisation) ────────────────────────

  await api.addRisuReplacer('afterRequest', async (content, type) => {
    if (!includeTypes.includes(type)) return content

    if (getCurrentTurn()) {
      clearDebounce()
      await diagnostics?.recordHook('afterRequest', type)
      await finalizeTurn(content)
    }
    return content
  })

  // ── output handler (streaming debounce) ──────────────────────────────

  await api.addRisuScriptHandler('output', async (content) => {
    const turn = getCurrentTurn()
    if (!turn || turn.finalized) return null

    turnCache.patch(turn.turnId, {
      lastOutputText: content
    })
    clearDebounce()
    await diagnostics?.recordHook('output')

    debounceTimer = setTimeout(() => {
      void finalizeTurn()
    }, outputDebounceMs)

    return null
  })

  // ── UI registrations ─────────────────────────────────────────────────

  await registerPluginUi(api, { onOpen: openSettings })

  // ── cleanup ──────────────────────────────────────────────────────────

  await api.onUnload(async () => {
    clearDebounce()
    clearActiveTurn()
    await diagnostics?.recordHook('shutdown')
    if (onShutdown) {
      try {
        await onShutdown()
      } catch (err) {
        await safeLog(api, `Plugin shutdown hook failed: ${err}`)
      }
    }
  })
}
