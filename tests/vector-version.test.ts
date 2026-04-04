import { describe, test, expect } from 'vitest'
import {
  computeVectorVersion,
  type VectorVersionInput,
} from '../src/memory/vectorVersion.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<VectorVersionInput>): VectorVersionInput {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computeVectorVersion — deterministic fingerprint
// ---------------------------------------------------------------------------

describe('computeVectorVersion', () => {
  test('returns a non-empty string', () => {
    const version = computeVectorVersion(makeInput())
    expect(typeof version).toBe('string')
    expect(version.length).toBeGreaterThan(0)
  })

  test('same inputs produce same version', () => {
    const a = computeVectorVersion(makeInput())
    const b = computeVectorVersion(makeInput())
    expect(a).toBe(b)
  })

  test('different provider produces different version', () => {
    const a = computeVectorVersion(makeInput({ provider: 'openai' }))
    const b = computeVectorVersion(makeInput({ provider: 'voyageai' }))
    expect(a).not.toBe(b)
  })

  test('different model produces different version', () => {
    const a = computeVectorVersion(makeInput({ model: 'text-embedding-3-small' }))
    const b = computeVectorVersion(makeInput({ model: 'text-embedding-3-large' }))
    expect(a).not.toBe(b)
  })

  test('different dimensions produces different version', () => {
    const a = computeVectorVersion(makeInput({ dimensions: 1536 }))
    const b = computeVectorVersion(makeInput({ dimensions: 768 }))
    expect(a).not.toBe(b)
  })

  test('different baseUrl produces different version', () => {
    const a = computeVectorVersion(makeInput({ baseUrl: 'https://api.openai.com/v1' }))
    const b = computeVectorVersion(makeInput({ baseUrl: 'https://custom.server.com/v1' }))
    expect(a).not.toBe(b)
  })

  test('version is a hex string with a readable prefix', () => {
    const version = computeVectorVersion(makeInput())
    // Format: "emb-<hex>"
    expect(version).toMatch(/^emb-[0-9a-f]+$/)
  })

  test('trailing slashes in baseUrl are normalized', () => {
    const a = computeVectorVersion(makeInput({ baseUrl: 'https://api.openai.com/v1' }))
    const b = computeVectorVersion(makeInput({ baseUrl: 'https://api.openai.com/v1/' }))
    expect(a).toBe(b)
  })
})
