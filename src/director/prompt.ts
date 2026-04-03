import type {
  CanonicalMemory,
  DirectorPromptPreset,
  DirectorAssertiveness,
  DirectorSettings,
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
  promptPreset?: DirectorPromptPreset
  /** Pre-formatted session notebook block (rendered by formatNotebookBlock). */
  notebookBlock?: string
  /** Pre-formatted recalled memory documents block (always includes MEMORY.md index). */
  recalledDocsBlock?: string
}

export interface PostReviewContext {
  responseText: string
  brief: SceneBrief
  messages: OpenAIChat[]
  directorState: DirectorState
  memory: CanonicalMemory
  assertiveness: DirectorAssertiveness
  promptPreset?: DirectorPromptPreset
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

export const BUILTIN_PROMPT_PRESET_ID = 'builtin-default'
export const BUILTIN_PROMPT_PRESET_NAME = 'Default'

// ---------------------------------------------------------------------------
// Default preset — reproduces the original hardcoded prompts byte-for-byte
// ---------------------------------------------------------------------------

export const DEFAULT_DIRECTOR_PROMPT_PRESET: DirectorPromptPreset = {
  preRequestSystemTemplate: [
    'You are the Director — a collaborative-fiction scene analyst.',
    'Examine the conversation and context below, then produce a SceneBrief:',
    'a compact JSON plan that guides the next response.',
    '',
    'Assertiveness: {{assertivenessDirective}}',
    '',
    'Rules:',
    '- Maintain continuity with established facts.',
    '- Respect the current scene phase and pacing.',
    '- Identify beats that advance active arcs naturally.',
    '- Note forbidden moves (contradictions, spoilers, lore violations).',
    '- Keep output concise — aim for ≤{{briefTokenCap}} tokens.',
    '',
    'Respond ONLY with a JSON object matching this schema:\n{{sceneBriefSchema}}',
  ].join('\n'),

  preRequestUserTemplate: [
    '## Current State',
    'Scene: {{currentSceneId}}',
    'Phase: {{scenePhase}}',
    'Pacing: {{pacingMode}}',
    '',
    '## Active Arcs',
    '{{activeArcs}}',
    '',
    '## Continuity Locks',
    '{{continuityFacts}}',
    '',
    '{{notebookBlock}}',
    '{{recalledDocsBlock}}',
    '## Memory Summaries',
    '{{memorySummaries}}',
    '',
    '## Recent Conversation',
    '{{recentConversation}}',
  ].join('\n'),

  postResponseSystemTemplate: [
    'You are the Director — a post-response reviewer for collaborative fiction.',
    'Review the AI response against the SceneBrief below.',
    'Extract durable facts, detect violations, and produce a MemoryUpdate.',
    '',
    'Assertiveness: {{assertivenessDirective}}',
    '',
    'Rules:',
    '- Score turn quality (0–1) based on brief adherence, continuity, characterisation.',
    '- List violations (continuity breaks, forbidden moves used, OOC behaviour).',
    '- Extract durable facts worth remembering long-term.',
    '- Produce memory operations for the storage layer.',
    '- "pass" = acceptable, "soft-fail" = minor issues, "hard-fail" = severe violations.',
    '',
    'Respond ONLY with a JSON object matching this schema:\n{{memoryUpdateSchema}}',
  ].join('\n'),

  postResponseUserTemplate: [
    '## SceneBrief Used',
    '{{sceneBriefJson}}',
    '',
    '## Current State',
    'Scene: {{currentSceneId}}',
    'Phase: {{scenePhase}}',
    '',
    '## AI Response',
    '{{responseText}}',
    '',
    '## Recent Conversation Context',
    '{{recentConversation}}',
  ].join('\n'),

  assertivenessDirectives: { ...ASSERTIVENESS_DIRECTIVE },
  sceneBriefSchema: SCENE_BRIEF_SCHEMA,
  memoryUpdateSchema: MEMORY_UPDATE_SCHEMA,
  maxRecentMessages: MAX_RECENT_MESSAGES,
}

export function resolvePromptPreset(
  settings: Pick<DirectorSettings, 'promptPresetId' | 'promptPresets'>,
): DirectorPromptPreset {
  const selected = settings.promptPresets[settings.promptPresetId]
  return selected?.preset ?? DEFAULT_DIRECTOR_PROMPT_PRESET
}

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
// Template engine
// ---------------------------------------------------------------------------

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  )
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildPreRequestPrompt(ctx: DirectorContext): OpenAIChat[] {
  const preset = ctx.promptPreset ?? DEFAULT_DIRECTOR_PROMPT_PRESET

  const vars: Record<string, string> = {
    assertivenessDirective: preset.assertivenessDirectives[ctx.assertiveness],
    sceneBriefSchema: preset.sceneBriefSchema,
    briefTokenCap: String(ctx.briefTokenCap),
    recentConversation: formatConversationTail(ctx.messages, preset.maxRecentMessages),
    memorySummaries: formatMemorySummaries(ctx.memory),
    currentSceneId: ctx.directorState.currentSceneId,
    scenePhase: ctx.directorState.scenePhase,
    pacingMode: ctx.directorState.pacingMode,
    activeArcs: formatArcs(ctx.directorState),
    continuityFacts: formatContinuityFacts(ctx.directorState),
    notebookBlock: ctx.notebookBlock ?? '',
    recalledDocsBlock: ctx.recalledDocsBlock ?? '',
  }

  return [
    { role: 'system', content: applyTemplate(preset.preRequestSystemTemplate, vars) },
    { role: 'user', content: applyTemplate(preset.preRequestUserTemplate, vars) },
  ]
}

export function buildPostResponsePrompt(ctx: PostReviewContext): OpenAIChat[] {
  const preset = ctx.promptPreset ?? DEFAULT_DIRECTOR_PROMPT_PRESET

  const vars: Record<string, string> = {
    assertivenessDirective: preset.assertivenessDirectives[ctx.assertiveness],
    memoryUpdateSchema: preset.memoryUpdateSchema,
    responseText: ctx.responseText,
    sceneBriefJson: JSON.stringify(ctx.brief, null, 2),
    currentSceneId: ctx.directorState.currentSceneId,
    scenePhase: ctx.directorState.scenePhase,
    recentConversation: formatConversationTail(ctx.messages, preset.maxRecentMessages),
  }

  return [
    { role: 'system', content: applyTemplate(preset.postResponseSystemTemplate, vars) },
    { role: 'user', content: applyTemplate(preset.postResponseUserTemplate, vars) },
  ]
}
