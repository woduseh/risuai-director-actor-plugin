export type ChatRole = 'system' | 'user' | 'assistant' | 'function'

export interface OpenAIChat {
  role: ChatRole
  content: string
  name?: string
  __directorInjected?: boolean
  __directorTag?: string
  metadata?: Record<string, unknown>
}

export type HookRequestType = 'model' | 'display' | 'emotion' | 'memory' | string
export type ScriptMode = 'display' | 'output' | 'input' | 'process'
export type ReplacerType = 'beforeRequest' | 'afterRequest'
export type DirectorAssertiveness = 'light' | 'standard' | 'firm'
export type DirectorProvider = 'openai' | 'anthropic' | 'google' | 'custom'
export type InjectionMode =
  | 'auto'
  | 'author-note'
  | 'adjacent-user'
  | 'post-constraint'
  | 'bottom'
export type PromptFamily = 'mythos' | 'unknown' | 'generic-rp'
export type PromptSegmentKind =
  | 'system-canon'
  | 'style-register'
  | 'persona'
  | 'character-rules'
  | 'lorebook'
  | 'memory'
  | 'author-note'
  | 'director-like'
  | 'constraint'
  | 'output-format'
  | 'prefill'
  | 'conversation'
  | 'latest-user'
  | 'latest-assistant'
  | 'unknown'
export type ScenePhase = 'setup' | 'pressure' | 'turn' | 'aftermath'
export type BriefPacing = 'breathe' | 'steady' | 'tight' | 'accelerate'
export type MemoryOpKind = 'insert' | 'update' | 'merge' | 'archive' | 'drop'
export type ValidationStatus = 'pass' | 'soft-fail' | 'hard-fail'

export interface DirectorSettings {
  enabled: boolean
  assertiveness: DirectorAssertiveness
  directorProvider: DirectorProvider
  directorBaseUrl: string
  directorApiKey: string
  directorModel: string
  directorMode: 'otherAx' | 'model'
  briefTokenCap: number
  postReviewEnabled: boolean
  embeddingsEnabled: boolean
  injectionMode: InjectionMode
  includeTypes: HookRequestType[]
  cooldownFailureThreshold: number
  cooldownMs: number
  outputDebounceMs: number
}

export interface ContinuityFact {
  id: string
  text: string
  priority: number
  sceneId?: string
  entityIds?: string[]
}

export interface ArcState {
  id: string
  label: string
  status: 'active' | 'paused' | 'resolved'
  weight: number
}

export interface QualityFailure {
  timestamp: number
  reason: string
  severity: 'low' | 'medium' | 'high'
}

export interface DirectorState {
  currentSceneId: string
  scenePhase: ScenePhase
  pacingMode: BriefPacing
  registerLock: string | null
  povLock: string | null
  continuityFacts: ContinuityFact[]
  activeArcs: ArcState[]
  ensembleWeights: Record<string, number>
  failureHistory: QualityFailure[]
  cooldown: {
    failures: number
    untilTs: number | null
  }
}

export interface ActorState {
  identityAnchor: string[]
  decisionChain: string[]
  behavioralLocks: string[]
  relationshipMap: Record<string, string>
  currentIntentHints: string[]
}

export interface MemorySummary {
  id: string
  text: string
  sceneId?: string
  recencyWeight: number
  updatedAt: number
  entityIds?: string[]
}

export interface EntityMemory {
  id: string
  name: string
  facts: string[]
  tags?: string[]
  updatedAt: number
}

export interface RelationMemory {
  id: string
  sourceId: string
  targetId: string
  label: string
  facts?: string[]
  updatedAt: number
}

export interface WorldFact {
  id: string
  text: string
  tags?: string[]
  updatedAt: number
}

export interface SceneLedgerEntry {
  id: string
  sceneId: string
  userText: string
  actorText: string
  createdAt: number
}

export interface TurnArchiveEntry {
  id: string
  summaryId: string
  sourceTurnIds: string[]
  createdAt: number
}

export interface CanonicalMemory {
  summaries: MemorySummary[]
  entities: EntityMemory[]
  relations: RelationMemory[]
  worldFacts: WorldFact[]
  sceneLedger: SceneLedgerEntry[]
  turnArchive: TurnArchiveEntry[]
  continuityFacts: ContinuityFact[]
}

export interface RuntimeMetrics {
  totalDirectorCalls: number
  totalDirectorFailures: number
  totalMemoryWrites: number
  lastUpdatedAt: number
}

export interface DirectorPluginState {
  schemaVersion: number
  projectKey: string
  characterKey: string
  sessionKey: string
  updatedAt: number
  settings: DirectorSettings
  director: DirectorState
  actor: ActorState
  memory: CanonicalMemory
  metrics: RuntimeMetrics
}

export interface SceneBeat {
  goal: string
  reason: string
  targetCharacter?: string
  stakes?: string
}

export interface SceneBrief {
  confidence: number
  pacing: BriefPacing
  beats: SceneBeat[]
  continuityLocks: string[]
  ensembleWeights: Record<string, number>
  styleInheritance: {
    genre?: string
    register?: string
    language?: string
    pov?: string
  }
  forbiddenMoves: string[]
  memoryHints: string[]
}

export interface MemoryOperation {
  op: MemoryOpKind
  target: string
  payload: Record<string, unknown>
}

export interface MemoryUpdate {
  status: ValidationStatus
  turnScore: number
  violations: string[]
  durableFacts: string[]
  sceneDelta: {
    scenePhase?: string
    activeCharacters?: string[]
    worldStateChanges?: string[]
  }
  entityUpdates: Record<string, unknown>[]
  relationUpdates: Record<string, unknown>[]
  memoryOps: MemoryOperation[]
  correction?: string
}

export interface PromptSegment {
  index: number
  message: OpenAIChat
  kind: PromptSegmentKind
  confidence: number
}

export interface PromptTopology {
  family: PromptFamily
  confidence: number
  segments: PromptSegment[]
  authorNoteIndex: number | null
  latestUserIndex: number | null
  latestAssistantIndex: number | null
  constraintIndex: number | null
  hasPrefill: boolean
}

export interface InjectionDiagnostics {
  strategy: Exclude<InjectionMode, 'auto'>
  topologyConfidence: number
  degraded: boolean
  notes: string[]
}

export interface InjectionResult {
  messages: OpenAIChat[]
  diagnostics: InjectionDiagnostics
}

export interface RetrievalResult {
  mustInject: string[]
  highPriority: string[]
  opportunistic: string[]
  scores: Record<string, number>
}

export interface TurnContext {
  turnId: string
  type: HookRequestType
  originalMessages: OpenAIChat[]
  latestMessages?: OpenAIChat[]
  brief?: SceneBrief
  retrieval?: RetrievalResult
  lastOutputText?: string
  finalized: boolean
  createdAt: number
}

export const DEFAULT_DIRECTOR_SETTINGS: DirectorSettings = {
  enabled: true,
  assertiveness: 'standard',
  directorProvider: 'openai',
  directorBaseUrl: 'https://api.openai.com/v1',
  directorApiKey: '',
  directorModel: 'gpt-4.1-mini',
  directorMode: 'otherAx',
  briefTokenCap: 320,
  postReviewEnabled: true,
  embeddingsEnabled: false,
  injectionMode: 'auto',
  includeTypes: ['model'],
  cooldownFailureThreshold: 3,
  cooldownMs: 60_000,
  outputDebounceMs: 400
}

export function createEmptyState(seed?: Partial<Pick<DirectorPluginState, 'projectKey' | 'characterKey' | 'sessionKey'>>): DirectorPluginState {
  const now = Date.now()
  return {
    schemaVersion: 1,
    projectKey: seed?.projectKey ?? 'default-project',
    characterKey: seed?.characterKey ?? 'default-character',
    sessionKey: seed?.sessionKey ?? 'default-session',
    updatedAt: now,
    settings: { ...DEFAULT_DIRECTOR_SETTINGS },
    director: {
      currentSceneId: 'scene-0',
      scenePhase: 'setup',
      pacingMode: 'steady',
      registerLock: null,
      povLock: null,
      continuityFacts: [],
      activeArcs: [],
      ensembleWeights: {},
      failureHistory: [],
      cooldown: {
        failures: 0,
        untilTs: null
      }
    },
    actor: {
      identityAnchor: [],
      decisionChain: [],
      behavioralLocks: [],
      relationshipMap: {},
      currentIntentHints: []
    },
    memory: {
      summaries: [],
      entities: [],
      relations: [],
      worldFacts: [],
      sceneLedger: [],
      turnArchive: [],
      continuityFacts: []
    },
    metrics: {
      totalDirectorCalls: 0,
      totalDirectorFailures: 0,
      totalMemoryWrites: 0,
      lastUpdatedAt: now
    }
  }
}
