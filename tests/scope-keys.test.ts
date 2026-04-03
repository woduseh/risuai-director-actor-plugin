import { describe, test, expect } from 'vitest'
import {
  normalizeTextForFingerprint,
  characterScopeIdentity,
  chatFingerprint,
  composeScopeKey,
  composeStorageKey
} from '../src/memory/scopeKeys.js'

describe('normalizeTextForFingerprint', () => {
  test('lowercases and trims text', () => {
    expect(normalizeTextForFingerprint('  Hello World  ')).toBe('hello world')
  })

  test('collapses multiple whitespace to single space', () => {
    expect(normalizeTextForFingerprint('hello   world\t\nnew')).toBe('hello world new')
  })

  test('returns empty string for empty/whitespace input', () => {
    expect(normalizeTextForFingerprint('')).toBe('')
    expect(normalizeTextForFingerprint('   ')).toBe('')
  })

  test('is idempotent', () => {
    const text = '  Mixed  CASE   Text  '
    const first = normalizeTextForFingerprint(text)
    const second = normalizeTextForFingerprint(first)
    expect(first).toBe(second)
  })
})

describe('characterScopeIdentity', () => {
  test('returns identity with deterministic fingerprint', () => {
    const identity = characterScopeIdentity('cha-123', 'Alice')
    expect(identity.chaId).toBe('cha-123')
    expect(identity.name).toBe('Alice')
    expect(typeof identity.fingerprint).toBe('string')
    expect(identity.fingerprint.length).toBeGreaterThan(0)
  })

  test('same inputs produce same fingerprint', () => {
    const a = characterScopeIdentity('cha-123', 'Alice')
    const b = characterScopeIdentity('cha-123', 'Alice')
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  test('different chaIds produce different fingerprints', () => {
    const a = characterScopeIdentity('cha-123', 'Alice')
    const b = characterScopeIdentity('cha-456', 'Alice')
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  test('different names produce different fingerprints', () => {
    const a = characterScopeIdentity('cha-123', 'Alice')
    const b = characterScopeIdentity('cha-123', 'Bob')
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  test('fingerprint is case-insensitive for name', () => {
    const a = characterScopeIdentity('cha-123', 'Alice')
    const b = characterScopeIdentity('cha-123', 'alice')
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  test('fingerprint ignores surrounding whitespace in name', () => {
    const a = characterScopeIdentity('cha-123', 'Alice')
    const b = characterScopeIdentity('cha-123', '  Alice  ')
    expect(a.fingerprint).toBe(b.fingerprint)
  })
})

describe('chatFingerprint', () => {
  test('returns deterministic hex string', () => {
    const fp = chatFingerprint('cha-123', 'Chat 1', 1700000000000, ['Hello', 'World', 'Test'])
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
    expect(fp).toMatch(/^[0-9a-f]+$/)
  })

  test('same inputs produce same fingerprint', () => {
    const msgs = ['Hello', 'World', 'Test']
    const a = chatFingerprint('cha-123', 'Chat 1', 1700000000000, msgs)
    const b = chatFingerprint('cha-123', 'Chat 1', 1700000000000, msgs)
    expect(a).toBe(b)
  })

  test('uses only first 3 non-empty messages', () => {
    const a = chatFingerprint('cha-123', 'Chat', 1700000000000, ['A', 'B', 'C', 'D', 'E'])
    const b = chatFingerprint('cha-123', 'Chat', 1700000000000, ['A', 'B', 'C'])
    expect(a).toBe(b)
  })

  test('skips empty messages when collecting first 3', () => {
    const a = chatFingerprint('cha-123', 'Chat', 1700000000000, ['', 'A', '', 'B', 'C'])
    const b = chatFingerprint('cha-123', 'Chat', 1700000000000, ['A', 'B', 'C'])
    expect(a).toBe(b)
  })

  test('works with fewer than 3 messages', () => {
    const fp = chatFingerprint('cha-123', 'Chat', 1700000000000, ['Only one'])
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
  })

  test('works with zero messages', () => {
    const fp = chatFingerprint('cha-123', 'Chat', 1700000000000, [])
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
  })

  test('different chat names produce different fingerprints', () => {
    const a = chatFingerprint('cha-123', 'Chat 1', 1700000000000, ['Hello'])
    const b = chatFingerprint('cha-123', 'Chat 2', 1700000000000, ['Hello'])
    expect(a).not.toBe(b)
  })

  test('different chaIds produce different fingerprints', () => {
    const a = chatFingerprint('cha-123', 'Chat', 1700000000000, ['Hello'])
    const b = chatFingerprint('cha-456', 'Chat', 1700000000000, ['Hello'])
    expect(a).not.toBe(b)
  })

  test('different lastDate produce different fingerprints', () => {
    const a = chatFingerprint('cha-123', 'Chat', 1700000000000, ['Hello'])
    const b = chatFingerprint('cha-123', 'Chat', 1700000099999, ['Hello'])
    expect(a).not.toBe(b)
  })
})

describe('composeScopeKey', () => {
  test('combines character and chat fingerprints into a string', () => {
    const key = composeScopeKey('char-fp', 'chat-fp')
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  test('is deterministic', () => {
    expect(composeScopeKey('a', 'b')).toBe(composeScopeKey('a', 'b'))
  })

  test('different character fingerprints produce different keys', () => {
    expect(composeScopeKey('a', 'b')).not.toBe(composeScopeKey('c', 'b'))
  })

  test('different chat fingerprints produce different keys', () => {
    expect(composeScopeKey('a', 'b')).not.toBe(composeScopeKey('a', 'c'))
  })

  test('order matters (not commutative)', () => {
    expect(composeScopeKey('a', 'b')).not.toBe(composeScopeKey('b', 'a'))
  })
})

describe('composeStorageKey', () => {
  test('combines namespace and scope key', () => {
    const key = composeStorageKey('director', 'scope-123')
    expect(key).toContain('director')
    expect(key).toContain('scope-123')
  })

  test('is deterministic', () => {
    expect(composeStorageKey('ns', 'key')).toBe(composeStorageKey('ns', 'key'))
  })

  test('different namespaces produce different keys', () => {
    expect(composeStorageKey('ns1', 'key')).not.toBe(composeStorageKey('ns2', 'key'))
  })

  test('different scope keys produce different storage keys', () => {
    expect(composeStorageKey('ns', 'key1')).not.toBe(composeStorageKey('ns', 'key2'))
  })
})
