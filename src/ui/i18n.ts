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
  'sidebar.kicker': 'Director Actor',
  'sidebar.title': 'Director Dashboard',
  'sidebar.subtitle': 'Fullscreen control center for settings, models, prompts, memory, and profiles.',

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
  'toolbar.kicker': 'Cupcake-style dashboard',
  'toolbar.tagline': 'Modern control surface for Director behavior, models, and memory.',

  // Buttons
  'btn.save': 'Save',
  'btn.saveChanges': 'Save Changes',
  'btn.discard': 'Discard',
  'btn.close': 'Close',
  'btn.closeIcon': '✕ Close',
  'btn.reset': 'Reset',
  'btn.exportSettings': 'Export Settings',
  'btn.testConnection': 'Test Connection',
  'btn.refreshModels': 'Refresh Models',
  'btn.newProfile': 'New Profile',
  'btn.export': 'Export',
  'btn.import': 'Import',

  // Dirty indicator
  'dirty.unsavedChanges': 'Unsaved changes',
  'dirty.unsavedHint': 'Unsaved changes stay local until you save.',

  // Card: Plugin Status
  'card.pluginStatus.title': 'Plugin Status',
  'card.pluginStatus.copy': 'Enable the director, tune tone strictness, and keep a quick view of connection health.',
  'label.enabled': 'Enabled',
  'label.assertiveness': 'Assertiveness',
  'label.mode': 'Mode',
  'label.injectionMode': 'Injection Mode',
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
  'card.metricsSnapshot.copy': 'Quick read-only visibility into runtime behavior before you dive deeper.',
  'metric.totalDirectorCalls': 'Total Director Calls',
  'metric.totalFailures': 'Total Failures',
  'metric.memoryWrites': 'Memory Writes',
  'metric.scenePhase': 'Scene Phase',

  // Card: Prompt Tuning
  'card.promptTuning.title': 'Prompt Tuning',
  'card.promptTuning.copy': 'Tune how strongly the Director pushes, how large the brief is, and whether post-review stays active.',
  'label.briefTokenCap': 'Brief Token Cap',
  'label.postReview': 'Enable Post-review',
  'label.embeddings': 'Enable Embeddings',

  // Card: Timing & Limits
  'card.timingLimits.title': 'Timing & Limits',
  'card.timingLimits.copy': 'Cooldown and debounce controls keep the Director stable under streaming and bad responses.',
  'label.cooldownFailures': 'Cooldown Failures',
  'label.cooldownMs': 'Cooldown (ms)',
  'label.outputDebounceMs': 'Output Debounce (ms)',

  // Card: Director Model Settings
  'card.directorModel.title': 'Director Model Settings',
  'card.directorModel.copy': 'Keep the Director on its own provider, base URL, key, and model without touching the main RP model.',
  'label.provider': 'Provider',
  'label.baseUrl': 'Base URL',
  'label.apiKey': 'API Key',
  'label.model': 'Model',
  'label.customModelId': 'Custom Model ID',
  'option.openai': 'OpenAI',
  'option.anthropic': 'Anthropic',
  'option.google': 'Google',
  'option.custom': 'Custom',

  // Card: Memory & Cache
  'card.memoryCache.title': 'Memory & Cache',
  'card.memoryCache.copy': 'Inspect the long-memory substrate and keep an eye on the cache/memory write behavior.',
  'card.memoryCache.hint': 'Memory summaries, entity graphs, and cache controls will appear here.',

  // Card: Settings Profiles
  'card.settingsProfiles.title': 'Settings Profiles',
  'card.settingsProfiles.copy': 'Save reusable presets, swap them in one click, and move them between saves with JSON import/export.',

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

  // Import alert
  'alert.importInstructions': 'To import a profile, save the JSON to plugin storage key "{{key}}" and click Import again.',

  // Placeholders
  'placeholder.customModelId': 'type a model ID directly',

  // Profile names
  'profile.defaultName': 'Profile {{n}}',
  'profile.balanced': 'Balanced',
  'profile.gentle': 'Gentle',
  'profile.strict': 'Strict',

  // Fallback summary (settings.ts non-DOM path)
  'fallback.header': '── Director Plugin Settings ──',
  'fallback.enabled': 'Enabled',
  'fallback.assertiveness': 'Assertiveness',
  'fallback.provider': 'Provider',
  'fallback.model': 'Model',
  'fallback.injection': 'Injection',
  'fallback.postReview': 'Post-review',
  'fallback.briefCap': 'Brief cap',
  'fallback.briefCapUnit': 'tokens',

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
  'sidebar.kicker': 'Director Actor',
  'sidebar.title': '디렉터 대시보드',
  'sidebar.subtitle': '설정, 모델, 프롬프트, 메모리, 프로필을 위한 전체화면 컨트롤 센터.',

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
  'toolbar.kicker': '컵케이크 스타일 대시보드',
  'toolbar.tagline': '디렉터 행동, 모델, 메모리를 위한 모던 컨트롤 서피스.',

  // Buttons
  'btn.save': '저장',
  'btn.saveChanges': '변경사항 저장',
  'btn.discard': '되돌리기',
  'btn.close': '닫기',
  'btn.closeIcon': '✕ 닫기',
  'btn.reset': '초기화',
  'btn.exportSettings': '설정 내보내기',
  'btn.testConnection': '연결 테스트',
  'btn.refreshModels': '모델 새로고침',
  'btn.newProfile': '새 프로필',
  'btn.export': '내보내기',
  'btn.import': '가져오기',

  // Dirty indicator
  'dirty.unsavedChanges': '저장되지 않은 변경사항',
  'dirty.unsavedHint': '저장하기 전까지 변경사항은 로컬에 유지됩니다.',

  // Card: Plugin Status
  'card.pluginStatus.title': '플러그인 상태',
  'card.pluginStatus.copy': '디렉터를 활성화하고, 톤 엄격도를 조절하며, 연결 상태를 빠르게 확인하세요.',
  'label.enabled': '활성화',
  'label.assertiveness': '적극성',
  'label.mode': '모드',
  'label.injectionMode': '주입 모드',
  'option.light': '가벼움',
  'option.standard': '표준',
  'option.firm': '엄격',
  'option.risuAux': 'Risu 보조 모델',
  'option.independentProvider': '독립 프로바이더',
  'option.auto': '자동',
  'option.authorNote': '작성자 노트',
  'option.adjacentUser': '인접 사용자',
  'option.postConstraint': '후속 제약',
  'option.bottom': '하단',

  // Card: Metrics Snapshot
  'card.metricsSnapshot.title': '메트릭 스냅샷',
  'card.metricsSnapshot.copy': '더 깊이 들어가기 전에 런타임 동작을 빠르게 읽기 전용으로 확인하세요.',
  'metric.totalDirectorCalls': '총 디렉터 호출 수',
  'metric.totalFailures': '총 실패 수',
  'metric.memoryWrites': '메모리 쓰기 수',
  'metric.scenePhase': '장면 단계',

  // Card: Prompt Tuning
  'card.promptTuning.title': '프롬프트 튜닝',
  'card.promptTuning.copy': '디렉터가 얼마나 강하게 유도할지, 브리프 크기, 사후 리뷰 활성화 여부를 조절하세요.',
  'label.briefTokenCap': '브리프 토큰 상한',
  'label.postReview': '사후 리뷰 활성화',
  'label.embeddings': '임베딩 활성화',

  // Card: Timing & Limits
  'card.timingLimits.title': '타이밍 & 제한',
  'card.timingLimits.copy': '쿨다운과 디바운스 제어로 스트리밍 및 잘못된 응답에서 디렉터를 안정적으로 유지합니다.',
  'label.cooldownFailures': '쿨다운 실패 횟수',
  'label.cooldownMs': '쿨다운 (ms)',
  'label.outputDebounceMs': '출력 디바운스 (ms)',

  // Card: Director Model Settings
  'card.directorModel.title': '디렉터 모델 설정',
  'card.directorModel.copy': '메인 RP 모델을 건드리지 않고 디렉터 전용 프로바이더, Base URL, 키, 모델을 유지하세요.',
  'label.provider': '프로바이더',
  'label.baseUrl': 'Base URL',
  'label.apiKey': 'API 키',
  'label.model': '모델',
  'label.customModelId': '커스텀 모델 ID',
  'option.openai': 'OpenAI',
  'option.anthropic': 'Anthropic',
  'option.google': 'Google',
  'option.custom': '커스텀',

  // Card: Memory & Cache
  'card.memoryCache.title': '메모리 & 캐시',
  'card.memoryCache.copy': '장기 메모리 기반과 캐시/메모리 쓰기 동작을 점검하세요.',
  'card.memoryCache.hint': '메모리 요약, 엔티티 그래프, 캐시 제어가 여기에 표시됩니다.',

  // Card: Settings Profiles
  'card.settingsProfiles.title': '설정 프로필',
  'card.settingsProfiles.copy': '재사용 가능한 프리셋을 저장하고, 한 번의 클릭으로 교체하며, JSON 가져오기/내보내기로 이동하세요.',

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

  // Import alert
  'alert.importInstructions': '프로필을 가져오려면 JSON을 플러그인 저장소 키 "{{key}}"에 저장한 후 가져오기를 다시 클릭하세요.',

  // Placeholders
  'placeholder.customModelId': '모델 ID를 직접 입력하세요',

  // Profile names
  'profile.defaultName': '프로필 {{n}}',
  'profile.balanced': '균형',
  'profile.gentle': '부드러움',
  'profile.strict': '엄격',

  // Fallback summary
  'fallback.header': '── 디렉터 플러그인 설정 ──',
  'fallback.enabled': '활성화',
  'fallback.assertiveness': '적극성',
  'fallback.provider': '프로바이더',
  'fallback.model': '모델',
  'fallback.injection': '주입',
  'fallback.postReview': '사후 리뷰',
  'fallback.briefCap': '브리프 상한',
  'fallback.briefCapUnit': '토큰',

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
