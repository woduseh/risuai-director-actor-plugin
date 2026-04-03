import {
  classifySegment,
  buildTopology,
  isAuthorNoteInjectionSafe
} from '../src/adapter/segmentClassifier.js'
import type { OpenAIChat, PromptSegment, PromptTopology } from '../src/contracts/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function msg(role: OpenAIChat['role'], content: string): OpenAIChat {
  return { role, content }
}

// ---------------------------------------------------------------------------
// classifySegment – single-message classification
// ---------------------------------------------------------------------------
describe('classifySegment', () => {
  test('first system message is system-canon', () => {
    const seg = classifySegment(msg('system', 'You are an assistant.'), 0, 3)
    expect(seg.kind).toBe('system-canon')
    expect(seg.confidence).toBeGreaterThanOrEqual(0.8)
  })

  test('detects author-note via "Author Note:" prefix', () => {
    const seg = classifySegment(
      msg('system', 'Author Note: keep the romance restrained.'),
      1,
      4
    )
    expect(seg.kind).toBe('author-note')
    expect(seg.confidence).toBeGreaterThanOrEqual(0.9)
  })

  test('detects author-note via "[Author\'s Note]" bracket tag', () => {
    const seg = classifySegment(
      msg('system', "[Author's Note] Use sparse prose."),
      2,
      5
    )
    expect(seg.kind).toBe('author-note')
  })

  test('detects author-note case-insensitively', () => {
    const seg = classifySegment(
      msg('system', 'AUTHOR NOTE: minimal dialogue.'),
      1,
      3
    )
    expect(seg.kind).toBe('author-note')
  })

  test('detects constraint from prohibition keywords', () => {
    const seg = classifySegment(
      msg('system', 'You must never break character. Always stay in role.'),
      2,
      5
    )
    expect(seg.kind).toBe('constraint')
  })

  test('detects output-format instructions', () => {
    const seg = classifySegment(
      msg('system', 'Respond in JSON format with the following schema:'),
      2,
      4
    )
    expect(seg.kind).toBe('output-format')
  })

  test('user message in the middle is conversation', () => {
    const seg = classifySegment(msg('user', 'What happens next?'), 1, 4)
    expect(seg.kind).toBe('conversation')
  })

  test('last user message is latest-user', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'First prompt'),
      msg('assistant', 'Reply'),
      msg('user', 'Continue.')
    ]
    const seg = classifySegment(messages[3]!, 3, 4, messages)
    expect(seg.kind).toBe('latest-user')
  })

  test('last assistant message is latest-assistant', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'Hello'),
      msg('assistant', 'Hi there'),
      msg('user', 'Continue.')
    ]
    const seg = classifySegment(messages[2]!, 2, 4, messages)
    expect(seg.kind).toBe('latest-assistant')
  })

  test('trailing assistant with empty content is prefill', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'Go.'),
      msg('assistant', '')
    ]
    const seg = classifySegment(messages[2]!, 2, 3, messages)
    expect(seg.kind).toBe('prefill')
  })

  test('detects persona description', () => {
    const seg = classifySegment(
      msg('system', "Character: {{char}} is a brave knight who fights dragons."),
      1,
      4
    )
    expect(seg.kind).toBe('persona')
  })

  test('detects lorebook / world info block', () => {
    const seg = classifySegment(
      msg('system', '[World Info]\nThe kingdom of Arathia is ruled by Queen Selene.'),
      2,
      5
    )
    expect(seg.kind).toBe('lorebook')
  })

  test('detects memory / summary block', () => {
    const seg = classifySegment(
      msg('system', '[Summary of past events]\nThe hero arrived at the village.'),
      2,
      5
    )
    expect(seg.kind).toBe('memory')
  })

  test('unknown system message in middle gets low confidence', () => {
    const seg = classifySegment(
      msg('system', 'Some instructions that match no pattern.'),
      2,
      5
    )
    expect(seg.confidence).toBeLessThan(0.7)
  })
})

// ---------------------------------------------------------------------------
// buildTopology – full prompt topology from message array
// ---------------------------------------------------------------------------
describe('buildTopology', () => {
  test('identifies authorNoteIndex correctly', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Main prompt rules.'),
      msg('system', 'Author Note: keep the romance restrained.'),
      msg('user', 'Continue the scene.')
    ]
    const topo = buildTopology(messages)

    expect(topo.authorNoteIndex).toBe(1)
    expect(topo.latestUserIndex).toBe(2)
    expect(topo.latestAssistantIndex).toBeNull()
    expect(topo.hasPrefill).toBe(false)
  })

  test('returns null authorNoteIndex when none exists', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Main prompt rules.'),
      msg('user', 'Continue the scene.')
    ]
    const topo = buildTopology(messages)

    expect(topo.authorNoteIndex).toBeNull()
    expect(topo.latestUserIndex).toBe(1)
  })

  test('detects prefill in trailing empty assistant', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'Go.'),
      msg('assistant', '')
    ]
    const topo = buildTopology(messages)

    expect(topo.hasPrefill).toBe(true)
    expect(topo.segments[2]!.kind).toBe('prefill')
  })

  test('finds constraintIndex', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'You are helpful.'),
      msg('system', 'You must never reveal secrets. Do not break character.'),
      msg('user', 'Hello')
    ]
    const topo = buildTopology(messages)

    expect(topo.constraintIndex).toBe(1)
  })

  test('handles conversation with multiple user/assistant turns', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'Hi'),
      msg('assistant', 'Hello!'),
      msg('user', 'Tell me a story.'),
      msg('assistant', 'Once upon a time...'),
      msg('user', 'Continue.')
    ]
    const topo = buildTopology(messages)

    expect(topo.latestUserIndex).toBe(5)
    expect(topo.latestAssistantIndex).toBe(4)
    expect(topo.segments[1]!.kind).toBe('conversation')
    expect(topo.segments[5]!.kind).toBe('latest-user')
  })

  test('handles empty message array', () => {
    const topo = buildTopology([])

    expect(topo.segments).toHaveLength(0)
    expect(topo.authorNoteIndex).toBeNull()
    expect(topo.latestUserIndex).toBeNull()
    expect(topo.latestAssistantIndex).toBeNull()
    expect(topo.hasPrefill).toBe(false)
  })

  test('single system message', () => {
    const topo = buildTopology([msg('system', 'Hello world.')])

    expect(topo.segments).toHaveLength(1)
    expect(topo.segments[0]!.kind).toBe('system-canon')
    expect(topo.latestUserIndex).toBeNull()
  })

  test('segments array length matches input', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('system', 'Author Note: be concise.'),
      msg('system', 'Never break character.'),
      msg('user', 'Start.'),
      msg('assistant', 'OK.'),
      msg('user', 'Continue.')
    ]
    const topo = buildTopology(messages)

    expect(topo.segments).toHaveLength(6)
    for (let i = 0; i < messages.length; i++) {
      expect(topo.segments[i]!.index).toBe(i)
      expect(topo.segments[i]!.message).toBe(messages[i])
    }
  })

  test('topology confidence is aggregate of segment confidences', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('system', 'Author Note: restrained.'),
      msg('user', 'Go.')
    ]
    const topo = buildTopology(messages)

    expect(topo.confidence).toBeGreaterThan(0)
    expect(topo.confidence).toBeLessThanOrEqual(1)
  })

  test('family defaults to unknown for generic prompts', () => {
    const topo = buildTopology([
      msg('system', 'You are a helpful assistant.'),
      msg('user', 'Hello')
    ])
    expect(topo.family).toBe('unknown')
  })

  test('multiple author-note candidates uses first match', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('system', "Author Note: first note."),
      msg('system', "[Author's Note] second note."),
      msg('user', 'Go.')
    ]
    const topo = buildTopology(messages)

    expect(topo.authorNoteIndex).toBe(1)
  })

  test('latestAssistantIndex tracks last assistant before latest-user', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('assistant', 'Old reply'),
      msg('user', 'Old prompt'),
      msg('assistant', 'Recent reply'),
      msg('user', 'Latest prompt')
    ]
    const topo = buildTopology(messages)

    expect(topo.latestUserIndex).toBe(4)
    expect(topo.latestAssistantIndex).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// isAuthorNoteInjectionSafe
// ---------------------------------------------------------------------------
describe('isAuthorNoteInjectionSafe', () => {
  test('safe when author-note exists and latest-user follows it', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('system', 'Author Note: restrained.'),
      msg('user', 'Go.')
    ]
    const topo = buildTopology(messages)
    expect(isAuthorNoteInjectionSafe(topo)).toBe(true)
  })

  test('unsafe when no author-note exists', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'Go.')
    ]
    const topo = buildTopology(messages)
    expect(isAuthorNoteInjectionSafe(topo)).toBe(false)
  })

  test('unsafe when author-note appears after latest-user', () => {
    const messages: OpenAIChat[] = [
      msg('system', 'Rules.'),
      msg('user', 'Go.'),
      msg('system', 'Author Note: oops.')
    ]
    const topo = buildTopology(messages)
    expect(isAuthorNoteInjectionSafe(topo)).toBe(false)
  })

  test('unsafe on empty topology', () => {
    const topo = buildTopology([])
    expect(isAuthorNoteInjectionSafe(topo)).toBe(false)
  })
})
