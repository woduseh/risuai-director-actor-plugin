import type { ContinuityFact } from '../contracts/types.js'
import type { CharacterScopeIdentity, ChatScopeIdentity } from '../contracts/memorySchema.js'

const MAX_CHAT_FINGERPRINT_MESSAGES = 3

/**
 * FNV-1a 32-bit hash — fast, deterministic, no external deps.
 * Returns an 8-char lowercase hex string.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Normalize text for deterministic fingerprinting:
 * lowercase, collapse all whitespace runs to single space, trim.
 */
export function normalizeTextForFingerprint(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Build a character scope identity from a host character's chaId and name.
 * The fingerprint is deterministic: same (chaId, normalized name) → same fingerprint.
 */
export function characterScopeIdentity(
  chaId: string,
  name: string
): CharacterScopeIdentity {
  const normalizedName = normalizeTextForFingerprint(name)
  const fingerprint = fnv1a(`char\0${chaId}\0${normalizedName}`)
  return { chaId, name, fingerprint }
}

/**
 * Fallback chat fingerprint from chaId, chat.name, chat.lastDate,
 * and the first 3 non-empty messages.
 * Returns an 8-char lowercase hex string.
 */
export function chatFingerprint(
  chaId: string,
  chatName: string,
  lastDate: number,
  messages: readonly string[]
): string {
  const nonEmpty = messages
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .slice(0, MAX_CHAT_FINGERPRINT_MESSAGES)

  const normalizedName = normalizeTextForFingerprint(chatName)
  const payload = [
    'chat',
    chaId,
    normalizedName,
    String(lastDate),
    ...nonEmpty
  ].join('\0')

  return fnv1a(payload)
}

/**
 * Compose a scope key from character and chat fingerprints.
 */
export function composeScopeKey(
  characterFingerprint: string,
  chatFp: string
): string {
  return `scope:${characterFingerprint}:${chatFp}`
}

/**
 * Compose a namespaced storage key from a namespace prefix and scope key.
 */
export function composeStorageKey(
  namespace: string,
  scopeKey: string
): string {
  return `${namespace}::${scopeKey}`
}
