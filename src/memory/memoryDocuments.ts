import type { DirectorPluginState, MemdirDocument } from '../contracts/types.js'
import type { MemdirStore } from './memdirStore.js'

// Rough chars-per-token estimate for budget enforcement
const CHARS_PER_TOKEN = 4

interface BuildMemoryMdOptions {
  tokenBudget: number
}

/**
 * Render a virtual MEMORY.md index document from the current memdir
 * document set. The output is always produced — even with zero docs —
 * so it can be injected as an always-on context anchor.
 *
 * The content is token-budgeted: it will truncate to stay within the
 * configured budget.
 */
export function buildMemoryMd(
  docs: MemdirDocument[],
  options: BuildMemoryMdOptions,
): string {
  const maxChars = options.tokenBudget * CHARS_PER_TOKEN
  const lines: string[] = ['# MEMORY.md', '']

  if (docs.length === 0) {
    lines.push('No memory documents recorded yet.')
    return lines.join('\n')
  }

  // Group documents by type
  const grouped = new Map<string, MemdirDocument[]>()
  for (const doc of docs) {
    const bucket = grouped.get(doc.type) ?? []
    bucket.push(doc)
    grouped.set(doc.type, bucket)
  }

  const typeOrder = [
    'character',
    'relationship',
    'world',
    'plot',
    'continuity',
    'operator',
  ]

  let charCount = lines.join('\n').length

  for (const type of typeOrder) {
    const bucket = grouped.get(type)
    if (!bucket || bucket.length === 0) continue

    const header = `## ${type}`
    if (charCount + header.length + 1 > maxChars) break
    lines.push(header)
    charCount += header.length + 1

    for (const doc of bucket) {
      const freshTag = doc.freshness !== 'current' ? ` [${doc.freshness}]` : ''
      const entry = `- **${doc.title}**${freshTag}: ${doc.description}`

      if (charCount + entry.length + 1 > maxChars) {
        lines.push('- _(truncated)_')
        return lines.join('\n')
      }

      lines.push(entry)
      charCount += entry.length + 1
    }

    lines.push('')
    charCount += 1
  }

  return lines.join('\n')
}

export interface MigrationResult {
  migratedCount: number
  docIds: string[]
}

/**
 * Explode the existing canonical memory blob into first-pass memdir
 * documents. This is a non-destructive migration helper — the legacy
 * canonical state is never modified or deleted.
 *
 * The migration is idempotent: documents are keyed by a deterministic
 * ID derived from the canonical record's ID, so re-running does not
 * create duplicates.
 */
export async function migrateCanonicalToMemdir(
  state: DirectorPluginState,
  store: MemdirStore,
): Promise<MigrationResult> {
  const now = Date.now()
  const scopeKey = state.projectKey
  const docs: MemdirDocument[] = []

  // Entities → character documents
  for (const entity of state.memory.entities) {
    docs.push({
      id: `migrated-entity-${entity.id}`,
      type: 'character',
      title: entity.name,
      description: entity.facts.join('; '),
      scopeKey,
      updatedAt: entity.updatedAt ?? now,
      source: 'migration',
      freshness: 'current',
      tags: entity.tags ?? [],
    })
  }

  // Relations → relationship documents
  for (const rel of state.memory.relations) {
    docs.push({
      id: `migrated-relation-${rel.id}`,
      type: 'relationship',
      title: `${rel.sourceId} → ${rel.targetId}`,
      description: [rel.label, ...(rel.facts ?? [])].join('; '),
      scopeKey,
      updatedAt: rel.updatedAt ?? now,
      source: 'migration',
      freshness: 'current',
      tags: [],
    })
  }

  // World facts → world documents
  for (const wf of state.memory.worldFacts) {
    docs.push({
      id: `migrated-worldfact-${wf.id}`,
      type: 'world',
      title: wf.text.slice(0, 60),
      description: wf.text,
      scopeKey,
      updatedAt: wf.updatedAt ?? now,
      source: 'migration',
      freshness: 'current',
      tags: wf.tags ?? [],
    })
  }

  // Continuity facts → continuity documents
  for (const cf of state.memory.continuityFacts) {
    docs.push({
      id: `migrated-continuity-${cf.id}`,
      type: 'continuity',
      title: cf.text.slice(0, 60),
      description: cf.text,
      scopeKey,
      updatedAt: now,
      source: 'migration',
      freshness: 'current',
      tags: [],
    })
  }

  // Summaries → plot documents
  for (const sum of state.memory.summaries) {
    docs.push({
      id: `migrated-summary-${sum.id}`,
      type: 'plot',
      title: sum.text.slice(0, 60),
      description: sum.text,
      scopeKey,
      updatedAt: sum.updatedAt ?? now,
      source: 'migration',
      freshness: 'current',
      tags: [],
    })
  }

  // Persist each document (idempotent via deterministic IDs)
  for (const doc of docs) {
    await store.putDocument(doc)
  }

  return {
    migratedCount: docs.length,
    docIds: docs.map((d) => d.id),
  }
}
