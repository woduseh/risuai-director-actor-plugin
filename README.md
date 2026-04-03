# RisuAI Director Actor Plugin

Director-Actor collaborative long-memory plugin for **RisuAI Plugin V3**.

## What it does

- Intercepts `beforeRequest` to call a lightweight Director pass
- Injects `<director-brief>` using author-note-first, latest-user fallback routing
- Reviews completed responses with a post-response Director pass
- Persists canonical memory in `pluginStorage`
- Survives streaming output with debounce-safe finalization
- Opens a fullscreen dashboard UI with sidebar navigation, modern theme-aware styling, and profile management
- Supports director model provider settings, model discovery, connection testing, and JSON import/export flows

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
- In non-DOM test environments, the settings entry falls back to a plain alert summary.

