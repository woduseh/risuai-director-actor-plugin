/**
 * @vitest-environment jsdom
 */
import { downloadJsonFile, readJsonFile } from '../src/ui/fileTransfer.js'

describe('downloadJsonFile', () => {
  let clickedHrefs: string[]
  let revokedUrls: string[]
  let createdBlobParts: unknown[]

  beforeEach(() => {
    clickedHrefs = []
    revokedUrls = []
    createdBlobParts = []

    // Spy on URL.createObjectURL / revokeObjectURL
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        createdBlobParts.push(blob)
        return 'blob:mock-url'
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url)
      }),
    })

    // Spy on anchor click
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag) as HTMLElement
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clickedHrefs.push((el as HTMLAnchorElement).href || (el as HTMLAnchorElement).getAttribute('href') || '')
        })
      }
      return el
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('creates a blob with JSON content and triggers download', () => {
    const data = { schema: 'test', version: 1 }
    downloadJsonFile(data, 'test-export.json')

    expect(createdBlobParts.length).toBe(1)
    expect(clickedHrefs.length).toBe(1)
    expect(revokedUrls).toContain('blob:mock-url')
  })

  test('sets the correct filename on the anchor element', () => {
    const data = { hello: 'world' }
    downloadJsonFile(data, 'my-settings.json')

    // The anchor's download attribute is set to the filename
    const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results.find(
      (r: { type: string; value: unknown }) => r.type === 'return' && (r.value as HTMLElement).tagName === 'A'
    )?.value as HTMLAnchorElement | undefined
    expect(anchor).toBeDefined()
    expect(anchor!.download).toBe('my-settings.json')
  })

  test('produces valid JSON in the blob', async () => {
    const data = { schema: 'test', version: 42, nested: { a: 1 } }
    downloadJsonFile(data, 'test.json')

    const blob = createdBlobParts[0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/json')
    const text = await blob.text()
    expect(JSON.parse(text)).toEqual(data)
  })
})

describe('readJsonFile', () => {
  function makeFile(content: string, name = 'test.json', type = 'application/json'): File {
    return new File([content], name, { type })
  }

  test('parses valid JSON file and returns the data', async () => {
    const data = { schema: 'test', version: 1 }
    const file = makeFile(JSON.stringify(data))
    const result = await readJsonFile(file)
    expect(result).toEqual(data)
  })

  test('rejects with an error for invalid JSON', async () => {
    const file = makeFile('not-json {{{')
    await expect(readJsonFile(file)).rejects.toThrow()
  })

  test('rejects with an error for empty file', async () => {
    const file = makeFile('')
    await expect(readJsonFile(file)).rejects.toThrow()
  })
})
