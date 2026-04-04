# RisuAI Director Actor Plugin

Director-Actor collaborative long-memory plugin for **RisuAI Plugin V3**.

## What it does

- Intercepts `beforeRequest` to call a lightweight Director pass
- Injects `<director-brief>` using author-note-first, latest-user fallback routing
- Reviews completed responses with a post-response Director pass
- Persists scoped canonical memory per character/chat in `pluginStorage`
- Survives streaming output with debounce-safe finalization
- Opens a fullscreen bilingual dashboard UI (`en` / `ko`) with sidebar navigation, last-tab restore, modern theme-aware styling, severity-aware status toasts, and profile management
- Supports director model provider settings for OpenAI, Anthropic, Google, GitHub Copilot, Vertex AI, and custom OpenAI-compatible endpoints
- Includes latest curated model catalogs such as `GPT-5.4`, `Claude Opus 4.6`, `Claude Sonnet 4.6`, and `Gemini 3.1 Pro Preview`
- Exposes prompt preset management for director pre-request and post-response templates
- Includes a scoped memory workbench for summaries, continuity facts, world facts, entities, and relations with live filtering, scope badges, quick navigation, internal section scrolling, bounded rerender updates, manual add/edit/delete, bulk delete, and two-step destructive arming safeguards
- Can backfill or fully regenerate memory from the current active chat into the scoped store
- Stores embedding provider/model settings for VoyageAI, OpenAI, Google, Vertex AI, and custom endpoints

## Claude-Inspired Memory Lifecycle

The plugin implements a multi-layer memory system inspired by Claude Code's `CLAUDE.md` pattern:

### Memory Layers

1. **Canonical Store** — Legacy scoped blob persisting `DirectorPluginState` per character/chat. Remains the backward-compatible source of truth for settings, director state, actor state, and metrics.
2. **Virtual Memdir** — Individually addressable memory documents (`MemdirDocument`) stored in a virtual directory structure. Each scope has its own index manifest and individually addressable records.
3. **Session Notebook** — Lightweight within-session continuity notebook (5 sections: current state, immediate goals, recent developments, unresolved threads, recent mistakes). Threshold-gated updates keep it fresh without churn.

### Memory Lifecycle Stages

| Stage | Description |
|-------|-------------|
| **Extract** | After each finalized turn, the extraction worker produces new memdir documents from conversation context. Debounced and hash-deduplicated. |
| **Recall** | Before each Director pass, a recall model selects relevant documents from the memdir manifest. Falls back to deterministic keyword ranking on model failure. |
| **Session Notebook** | Updated every N turns or N tokens within a single session. Provides stable short-term context independent of retrieval budgets. |
| **Dream** | Periodic auto-consolidation worker (orient → gather → consolidate → prune) that merges redundant extraction documents and prunes stale entries. Never touches operator/manual-locked memories. |

### Migration from Legacy Canonical Memory

When a `MemdirStore` is provided to `CanonicalStore`, the plugin performs a **lazy, non-destructive migration** on first load per scope:

- Entities → `character` documents
- Relations → `relationship` documents
- World facts → `world` documents
- Continuity facts → `continuity` documents
- Summaries → `plot` documents

The migration is **idempotent** (deterministic IDs prevent duplicates), **non-destructive** (the canonical blob is never modified or deleted), and **safe when partially complete** (canonical reads remain available as a fallback; the migration marker is only set after all documents are persisted).

A per-scope migration marker (`director-memdir:migrated:{scopeKey}`) records when migration completed successfully. If the marker is absent, migration is retried on next load.

### Operator Controls

The dashboard Memory Operations card provides operator controls:

- **Run Extract Now** — Force an immediate extraction pass
- **Run Dream Now** — Force an immediate consolidation pass
- **Inspect Recalled Docs** — View the last recall result
- **Toggle Fallback Retrieval** — Switch between model-based and keyword-based recall
- **Settings Export** — Export the current dashboard settings, profiles, and locale as structured JSON from the fullscreen dashboard
- **Memory Navigation** — Keep the last-open tab, jump between memory sections, and preserve focus/scroll/filter context during memory CRUD updates

## Project layout

- `src/index.ts` — live plugin entrypoint and auto-bootstrap
- `src/runtime/plugin.ts` — hook orchestration
- `src/director/` — prompt assembly, model calls, validation
- `src/adapter/` — prompt topology classification and injection
- `src/memory/` — canonical store, memdir store, extraction worker, recall, session notebook, auto-dream consolidation, migration
- `src/ui/` — fullscreen dashboard registration, state, model adapters, and rendering
- `dist/risuai-director-actor-plugin.js` — bundled Plugin V3 output

## Commands

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Output

`npm run build` emits the single-file plugin bundle to:

```text
dist/risuai-director-actor-plugin.js
```

## Notes

- The bundle includes Plugin V3 metadata comments at the top.
- The entrypoint auto-registers when it detects a RisuAI Plugin V3 API object on `globalThis`.
- The dashboard uses `showContainer('fullscreen')` with namespaced `.da-` styles so it stays isolated without Shadow DOM.
- Runtime state is keyed per character/chat and preserves the active scope as chats gain opening turns or later expose stable chat IDs.
- Current chat extraction reuses the Director post-response review path so backfilled memory follows the same normalization rules as live turns.
- In non-DOM test environments, the settings entry falls back to a plain alert summary.

