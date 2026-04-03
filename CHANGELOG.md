# Changelog

## [Unreleased]

### Added

- Memory dashboard vertical slice for summaries and continuity facts, including localized filter and empty states
- Scoped canonical storage keys per character/chat with legacy flat-key migration
- Inline manual add controls for summary and continuity memory items in the dashboard
- Live dashboard filtering across rendered summary and continuity memory items
- Prompt preset foundation for director prompt builders with built-in default templates and custom override support

### Fixed

- Dashboard memory deletes now prefer the live canonical write path to avoid runtime cache desync
- Memory dashboard rendering now escapes summary and continuity text/id values before HTML injection
- Scoped resolver no longer drifts as no-id chats gain opening turns
- Scoped resolver no longer merges different stable chat IDs that share the same default name/opening messages
- Prompt template rendering now preserves literal `{{token}}` text inside dynamic conversation, memory, and response content

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
