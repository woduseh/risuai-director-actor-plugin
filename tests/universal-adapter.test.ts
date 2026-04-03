import { classifyPromptTopology, injectDirectorBrief, serializeDirectorBrief } from '../src/adapter/universalPromptAdapter.js'
import type { OpenAIChat, SceneBrief } from '../src/contracts/types.js'

const sampleBrief: SceneBrief = {
  confidence: 0.91,
  pacing: 'steady',
  beats: [{ goal: 'Increase pressure', reason: 'The scene needs friction' }],
  continuityLocks: ['A still hides the letter.'],
  ensembleWeights: { A: 1 },
  styleInheritance: { genre: 'mythic', register: 'literary' },
  forbiddenMoves: ['Do not resolve the conflict yet.'],
  memoryHints: ['letter']
}

describe('universal prompt adapter', () => {
  test('classifies author-note landmarks', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: 'Author Note: keep the romance restrained.' },
      { role: 'user', content: 'Continue the scene.' }
    ]

    const topology = classifyPromptTopology(messages)

    expect(topology.authorNoteIndex).toBe(1)
    expect(topology.latestUserIndex).toBe(2)
  })

  test('injects after author-note when available', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: 'Author Note: keep the romance restrained.' },
      { role: 'user', content: 'Continue the scene.' }
    ]

    const result = injectDirectorBrief(messages, sampleBrief, 'auto')

    expect(result.diagnostics.strategy).toBe('author-note')
    expect(result.messages[2]?.content).toContain('<director-brief version="1">')
    expect(result.messages[3]?.role).toBe('user')
  })

  test('falls back to latest-user insertion when no author-note exists', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'user', content: 'Continue the scene.' }
    ]

    const result = injectDirectorBrief(messages, sampleBrief, 'auto')

    expect(result.diagnostics.strategy).toBe('adjacent-user')
    expect(result.messages[1]?.content).toContain('<director-brief version="1">')
    expect(result.messages[2]?.role).toBe('user')
  })

  test('serializes XML safely for angle brackets and ampersands', () => {
    const xml = serializeDirectorBrief({
      ...sampleBrief,
      continuityLocks: ['A < B & C > D']
    })

    expect(xml).toContain('A &lt; B &amp; C &gt; D')
  })

  test('removes stale director-injected messages before reinjecting', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: 'Author Note: keep the romance restrained.' },
      { role: 'system', content: '<director-brief version="1">OLD</director-brief>', __directorInjected: true, __directorTag: 'director-brief' },
      { role: 'user', content: 'Continue the scene.' }
    ]

    const result = injectDirectorBrief(messages, sampleBrief, 'auto')

    const injected = result.messages.filter((m) => m.__directorInjected)
    expect(injected).toHaveLength(1)
    expect(injected[0]?.content).toContain('<director-brief version="1">')
    expect(injected[0]?.content).not.toContain('OLD')
  })

  test('does not mutate the original messages array', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Hello.' }
    ]
    const originalLength = messages.length

    injectDirectorBrief(messages, sampleBrief, 'auto')

    expect(messages).toHaveLength(originalLength)
  })

  test('preserves user author notes when injecting', () => {
    const authorNoteContent = 'Author Note: keep the romance restrained.'
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: authorNoteContent },
      { role: 'user', content: 'Continue the scene.' }
    ]

    const result = injectDirectorBrief(messages, sampleBrief, 'auto')

    const authorNote = result.messages.find((m) => m.content === authorNoteContent)
    expect(authorNote).toBeDefined()
    expect(authorNote?.__directorInjected).toBeUndefined()
  })

  test('falls back to bottom when no user message exists', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'System prompt only.' }
    ]

    const result = injectDirectorBrief(messages, sampleBrief, 'auto')

    expect(result.diagnostics.strategy).toBe('bottom')
    expect(result.diagnostics.degraded).toBe(true)
    expect(result.messages[result.messages.length - 1]?.__directorInjected).toBe(true)
  })

  test('forced adjacent-user mode works even with author-note present', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: 'Author Note: keep the romance restrained.' },
      { role: 'user', content: 'Continue the scene.' }
    ]

    const result = injectDirectorBrief(messages, sampleBrief, 'adjacent-user')

    expect(result.diagnostics.strategy).toBe('adjacent-user')
    // Injected before the latest user message
    const userIdx = result.messages.findIndex((m) => m.role === 'user')
    expect(result.messages[userIdx - 1]?.__directorInjected).toBe(true)
  })

  test('topology detects latestAssistantIndex', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Hello.' },
      { role: 'assistant', content: 'Hi there.' },
      { role: 'user', content: 'How are you?' }
    ]

    const topology = classifyPromptTopology(messages)

    expect(topology.latestAssistantIndex).toBe(2)
    expect(topology.latestUserIndex).toBe(3)
  })

  test('serialized XML includes all brief sections', () => {
    const xml = serializeDirectorBrief(sampleBrief)

    expect(xml).toContain('<director-brief version="1">')
    expect(xml).toContain('</director-brief>')
    expect(xml).toContain('<confidence>0.91</confidence>')
    expect(xml).toContain('<pacing>steady</pacing>')
    expect(xml).toContain('<goal>Increase pressure</goal>')
    expect(xml).toContain('<reason>The scene needs friction</reason>')
    expect(xml).toContain('<lock>A still hides the letter.</lock>')
    expect(xml).toContain('<genre>mythic</genre>')
    expect(xml).toContain('<register>literary</register>')
    expect(xml).toContain('<move>Do not resolve the conflict yet.</move>')
    expect(xml).toContain('<hint>letter</hint>')
  })

  test('escapes XML in ensemble weight names', () => {
    const xml = serializeDirectorBrief({
      ...sampleBrief,
      ensembleWeights: { 'A & B': 1, 'C < D': 2 }
    })

    expect(xml).toContain('name="A &amp; B"')
    expect(xml).toContain('name="C &lt; D"')
  })
})
