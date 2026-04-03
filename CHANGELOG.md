# Changelog

## [Unreleased]

### Added

- Memory Operations card on the dashboard memory page showing last extraction time, last consolidation time, notebook freshness badge, and document counts by type
- Operator actions: Run Extract Now, Run Dream Now, Inspect Recalled Docs, Toggle Fallback Retrieval
- Stale-memory warnings and locked-memory indicators on the memory ops card
- Optional `DashboardStore` callbacks (`forceExtract`, `forceDream`, `getRecalledDocs`, `isMemoryLocked`) for composition-root integration
- Persisted fallback retrieval mode preference (`dashboard-memory-ops-prefs-v1`)
- Bilingual (en/ko) labels for all new memory operations UI elements

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

- Fullscreen dashboard UI with sidebar navigation, card-based panels, and theme-aware `.da-` namespaced styling
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
