import type { AsyncKeyValueStore } from '../contracts/risuai.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BREADCRUMBS = 16

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookKind = 'beforeRequest' | 'afterRequest' | 'output' | 'shutdown'
export type WorkerKind = 'extraction' | 'dream' | 'recovery'
export type WorkerHealth = 'idle' | 'ok' | 'error'

export interface Breadcrumb {
  ts: number
  label: string
  detail?: string | undefined
}

export interface WorkerStatus {
  health: WorkerHealth
  lastTs: number
  lastDetail?: string | undefined
}

export interface DiagnosticsSnapshot {
  lastHookKind: HookKind | null
  lastHookTs: number
  lastErrorMessage: string | null
  lastErrorTs: number
  extraction: WorkerStatus
  dream: WorkerStatus
  recovery: WorkerStatus
  breadcrumbs: Breadcrumb[]
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultWorkerStatus(): WorkerStatus {
  return { health: 'idle', lastTs: 0 }
}

export function createDefaultDiagnosticsSnapshot(): DiagnosticsSnapshot {
  return {
    lastHookKind: null,
    lastHookTs: 0,
    lastErrorMessage: null,
    lastErrorTs: 0,
    extraction: defaultWorkerStatus(),
    dream: defaultWorkerStatus(),
    recovery: defaultWorkerStatus(),
    breadcrumbs: [],
  }
}

// ---------------------------------------------------------------------------
// Storage key helper
// ---------------------------------------------------------------------------

export function diagnosticsStorageKey(scopeKey: string): string {
  return `continuity-director-diagnostics-v1:${scopeKey}`
}

// ---------------------------------------------------------------------------
// Diagnostics manager
// ---------------------------------------------------------------------------

export class DiagnosticsManager {
  private snapshot: DiagnosticsSnapshot
  private readonly storage: AsyncKeyValueStore
  private readonly storageKey: string

  constructor(storage: AsyncKeyValueStore, scopeKey: string) {
    this.storage = storage
    this.storageKey = diagnosticsStorageKey(scopeKey)
    this.snapshot = createDefaultDiagnosticsSnapshot()
  }

  // ── persistence ─────────────────────────────────────────────────────

  async loadSnapshot(): Promise<DiagnosticsSnapshot> {
    const raw = await this.storage.getItem<DiagnosticsSnapshot>(this.storageKey)
    if (raw != null && typeof raw === 'object' && Array.isArray(raw.breadcrumbs)) {
      this.snapshot = {
        lastHookKind: typeof raw.lastHookKind === 'string' ? raw.lastHookKind as HookKind : null,
        lastHookTs: typeof raw.lastHookTs === 'number' ? raw.lastHookTs : 0,
        lastErrorMessage: typeof raw.lastErrorMessage === 'string' ? raw.lastErrorMessage : null,
        lastErrorTs: typeof raw.lastErrorTs === 'number' ? raw.lastErrorTs : 0,
        extraction: normalizeWorkerStatus(raw.extraction),
        dream: normalizeWorkerStatus(raw.dream),
        recovery: normalizeWorkerStatus(raw.recovery),
        breadcrumbs: raw.breadcrumbs.slice(-MAX_BREADCRUMBS),
      }
    } else {
      this.snapshot = createDefaultDiagnosticsSnapshot()
    }
    return structuredClone(this.snapshot)
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(this.storageKey, structuredClone(this.snapshot))
  }

  // ── accessors ───────────────────────────────────────────────────────

  getSnapshot(): DiagnosticsSnapshot {
    return structuredClone(this.snapshot)
  }

  // ── recording methods ───────────────────────────────────────────────

  async recordHook(kind: HookKind, detail?: string): Promise<void> {
    const now = Date.now()
    this.snapshot.lastHookKind = kind
    this.snapshot.lastHookTs = now
    this.pushBreadcrumb({ ts: now, label: `hook:${kind}`, detail })
    await this.persist()
  }

  async recordError(kind: string, error: unknown): Promise<void> {
    const now = Date.now()
    const message = error instanceof Error ? error.message : String(error)
    this.snapshot.lastErrorMessage = message
    this.snapshot.lastErrorTs = now
    this.pushBreadcrumb({ ts: now, label: `error:${kind}`, detail: message })
    await this.persist()
  }

  async recordWorkerSuccess(workerKind: WorkerKind, detail?: string): Promise<void> {
    const now = Date.now()
    const status = this.workerRef(workerKind)
    status.health = 'ok'
    status.lastTs = now
    status.lastDetail = detail
    this.pushBreadcrumb({ ts: now, label: `worker:${workerKind}:ok`, detail })
    await this.persist()
  }

  async recordWorkerFailure(workerKind: WorkerKind, error: unknown): Promise<void> {
    const now = Date.now()
    const message = error instanceof Error ? error.message : String(error)
    const status = this.workerRef(workerKind)
    status.health = 'error'
    status.lastTs = now
    status.lastDetail = message
    this.snapshot.lastErrorMessage = message
    this.snapshot.lastErrorTs = now
    this.pushBreadcrumb({ ts: now, label: `worker:${workerKind}:error`, detail: message })
    await this.persist()
  }

  async recordRecovery(resultStatus: 'ok' | 'error' | 'skipped', detail?: string): Promise<void> {
    const now = Date.now()
    const status = this.workerRef('recovery')
    status.health = resultStatus === 'error' ? 'error' : 'ok'
    status.lastTs = now
    status.lastDetail = detail
    this.pushBreadcrumb({ ts: now, label: `recovery:${resultStatus}`, detail })
    await this.persist()
  }

  // ── internal ────────────────────────────────────────────────────────

  private workerRef(kind: WorkerKind): WorkerStatus {
    return this.snapshot[kind]
  }

  private pushBreadcrumb(crumb: Breadcrumb): void {
    this.snapshot.breadcrumbs.push(crumb)
    if (this.snapshot.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.snapshot.breadcrumbs = this.snapshot.breadcrumbs.slice(-MAX_BREADCRUMBS)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeWorkerStatus(raw: unknown): WorkerStatus {
  if (raw != null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    const health = r.health
    const validHealth = health === 'idle' || health === 'ok' || health === 'error'
    return {
      health: validHealth ? health as WorkerHealth : 'idle',
      lastTs: typeof r.lastTs === 'number' ? r.lastTs : 0,
      lastDetail: typeof r.lastDetail === 'string' ? r.lastDetail : undefined,
    }
  }
  return defaultWorkerStatus()
}
