// ---------------------------------------------------------------------------
// Browser file transfer utilities for dashboard settings import/export
// ---------------------------------------------------------------------------

/**
 * Trigger a browser file download with JSON content.
 *
 * Creates a temporary Blob URL, clicks an invisible anchor element, and
 * cleans up the URL. This is the standard cross-browser approach and does
 * NOT use the File System Access API.
 */
export function downloadJsonFile(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()

  URL.revokeObjectURL(url)
}

/**
 * Read and parse a JSON file selected by the user.
 *
 * @returns The parsed JSON value.
 * @throws  If the file is empty or contains malformed JSON.
 */
export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      if (!text) {
        reject(new Error('File is empty'))
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (err) {
        reject(new Error(`Invalid JSON: ${(err as Error).message}`))
      }
    }
    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }
    reader.readAsText(file)
  })
}

/**
 * Open a file picker and return the selected file.
 *
 * Creates a hidden `<input type="file">` element, clicks it, and returns
 * the first selected file. Returns `null` if the user cancels.
 */
export function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'

    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null
      input.remove()
      resolve(file)
    })

    // Handle cancel — the input won't fire 'change' if user cancels,
    // but a focus event on the window after the picker closes is unreliable.
    // We rely on the caller tolerating a never-resolved promise in that edge case,
    // or add a focus listener as a best-effort fallback.
    const onFocus = (): void => {
      setTimeout(() => {
        if (!input.files?.length) {
          input.remove()
          resolve(null)
        }
        window.removeEventListener('focus', onFocus)
      }, 300)
    }
    window.addEventListener('focus', onFocus)

    document.body.appendChild(input)
    input.click()
  })
}

/**
 * Build a timestamped filename for a settings export.
 *
 * Format: `continuity-director-settings-YYYYMMDD-HHmmss.json`
 */
export function buildSettingsExportFilename(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `continuity-director-settings-${date}-${time}.json`
}
