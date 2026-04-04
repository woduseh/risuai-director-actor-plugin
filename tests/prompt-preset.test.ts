import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DIRECTOR_PROMPT_PRESET,
  buildPostResponsePrompt,
  buildPreRequestPrompt,
} from '../src/director/prompt.js'
import type {
  DirectorContext,
  PostReviewContext,
} from '../src/director/prompt.js'
import { createEmptyState, DEFAULT_DIRECTOR_SETTINGS, type SceneBrief } from '../src/contracts/types.js'

const VALID_BRIEF: SceneBrief = {
  confidence: 0.85,
  pacing: 'steady',
  beats: [{ goal: 'introduce tension', reason: 'arc needs escalation' }],
  continuityLocks: ['Character A has the key'],
  ensembleWeights: { 'Character A': 1 },
  styleInheritance: { genre: 'fantasy' },
  forbiddenMoves: ['Do not kill Character A'],
  memoryHints: ['key', 'door'],
}

function makeDirectorContext(overrides?: Partial<DirectorContext>): DirectorContext {
  const state = createEmptyState()
  return {
    messages: [
      { role: 'system', content: 'You are a character in a story.' },
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Message 2' },
      { role: 'user', content: 'Message 3' },
      { role: 'assistant', content: 'Message 4' },
    ],
    directorState: state.director,
    memory: state.memory,
    assertiveness: 'standard',
    briefTokenCap: DEFAULT_DIRECTOR_SETTINGS.briefTokenCap,
    ...overrides,
  }
}

function makePostReviewContext(
  overrides?: Partial<PostReviewContext>,
): PostReviewContext {
  const state = createEmptyState()
  return {
    responseText: 'Character A picked up the ancient key and turned toward the door.',
    brief: VALID_BRIEF,
    messages: [
      { role: 'system', content: 'You are a character in a story.' },
      { role: 'user', content: 'Tell me about the ancient key.' },
      {
        role: 'assistant',
        content: 'Character A picked up the ancient key and turned toward the door.',
      },
    ],
    directorState: state.director,
    memory: state.memory,
    assertiveness: 'standard',
    ...overrides,
  }
}

describe('default settings', () => {
  test('default briefTokenCap reflects the higher soft cap', () => {
    expect(DEFAULT_DIRECTOR_SETTINGS.briefTokenCap).toBe(1024)
  })
})

describe('director prompt presets', () => {
  test('explicit default preset preserves pre-request prompt output', () => {
    const withoutPreset = buildPreRequestPrompt(makeDirectorContext())
    const withDefaultPreset = buildPreRequestPrompt(
      makeDirectorContext({
        promptPreset: DEFAULT_DIRECTOR_PROMPT_PRESET,
      }),
    )

    expect(withDefaultPreset).toEqual(withoutPreset)
  })

  test('explicit default preset preserves post-response prompt output', () => {
    const withoutPreset = buildPostResponsePrompt(makePostReviewContext())
    const withDefaultPreset = buildPostResponsePrompt(
      makePostReviewContext({
        promptPreset: DEFAULT_DIRECTOR_PROMPT_PRESET,
      }),
    )

    expect(withDefaultPreset).toEqual(withoutPreset)
  })

  test('custom preset overrides pre-request templates and recent message cap', () => {
    const preset = {
      ...DEFAULT_DIRECTOR_PROMPT_PRESET,
      preRequestSystemTemplate:
        'Custom pre-request system.\nAssertiveness: {{assertivenessDirective}}\nSchema:\n{{sceneBriefSchema}}\nCap: {{briefTokenCap}}',
      preRequestUserTemplate:
        'Conversation tail:\n{{recentConversation}}\nMemory:\n{{memorySummaries}}',
      assertivenessDirectives: {
        light: 'gentle mode',
        standard: 'balanced mode',
        firm: 'strict mode',
      },
      sceneBriefSchema: '{"custom":"brief"}',
      maxRecentMessages: 2,
    }

    const msgs = buildPreRequestPrompt(
      makeDirectorContext({
        assertiveness: 'firm',
        briefTokenCap: 200,
        promptPreset: preset,
      }),
    )

    expect(msgs[0]?.content).toContain('Custom pre-request system.')
    expect(msgs[0]?.content).toContain('strict mode')
    expect(msgs[0]?.content).toContain('"custom":"brief"')
    expect(msgs[0]?.content).toContain('Cap: 200')
    expect(msgs[1]?.content).toContain('Message 3')
    expect(msgs[1]?.content).toContain('Message 4')
    expect(msgs[1]?.content).not.toContain('Message 1')
  })

  test('custom preset overrides post-response templates and schema', () => {
    const preset = {
      ...DEFAULT_DIRECTOR_PROMPT_PRESET,
      postResponseSystemTemplate:
        'Custom post-review system.\nAssertiveness: {{assertivenessDirective}}\nSchema:\n{{memoryUpdateSchema}}',
      postResponseUserTemplate:
        'Reviewed response:\n{{responseText}}\nBrief JSON:\n{{sceneBriefJson}}',
      assertivenessDirectives: {
        light: 'gentle mode',
        standard: 'balanced mode',
        firm: 'strict mode',
      },
      memoryUpdateSchema: '{"custom":"memory"}',
    }

    const msgs = buildPostResponsePrompt(
      makePostReviewContext({
        assertiveness: 'light',
        promptPreset: preset,
      }),
    )

    expect(msgs[0]?.content).toContain('Custom post-review system.')
    expect(msgs[0]?.content).toContain('gentle mode')
    expect(msgs[0]?.content).toContain('"custom":"memory"')
    expect(msgs[1]?.content).toContain('Character A picked up the ancient key')
    expect(msgs[1]?.content).toContain('"confidence": 0.85')
  })

  test('default pre-request preset foregrounds notebook and recalled memory layers', () => {
    const messages = buildPreRequestPrompt(
      makeDirectorContext({
        notebookBlock: '## Session Notebook\n- unresolved thread',
        recalledDocsBlock: '## Relevant Memory\n- prior oath',
      }),
    )

    // System template should instruct the Director to read context in layers
    expect(messages[0]?.content).toContain('hot state')
    expect(messages[0]?.content).toContain('warm memory')
    expect(messages[0]?.content).toContain('recent transcript')

    // User template should present notebook and recalled docs as named context layers
    expect(messages[1]?.content).toContain('## Session Notebook')
    expect(messages[1]?.content).toContain('- unresolved thread')
    expect(messages[1]?.content).toContain('## Relevant Memory')
    expect(messages[1]?.content).toContain('- prior oath')
  })

  test('default pre-request preset omits empty context layers gracefully', () => {
    const messages = buildPreRequestPrompt(makeDirectorContext())

    // Without notebook/recalled docs, the empty placeholders collapse to blank lines.
    // The newline-collapse logic should reduce runs of 3+ newlines to pairs.
    const userContent = messages[1]?.content ?? ''
    
    // The template has "# Layer 2 · Warm Memory" followed by notebookBlock and recalledDocsBlock
    // When both are empty strings, there should be no runs of 3+ consecutive newlines in the output
    expect(userContent).toMatch(/Layer 2 · Warm Memory\n\n## Memory Summaries/)
    
    // No more than 2 consecutive newlines should appear anywhere in the content
    expect(userContent).not.toMatch(/\n{3,}/)
  })

  test('dynamic prompt content keeps placeholder-like text literal', () => {
    const preRequestMsgs = buildPreRequestPrompt(
      makeDirectorContext({
        messages: [
          { role: 'user', content: 'Literal {{currentSceneId}} token' },
          { role: 'assistant', content: 'Literal {{scenePhase}} token' },
        ],
      }),
    )

    const postResponseMsgs = buildPostResponsePrompt(
      makePostReviewContext({
        responseText: 'Echo {{recentConversation}} exactly.',
      }),
    )

    expect(preRequestMsgs[1]?.content).toContain('[user] Literal {{currentSceneId}} token')
    expect(preRequestMsgs[1]?.content).toContain('[assistant] Literal {{scenePhase}} token')
    expect(postResponseMsgs[1]?.content).toContain('Echo {{recentConversation}} exactly.')
  })

  test('default post-response preset adds durable-memory extraction heuristics', () => {
    const messages = buildPostResponsePrompt(makePostReviewContext())
    const systemContent = messages[0]?.content ?? ''

    expect(systemContent).toContain('Store state deltas, not baseline restatements.')
    expect(systemContent).toContain('Distinguish attempt from result and consequence.')
    expect(systemContent).toContain('Prioritize open threads, commitments, consequences, and relationship changes.')
  })

  test('default post-response preset includes notebook reference when provided', () => {
    const ctx = {
      ...makePostReviewContext(),
      notebookBlock: '## Session Notebook\n- The oath remains binding.',
    }

    const messages = buildPostResponsePrompt(ctx)
    const userContent = messages[1]?.content ?? ''

    expect(userContent).toContain('## Already Known Notebook Context')
    expect(userContent).toContain('The oath remains binding.')
  })

  test('post-response prompt replaces missing notebook placeholders with empty text', () => {
    const preset = {
      ...DEFAULT_DIRECTOR_PROMPT_PRESET,
      postResponseUserTemplate:
        'Notebook:\n{{notebookBlock}}\nResponse:\n{{responseText}}',
    }
    const ctx = makePostReviewContext({
      promptPreset: preset,
    })

    const messages = buildPostResponsePrompt(ctx)
    const userContent = messages[1]?.content ?? ''

    expect(userContent).toContain('Notebook:\n\nResponse:\n')
    expect(userContent).not.toContain('{{notebookBlock}}')
  })
})
