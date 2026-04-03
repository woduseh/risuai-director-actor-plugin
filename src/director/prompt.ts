import type {
  CanonicalMemory,
  DirectorAssertiveness,
  DirectorState,
  OpenAIChat,
  SceneBrief,
} from '../contracts/types.js'

// ---------------------------------------------------------------------------
// Input context types
// ---------------------------------------------------------------------------

export interface DirectorContext {
  messages: OpenAIChat[]
  directorState: DirectorState
  memory: CanonicalMemory
  assertiveness: DirectorAssertiveness
  briefTokenCap: number
}

export interface PostReviewContext {
  responseText: string
  brief: SceneBrief
  messages: OpenAIChat[]
  directorState: DirectorState
  memory: CanonicalMemory
  assertiveness: DirectorAssertiveness
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT_MESSAGES = 8

const ASSERTIVENESS_DIRECTIVE: Record<DirectorAssertiveness, string> = {
  light:
    'Use a light touch — suggest gently and let the writer take creative lead. ' +
    'Only flag clear continuity breaks.',
  standard:
    'Provide clear direction with room for creative interpretation. ' +
    'Flag continuity breaks and notable deviations from the brief.',
  firm:
    'Enforce constraints strictly. Flag any deviation from continuity, ' +
    'characterisation anchors, or forbidden moves as a violation.',
}

const SCENE_BRIEF_SCHEMA = `{
  "confidence": <number 0–1>,
  "pacing": "breathe"|"steady"|"tight"|"accelerate",
  "beats": [{"goal":"…","reason":"…","targetCharacter?":"…","stakes?":"…"}],
  "continuityLocks": ["…"],
  "ensembleWeights": {"<name>": <weight>},
  "styleInheritance": {"genre?":"…","register?":"…","language?":"…","pov?":"…"},
  "forbiddenMoves": ["…"],
  "memoryHints": ["…"]
}`

const MEMORY_UPDATE_SCHEMA = `{
  "status": "pass"|"soft-fail"|"hard-fail",
  "turnScore": <number 0–1>,
  "violations": ["…"],
  "durableFacts": ["…"],
  "sceneDelta": {"scenePhase?":"…","activeCharacters?":["…"],"worldStateChanges?":["…"]},
  "entityUpdates": [{}],
  "relationUpdates": [{}],
  "memoryOps": [{"op":"insert"|"update"|"merge"|"archive"|"drop","target":"…","payload":{}}],
  "correction?": "…"
}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatConversationTail(messages: OpenAIChat[], max: number): string {
  const tail = messages.slice(-max)
  return tail
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n')
}

function formatMemorySummaries(memory: CanonicalMemory): string {
  if (memory.summaries.length === 0) return '(none)'
  return memory.summaries
    .slice()
    .sort((a, b) => b.recencyWeight - a.recencyWeight)
    .slice(0, 10)
    .map((s) => `- ${s.text}`)
    .join('\n')
}

function formatContinuityFacts(state: DirectorState): string {
  if (state.continuityFacts.length === 0) return '(none)'
  return state.continuityFacts.map((f) => `- ${f.text}`).join('\n')
}

function formatArcs(state: DirectorState): string {
  const active = state.activeArcs.filter((a) => a.status === 'active')
  if (active.length === 0) return '(none)'
  return active.map((a) => `- ${a.label} (weight ${a.weight})`).join('\n')
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildPreRequestPrompt(ctx: DirectorContext): OpenAIChat[] {
  const system: OpenAIChat = {
    role: 'system',
    content: [
      'You are the Director — a collaborative-fiction scene analyst.',
      'Examine the conversation and context below, then produce a SceneBrief:',
      'a compact JSON plan that guides the next response.',
      '',
      `Assertiveness: ${ASSERTIVENESS_DIRECTIVE[ctx.assertiveness]}`,
      '',
      'Rules:',
      '- Maintain continuity with established facts.',
      '- Respect the current scene phase and pacing.',
      '- Identify beats that advance active arcs naturally.',
      '- Note forbidden moves (contradictions, spoilers, lore violations).',
      `- Keep output concise — aim for ≤${ctx.briefTokenCap} tokens.`,
      '',
      `Respond ONLY with a JSON object matching this schema:\n${SCENE_BRIEF_SCHEMA}`,
    ].join('\n'),
  }

  const user: OpenAIChat = {
    role: 'user',
    content: [
      '## Current State',
      `Scene: ${ctx.directorState.currentSceneId}`,
      `Phase: ${ctx.directorState.scenePhase}`,
      `Pacing: ${ctx.directorState.pacingMode}`,
      '',
      '## Active Arcs',
      formatArcs(ctx.directorState),
      '',
      '## Continuity Locks',
      formatContinuityFacts(ctx.directorState),
      '',
      '## Memory Summaries',
      formatMemorySummaries(ctx.memory),
      '',
      '## Recent Conversation',
      formatConversationTail(ctx.messages, MAX_RECENT_MESSAGES),
    ].join('\n'),
  }

  return [system, user]
}

export function buildPostResponsePrompt(ctx: PostReviewContext): OpenAIChat[] {
  const system: OpenAIChat = {
    role: 'system',
    content: [
      'You are the Director — a post-response reviewer for collaborative fiction.',
      'Review the AI response against the SceneBrief below.',
      'Extract durable facts, detect violations, and produce a MemoryUpdate.',
      '',
      `Assertiveness: ${ASSERTIVENESS_DIRECTIVE[ctx.assertiveness]}`,
      '',
      'Rules:',
      '- Score turn quality (0–1) based on brief adherence, continuity, characterisation.',
      '- List violations (continuity breaks, forbidden moves used, OOC behaviour).',
      '- Extract durable facts worth remembering long-term.',
      '- Produce memory operations for the storage layer.',
      '- "pass" = acceptable, "soft-fail" = minor issues, "hard-fail" = severe violations.',
      '',
      `Respond ONLY with a JSON object matching this schema:\n${MEMORY_UPDATE_SCHEMA}`,
    ].join('\n'),
  }

  const user: OpenAIChat = {
    role: 'user',
    content: [
      '## SceneBrief Used',
      JSON.stringify(ctx.brief, null, 2),
      '',
      '## Current State',
      `Scene: ${ctx.directorState.currentSceneId}`,
      `Phase: ${ctx.directorState.scenePhase}`,
      '',
      '## AI Response',
      ctx.responseText,
      '',
      '## Recent Conversation Context',
      formatConversationTail(ctx.messages, MAX_RECENT_MESSAGES),
    ].join('\n'),
  }

  return [system, user]
}
