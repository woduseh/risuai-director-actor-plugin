import {
  ModelPayloadError,
  parseJsonObject,
  parseMemoryUpdate,
  parseSceneBrief,
  stripMarkdownCodeFences,
} from '../src/director/validator.js'

/* ------------------------------------------------------------------ */
/*  stripMarkdownCodeFences                                           */
/* ------------------------------------------------------------------ */
describe('stripMarkdownCodeFences', () => {
  test('strips ```json fences', () => {
    const fenced = '```json\n{"hello":"world"}\n```'
    expect(stripMarkdownCodeFences(fenced)).toBe('{"hello":"world"}')
  })

  test('strips bare ``` fences (no language tag)', () => {
    expect(stripMarkdownCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test('returns plain JSON unchanged', () => {
    expect(stripMarkdownCodeFences('{"a":1}')).toBe('{"a":1}')
  })

  test('strips surrounding prose around fenced block', () => {
    const input = 'Here is the result:\n```json\n{"x":1}\n```\nDone.'
    expect(stripMarkdownCodeFences(input)).toBe('{"x":1}')
  })

  test('handles Windows-style CRLF', () => {
    const input = '```json\r\n{"a":1}\r\n```'
    expect(stripMarkdownCodeFences(input)).toBe('{"a":1}')
  })
})

/* ------------------------------------------------------------------ */
/*  parseJsonObject                                                   */
/* ------------------------------------------------------------------ */
describe('parseJsonObject', () => {
  test('parses plain JSON object', () => {
    expect(parseJsonObject('{"key":"val"}')).toEqual({ key: 'val' })
  })

  test('parses JSON wrapped in markdown fences', () => {
    expect(parseJsonObject('```json\n{"k":1}\n```')).toEqual({ k: 1 })
  })

  test('throws ModelPayloadError on non-object JSON (array)', () => {
    expect(() => parseJsonObject('[1,2]')).toThrow(ModelPayloadError)
  })

  test('throws ModelPayloadError on non-JSON text', () => {
    expect(() => parseJsonObject('not json at all')).toThrow(ModelPayloadError)
  })

  test('extracts JSON object from surrounding prose', () => {
    const input = 'Sure! Here is your output:\n{"a":1}\nHope that helps!'
    expect(parseJsonObject(input)).toEqual({ a: 1 })
  })

  test('throws on empty input', () => {
    expect(() => parseJsonObject('')).toThrow(ModelPayloadError)
  })
})

/* ------------------------------------------------------------------ */
/*  parseSceneBrief                                                   */
/* ------------------------------------------------------------------ */
describe('parseSceneBrief', () => {
  const validBrief = {
    confidence: 0.88,
    pacing: 'tight',
    beats: [{ goal: 'ضغط the scene', reason: 'arc escalation' }],
    continuityLocks: ['A still carries the knife.'],
    ensembleWeights: { A: 1 },
    styleInheritance: { genre: 'mythic', register: 'literary' },
    forbiddenMoves: ['Do not reveal hidden lore.'],
    memoryHints: ['knife'],
  }

  test('parses a valid SceneBrief from fenced JSON', () => {
    const brief = parseSceneBrief(`\`\`\`json
${JSON.stringify(validBrief, null, 2)}
\`\`\``)

    expect(brief.pacing).toBe('tight')
    expect(brief.forbiddenMoves).toContain('Do not reveal hidden lore.')
    expect(brief.beats[0]?.goal).toBe('ضغط the scene')
  })

  test('parses valid SceneBrief from plain JSON', () => {
    const brief = parseSceneBrief(JSON.stringify(validBrief))
    expect(brief.confidence).toBe(0.88)
  })

  test('throws when required fields are missing', () => {
    expect(() => parseSceneBrief('{"confidence":0.5}')).toThrow(ModelPayloadError)
  })

  test('throws on invalid pacing enum', () => {
    expect(() =>
      parseSceneBrief(JSON.stringify({ ...validBrief, pacing: 'warp-speed' }))
    ).toThrow(ModelPayloadError)
  })

  test('throws when confidence is out of 0-1 range', () => {
    expect(() =>
      parseSceneBrief(JSON.stringify({ ...validBrief, confidence: 1.5 }))
    ).toThrow(ModelPayloadError)
  })

  test('throws when beats is not an array', () => {
    expect(() =>
      parseSceneBrief(JSON.stringify({ ...validBrief, beats: 'nope' }))
    ).toThrow(ModelPayloadError)
  })

  test('throws when a beat is missing goal', () => {
    expect(() =>
      parseSceneBrief(
        JSON.stringify({ ...validBrief, beats: [{ reason: 'x' }] })
      )
    ).toThrow(ModelPayloadError)
  })

  test('error message names the missing field', () => {
    try {
      parseSceneBrief('{"confidence":0.5}')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ModelPayloadError)
      expect((e as ModelPayloadError).message).toMatch(/pacing/i)
    }
  })
})

/* ------------------------------------------------------------------ */
/*  parseMemoryUpdate                                                 */
/* ------------------------------------------------------------------ */
describe('parseMemoryUpdate', () => {
  const validUpdate = {
    status: 'pass',
    turnScore: 0.74,
    violations: [],
    durableFacts: ['A left the room.'],
    sceneDelta: { scenePhase: 'aftermath', activeCharacters: ['A'] },
    entityUpdates: [],
    relationUpdates: [],
    memoryOps: [
      { op: 'insert', target: 'summaries', payload: { text: 'A left the room.' } },
    ],
  }

  test('parses a valid MemoryUpdate', () => {
    const update = parseMemoryUpdate(JSON.stringify(validUpdate))
    expect(update.status).toBe('pass')
    expect(update.memoryOps[0]?.op).toBe('insert')
  })

  test('parses MemoryUpdate with optional correction field', () => {
    const withCorrection = { ...validUpdate, correction: 'Fix the POV.' }
    const update = parseMemoryUpdate(JSON.stringify(withCorrection))
    expect(update.correction).toBe('Fix the POV.')
  })

  test('throws on invalid status enum', () => {
    expect(() =>
      parseMemoryUpdate(JSON.stringify({ ...validUpdate, status: 'maybe' }))
    ).toThrow(ModelPayloadError)
  })

  test('throws when turnScore is not a number', () => {
    expect(() =>
      parseMemoryUpdate(JSON.stringify({ ...validUpdate, turnScore: 'high' }))
    ).toThrow(ModelPayloadError)
  })

  test('throws when memoryOps contains invalid op kind', () => {
    const bad = {
      ...validUpdate,
      memoryOps: [{ op: 'destroy', target: 'x', payload: {} }],
    }
    expect(() => parseMemoryUpdate(JSON.stringify(bad))).toThrow(ModelPayloadError)
  })

  test('throws when required fields are missing', () => {
    expect(() => parseMemoryUpdate('{"status":"pass"}')).toThrow(ModelPayloadError)
  })

  test('ModelPayloadError is an instanceof Error', () => {
    try {
      parseMemoryUpdate('garbage')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect(e).toBeInstanceOf(ModelPayloadError)
    }
  })
})
