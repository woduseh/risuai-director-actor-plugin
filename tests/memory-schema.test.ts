import { describe, test, expect } from 'vitest'
import type { ScopedMemoryEnvelope } from '../src/contracts/memorySchema.js'
import {
  MEMORY_SCHEMA_VERSION,
  createScopedMemoryEnvelope,
  createScopeRegistry,
  registerFingerprint,
  resolveScope,
  aliasFingerprint
} from '../src/contracts/memorySchema.js'
import type { CanonicalMemory } from '../src/contracts/types.js'
import { createEmptyState } from '../src/contracts/types.js'

describe('ScopedMemoryEnvelope', () => {
  test('createScopedMemoryEnvelope returns valid envelope with meta', () => {
    const envelope = createScopedMemoryEnvelope({
      character: { chaId: 'cha-1', name: 'Alice', fingerprint: 'fp-char' },
      chat: { name: 'Chat 1', fingerprint: 'fp-chat' },
      writerId: 'writer-1'
    })

    expect(envelope.meta.schemaVersion).toBe(MEMORY_SCHEMA_VERSION)
    expect(envelope.meta.revision).toBe(0)
    expect(envelope.meta.lastWriterId).toBe('writer-1')
    expect(envelope.meta.character.chaId).toBe('cha-1')
    expect(envelope.meta.character.name).toBe('Alice')
    expect(envelope.meta.character.fingerprint).toBe('fp-char')
    expect(envelope.meta.chat.name).toBe('Chat 1')
    expect(envelope.meta.chat.fingerprint).toBe('fp-chat')
    expect(typeof envelope.meta.updatedAt).toBe('number')
  })

  test('envelope memory includes all CanonicalMemory domains including continuityFacts', () => {
    const envelope = createScopedMemoryEnvelope({
      character: { chaId: 'cha-1', name: 'Alice', fingerprint: 'fp' },
      chat: { name: 'Chat', fingerprint: 'fp' },
      writerId: 'w'
    })

    expect(envelope.memory.summaries).toEqual([])
    expect(envelope.memory.entities).toEqual([])
    expect(envelope.memory.relations).toEqual([])
    expect(envelope.memory.worldFacts).toEqual([])
    expect(envelope.memory.sceneLedger).toEqual([])
    expect(envelope.memory.turnArchive).toEqual([])
    expect(envelope.memory.continuityFacts).toEqual([])
  })

  test('envelope with optional chatId on chat identity', () => {
    const envelope = createScopedMemoryEnvelope({
      character: { chaId: 'cha-1', name: 'Alice', fingerprint: 'fp' },
      chat: { chatId: 'chat-42', name: 'Chat', fingerprint: 'fp' },
      writerId: 'w'
    })

    expect(envelope.meta.chat.chatId).toBe('chat-42')
  })
})

describe('MEMORY_SCHEMA_VERSION', () => {
  test('is a positive integer', () => {
    expect(MEMORY_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(MEMORY_SCHEMA_VERSION)).toBe(true)
  })
})

describe('ScopeRegistry', () => {
  test('createScopeRegistry returns empty registry', () => {
    const registry = createScopeRegistry()
    expect(registry.entries).toEqual([])
  })

  test('registerFingerprint creates a new entry and returns scopeId', () => {
    const registry = createScopeRegistry()
    const scopeId = registerFingerprint(registry, 'fp-1', 'Alice Chat')

    expect(typeof scopeId).toBe('string')
    expect(scopeId.length).toBeGreaterThan(0)
    expect(registry.entries).toHaveLength(1)
    expect(registry.entries[0]!.fingerprints).toContain('fp-1')
    expect(registry.entries[0]!.label).toBe('Alice Chat')
  })

  test('registerFingerprint uses custom ID generator when provided', () => {
    const registry = createScopeRegistry()
    let counter = 0
    const idGen = () => `test-scope-${++counter}`
    const scopeId = registerFingerprint(registry, 'fp-1', 'Label', { generateId: idGen })

    expect(scopeId).toBe('test-scope-1')
    expect(registry.entries[0]!.scopeId).toBe('test-scope-1')
  })

  test('registerFingerprint returns existing scopeId for known fingerprint', () => {
    const registry = createScopeRegistry()
    const first = registerFingerprint(registry, 'fp-1', 'Alice Chat')
    const second = registerFingerprint(registry, 'fp-1', 'Alice Chat')

    expect(first).toBe(second)
    expect(registry.entries).toHaveLength(1)
  })

  test('registerFingerprint creates separate entries for different fingerprints', () => {
    const registry = createScopeRegistry()
    const a = registerFingerprint(registry, 'fp-1')
    const b = registerFingerprint(registry, 'fp-2')

    expect(a).not.toBe(b)
    expect(registry.entries).toHaveLength(2)
  })

  test('resolveScope returns scopeId for known fingerprint', () => {
    const registry = createScopeRegistry()
    const scopeId = registerFingerprint(registry, 'fp-1')

    expect(resolveScope(registry, 'fp-1')).toBe(scopeId)
  })

  test('resolveScope returns undefined for unknown fingerprint', () => {
    const registry = createScopeRegistry()
    expect(resolveScope(registry, 'unknown')).toBeUndefined()
  })

  test('aliasFingerprint adds new fingerprint to existing scope', () => {
    const registry = createScopeRegistry()
    const scopeId = registerFingerprint(registry, 'fp-1')

    aliasFingerprint(registry, scopeId, 'fp-2')

    expect(resolveScope(registry, 'fp-2')).toBe(scopeId)
    expect(registry.entries).toHaveLength(1)
    expect(registry.entries[0]!.fingerprints).toContain('fp-1')
    expect(registry.entries[0]!.fingerprints).toContain('fp-2')
  })

  test('aliasFingerprint throws for unknown scopeId', () => {
    const registry = createScopeRegistry()
    expect(() => aliasFingerprint(registry, 'no-such-scope', 'fp-1')).toThrow()
  })

  test('aliasFingerprint is idempotent for already-present fingerprint', () => {
    const registry = createScopeRegistry()
    const scopeId = registerFingerprint(registry, 'fp-1')

    aliasFingerprint(registry, scopeId, 'fp-1')

    expect(registry.entries[0]!.fingerprints).toEqual(['fp-1'])
  })
})

describe('CanonicalMemory with continuityFacts', () => {
  test('CanonicalMemory type accepts continuityFacts field', () => {
    const memory: CanonicalMemory = {
      summaries: [],
      entities: [],
      relations: [],
      worldFacts: [],
      sceneLedger: [],
      turnArchive: [],
      continuityFacts: [
        { id: 'cf-1', text: 'The door is locked', priority: 0.9 }
      ]
    }
    expect(memory.continuityFacts).toHaveLength(1)
    expect(memory.continuityFacts[0]!.text).toBe('The door is locked')
  })

  test('createEmptyState includes continuityFacts in memory', () => {
    const state = createEmptyState()
    expect(state.memory.continuityFacts).toEqual([])
  })
})
