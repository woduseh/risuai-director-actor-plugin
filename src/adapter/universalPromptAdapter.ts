import type {
  InjectionDiagnostics,
  InjectionMode,
  InjectionResult,
  OpenAIChat,
  PromptTopology,
  SceneBrief
} from '../contracts/types.js'
import { classifyAllSegments } from './segmentClassifier.js'
import { escapeXml } from '../utils/xml.js'

const DIRECTOR_TAG = 'director-brief'
const BRIEF_VERSION = '1'

// ─── Topology ────────────────────────────────────────────────────────────────

/**
 * Analyse message array and return structural landmarks.
 */
export function classifyPromptTopology(messages: readonly OpenAIChat[]): PromptTopology {
  const segments = classifyAllSegments(messages)

  let authorNoteIndex: number | null = null
  let latestUserIndex: number | null = null
  let latestAssistantIndex: number | null = null
  let constraintIndex: number | null = null
  let memoryIndex: number | null = null
  let hasPrefill = false

  for (const seg of segments) {
    switch (seg.kind) {
      case 'author-note':
        authorNoteIndex = seg.index
        break
      case 'latest-user':
        latestUserIndex = seg.index
        break
      case 'latest-assistant':
        latestAssistantIndex = seg.index
        break
      case 'constraint':
        constraintIndex = seg.index
        break
      case 'memory':
        memoryIndex = seg.index
        break
      case 'prefill':
        hasPrefill = true
        break
    }
  }

  const avgConfidence =
    segments.length > 0
      ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
      : 0

  return {
    family: 'unknown',
    confidence: Math.round(avgConfidence * 100) / 100,
    segments,
    authorNoteIndex,
    latestUserIndex,
    latestAssistantIndex,
    constraintIndex,
    memoryIndex,
    hasPrefill
  }
}

// ─── Serialisation ───────────────────────────────────────────────────────────

function xmlLine(tag: string, content: string, indent = '  '): string {
  return `${indent}<${tag}>${escapeXml(content)}</${tag}>`
}

/**
 * Serialize a SceneBrief into a `<director-brief version="1">` XML block.
 */
export function serializeDirectorBrief(brief: SceneBrief): string {
  const lines: string[] = []
  lines.push(`<${DIRECTOR_TAG} version="${BRIEF_VERSION}">`)

  lines.push(xmlLine('confidence', String(brief.confidence)))
  lines.push(xmlLine('pacing', brief.pacing))

  if (brief.beats.length > 0) {
    lines.push('  <beats>')
    for (const beat of brief.beats) {
      lines.push('    <beat>')
      lines.push(xmlLine('goal', beat.goal, '      '))
      lines.push(xmlLine('reason', beat.reason, '      '))
      if (beat.targetCharacter) {
        lines.push(xmlLine('target-character', beat.targetCharacter, '      '))
      }
      if (beat.stakes) {
        lines.push(xmlLine('stakes', beat.stakes, '      '))
      }
      lines.push('    </beat>')
    }
    lines.push('  </beats>')
  }

  if (brief.continuityLocks.length > 0) {
    lines.push('  <continuity-locks>')
    for (const lock of brief.continuityLocks) {
      lines.push(xmlLine('lock', lock, '    '))
    }
    lines.push('  </continuity-locks>')
  }

  const entries = Object.entries(brief.ensembleWeights)
  if (entries.length > 0) {
    lines.push('  <ensemble-weights>')
    for (const [name, weight] of entries) {
      lines.push(`    <weight name="${escapeXml(name)}">${weight}</weight>`)
    }
    lines.push('  </ensemble-weights>')
  }

  const style = brief.styleInheritance
  const styleEntries = Object.entries(style).filter(
    (pair): pair is [string, string] => pair[1] != null
  )
  if (styleEntries.length > 0) {
    lines.push('  <style-inheritance>')
    for (const [key, val] of styleEntries) {
      lines.push(xmlLine(key, val, '    '))
    }
    lines.push('  </style-inheritance>')
  }

  if (brief.forbiddenMoves.length > 0) {
    lines.push('  <forbidden-moves>')
    for (const move of brief.forbiddenMoves) {
      lines.push(xmlLine('move', move, '    '))
    }
    lines.push('  </forbidden-moves>')
  }

  if (brief.memoryHints.length > 0) {
    lines.push('  <memory-hints>')
    for (const hint of brief.memoryHints) {
      lines.push(xmlLine('hint', hint, '    '))
    }
    lines.push('  </memory-hints>')
  }

  lines.push(`</${DIRECTOR_TAG}>`)
  return lines.join('\n')
}

// ─── Injection ───────────────────────────────────────────────────────────────

/**
 * Build a director-injected system message from a brief.
 */
function makeDirectorMessage(brief: SceneBrief): OpenAIChat {
  return {
    role: 'system',
    content: serializeDirectorBrief(brief),
    __directorInjected: true,
    __directorTag: DIRECTOR_TAG
  }
}

/**
 * Remove previously injected director messages from a message list.
 * Returns a new array without mutating the input.
 */
function stripStaleInjections(messages: readonly OpenAIChat[]): OpenAIChat[] {
  return messages.filter((m) => !m.__directorInjected)
}

/**
 * Insert `element` into `arr` at `position`, returning a new array.
 */
function insertAt<T>(arr: readonly T[], position: number, element: T): T[] {
  const copy = [...arr]
  copy.splice(position, 0, element)
  return copy
}

/**
 * Inject a director brief into the message array.
 *
 * Strategy priority (when mode is 'auto'):
 *   P3 — after the author-note system message  (semantic)
 *   P2 — just before the latest user message    (deterministic)
 *   P1 — bottom                                 (last resort)
 */
export function injectDirectorBrief(
  messages: readonly OpenAIChat[],
  brief: SceneBrief,
  mode: InjectionMode
): InjectionResult {
  const cleaned = stripStaleInjections(messages)
  const topology = classifyPromptTopology(cleaned)
  const directorMsg = makeDirectorMessage(brief)

  const notes: string[] = []

  const resolvedMode = mode === 'auto' ? resolveAutoMode(topology, notes) : mode

  let resultMessages: OpenAIChat[]

  switch (resolvedMode) {
    case 'author-note': {
      const idx = topology.authorNoteIndex!
      resultMessages = insertAt(cleaned, idx + 1, directorMsg)
      break
    }
    case 'adjacent-user': {
      const idx = topology.latestUserIndex!
      resultMessages = insertAt(cleaned, idx, directorMsg)
      break
    }
    case 'post-constraint': {
      const idx = topology.constraintIndex ?? cleaned.length
      resultMessages = insertAt(cleaned, idx + 1, directorMsg)
      break
    }
    case 'bottom':
    default: {
      resultMessages = [...cleaned, directorMsg]
      notes.push('Fell through to bottom injection.')
      break
    }
  }

  const diagnostics: InjectionDiagnostics = {
    strategy: resolvedMode as Exclude<InjectionMode, 'auto'>,
    topologyConfidence: topology.confidence,
    degraded: resolvedMode === 'bottom',
    notes
  }

  return { messages: resultMessages, diagnostics }
}

function resolveAutoMode(
  topology: PromptTopology,
  notes: string[]
): Exclude<InjectionMode, 'auto'> {
  if (topology.authorNoteIndex != null) {
    notes.push('Author-note landmark detected; injecting after it.')
    return 'author-note'
  }
  if (topology.latestUserIndex != null) {
    notes.push('No author-note found; injecting before latest user message.')
    return 'adjacent-user'
  }
  notes.push('No suitable landmark found; falling back to bottom.')
  return 'bottom'
}

// ─── Actor memory helpers ────────────────────────────────────────────────────

const ACTOR_MEMORY_TAG = 'actor-memory'

function makeActorMemoryMessage(context: string): OpenAIChat {
  return {
    role: 'system',
    content: context,
    __directorInjected: true,
    __directorTag: ACTOR_MEMORY_TAG
  }
}

/**
 * Compute where the brief should be inserted (resolved position index).
 * Hardens explicit modes against null anchors by falling back to bottom.
 */
function computeBriefPosition(
  len: number,
  topology: PromptTopology,
  resolved: Exclude<InjectionMode, 'auto'>
): number {
  switch (resolved) {
    case 'author-note':
      return topology.authorNoteIndex != null
        ? topology.authorNoteIndex + 1
        : len
    case 'adjacent-user':
      return topology.latestUserIndex != null
        ? topology.latestUserIndex
        : len
    case 'post-constraint':
      return (topology.constraintIndex ?? len - 1) + 1
    case 'bottom':
    default:
      return len
  }
}

/**
 * Compute where actor memory should be inserted.
 * Strategy: memory landmark (auto only) → author note → latest user → bottom.
 */
function computeActorMemoryPosition(
  len: number,
  topology: PromptTopology,
  mode: InjectionMode,
  notes: string[]
): number {
  if (mode === 'auto' && topology.memoryIndex != null) {
    notes.push('Memory landmark detected; injecting actor memory after it.')
    return topology.memoryIndex + 1
  }
  if (topology.authorNoteIndex != null) {
    notes.push('Injecting actor memory after author note.')
    return topology.authorNoteIndex + 1
  }
  if (topology.latestUserIndex != null) {
    notes.push('Injecting actor memory before latest user message.')
    return topology.latestUserIndex
  }
  notes.push('No suitable landmark for actor memory; falling back to bottom.')
  return len
}

/**
 * Inject both the director brief and actor memory context as separate
 * system messages. Strips all stale director artifacts first.
 *
 * Actor memory placement (auto mode):
 *   P4 — after the memory / Past Summary landmark
 *   P3 — after the author-note
 *   P2 — before the latest user message
 *   P1 — bottom
 *
 * Brief placement uses the existing strategy from `resolveAutoMode`.
 */
export function injectDirectorArtifacts(
  messages: readonly OpenAIChat[],
  brief: SceneBrief,
  actorMemoryContext: string,
  mode: InjectionMode
): InjectionResult {
  const cleaned = stripStaleInjections(messages)
  const topology = classifyPromptTopology(cleaned)

  const notes: string[] = []
  const resolvedBriefMode =
    mode === 'auto' ? resolveAutoMode(topology, notes) : mode

  const briefPos = computeBriefPosition(cleaned.length, topology, resolvedBriefMode)
  const memPos = computeActorMemoryPosition(cleaned.length, topology, mode, notes)

  const briefMsg = makeDirectorMessage(brief)
  const memoryMsg = makeActorMemoryMessage(actorMemoryContext)

  // Insert from highest position first so earlier inserts don't shift indices.
  // When positions are equal, splice both at once so memory lands before brief.
  const result = [...cleaned]
  if (memPos === briefPos) {
    result.splice(memPos, 0, memoryMsg, briefMsg)
  } else if (memPos > briefPos) {
    result.splice(memPos, 0, memoryMsg)
    result.splice(briefPos, 0, briefMsg)
  } else {
    result.splice(briefPos, 0, briefMsg)
    result.splice(memPos, 0, memoryMsg)
  }

  const diagnostics: InjectionDiagnostics = {
    strategy: resolvedBriefMode as Exclude<InjectionMode, 'auto'>,
    topologyConfidence: topology.confidence,
    degraded: resolvedBriefMode === 'bottom',
    notes
  }

  return { messages: result, diagnostics }
}
