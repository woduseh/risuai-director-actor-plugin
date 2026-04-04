# Changelog

## [0.8.0] - 2026-04-04

### Added

- Layered Director preset with separate brief and long-memory budget sections
- Actor-side long-memory injection path independent of the Director brief
- CBS memory / Past Summary-aware placement for actor long-memory blocks
- Brief budget vs memory budget separation with explicit soft-cap semantics

### Changed

- Dashboard Prompt Tuning card copy now explains brief soft cap and actor long-memory injection
- Brief Token Cap label updated to Brief Token Soft Cap across EN and KO locales
- README updated with dual-injection architecture and Claude-style context layering
- Usage guide updated with actor long-memory explanation and soft-cap guidance

## [0.7.0] - 2026-04-04

### Added

- Direct GitHub Copilot runtime support using a pasted Copilot token for connection tests, live model discovery, and Director inference
- Direct Vertex AI runtime support using a pasted service-account JSON key for connection tests, Gemini Director inference, publisher-model discovery, and text embeddings

### Changed

- Refreshed curated provider model presets around the 2026-04-01 lineup: GPT-5.4 family, Claude 4.5/4.6, and Gemini 2.5
- Dashboard provider settings now use provider-specific auth flows instead of treating Copilot and Vertex as generic API-key providers

## [0.6.1] - 2026-04-04

### Changed

- Rebranded the user-facing plugin and dashboard naming from **Director Actor** to **Continuity Director** for clearer continuity-and-guidance positioning
- Replaced the dashboard's whimsical **Cupcake-style dashboard** copy with **Operator Console** language and refreshed the bilingual console subtitle/tagline text
- Polished EN + KO user-facing strings: clearer card descriptions, natural confirmation prompts, consistent terminology (Consolidation over Dream, Memory Workbench, 개입 강도, 삽입 방식, 제공자, 갱신 상태, 사용자 지정)

## [0.6.0] - 2026-04-04

### Added

- Repository-side GitGuardian configuration for generated bundle false positives under `dist/**`
- Opt-in embedding retrieval runtime with host-safe provider clients, vector-version invalidation, embed-on-persist, per-scope refresh, and dashboard cache status reporting
- Read-only Memory Workbench inspector with type/status/source filters, per-document embedding state, `MEMORY.md` preview, and session notebook snapshot

### Changed

- Memdir recall can now use an embedding-based candidate prefilter before recall-model selection while preserving the existing deterministic retrieval spine
- Dashboard memory operations now report embedding support plus ready/stale/missing cache counts and expose a manual **Refresh Embeddings** action

### Fixed

- Embedding cache status now reports provider support honestly and no longer relies on UI-layer overrides
- Persist-time embedding enrichment now stores each new memdir document once instead of double-writing on the embedding path
- Memory Workbench filter handling now distinguishes empty scopes from no-match filter states and validates DOM-derived filter values before applying them

## [0.5.0] - 2026-04-04

### Added

- Memory-page scope badge, quick navigation controls, and a direct model-settings cross-link in the fullscreen dashboard
- Last-open tab persistence across dashboard reopen
- Bounded memory-page rerender path for memory CRUD/edit/bulk-delete flows that keeps the root shell, sidebar, and footer mounted

### Changed

- Memory filter text now survives dashboard rerenders and regenerate flows no longer replay stale filter state
- Memory lists now use internal scrolling caps so large sections stop stretching the entire content area
- Bounded memory-page rerender now preserves focus and scroll position during memory mutations

### Fixed

- Dashboard accessibility coverage now includes memory/filter/add controls, connection-status live semantics, reduced-motion handling, and memory checkbox focus styling
- Toast notifications no longer intercept pointer input over underlying dashboard controls
- Deferred dashboard follow-up now passes test, typecheck, and build verification with targeted regression coverage for tab persistence, quick-nav, cross-link navigation, bounded rerender, focus restoration, and scroll preservation

## [0.4.3] - 2026-04-04

### Added

- Severity-aware dashboard toasts with ARIA status/alert semantics and longer-lived error messages
- Async busy guards for high-risk dashboard actions to prevent duplicate clicks while operations are in flight
- Plugin-native destructive-action arming flow for single memory delete, bulk delete, regenerate current chat, and prompt preset delete
- Dashboard settings export payload for current settings, profiles, and locale

### Changed

- Dashboard now styles diagnostics, warnings, recalled-doc lists, breadcrumbs, disabled controls, and armed destructive buttons consistently with the fullscreen theme
- Toolbar and sidebar dashboard action buttons now route to real save, discard, close, and settings-export flows instead of inert controls

### Fixed

- Armed destructive buttons now restore their original text on early-return paths and are cleared on tab switch
- Busy disabled-state wiring now targets the correct aliased toolbar buttons
- Toast gradients now use fully opaque color mixes instead of unintentionally transparent top stops

## [0.4.2] - 2026-04-04

### Added

- Durable pending-turn recovery via pluginStorage-backed `TurnRecoveryManager`
- Stage-aware recovery record tracks `post-response-pending` and `housekeeping-pending` stages
- `attemptStartupRecovery()` replays incomplete turns on next plugin startup without double-applying canonical memory updates
- `bootstrapPlugin` accepts optional `turnRecovery` option for crash-safe turn processing
- Startup recovery wired in `registerContinuityDirectorPlugin` composition root
- 16 focused tests covering persist/advance/clear lifecycle, stage-aware replay, idempotent recovery, and failure retention
- Reusable JSON repair layer for LLM outputs shared by director validation, recall parsing, and dream consolidation
- Focused JSON repair coverage for fenced/prose-wrapped payloads, smart quotes, trailing commas, and repaired recall arrays

### Fixed

- Recall and dream parsing now recover from common malformed-but-repairable JSON instead of failing on the first `JSON.parse`
- Trailing-comma repair now respects JSON string boundaries, avoiding silent corruption of values containing `, ]` or `, }`

## [0.4.1] - 2026-04-04

### Added

- Reusable `withRetry` helper with exponential backoff in `src/runtime/network.ts`
- `isTransientError` classifier for status codes 429/502/503/504/524 and common transient wording (rate limit, timeout, overloaded)
- Extraction worker retries transient `runExtraction` failures (2 retries, 1500ms base backoff)
- Recall model retries transient thrown errors and transient `ok:false` responses within `findRelevantMemories`
- Malformed recall output still falls back immediately without retry
- Optional `retryOptions` on `ExtractionWorkerOptions` and `findRelevantMemories` for caller control
- Comprehensive test coverage for retry, non-retry, and exhaustion paths

### Fixed

- Background extraction now promotes transient host `ok:false` failures into retryable errors instead of swallowing them as no-op results
- Recall prefetch timeout now aborts retry backoff after the request budget expires, preventing orphaned retry scheduling after fallback

## [0.4.0] - 2026-04-03

### Added

- Claude-inspired multi-layer memory lifecycle: extract → recall → session notebook → consolidation
- Lazy per-scope memdir migration gate with idempotent, non-destructive canonical-to-memdir migration
- Per-scope migration marker (`continuity-director-memdir:migrated:{scopeKey}`) with schema version tracking
- `MemdirMigrationMarker` type and `getMigrationMarker()` API on `CanonicalStore`
- `CanonicalStore` accepts optional `memdirStore` to trigger automatic migration on first load
- Dual-read backward compatibility: canonical blob remains readable during and after memdir migration
- Safe partial-migration fallback: canonical reads are always available even if memdir state is incomplete
- Integration test covering full extract → recall → session-memory → consolidation lifecycle without shared-state conflicts
- Memory Operations card on the dashboard memory page showing last extraction time, last consolidation time, notebook status badge, and document counts by type
- Operator actions: Run Extract Now, Run Consolidation Now, View Recalled Docs, Toggle Fallback Retrieval
- Stale-memory warnings and locked-memory indicators on the memory ops card
- Optional `DashboardStore` callbacks (`forceExtract`, `forceDream`, `getRecalledDocs`, `isMemoryLocked`) for composition-root integration
- Persisted fallback retrieval mode preference (`continuity-director-dashboard-memory-ops-prefs-v1`)
- Bilingual (en/ko) labels for all new memory operations UI elements
- Comprehensive README documentation for memory lifecycle, migration behavior, and operator controls

### Fixed

- XSS escape assertion in `dashboard-memory-page.test.ts` now scoped to memory item lists to avoid false positives from legitimate `<strong>` elements in the ops status card

## [0.3.0] - 2026-04-03

### Added

- Bilingual dashboard localization with persisted `en` / `ko` language switching
- Scoped canonical storage keys per character/chat with legacy flat-key migration
- Prompt preset persistence and editing for director pre-request and post-response templates
- Current-chat memory backfill using the Director post-response review pipeline
- Current-chat memory regeneration that resets the active scoped store before re-extracting
- Manual memory workbench coverage for summaries, continuity facts, world facts, entities, and relations
- Inline memory editing plus cross-domain bulk delete actions in the dashboard
- Expanded provider catalogs for GitHub Copilot and Google Vertex AI
- Refreshed curated model catalogs including GPT-5.4, Claude 4.6, and Gemini 3.1 variants
- Embedding provider settings for VoyageAI, OpenAI, Google, Vertex AI, and custom endpoints

### Fixed

- Dashboard memory deletes now prefer the live canonical write path to avoid runtime cache desync
- Memory dashboard rendering now escapes summary and continuity text/id values before HTML injection
- Scoped resolver no longer drifts as no-id chats gain opening turns
- Scoped resolver no longer merges different stable chat IDs that share the same default name/opening messages
- Prompt template rendering now preserves literal `{{token}}` text inside dynamic conversation, memory, and response content
- Current-chat extraction now guards against host scope drift before writing into scoped storage

### Changed

- Memory workbench now loads curated model lists on open even for provider-managed catalogs such as Copilot
- Model refresh actions now repopulate the selector instead of leaving the button inert

## [0.2.0] - 2026-04-03

### Added

- Fullscreen dashboard UI with sidebar navigation, card-based panels, and theme-aware `.cd-` namespaced styling
- Director model provider controls, provider-based model loading, and connection testing helpers
- Dashboard profile management plus settings JSON import/export
- Lifecycle-managed dashboard controller with cleanup-safe open/close behavior
- Focused dashboard test coverage for CSS, DOM, state, lifecycle, and model helpers

## [0.1.0]

### Added

- Initial RisuAI Plugin V3 Director-Actor implementation
- Canonical persistent memory store and turn cache
- Director pre-request and post-response LLM services with JSON validation
- Universal prompt adapter with author-note-first injection
- Streaming-safe runtime hooks and single-file esbuild bundle output
