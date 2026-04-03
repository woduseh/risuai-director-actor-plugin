import { describe, expect, test } from 'vitest'
import { createEmptyState, type DirectorPluginState } from '../src/contracts/types.js'
import { backfillCurrentChat } from '../src/director/backfill.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'

function attachCurrentChat(
  api: ReturnType<typeof createMockRisuaiApi>,
  chat: {
    id?: string
    name: string
    lastDate: number
    messages: Array<{ role: string; content: string }>
  },
): void {
  const host = api as unknown as Record<string, unknown>
  host.getCharacter = async () => ({ chaId: 'cha-1', name: 'Hero' })
  host.getCurrentCharacterIndex = async () => 0
  host.getCurrentChatIndex = async () => 0
  host.getChatFromIndex = async () => chat
}

describe('backfillCurrentChat', () => {
  test('extracts durable facts from current chat assistant turns and persists incremental state', async () => {
    const api = createMockRisuaiApi()
    attachCurrentChat(api, {
      id: 'chat-1',
      name: 'Session 1',
      lastDate: 1,
      messages: [
        { role: 'user', content: 'Where is the key?' },
        { role: 'assistant', content: 'A hides the key under the altar.' },
        { role: 'user', content: 'What does A do next?' },
        { role: 'assistant', content: 'A slips out through the eastern gate.' },
      ],
    })

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['The key is hidden under the altar.'],
        sceneDelta: { scenePhase: 'turn', activeCharacters: ['A'] },
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.84,
        violations: [],
        durableFacts: ['A leaves through the eastern gate.'],
        sceneDelta: { scenePhase: 'aftermath', activeCharacters: ['A'] },
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })

    let current = createEmptyState()
    const snapshots: string[][] = []

    const result = await backfillCurrentChat(api, {
      load: async () => structuredClone(current),
      save: async (next: DirectorPluginState) => {
        current = structuredClone(next)
        snapshots.push(next.memory.summaries.map((entry) => entry.text))
      },
    })

    expect(result.totalAssistantTurns).toBe(2)
    expect(result.processedTurns).toBe(2)
    expect(result.appliedUpdates).toBe(2)
    expect(current.memory.summaries.map((entry) => entry.text)).toEqual(
      expect.arrayContaining([
        'The key is hidden under the altar.',
        'A leaves through the eastern gate.',
      ]),
    )
    expect(current.memory.sceneLedger).toHaveLength(2)
    expect(snapshots).toHaveLength(2)
  })
})
