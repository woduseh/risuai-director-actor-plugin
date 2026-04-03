import { describe, test, expect } from 'vitest'
import {
  normalizeQuotes,
  removeTrailingCommas,
  stripMarkdownCodeFences,
  extractBalancedSubstring,
  repairParseObject,
  repairParseArray,
} from '../src/runtime/jsonRepair.js'

// ---------------------------------------------------------------------------
// normalizeQuotes
// ---------------------------------------------------------------------------

describe('normalizeQuotes', () => {
  test('replaces left/right double curly quotes', () => {
    expect(normalizeQuotes('\u201Chello\u201D')).toBe('"hello"')
  })

  test('replaces left/right single curly quotes', () => {
    expect(normalizeQuotes('\u2018world\u2019')).toBe("'world'")
  })

  test('leaves ASCII quotes untouched', () => {
    expect(normalizeQuotes('"normal"')).toBe('"normal"')
  })
})

// ---------------------------------------------------------------------------
// removeTrailingCommas
// ---------------------------------------------------------------------------

describe('removeTrailingCommas', () => {
  test('removes trailing comma before }', () => {
    expect(removeTrailingCommas('{"a":1,}')).toBe('{"a":1}')
  })

  test('removes trailing comma before ]', () => {
    expect(removeTrailingCommas('["a","b",]')).toBe('["a","b"]')
  })

  test('removes trailing comma with whitespace', () => {
    expect(removeTrailingCommas('{"a":1 , }')).toBe('{"a":1 }')
  })

  test('handles nested trailing commas', () => {
    expect(removeTrailingCommas('{"a":[1,2,],}')).toBe('{"a":[1,2]}')
  })

  test('no-op when no trailing commas', () => {
    expect(removeTrailingCommas('{"a":1}')).toBe('{"a":1}')
  })
})

// ---------------------------------------------------------------------------
// stripMarkdownCodeFences
// ---------------------------------------------------------------------------

describe('stripMarkdownCodeFences (from jsonRepair)', () => {
  test('strips ```json fences', () => {
    expect(stripMarkdownCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test('strips bare ``` fences', () => {
    expect(stripMarkdownCodeFences('```\n[1,2]\n```')).toBe('[1,2]')
  })

  test('strips surrounding prose around fenced block', () => {
    const input = 'Here is the result:\n```json\n{"x":1}\n```\nDone.'
    expect(stripMarkdownCodeFences(input)).toBe('{"x":1}')
  })

  test('handles CRLF', () => {
    expect(stripMarkdownCodeFences('```json\r\n{"a":1}\r\n```')).toBe('{"a":1}')
  })

  test('returns plain text trimmed when no fences', () => {
    expect(stripMarkdownCodeFences('  {"a":1}  ')).toBe('{"a":1}')
  })
})

// ---------------------------------------------------------------------------
// extractBalancedSubstring
// ---------------------------------------------------------------------------

describe('extractBalancedSubstring', () => {
  test('extracts object from prose', () => {
    const input = 'Sure! {"key":"val"} hope that helps'
    expect(extractBalancedSubstring(input, 'object')).toBe('{"key":"val"}')
  })

  test('extracts array from prose', () => {
    const input = 'Here are the IDs: ["a","b","c"] end.'
    expect(extractBalancedSubstring(input, 'array')).toBe('["a","b","c"]')
  })

  test('handles nested structures', () => {
    const input = '{"outer":{"inner":1}}'
    expect(extractBalancedSubstring(input, 'object')).toBe('{"outer":{"inner":1}}')
  })

  test('respects string escaping with brackets', () => {
    const input = '{"text":"a } b"}'
    expect(extractBalancedSubstring(input, 'object')).toBe('{"text":"a } b"}')
  })

  test('returns null when no matching delimiter found', () => {
    expect(extractBalancedSubstring('no json here', 'object')).toBeNull()
    expect(extractBalancedSubstring('no json here', 'array')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// repairParseObject
// ---------------------------------------------------------------------------

describe('repairParseObject', () => {
  test('parses clean JSON object', () => {
    expect(repairParseObject('{"a":1}')).toEqual({ a: 1 })
  })

  test('parses fenced JSON object', () => {
    expect(repairParseObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  test('parses prose-wrapped JSON object', () => {
    expect(repairParseObject('Here: {"a":1} done')).toEqual({ a: 1 })
  })

  test('handles smart quotes in JSON', () => {
    const input = '{\u201Ckey\u201D: \u201Cvalue\u201D}'
    expect(repairParseObject(input)).toEqual({ key: 'value' })
  })

  test('handles trailing commas', () => {
    expect(repairParseObject('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 })
  })

  test('handles trailing commas inside fenced block', () => {
    expect(repairParseObject('```json\n{"a":1,}\n```')).toEqual({ a: 1 })
  })

  test('handles smart quotes + trailing commas + fences combined', () => {
    const input = '```json\n{\u201Ca\u201D: 1, \u201Cb\u201D: 2,}\n```'
    expect(repairParseObject(input)).toEqual({ a: 1, b: 2 })
  })

  test('handles prose-wrapped + trailing commas + smart quotes', () => {
    const input = 'Result:\n{\u201Cx\u201D: \u201Cy\u201D,}\nDone.'
    expect(repairParseObject(input)).toEqual({ x: 'y' })
  })

  test('returns null for arrays', () => {
    expect(repairParseObject('[1,2,3]')).toBeNull()
  })

  test('returns null for non-JSON garbage', () => {
    expect(repairParseObject('totally not json at all!!!')).toBeNull()
  })

  test('returns null for empty input', () => {
    expect(repairParseObject('')).toBeNull()
  })

  test('preserves string value containing ", }" without mutation', () => {
    const input = '{"msg":"items: a, }"}'
    const result = repairParseObject(input)
    expect(result).toEqual({ msg: 'items: a, }' })
  })

  test('preserves string value containing ", ]" without mutation', () => {
    const input = '{"msg":"list: 1, ]"}'
    const result = repairParseObject(input)
    expect(result).toEqual({ msg: 'list: 1, ]' })
  })
})

// ---------------------------------------------------------------------------
// repairParseArray
// ---------------------------------------------------------------------------

describe('repairParseArray', () => {
  test('parses clean JSON array', () => {
    expect(repairParseArray('["a","b"]')).toEqual(['a', 'b'])
  })

  test('parses fenced JSON array', () => {
    expect(repairParseArray('```json\n["a","b"]\n```')).toEqual(['a', 'b'])
  })

  test('parses prose-wrapped JSON array', () => {
    expect(repairParseArray('Here are the IDs: ["x","y"] done.')).toEqual(['x', 'y'])
  })

  test('handles smart quotes in array', () => {
    const input = '[\u201Ca\u201D, \u201Cb\u201D]'
    expect(repairParseArray(input)).toEqual(['a', 'b'])
  })

  test('handles trailing commas in array', () => {
    expect(repairParseArray('["a","b",]')).toEqual(['a', 'b'])
  })

  test('handles fenced array with trailing commas and smart quotes', () => {
    const input = '```json\n[\u201Ca\u201D, \u201Cb\u201D,]\n```'
    expect(repairParseArray(input)).toEqual(['a', 'b'])
  })

  test('returns null for objects', () => {
    expect(repairParseArray('{"a":1}')).toBeNull()
  })

  test('returns null for non-JSON garbage', () => {
    expect(repairParseArray('not json!!!')).toBeNull()
  })

  test('returns null for empty input', () => {
    expect(repairParseArray('')).toBeNull()
  })

  test('preserves array element containing ", ]" without mutation', () => {
    const input = '["keep: x, ]"]'
    const result = repairParseArray(input)
    expect(result).toEqual(['keep: x, ]'])
  })

  test('preserves array element containing ", }" without mutation', () => {
    const input = '["keep: x, }"]'
    const result = repairParseArray(input)
    expect(result).toEqual(['keep: x, }'])
  })
})
