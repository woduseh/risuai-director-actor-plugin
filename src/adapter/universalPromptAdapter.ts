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
