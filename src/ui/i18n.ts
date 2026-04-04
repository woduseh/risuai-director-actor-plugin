import type { EmbeddingProvider } from '../contracts/types.js'

// ---------------------------------------------------------------------------
// Dashboard i18n – bilingual localization (English + Korean)
// ---------------------------------------------------------------------------

export type DashboardLocale = 'en' | 'ko'

/** All translation keys used across the dashboard UI. */
export type TranslationKey = keyof typeof EN_CATALOG

// ---------------------------------------------------------------------------
// Active locale state
// ---------------------------------------------------------------------------

let activeLocale: DashboardLocale = 'en'

export function getLocale(): DashboardLocale {
  return activeLocale
}

export function setLocale(locale: DashboardLocale): void {
  activeLocale = locale
}

// ---------------------------------------------------------------------------
// English catalog
// ---------------------------------------------------------------------------

const EN_CATALOG = {
  // Sidebar
  'sidebar.kicker': 'Continuity Director',
  'sidebar.title': 'Continuity Console',
  'sidebar.subtitle': 'Narrative guidance, models, prompts, memory, and profiles.',

  // Sidebar group labels
  'sidebar.group.general': 'General',
  'sidebar.group.tuning': 'Prompt Tuning',
  'sidebar.group.memory': 'Memory',
  'sidebar.group.profiles': 'Profiles',

  // Tab labels
  'tab.general': 'General',
  'tab.promptTuning': 'Prompt Tuning',
  'tab.modelSettings': 'Model Settings',
  'tab.memoryCache': 'Memory & Cache',
  'tab.settingsProfiles': 'Settings Profiles',

  // Toolbar
  'toolbar.kicker': 'Operator Console',
  'toolbar.tagline': 'Narrative guidance and persistent memory for long-form roleplay.',

  // Buttons
  'btn.save': 'Save',
  'btn.saveChanges': 'Save Changes',
  'btn.discard': 'Discard',
  'btn.cancel': 'Cancel',
  'btn.close': 'Close',
  'btn.closeIcon': '✕ Close',
  'btn.reset': 'Reset',
  'btn.exportSettings': 'Export Settings',
  'btn.testConnection': 'Test Connection',
  'btn.refreshModels': 'Refresh Models',
  'btn.newProfile': 'New Profile',
  'btn.newPromptPreset': 'New Prompt Preset',
  'btn.deletePromptPreset': 'Delete Preset',
  'btn.backfillCurrentChat': 'Extract Current Chat',
  'btn.regenerateCurrentChat': 'Regenerate from Current Chat',
  'btn.deleteSelected': 'Delete Selected',
  'btn.select': 'Select',
  'btn.edit': 'Edit',
  'btn.export': 'Export',
  'btn.import': 'Import',

  // Dirty indicator
  'dirty.unsavedChanges': 'Unsaved changes',
  'dirty.unsavedHint': 'Unsaved changes stay local until you save.',

  // Card: Plugin Status
  'card.pluginStatus.title': 'Plugin Status',
  'card.pluginStatus.copy': 'Enable the Director, adjust intervention strength, and check connection health.',
  'label.enabled': 'Enabled',
  'label.assertiveness': 'Intervention Strength',
  'label.mode': 'Mode',
  'label.injectionMode': 'Insertion Method',
  'option.light': 'Light',
  'option.standard': 'Standard',
  'option.firm': 'Firm',
  'option.risuAux': 'Risu Aux Model',
  'option.independentProvider': 'Independent Provider',
  'option.auto': 'Auto',
  'option.authorNote': 'Author Note',
  'option.adjacentUser': 'Adjacent User',
  'option.postConstraint': 'Post Constraint',
  'option.bottom': 'Bottom',

  // Card: Metrics Snapshot
  'card.metricsSnapshot.title': 'Metrics Snapshot',
  'card.metricsSnapshot.copy': 'Read-only snapshot of runtime behavior.',
  'metric.totalDirectorCalls': 'Total Director Calls',
  'metric.totalFailures': 'Total Failures',
  'metric.memoryWrites': 'Memory Writes',
  'metric.scenePhase': 'Scene Phase',

  // Card: Prompt Tuning
  'card.promptTuning.title': 'Prompt Tuning',
  'card.promptTuning.copy': 'Adjust Director strength, brief soft cap, post-review behavior, and actor long memory injection.',
  'card.promptPresets.title': 'Prompt Presets',
  'card.promptPresets.copy': 'Select, clone, or edit the prompt templates used by the Director.',
  'label.briefTokenCap': 'Director Brief Token Soft Cap',
  'label.postReview': 'Enable Post-review',
  'label.embeddings': 'Enable Embeddings',
  'label.promptPreset': 'Active Prompt Preset',
  'label.promptPresetName': 'Preset Name',
  'label.preRequestSystemTemplate': 'Pre-request System Template',
  'label.preRequestUserTemplate': 'Pre-request User Template',
  'label.postResponseSystemTemplate': 'Post-response System Template',
  'label.postResponseUserTemplate': 'Post-response User Template',
  'label.maxRecentMessages': 'Recent Message Cap',

  // Card: Timing & Limits
  'card.timingLimits.title': 'Timing & Limits',
  'card.timingLimits.copy': 'Cooldown and debounce settings to keep the Director stable.',
  'label.cooldownFailures': 'Cooldown Failures',
  'label.cooldownMs': 'Cooldown (ms)',
  'label.outputDebounceMs': 'Output Debounce (ms)',

  // Card: Director Model Settings
  'card.directorModel.title': 'Director Model Settings',
  'card.directorModel.copy': 'Configure an independent provider, Base URL, key, and model for the Director.',
  'label.provider': 'Provider',
  'label.baseUrl': 'Base URL',
  'label.apiKey': 'API Key',
  'label.model': 'Model',
  'label.customModelId': 'Custom Model ID',
  'label.copilotToken': 'Copilot Token',
  'help.copilotToken': 'Personal access token or GitHub Copilot token for authentication.',
  'label.vertexJsonKey': 'Service Account JSON Key',
  'label.vertexProject': 'Project ID',
  'label.vertexLocation': 'Location',
  'help.vertexJsonKey': 'Paste the full JSON key for the Vertex AI service account.',

  'option.openai': 'OpenAI',
  'option.anthropic': 'Anthropic',
  'option.google': 'Google',
  'option.copilot': 'GitHub Copilot',
  'option.vertex': 'Google Vertex AI',
  'option.custom': 'Custom',

  // Card: Embedding Settings
  'card.embeddingSettings.title': 'Embedding Settings',
  'card.embeddingSettings.copy': 'Configure the embedding provider used for semantic memory retrieval.',
  'label.embeddingProvider': 'Embedding Provider',
  'label.embeddingBaseUrl': 'Embedding Base URL',
  'label.embeddingApiKey': 'Embedding API Key',
  'label.embeddingModel': 'Embedding Model',
  'label.embeddingDimensions': 'Embedding Dimensions',
  'label.embeddingVertexJsonKey': 'Embedding Service Account JSON Key',
  'label.embeddingVertexProject': 'Embedding Project ID',
  'label.embeddingVertexLocation': 'Embedding Location',
  'option.embedding.voyageai': 'Voyage AI',
  'option.embedding.openai': 'OpenAI',
  'option.embedding.google': 'Google',
  'option.embedding.vertex': 'Google Vertex AI',
  'option.embedding.custom': 'Custom',

  // Card: Memory & Cache
  'card.memoryCache.title': 'Memory & Cache',
  'card.memoryCache.copy': 'Review memory documents and monitor cache behavior.',
  'card.memoryCache.hint': 'Memory summaries, entity graphs, and cache controls will appear here.',
  'card.memorySummaries.title': 'Summaries',
  'card.continuityFacts.title': 'Continuity Facts',
  'btn.delete': 'Delete',
  'btn.add': 'Add',
  'memory.addSummaryPlaceholder': 'New summary text\u2026',
  'memory.addFactPlaceholder': 'New continuity fact\u2026',
  'memory.addWorldFactPlaceholder': 'New world fact\u2026',
  'memory.addEntityNamePlaceholder': 'New entity name\u2026',
  'memory.addRelationSourcePlaceholder': 'Source ID',
  'memory.addRelationLabelPlaceholder': 'Label',
  'memory.addRelationTargetPlaceholder': 'Target ID',
  'memory.filterPlaceholder': 'Filter memory\u2026',
  'memory.emptyHint': 'No memory items yet. Summaries and continuity facts will appear here as the story progresses.',
  'card.worldFacts.title': 'World Facts',
  'card.entities.title': 'Entities',
  'card.relations.title': 'Relations',

  // Scope badge
  'memory.scopeLabel': 'Scope: {{scope}}',
  'memory.scopeGlobal': 'Global',
  'memory.scopeScoped': 'Scoped',

  // Quick navigation
  'memory.quickNav.summaries': 'Summaries',
  'memory.quickNav.continuityFacts': 'Continuity Facts',
  'memory.quickNav.worldFacts': 'World Facts',
  'memory.quickNav.entities': 'Entities',
  'memory.quickNav.relations': 'Relations',

  // Cross-link
  'memory.modelSettingsLink': 'Embeddings & Model Settings',

  // Card: Memory Operations
  'card.memoryOps.title': 'Memory Operations',
  'card.memoryOps.copy': 'Live status of extraction and consolidation workers.',
  'memoryOps.lastExtract': 'Last Extraction',
  'memoryOps.lastDream': 'Last Consolidation',
  'memoryOps.freshness': 'Notebook Status',
  'memoryOps.docCounts': 'Document Counts',
  'memoryOps.freshnessUnknown': 'Unknown',
  'memoryOps.freshnessCurrent': 'Current',
  'memoryOps.freshnessStale': 'Stale',
  'memoryOps.neverRun': 'Never',
  'memoryOps.locked': 'Memory locked — consolidation in progress',
  'memoryOps.staleExtract': 'Memory extraction is more than 24 h old',
  'memoryOps.staleDream': 'Last consolidation is more than 24 h old',

  'memoryOps.fallbackEnabled': 'Fallback retrieval ON',
  'memoryOps.fallbackDisabled': 'Fallback retrieval OFF',
  'btn.forceExtract': 'Run Extract Now',
  'btn.forceDream': 'Run Consolidation Now',
  'btn.inspectRecalled': 'View Recalled Docs',
  'btn.toggleFallback': 'Toggle Fallback Retrieval',
  'btn.refreshEmbeddings': 'Refresh Embeddings',

  // Embedding status
  'embeddingStatus.title': 'Embedding Status',
  'embeddingStatus.ready': 'Ready',
  'embeddingStatus.stale': 'Stale',
  'embeddingStatus.missing': 'Missing',
  'embeddingStatus.disabled': 'Disabled',
  'embeddingStatus.unsupported': 'Unsupported Provider',
  'embeddingStatus.version': 'Vector Version',
  'embeddingStatus.counts': 'Embedding Counts',
  'toast.refreshEmbeddingsStarted': 'Embedding refresh started',
  'toast.refreshEmbeddingsComplete': 'Embeddings refreshed ({{count}} docs)',
  'toast.refreshEmbeddingsFailed': 'Embedding refresh failed: {{error}}',

  // Diagnostics
  'diag.title': 'Runtime Diagnostics',
  'diag.lastHook': 'Last Hook',
  'diag.lastError': 'Last Error',
  'diag.noError': 'None',
  'diag.extraction': 'Extraction Worker',
  'diag.dream': 'Consolidation Worker',
  'diag.recovery': 'Startup Recovery',
  'diag.breadcrumbs': 'Recent Activity',
  'diag.health.idle': 'Idle',
  'diag.health.ok': 'OK',
  'diag.health.error': 'Error',
  'diag.noBreadcrumbs': 'No recent activity',

  'toast.extractStarted': 'Extraction started',
  'toast.dreamStarted': 'Consolidation started',
  'toast.extractFailed': 'Extraction failed: {{error}}',
  'toast.dreamFailed': 'Consolidation failed: {{error}}',
  'toast.fallbackToggled': 'Fallback retrieval toggled',
  'toast.noCallback': 'Action not available — runtime callback not configured',

  // Card: Settings Profiles
  'card.settingsProfiles.title': 'Settings Profiles',
  'card.settingsProfiles.copy': 'Save reusable presets, swap them quickly, and import/export as JSON.',

  // Connection status
  'connection.notTested': 'Not tested',
  'connection.testing': 'Testing…',
  'connection.connected': 'Connected ({{count}} models)',

  // Toast messages
  'toast.settingsSaved': 'Settings saved',
  'toast.changesDiscarded': 'Changes discarded',
  'toast.profileCreated': 'Profile created',
  'toast.profileExported': 'Profile exported',
  'toast.profileImported': 'Profile imported',
  'toast.noProfileSelected': 'No profile selected',
  'toast.invalidProfileFormat': 'Invalid profile format',
  'toast.failedParseProfile': 'Failed to parse profile JSON',
  'toast.settingsExported': 'Settings exported',
  'toast.backfillCompleted': 'Chat extraction completed ({{count}} updates)',
  'toast.backfillSkipped': 'No chat memories were extracted',
  'error.backfillScopeMismatch': 'The active chat changed while the dashboard was open. Return to the original chat and try again.',

  // Import alert
  'alert.importInstructions': 'To import a profile, save the JSON to plugin storage key "{{key}}" and click Import again.',

  // Placeholders
  'placeholder.customModelId': 'type a model ID directly',

  // Profile names
  'profile.defaultName': 'Profile {{n}}',
  'profile.balanced': 'Balanced',
  'profile.gentle': 'Gentle',
  'profile.strict': 'Strict',
  'promptPreset.defaultName': 'Default Preset',
  'promptPreset.customName': 'Custom Preset {{n}}',
  'promptPreset.readOnlyHint': 'Built-in presets are read-only. Clone the current preset to customize it.',

  // Fallback summary (settings.ts non-DOM path)
  'fallback.header': '── Continuity Director Settings ──',
  'fallback.enabled': 'Enabled',
  'fallback.assertiveness': 'Strength',
  'fallback.provider': 'Provider',
  'fallback.model': 'Model',
  'fallback.injection': 'Insertion',
  'fallback.postReview': 'Post-review',
  'fallback.briefCap': 'Director brief soft cap',
  'fallback.briefCapUnit': 'tokens',

  // Refresh guard
  'guard.blockedStartup': 'Please wait — the plugin is still starting up.',
  'guard.blockedShutdown': 'Please wait — the plugin is shutting down.',
  'guard.blockedMaintenance': 'Please wait — another maintenance task is still running.',

  // Destructive confirmation arming
  'confirm.deleteMemory': 'Delete this item?',
  'confirm.bulkDeleteMemory': 'Delete selected items?',
  'confirm.regenerateCurrentChat': 'Regenerate memory?',
  'confirm.deletePromptPreset': 'Delete this preset?',

  // Memory Workbench (read-only memory document inspector)
  'workbench.title': 'Memory Workbench',
  'workbench.copy': 'Read-only inspector for memory documents in the current scope.',
  'workbench.loading': 'Loading memory documents…',
  'workbench.emptyHint': 'No memory documents in this scope yet.',
  'workbench.noMatchHint': 'No documents match the current filters.',
  'workbench.filterAll': 'All',
  'workbench.filterType': 'Type',
  'workbench.filterFreshness': 'Status',
  'workbench.filterSource': 'Source',
  'workbench.embedded': 'Embedded',
  'workbench.notEmbedded': 'Not Embedded',
  'workbench.memoryMdTitle': 'MEMORY.md Preview',
  'workbench.notebookTitle': 'Session Notebook',
  'workbench.notebookEmpty': 'No notebook entries for this session.',

  // Language selector
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.ko': '한국어',
} as const

// ---------------------------------------------------------------------------
// Korean catalog
// ---------------------------------------------------------------------------

const KO_CATALOG: Record<TranslationKey, string> = {
  // Sidebar
  'sidebar.kicker': 'Continuity Director',
  'sidebar.title': '운영 콘솔',
  'sidebar.subtitle': '내러티브 가이드, 모델, 프롬프트, 메모리, 프로필 관리.',

  // Sidebar group labels
  'sidebar.group.general': '일반',
  'sidebar.group.tuning': '프롬프트 튜닝',
  'sidebar.group.memory': '메모리',
  'sidebar.group.profiles': '프로필',

  // Tab labels
  'tab.general': '일반',
  'tab.promptTuning': '프롬프트 튜닝',
  'tab.modelSettings': '모델 설정',
  'tab.memoryCache': '메모리 & 캐시',
  'tab.settingsProfiles': '설정 프로필',

  // Toolbar
  'toolbar.kicker': '운영 콘솔',
  'toolbar.tagline': '장기 롤플레이를 위한 내러티브 가이드와 지속 메모리.',

  // Buttons
  'btn.save': '저장',
  'btn.saveChanges': '변경사항 저장',
  'btn.discard': '되돌리기',
  'btn.cancel': '취소',
  'btn.close': '닫기',
  'btn.closeIcon': '✕ 닫기',
  'btn.reset': '초기화',
  'btn.exportSettings': '설정 내보내기',
  'btn.testConnection': '연결 테스트',
  'btn.refreshModels': '모델 새로고침',
  'btn.newProfile': '새 프로필',
  'btn.newPromptPreset': '새 프롬프트 프리셋',
  'btn.deletePromptPreset': '프리셋 삭제',
  'btn.backfillCurrentChat': '현재 채팅 추출',
  'btn.regenerateCurrentChat': '현재 채팅 기준 재생성',
  'btn.deleteSelected': '선택 삭제',
  'btn.select': '선택',
  'btn.edit': '편집',
  'btn.export': '내보내기',
  'btn.import': '가져오기',

  // Dirty indicator
  'dirty.unsavedChanges': '저장되지 않은 변경사항',
  'dirty.unsavedHint': '저장하기 전까지 변경사항은 로컬에 유지됩니다.',

  // Card: Plugin Status
  'card.pluginStatus.title': '플러그인 상태',
  'card.pluginStatus.copy': 'Director를 활성화하고, 개입 강도를 조절하며, 연결 상태를 확인합니다.',
  'label.enabled': '활성화',
  'label.assertiveness': '개입 강도',
  'label.mode': '모드',
  'label.injectionMode': '삽입 방식',
  'option.light': '가벼움',
  'option.standard': '표준',
  'option.firm': '엄격',
  'option.risuAux': 'Risu 보조 모델',
  'option.independentProvider': '독립 제공자',
  'option.auto': '자동',
  'option.authorNote': '작성자 노트',
  'option.adjacentUser': '인접 사용자',
  'option.postConstraint': '후속 제약',
  'option.bottom': '하단',

  // Card: Metrics Snapshot
  'card.metricsSnapshot.title': '메트릭 스냅샷',
  'card.metricsSnapshot.copy': '런타임 동작의 읽기 전용 요약입니다.',
  'metric.totalDirectorCalls': '총 디렉터 호출 수',
  'metric.totalFailures': '총 실패 수',
  'metric.memoryWrites': '메모리 쓰기 수',
  'metric.scenePhase': '장면 단계',

  // Card: Prompt Tuning
  'card.promptTuning.title': '프롬프트 튜닝',
  'card.promptTuning.copy': 'Director 개입 강도, 브리프 소프트 캡, 사후 리뷰, 액터 장기 메모리 주입을 조절합니다.',
  'card.promptPresets.title': '프롬프트 프리셋',
  'card.promptPresets.copy': '프리셋을 선택·복제·편집하여 Director 프롬프트 템플릿을 관리합니다.',
  'label.briefTokenCap': 'Director 브리프 토큰 소프트 캡',
  'label.postReview': '사후 리뷰 활성화',
  'label.embeddings': '임베딩 활성화',
  'label.promptPreset': '활성 프롬프트 프리셋',
  'label.promptPresetName': '프리셋 이름',
  'label.preRequestSystemTemplate': '요청 전 시스템 템플릿',
  'label.preRequestUserTemplate': '요청 전 사용자 템플릿',
  'label.postResponseSystemTemplate': '응답 후 시스템 템플릿',
  'label.postResponseUserTemplate': '응답 후 사용자 템플릿',
  'label.maxRecentMessages': '최근 메시지 상한',

  // Card: Timing & Limits
  'card.timingLimits.title': '타이밍 & 제한',
  'card.timingLimits.copy': '쿨다운·디바운스 설정으로 Director를 안정적으로 유지합니다.',
  'label.cooldownFailures': '쿨다운 실패 횟수',
  'label.cooldownMs': '쿨다운 (ms)',
  'label.outputDebounceMs': '출력 디바운스 (ms)',

  // Card: Director Model Settings
  'card.directorModel.title': '디렉터 모델 설정',
  'card.directorModel.copy': 'Director 전용 제공자, Base URL, 키, 모델을 설정합니다.',
  'label.provider': '제공자',
  'label.baseUrl': 'Base URL',
  'label.apiKey': 'API 키',
  'label.model': '모델',
  'label.customModelId': '사용자 지정 모델 ID',
  'label.copilotToken': 'Copilot 토큰',
  'help.copilotToken': '인증을 위한 개인 액세스 토큰 또는 GitHub Copilot 토큰입니다.',
  'label.vertexJsonKey': '서비스 계정 JSON 키',
  'label.vertexProject': '프로젝트 ID',
  'label.vertexLocation': '위치',
  'help.vertexJsonKey': 'Vertex AI 서비스 계정의 전체 JSON 키를 붙여넣으세요.',
  'option.openai': 'OpenAI',
  'option.anthropic': 'Anthropic',
  'option.google': 'Google',
  'option.copilot': 'GitHub Copilot',
  'option.vertex': 'Google Vertex AI',
  'option.custom': '사용자 지정',

  // Card: Embedding Settings
  'card.embeddingSettings.title': '임베딩 설정',
  'card.embeddingSettings.copy': '시맨틱 메모리 검색에 사용할 임베딩 제공자를 설정합니다.',
  'label.embeddingProvider': '임베딩 제공자',
  'label.embeddingBaseUrl': '임베딩 Base URL',
  'label.embeddingApiKey': '임베딩 API 키',
  'label.embeddingModel': '임베딩 모델',
  'label.embeddingDimensions': '임베딩 차원',
  'label.embeddingVertexJsonKey': '임베딩 서비스 계정 JSON 키',
  'label.embeddingVertexProject': '임베딩 프로젝트 ID',
  'label.embeddingVertexLocation': '임베딩 위치',
  'option.embedding.voyageai': 'Voyage AI',
  'option.embedding.openai': 'OpenAI',
  'option.embedding.google': 'Google',
  'option.embedding.vertex': 'Google Vertex AI',
  'option.embedding.custom': '사용자 지정',

  // Card: Memory & Cache
  'card.memoryCache.title': '메모리 & 캐시',
  'card.memoryCache.copy': '메모리 문서와 캐시 동작을 확인합니다.',
  'card.memoryCache.hint': '메모리 요약, 엔티티 그래프, 캐시 제어가 여기에 표시됩니다.',
  'card.memorySummaries.title': '요약',
  'card.continuityFacts.title': '연속성 사실',
  'btn.delete': '삭제',
  'btn.add': '추가',
  'memory.addSummaryPlaceholder': '새 요약 텍스트\u2026',
  'memory.addFactPlaceholder': '새 연속성 사실\u2026',
  'memory.addWorldFactPlaceholder': '새 세계 사실\u2026',
  'memory.addEntityNamePlaceholder': '새 엔티티 이름\u2026',
  'memory.addRelationSourcePlaceholder': '소스 ID',
  'memory.addRelationLabelPlaceholder': '라벨',
  'memory.addRelationTargetPlaceholder': '대상 ID',
  'memory.filterPlaceholder': '메모리 필터\u2026',
  'memory.emptyHint': '아직 메모리 항목이 없습니다. 이야기가 진행됨에 따라 요약 및 연속성 사실이 여기에 표시됩니다.',
  'card.worldFacts.title': '세계 사실',
  'card.entities.title': '엔티티',
  'card.relations.title': '관계',

  // Scope badge
  'memory.scopeLabel': '범위: {{scope}}',
  'memory.scopeGlobal': '전역',
  'memory.scopeScoped': '범위 지정됨',

  // Quick navigation
  'memory.quickNav.summaries': '요약',
  'memory.quickNav.continuityFacts': '연속성 사실',
  'memory.quickNav.worldFacts': '세계 사실',
  'memory.quickNav.entities': '엔티티',
  'memory.quickNav.relations': '관계',

  // Cross-link
  'memory.modelSettingsLink': '임베딩 & 모델 설정',

  // Card: Memory Operations
  'card.memoryOps.title': '메모리 작업',
  'card.memoryOps.copy': '추출·통합 워커의 실시간 상태입니다.',
  'memoryOps.lastExtract': '마지막 추출',
  'memoryOps.lastDream': '마지막 통합',
  'memoryOps.freshness': '노트북 갱신 상태',
  'memoryOps.docCounts': '문서 수',
  'memoryOps.freshnessUnknown': '알 수 없음',
  'memoryOps.freshnessCurrent': '최신',
  'memoryOps.freshnessStale': '오래됨',
  'memoryOps.neverRun': '없음',
  'memoryOps.locked': '메모리 잠김 — 통합 진행 중',
  'memoryOps.staleExtract': '메모리 추출이 24시간 이상 경과했습니다',
  'memoryOps.staleDream': '마지막 통합이 24시간 이상 경과했습니다',
  'memoryOps.fallbackEnabled': '대체 검색 켜짐',
  'memoryOps.fallbackDisabled': '대체 검색 꺼짐',
  'btn.forceExtract': '지금 추출 실행',
  'btn.forceDream': '통합 실행',
  'btn.inspectRecalled': '회상 문서 보기',
  'btn.toggleFallback': '대체 검색 토글',
  'btn.refreshEmbeddings': '임베딩 새로고침',

  // Embedding status
  'embeddingStatus.title': '임베딩 상태',
  'embeddingStatus.ready': '준비됨',
  'embeddingStatus.stale': '오래됨',
  'embeddingStatus.missing': '없음',
  'embeddingStatus.disabled': '비활성화',
  'embeddingStatus.unsupported': '지원되지 않는 제공자',
  'embeddingStatus.version': '벡터 버전',
  'embeddingStatus.counts': '임베딩 수',
  'toast.refreshEmbeddingsStarted': '임베딩 새로고침이 시작되었습니다',
  'toast.refreshEmbeddingsComplete': '임베딩이 새로고침되었습니다 ({{count}}개 문서)',
  'toast.refreshEmbeddingsFailed': '임베딩 새로고침 실패: {{error}}',

  // Diagnostics
  'diag.title': '런타임 진단',
  'diag.lastHook': '마지막 훅',
  'diag.lastError': '마지막 오류',
  'diag.noError': '없음',
  'diag.extraction': '추출 워커',
  'diag.dream': '통합 워커',
  'diag.recovery': '시작 복구',
  'diag.breadcrumbs': '최근 활동',
  'diag.health.idle': '대기',
  'diag.health.ok': '정상',
  'diag.health.error': '오류',
  'diag.noBreadcrumbs': '최근 활동 없음',

  'toast.extractStarted': '추출이 시작되었습니다',
  'toast.dreamStarted': '통합이 시작되었습니다',
  'toast.extractFailed': '추출 실패: {{error}}',
  'toast.dreamFailed': '통합 실패: {{error}}',
  'toast.fallbackToggled': '대체 검색이 토글되었습니다',
  'toast.noCallback': '사용 불가 — 런타임 콜백이 설정되지 않았습니다',

  // Card: Settings Profiles
  'card.settingsProfiles.title': '설정 프로필',
  'card.settingsProfiles.copy': '프리셋을 저장·교체하고 JSON으로 가져오기/내보내기합니다.',

  // Connection status
  'connection.notTested': '테스트되지 않음',
  'connection.testing': '테스트 중…',
  'connection.connected': '연결됨 ({{count}}개 모델)',

  // Toast messages
  'toast.settingsSaved': '설정이 저장되었습니다',
  'toast.changesDiscarded': '변경사항이 취소되었습니다',
  'toast.profileCreated': '프로필이 생성되었습니다',
  'toast.profileExported': '프로필이 내보내졌습니다',
  'toast.profileImported': '프로필을 가져왔습니다',
  'toast.noProfileSelected': '선택된 프로필이 없습니다',
  'toast.invalidProfileFormat': '잘못된 프로필 형식입니다',
  'toast.failedParseProfile': '프로필 JSON 파싱에 실패했습니다',
  'toast.settingsExported': '설정이 내보내졌습니다',
  'toast.backfillCompleted': '채팅 추출이 완료되었습니다 ({{count}}개 업데이트)',
  'toast.backfillSkipped': '추출된 채팅 메모리가 없습니다',
  'error.backfillScopeMismatch': '대시보드를 연 뒤 활성 채팅이 바뀌었습니다. 원래 채팅으로 돌아간 뒤 다시 시도하세요.',

  // Import alert
  'alert.importInstructions': '프로필을 가져오려면 JSON을 플러그인 저장소 키 "{{key}}"에 저장한 후 가져오기를 다시 클릭하세요.',

  // Placeholders
  'placeholder.customModelId': '모델 ID를 직접 입력하세요',

  // Profile names
  'profile.defaultName': '프로필 {{n}}',
  'profile.balanced': '균형',
  'profile.gentle': '부드러움',
  'profile.strict': '엄격',
  'promptPreset.defaultName': '기본 프리셋',
  'promptPreset.customName': '사용자 지정 프리셋 {{n}}',
  'promptPreset.readOnlyHint': '내장 프리셋은 읽기 전용입니다. 현재 프리셋을 복제해 사용자 정의하세요.',

  // Fallback summary
  'fallback.header': '── 연속성 디렉터 설정 ──',
  'fallback.enabled': '활성화',
  'fallback.assertiveness': '개입 강도',
  'fallback.provider': '제공자',
  'fallback.model': '모델',
  'fallback.injection': '삽입 방식',
  'fallback.postReview': '사후 리뷰',
  'fallback.briefCap': 'Director 브리프 소프트 캡',
  'fallback.briefCapUnit': '토큰',

  // Refresh guard
  'guard.blockedStartup': '잠시 기다려 주세요 — 플러그인이 아직 시작 중입니다.',
  'guard.blockedShutdown': '잠시 기다려 주세요 — 플러그인이 종료 중입니다.',
  'guard.blockedMaintenance': '잠시 기다려 주세요 — 다른 유지보수 작업이 아직 실행 중입니다.',

  // Destructive confirmation arming
  'confirm.deleteMemory': '이 항목을 삭제할까요?',
  'confirm.bulkDeleteMemory': '선택한 항목을 삭제할까요?',
  'confirm.regenerateCurrentChat': '메모리를 재생성할까요?',
  'confirm.deletePromptPreset': '이 프리셋을 삭제할까요?',

  // Memory Workbench (read-only memory document inspector)
  'workbench.title': '메모리 워크벤치',
  'workbench.copy': '현재 범위의 메모리 문서를 읽기 전용으로 검사합니다.',
  'workbench.loading': '메모리 문서 불러오는 중…',
  'workbench.emptyHint': '이 범위에 메모리 문서가 아직 없습니다.',
  'workbench.noMatchHint': '현재 필터에 일치하는 문서가 없습니다.',
  'workbench.filterAll': '전체',
  'workbench.filterType': '유형',
  'workbench.filterFreshness': '갱신 상태',
  'workbench.filterSource': '소스',
  'workbench.embedded': '임베딩됨',
  'workbench.notEmbedded': '임베딩 없음',
  'workbench.memoryMdTitle': 'MEMORY.md 미리보기',
  'workbench.notebookTitle': '세션 노트북',
  'workbench.notebookEmpty': '이 세션에 대한 노트북 항목이 없습니다.',

  // Language selector
  'lang.label': '언어',
  'lang.en': 'English',
  'lang.ko': '한국어',
}

// ---------------------------------------------------------------------------
// Catalog map
// ---------------------------------------------------------------------------

export const CATALOGS: Record<DashboardLocale, Record<TranslationKey, string>> = {
  en: EN_CATALOG,
  ko: KO_CATALOG,
}

// ---------------------------------------------------------------------------
// Translation function
// ---------------------------------------------------------------------------

/**
 * Look up a translation key in the active locale's catalog.
 * Fallback order: active locale → English → raw key.
 * Supports `{{param}}` interpolation.
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string>,
): string {
  const catalog = CATALOGS[activeLocale]
  let value: string = catalog[key] ?? CATALOGS.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{{${k}}}`, v)
    }
  }
  return value
}

// ---------------------------------------------------------------------------
// Tab label mapping (used by dashboardDom)
// ---------------------------------------------------------------------------

const TAB_KEY_MAP: Record<string, TranslationKey> = {
  'general': 'tab.general',
  'prompt-tuning': 'tab.promptTuning',
  'model-settings': 'tab.modelSettings',
  'memory-cache': 'tab.memoryCache',
  'settings-profiles': 'tab.settingsProfiles',
}

/** Get the localized label for a dashboard tab id. */
export function tabLabel(tabId: string): string {
  const key = TAB_KEY_MAP[tabId]
  return key ? t(key) : tabId
}

const SIDEBAR_GROUP_KEY_MAP: Record<string, TranslationKey> = {
  'general': 'sidebar.group.general',
  'tuning': 'sidebar.group.tuning',
  'memory': 'sidebar.group.memory',
  'profiles': 'sidebar.group.profiles',
}

/** Get the localized label for a sidebar group id. */
export function sidebarGroupLabel(groupId: string): string {
  const key = SIDEBAR_GROUP_KEY_MAP[groupId]
  return key ? t(key) : groupId
}

const EMBEDDING_PROVIDER_KEY_MAP: Record<EmbeddingProvider, TranslationKey> = {
  openai: 'option.embedding.openai',
  voyageai: 'option.embedding.voyageai',
  google: 'option.embedding.google',
  vertex: 'option.embedding.vertex',
  custom: 'option.embedding.custom',
}

export function embeddingProviderLabel(providerId: EmbeddingProvider): string {
  return t(EMBEDDING_PROVIDER_KEY_MAP[providerId])
}

// ---------------------------------------------------------------------------
// Built-in profile display name mapping (used by dashboardDom)
// ---------------------------------------------------------------------------

const BUILTIN_PROFILE_KEY_MAP: Record<string, TranslationKey> = {
  'builtin-balanced': 'profile.balanced',
  'builtin-gentle': 'profile.gentle',
  'builtin-strict': 'profile.strict',
}

/** Get the localized display name for a profile. Built-in profiles use i18n; custom profiles return the raw name. */
export function profileDisplayName(id: string, fallbackName: string): string {
  const key = BUILTIN_PROFILE_KEY_MAP[id]
  return key ? t(key) : fallbackName
}
