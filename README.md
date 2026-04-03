# RisuAI Director Actor Plugin

Director-Actor collaborative long-memory plugin for **RisuAI Plugin V3**.

## What it does

- Intercepts `beforeRequest` to call a lightweight Director pass
- Injects `<director-brief>` using author-note-first, latest-user fallback routing
- Reviews completed responses with a post-response Director pass
- Persists scoped canonical memory per character/chat in `pluginStorage`
- Survives streaming output with debounce-safe finalization
- Opens a fullscreen bilingual dashboard UI (`en` / `ko`) with sidebar navigation, modern theme-aware styling, and profile management
- Supports director model provider settings for OpenAI, Anthropic, Google, GitHub Copilot, Vertex AI, and custom OpenAI-compatible endpoints
- Includes latest curated model catalogs such as `GPT-5.4`, `Claude Opus 4.6`, `Claude Sonnet 4.6`, and `Gemini 3.1 Pro Preview`
- Exposes prompt preset management for director pre-request and post-response templates
- Includes a scoped memory workbench for summaries, continuity facts, world facts, entities, and relations with live filtering, manual add/edit/delete, and bulk delete
- Can backfill or fully regenerate memory from the current active chat into the scoped store
- Stores embedding provider/model settings for VoyageAI, OpenAI, Google, Vertex AI, and custom endpoints

## Project layout

- `src/index.ts` — live plugin entrypoint and auto-bootstrap
- `src/runtime/plugin.ts` — hook orchestration
- `src/director/` — prompt assembly, model calls, validation
- `src/adapter/` — prompt topology classification and injection
- `src/memory/` — canonical store, retrieval, turn cache, update application
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

