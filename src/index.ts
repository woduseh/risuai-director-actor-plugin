import type { RisuaiApi } from './contracts/risuai.js'
import type {
  CanonicalMemory,
  DirectorPluginState,
  OpenAIChat
} from './contracts/types.js'
import { createDirectorService } from './director/service.js'
import { CanonicalStore } from './memory/canonicalStore.js'
import { applyMemoryUpdate } from './memory/applyUpdate.js'
import { retrieveMemory } from './memory/retrieval.js'
import { TurnCache } from './memory/turnCache.js'
import { CircuitBreaker } from './runtime/circuitBreaker.js'
import {
  bootstrapPlugin,
  type DirectorPostResponseInput,
  type DirectorPreRequestInput
} from './runtime/plugin.js'
import { showSettingsOverlay } from './ui/settings.js'

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

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
  const store = new CanonicalStore(api.pluginStorage)
  const turnCache = new TurnCache()
  const initialState = await store.load()
  const circuitBreaker = new CircuitBreaker(
    initialState.settings.cooldownFailureThreshold,
    initialState.settings.cooldownMs
  )

  const director = {
    async preRequest(input: DirectorPreRequestInput) {
      const state = await store.load()
      if (!state.settings.enabled) return null

      const retrieved = retrieveMemory({
        state,
        messages: input.messages
      })
      turnCache.patch(input.turnId, { retrieval: retrieved })

      const service = createDirectorService(api, state.settings)
      const result = await service.preRequest({
        messages: input.messages,
        directorState: state.director,
        memory: projectRetrievedMemory(state, retrieved),
        assertiveness: state.settings.assertiveness,
        briefTokenCap: state.settings.briefTokenCap
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

      const service = createDirectorService(api, state.settings)
      const result = await service.postResponse({
        responseText: input.content,
        brief: input.brief,
        messages: input.messages,
        directorState: state.director,
        memory: state.memory,
        assertiveness: state.settings.assertiveness
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
    openSettings: async () => {
      const current = await store.load()
      await showSettingsOverlay(api, current.settings)
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
