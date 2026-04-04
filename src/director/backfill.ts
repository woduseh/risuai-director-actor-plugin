import type { RisuaiApi } from '../contracts/risuai.js'
import type {
  ChatRole,
  DirectorPluginState,
  OpenAIChat,
  SceneBrief,
} from '../contracts/types.js'
import { applyMemoryUpdate } from '../memory/applyUpdate.js'
import { tryGetChat } from '../memory/scopeResolver.js'
import { resolvePromptPreset } from './prompt.js'
import { createDirectorService } from './service.js'

const BACKFILL_WINDOW_MESSAGES = 8
const MAX_BACKFILL_ASSISTANT_TURNS = 50

export interface ChatBackfillStateStore {
  load(): Promise<DirectorPluginState>
  save(next: DirectorPluginState): Promise<void>
}

export interface ChatBackfillResult {
  totalAssistantTurns: number
  processedTurns: number
  appliedUpdates: number
  warnings: string[]
}

function normalizeHostRole(role: string): ChatRole {
  const normalized = role.trim().toLowerCase()
  if (normalized === 'assistant' || normalized === 'char' || normalized === 'bot' || normalized === 'model') {
    return 'assistant'
  }
  if (normalized === 'system' || normalized === 'developer' || normalized === 'note') {
    return 'system'
  }
  if (normalized === 'function' || normalized === 'tool') {
    return 'function'
  }
  return 'user'
}

function buildWindowMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
  assistantIndex: number,
): OpenAIChat[] {
  const start = Math.max(0, assistantIndex - BACKFILL_WINDOW_MESSAGES + 1)
  return messages.slice(start, assistantIndex + 1).map((message) => ({
    role: normalizeHostRole(message.role),
    content: message.content,
  }))
}

function findLatestUserText(
  messages: ReadonlyArray<{ role: string; content: string }>,
  assistantIndex: number,
): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (normalizeHostRole(messages[index]!.role) === 'user') {
      return messages[index]!.content
    }
  }
  return ''
}

function buildBackfillBrief(state: DirectorPluginState): SceneBrief {
  return {
    confidence: 0.5,
    pacing: state.director.pacingMode,
    beats: [],
    continuityLocks: [],
    ensembleWeights: {},
    styleInheritance: {},
    forbiddenMoves: [],
    memoryHints: [],
  }
}

export async function backfillCurrentChat(
  api: RisuaiApi,
  stateStore: ChatBackfillStateStore,
): Promise<ChatBackfillResult> {
  const chat = await tryGetChat(api)
  if (!chat) {
    return {
      totalAssistantTurns: 0,
      processedTurns: 0,
      appliedUpdates: 0,
      warnings: ['Current chat is unavailable for backfill.'],
    }
  }

  const assistantIndexes = chat.messages
    .map((message, index) =>
      normalizeHostRole(message.role) === 'assistant' ? index : -1,
    )
    .filter((index) => index >= 0)
    .slice(-MAX_BACKFILL_ASSISTANT_TURNS)

  if (assistantIndexes.length === 0) {
    return {
      totalAssistantTurns: 0,
      processedTurns: 0,
      appliedUpdates: 0,
      warnings: ['Current chat has no assistant turns to extract.'],
    }
  }

  let state = await stateStore.load()
  const service = createDirectorService(api, state.settings)
  const warnings: string[] = []
  let processedTurns = 0
  let appliedUpdates = 0

  await api.log(
    `[director-plugin] Backfill started for ${String(assistantIndexes.length)} assistant turns.`,
  )

  for (const assistantIndex of assistantIndexes) {
    await api.log(
      `[director-plugin] Backfill progress ${String(processedTurns + 1)}/${String(assistantIndexes.length)}.`,
    )
    const messages = buildWindowMessages(chat.messages, assistantIndex)
    const responseText = messages[messages.length - 1]?.content ?? ''
    const brief = buildBackfillBrief(state)
    const result = await service.postResponse({
      responseText,
      brief,
      messages,
      directorState: state.director,
      memory: state.memory,
      assertiveness: state.settings.assertiveness,
      promptPreset: resolvePromptPreset(state.settings),
    })

    processedTurns += 1

    if (!result.ok) {
      warnings.push(result.error)
      continue
    }

    const applied = applyMemoryUpdate(state, result.update, {
      turnId: `backfill-turn-${assistantIndex}`,
      userText: findLatestUserText(chat.messages, assistantIndex),
      responseText: responseText,
      brief,
    })

    state = applied.state
    state.updatedAt = Date.now()
    state.metrics.totalDirectorCalls += 1
    state.metrics.totalMemoryWrites += 1
    state.metrics.lastUpdatedAt = state.updatedAt
    warnings.push(...applied.warnings)
    appliedUpdates += 1

    await stateStore.save(state)
  }

  return {
    totalAssistantTurns: assistantIndexes.length,
    processedTurns,
    appliedUpdates,
    warnings,
  }
}
