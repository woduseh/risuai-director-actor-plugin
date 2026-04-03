import type { RisuaiApi } from '../contracts/risuai.js'
import type {
  HookRequestType,
  InjectionMode,
  MemoryUpdate,
  OpenAIChat,
  RetrievalResult,
  SceneBrief
} from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'
import { injectDirectorBrief } from '../adapter/universalPromptAdapter.js'
import type { ExtractionContext } from '../memory/extractMemories.js'
import { TurnCache } from '../memory/turnCache.js'
import { registerPluginUi, showSettingsOverlay } from '../ui/settings.js'

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

export interface DirectorFunctions {
  preRequest(input: DirectorPreRequestInput): Promise<SceneBrief | null>
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

      await director.postResponse(postInput)
      circuitBreaker?.recordSuccess()

      // Notify housekeeping for background extraction
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
          await safeLog(api, `Housekeeping afterTurn failed: ${hkErr}`)
        }
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
      const brief = await director.preRequest({
        turnId: turn.turnId,
        type,
        messages
      })

      if (!brief) {
        clearActiveTurn()
        return messages
      }

      const injected = injectDirectorBrief(messages, brief, injectionMode)
      turnCache.patch(turn.turnId, {
        brief,
        latestMessages: injected.messages
      })

      return injected.messages
    } catch (err) {
      clearActiveTurn()
      await safeLog(api, `Director preRequest failed: ${err}`)
      circuitBreaker?.recordFailure(String(err))
      return messages
    }
  })

  // ── afterRequest (non-streaming finalisation) ────────────────────────

  await api.addRisuReplacer('afterRequest', async (content, type) => {
    if (!includeTypes.includes(type)) return content

    if (getCurrentTurn()) {
      clearDebounce()
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

    debounceTimer = setTimeout(() => {
      void finalizeTurn()
    }, outputDebounceMs)

    return null
  })

  // ── UI registrations ─────────────────────────────────────────────────

  await registerPluginUi(api, { onOpen: openSettings })

  // ── cleanup ──────────────────────────────────────────────────────────

  await api.onUnload(() => {
    clearDebounce()
    clearActiveTurn()
  })
}
