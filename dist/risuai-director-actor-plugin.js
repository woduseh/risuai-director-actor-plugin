//@name risuai-director-actor-plugin
//@display-name RisuAI Director Actor
//@api 3.0
//@version 0.4.0
//@description Director-Actor collaborative long-memory plugin for RisuAI Plugin V3

"use strict";
(() => {
  // src/director/prompt.ts
  var MAX_RECENT_MESSAGES = 8;
  var ASSERTIVENESS_DIRECTIVE = {
    light: "Use a light touch \u2014 suggest gently and let the writer take creative lead. Only flag clear continuity breaks.",
    standard: "Provide clear direction with room for creative interpretation. Flag continuity breaks and notable deviations from the brief.",
    firm: "Enforce constraints strictly. Flag any deviation from continuity, characterisation anchors, or forbidden moves as a violation."
  };
  var SCENE_BRIEF_SCHEMA = `{
  "confidence": <number 0\u20131>,
  "pacing": "breathe"|"steady"|"tight"|"accelerate",
  "beats": [{"goal":"\u2026","reason":"\u2026","targetCharacter?":"\u2026","stakes?":"\u2026"}],
  "continuityLocks": ["\u2026"],
  "ensembleWeights": {"<name>": <weight>},
  "styleInheritance": {"genre?":"\u2026","register?":"\u2026","language?":"\u2026","pov?":"\u2026"},
  "forbiddenMoves": ["\u2026"],
  "memoryHints": ["\u2026"]
}`;
  var MEMORY_UPDATE_SCHEMA = `{
  "status": "pass"|"soft-fail"|"hard-fail",
  "turnScore": <number 0\u20131>,
  "violations": ["\u2026"],
  "durableFacts": ["\u2026"],
  "sceneDelta": {"scenePhase?":"\u2026","activeCharacters?":["\u2026"],"worldStateChanges?":["\u2026"]},
  "entityUpdates": [{}],
  "relationUpdates": [{}],
  "memoryOps": [{"op":"insert"|"update"|"merge"|"archive"|"drop","target":"\u2026","payload":{}}],
  "correction?": "\u2026"
}`;
  var BUILTIN_PROMPT_PRESET_ID = "builtin-default";
  var BUILTIN_PROMPT_PRESET_NAME = "Default";
  var DEFAULT_DIRECTOR_PROMPT_PRESET = {
    preRequestSystemTemplate: [
      "You are the Director \u2014 a collaborative-fiction scene analyst.",
      "Examine the conversation and context below, then produce a SceneBrief:",
      "a compact JSON plan that guides the next response.",
      "",
      "Assertiveness: {{assertivenessDirective}}",
      "",
      "Rules:",
      "- Maintain continuity with established facts.",
      "- Respect the current scene phase and pacing.",
      "- Identify beats that advance active arcs naturally.",
      "- Note forbidden moves (contradictions, spoilers, lore violations).",
      "- Keep output concise \u2014 aim for \u2264{{briefTokenCap}} tokens.",
      "",
      "Respond ONLY with a JSON object matching this schema:\n{{sceneBriefSchema}}"
    ].join("\n"),
    preRequestUserTemplate: [
      "## Current State",
      "Scene: {{currentSceneId}}",
      "Phase: {{scenePhase}}",
      "Pacing: {{pacingMode}}",
      "",
      "## Active Arcs",
      "{{activeArcs}}",
      "",
      "## Continuity Locks",
      "{{continuityFacts}}",
      "",
      "{{notebookBlock}}",
      "{{recalledDocsBlock}}",
      "## Memory Summaries",
      "{{memorySummaries}}",
      "",
      "## Recent Conversation",
      "{{recentConversation}}"
    ].join("\n"),
    postResponseSystemTemplate: [
      "You are the Director \u2014 a post-response reviewer for collaborative fiction.",
      "Review the AI response against the SceneBrief below.",
      "Extract durable facts, detect violations, and produce a MemoryUpdate.",
      "",
      "Assertiveness: {{assertivenessDirective}}",
      "",
      "Rules:",
      "- Score turn quality (0\u20131) based on brief adherence, continuity, characterisation.",
      "- List violations (continuity breaks, forbidden moves used, OOC behaviour).",
      "- Extract durable facts worth remembering long-term.",
      "- Produce memory operations for the storage layer.",
      '- "pass" = acceptable, "soft-fail" = minor issues, "hard-fail" = severe violations.',
      "",
      "Respond ONLY with a JSON object matching this schema:\n{{memoryUpdateSchema}}"
    ].join("\n"),
    postResponseUserTemplate: [
      "## SceneBrief Used",
      "{{sceneBriefJson}}",
      "",
      "## Current State",
      "Scene: {{currentSceneId}}",
      "Phase: {{scenePhase}}",
      "",
      "## AI Response",
      "{{responseText}}",
      "",
      "## Recent Conversation Context",
      "{{recentConversation}}"
    ].join("\n"),
    assertivenessDirectives: { ...ASSERTIVENESS_DIRECTIVE },
    sceneBriefSchema: SCENE_BRIEF_SCHEMA,
    memoryUpdateSchema: MEMORY_UPDATE_SCHEMA,
    maxRecentMessages: MAX_RECENT_MESSAGES
  };
  function resolvePromptPreset(settings) {
    const selected = settings.promptPresets[settings.promptPresetId];
    return selected?.preset ?? DEFAULT_DIRECTOR_PROMPT_PRESET;
  }
  function formatConversationTail(messages, max) {
    const tail = messages.slice(-max);
    return tail.map((m) => `[${m.role}] ${m.content}`).join("\n");
  }
  function formatMemorySummaries(memory) {
    if (memory.summaries.length === 0) return "(none)";
    return memory.summaries.slice().sort((a, b) => b.recencyWeight - a.recencyWeight).slice(0, 10).map((s) => `- ${s.text}`).join("\n");
  }
  function formatContinuityFacts(state) {
    if (state.continuityFacts.length === 0) return "(none)";
    return state.continuityFacts.map((f) => `- ${f.text}`).join("\n");
  }
  function formatArcs(state) {
    const active = state.activeArcs.filter((a) => a.status === "active");
    if (active.length === 0) return "(none)";
    return active.map((a) => `- ${a.label} (weight ${a.weight})`).join("\n");
  }
  function applyTemplate(template, vars) {
    return template.replace(
      /\{\{([a-zA-Z0-9_]+)\}\}/g,
      (match, key) => Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
    );
  }
  function buildPreRequestPrompt(ctx) {
    const preset = ctx.promptPreset ?? DEFAULT_DIRECTOR_PROMPT_PRESET;
    const vars = {
      assertivenessDirective: preset.assertivenessDirectives[ctx.assertiveness],
      sceneBriefSchema: preset.sceneBriefSchema,
      briefTokenCap: String(ctx.briefTokenCap),
      recentConversation: formatConversationTail(ctx.messages, preset.maxRecentMessages),
      memorySummaries: formatMemorySummaries(ctx.memory),
      currentSceneId: ctx.directorState.currentSceneId,
      scenePhase: ctx.directorState.scenePhase,
      pacingMode: ctx.directorState.pacingMode,
      activeArcs: formatArcs(ctx.directorState),
      continuityFacts: formatContinuityFacts(ctx.directorState),
      notebookBlock: ctx.notebookBlock ?? "",
      recalledDocsBlock: ctx.recalledDocsBlock ?? ""
    };
    return [
      { role: "system", content: applyTemplate(preset.preRequestSystemTemplate, vars) },
      { role: "user", content: applyTemplate(preset.preRequestUserTemplate, vars) }
    ];
  }
  function buildPostResponsePrompt(ctx) {
    const preset = ctx.promptPreset ?? DEFAULT_DIRECTOR_PROMPT_PRESET;
    const vars = {
      assertivenessDirective: preset.assertivenessDirectives[ctx.assertiveness],
      memoryUpdateSchema: preset.memoryUpdateSchema,
      responseText: ctx.responseText,
      sceneBriefJson: JSON.stringify(ctx.brief, null, 2),
      currentSceneId: ctx.directorState.currentSceneId,
      scenePhase: ctx.directorState.scenePhase,
      recentConversation: formatConversationTail(ctx.messages, preset.maxRecentMessages)
    };
    return [
      { role: "system", content: applyTemplate(preset.postResponseSystemTemplate, vars) },
      { role: "user", content: applyTemplate(preset.postResponseUserTemplate, vars) }
    ];
  }

  // src/director/validator.ts
  var ModelPayloadError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ModelPayloadError";
      Object.setPrototypeOf(this, new.target.prototype);
    }
  };
  var BRIEF_PACING_VALUES = [
    "breathe",
    "steady",
    "tight",
    "accelerate"
  ];
  var VALIDATION_STATUS_VALUES = [
    "pass",
    "soft-fail",
    "hard-fail"
  ];
  var MEMORY_OP_VALUES = [
    "insert",
    "update",
    "merge",
    "archive",
    "drop"
  ];
  function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function requireString(obj, key, label) {
    const v = obj[key];
    if (typeof v !== "string") throw new ModelPayloadError(`${label}: expected string for "${key}"`);
    return v;
  }
  function requireNumber(obj, key, label) {
    const v = obj[key];
    if (typeof v !== "number" || Number.isNaN(v)) {
      throw new ModelPayloadError(`${label}: expected number for "${key}"`);
    }
    return v;
  }
  function requireArray(obj, key, label) {
    const v = obj[key];
    if (!Array.isArray(v)) throw new ModelPayloadError(`${label}: expected array for "${key}"`);
    return v;
  }
  function requireStringArray(obj, key, label) {
    const arr = requireArray(obj, key, label);
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== "string") {
        throw new ModelPayloadError(`${label}: expected string at ${key}[${i}]`);
      }
    }
    return arr;
  }
  function requireRecord(obj, key, label) {
    const v = obj[key];
    if (!isRecord(v)) throw new ModelPayloadError(`${label}: expected object for "${key}"`);
    return v;
  }
  function requireEnum(obj, key, allowed, label) {
    const v = requireString(obj, key, label);
    if (!allowed.includes(v)) {
      throw new ModelPayloadError(`${label}: invalid "${key}" value "${v}"; expected one of: ${allowed.join(", ")}`);
    }
    return v;
  }
  function stripMarkdownCodeFences(text) {
    const normalised = text.replace(/\r\n/g, "\n");
    const fenceRe = /```[a-zA-Z]*\n([\s\S]*?)\n```/;
    const m = fenceRe.exec(normalised);
    if (m) return m[1].trim();
    return normalised.trim();
  }
  function parseJsonObject(text) {
    if (!text.trim()) throw new ModelPayloadError("Empty input");
    const stripped = stripMarkdownCodeFences(text);
    const direct = tryParseObject(stripped);
    if (direct) return direct;
    const extracted = extractJsonSubstring(stripped);
    if (extracted) return extracted;
    throw new ModelPayloadError("Could not extract a JSON object from the model output");
  }
  function tryParseObject(s) {
    try {
      const parsed = JSON.parse(s);
      if (isRecord(parsed)) return parsed;
    } catch {
    }
    return null;
  }
  function extractJsonSubstring(text) {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          const result = tryParseObject(candidate);
          if (result) return result;
        }
      }
    }
    return null;
  }
  function parseSceneBrief(text) {
    const raw = parseJsonObject(text);
    const L = "SceneBrief";
    const confidence = requireNumber(raw, "confidence", L);
    if (confidence < 0 || confidence > 1) {
      throw new ModelPayloadError(`${L}: "confidence" must be between 0 and 1`);
    }
    const pacing = requireEnum(raw, "pacing", BRIEF_PACING_VALUES, L);
    const rawBeats = requireArray(raw, "beats", L);
    const beats = rawBeats.map((b, i) => {
      if (!isRecord(b)) throw new ModelPayloadError(`${L}: beats[${i}] must be an object`);
      const goal = requireString(b, "goal", `${L}.beats[${i}]`);
      const reason = requireString(b, "reason", `${L}.beats[${i}]`);
      const beat = { goal, reason };
      if (typeof b["targetCharacter"] === "string") beat.targetCharacter = b["targetCharacter"];
      if (typeof b["stakes"] === "string") beat.stakes = b["stakes"];
      return beat;
    });
    const continuityLocks = requireStringArray(raw, "continuityLocks", L);
    const forbiddenMoves = requireStringArray(raw, "forbiddenMoves", L);
    const memoryHints = requireStringArray(raw, "memoryHints", L);
    const ewRaw = requireRecord(raw, "ensembleWeights", L);
    const ensembleWeights = {};
    for (const [k, v] of Object.entries(ewRaw)) {
      if (typeof v !== "number") throw new ModelPayloadError(`${L}: ensembleWeights["${k}"] must be a number`);
      ensembleWeights[k] = v;
    }
    const siRaw = requireRecord(raw, "styleInheritance", L);
    const styleInheritance = {};
    for (const field of ["genre", "register", "language", "pov"]) {
      const v = siRaw[field];
      if (typeof v === "string") styleInheritance[field] = v;
    }
    return {
      confidence,
      pacing,
      beats,
      continuityLocks,
      ensembleWeights,
      styleInheritance,
      forbiddenMoves,
      memoryHints
    };
  }
  function parseMemoryUpdate(text) {
    const raw = parseJsonObject(text);
    const L = "MemoryUpdate";
    const status = requireEnum(raw, "status", VALIDATION_STATUS_VALUES, L);
    const turnScore = requireNumber(raw, "turnScore", L);
    const violations = requireStringArray(raw, "violations", L);
    const durableFacts = requireStringArray(raw, "durableFacts", L);
    const sdRaw = requireRecord(raw, "sceneDelta", L);
    const sceneDelta = {};
    if (typeof sdRaw["scenePhase"] === "string") sceneDelta.scenePhase = sdRaw["scenePhase"];
    if (Array.isArray(sdRaw["activeCharacters"])) sceneDelta.activeCharacters = sdRaw["activeCharacters"];
    if (Array.isArray(sdRaw["worldStateChanges"])) sceneDelta.worldStateChanges = sdRaw["worldStateChanges"];
    const entityUpdates = requireArray(raw, "entityUpdates", L);
    const relationUpdates = requireArray(raw, "relationUpdates", L);
    const rawOps = requireArray(raw, "memoryOps", L);
    const memoryOps = rawOps.map((o, i) => {
      if (!isRecord(o)) throw new ModelPayloadError(`${L}: memoryOps[${i}] must be an object`);
      const op = requireEnum(o, "op", MEMORY_OP_VALUES, `${L}.memoryOps[${i}]`);
      const target = requireString(o, "target", `${L}.memoryOps[${i}]`);
      const payload = requireRecord(o, "payload", `${L}.memoryOps[${i}]`);
      return { op, target, payload };
    });
    const result = {
      status,
      turnScore,
      violations,
      durableFacts,
      sceneDelta,
      entityUpdates,
      relationUpdates,
      memoryOps
    };
    if (typeof raw["correction"] === "string") {
      result.correction = raw["correction"];
    }
    return result;
  }

  // src/director/service.ts
  function createDirectorService(api, settings) {
    return {
      async preRequest(ctx) {
        const messages = buildPreRequestPrompt(ctx);
        const llmResult = await api.runLLMModel({
          messages,
          staticModel: settings.directorModel,
          mode: settings.directorMode
        });
        if (llmResult.type === "fail") {
          return { ok: false, error: `LLM call failed: ${llmResult.result}` };
        }
        const raw = llmResult.result;
        try {
          const brief = parseSceneBrief(raw);
          return { ok: true, brief, raw };
        } catch (err) {
          const message = err instanceof ModelPayloadError ? err.message : `SceneBrief parse error: ${String(err)}`;
          return { ok: false, error: message, raw };
        }
      },
      async postResponse(ctx) {
        const messages = buildPostResponsePrompt(ctx);
        const llmResult = await api.runLLMModel({
          messages,
          staticModel: settings.directorModel,
          mode: settings.directorMode
        });
        if (llmResult.type === "fail") {
          return { ok: false, error: `LLM call failed: ${llmResult.result}` };
        }
        const raw = llmResult.result;
        try {
          const update = parseMemoryUpdate(raw);
          return { ok: true, update, raw };
        } catch (err) {
          const message = err instanceof ModelPayloadError ? err.message : `MemoryUpdate parse error: ${String(err)}`;
          return { ok: false, error: message, raw };
        }
      }
    };
  }

  // src/contracts/types.ts
  var DEFAULT_DIRECTOR_SETTINGS = {
    enabled: true,
    assertiveness: "standard",
    directorProvider: "openai",
    directorBaseUrl: "https://api.openai.com/v1",
    directorApiKey: "",
    directorModel: "gpt-4.1-mini",
    directorMode: "otherAx",
    briefTokenCap: 320,
    postReviewEnabled: true,
    embeddingsEnabled: false,
    injectionMode: "auto",
    includeTypes: ["model"],
    cooldownFailureThreshold: 3,
    cooldownMs: 6e4,
    outputDebounceMs: 400,
    embeddingProvider: "openai",
    embeddingBaseUrl: "https://api.openai.com/v1",
    embeddingApiKey: "",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    promptPresetId: "builtin-default",
    promptPresets: {},
    extractionMinTurnInterval: 3,
    recallCooldownMs: 1e4,
    dreamMinHoursElapsed: 4,
    dreamMinSessionsElapsed: 2
  };
  function createEmptyState(seed) {
    const now = Date.now();
    return {
      schemaVersion: 1,
      projectKey: seed?.projectKey ?? "default-project",
      characterKey: seed?.characterKey ?? "default-character",
      sessionKey: seed?.sessionKey ?? "default-session",
      updatedAt: now,
      settings: { ...DEFAULT_DIRECTOR_SETTINGS },
      director: {
        currentSceneId: "scene-0",
        scenePhase: "setup",
        pacingMode: "steady",
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
    };
  }

  // src/memory/memoryDocuments.ts
  var CHARS_PER_TOKEN = 4;
  function buildMemoryMd(docs, options) {
    const maxChars = options.tokenBudget * CHARS_PER_TOKEN;
    const lines = ["# MEMORY.md", ""];
    if (docs.length === 0) {
      lines.push("No memory documents recorded yet.");
      return lines.join("\n");
    }
    const grouped = /* @__PURE__ */ new Map();
    for (const doc of docs) {
      const bucket = grouped.get(doc.type) ?? [];
      bucket.push(doc);
      grouped.set(doc.type, bucket);
    }
    const typeOrder = [
      "character",
      "relationship",
      "world",
      "plot",
      "continuity",
      "operator"
    ];
    let charCount = lines.join("\n").length;
    for (const type of typeOrder) {
      const bucket = grouped.get(type);
      if (!bucket || bucket.length === 0) continue;
      const header = `## ${type}`;
      if (charCount + header.length + 1 > maxChars) break;
      lines.push(header);
      charCount += header.length + 1;
      for (const doc of bucket) {
        const freshTag = doc.freshness !== "current" ? ` [${doc.freshness}]` : "";
        const entry = `- **${doc.title}**${freshTag}: ${doc.description}`;
        if (charCount + entry.length + 1 > maxChars) {
          lines.push("- _(truncated)_");
          return lines.join("\n");
        }
        lines.push(entry);
        charCount += entry.length + 1;
      }
      lines.push("");
      charCount += 1;
    }
    return lines.join("\n");
  }
  async function migrateCanonicalToMemdir(state, store) {
    const now = Date.now();
    const scopeKey = store.scopeKey;
    const docs = [];
    for (const entity of state.memory.entities) {
      docs.push({
        id: `migrated-entity-${entity.id}`,
        type: "character",
        title: entity.name,
        description: entity.facts.join("; "),
        scopeKey,
        updatedAt: entity.updatedAt ?? now,
        source: "migration",
        freshness: "current",
        tags: entity.tags ?? []
      });
    }
    for (const rel of state.memory.relations) {
      docs.push({
        id: `migrated-relation-${rel.id}`,
        type: "relationship",
        title: `${rel.sourceId} \u2192 ${rel.targetId}`,
        description: [rel.label, ...rel.facts ?? []].join("; "),
        scopeKey,
        updatedAt: rel.updatedAt ?? now,
        source: "migration",
        freshness: "current",
        tags: []
      });
    }
    for (const wf of state.memory.worldFacts) {
      docs.push({
        id: `migrated-worldfact-${wf.id}`,
        type: "world",
        title: wf.text.slice(0, 60),
        description: wf.text,
        scopeKey,
        updatedAt: wf.updatedAt ?? now,
        source: "migration",
        freshness: "current",
        tags: wf.tags ?? []
      });
    }
    for (const cf of state.memory.continuityFacts) {
      docs.push({
        id: `migrated-continuity-${cf.id}`,
        type: "continuity",
        title: cf.text.slice(0, 60),
        description: cf.text,
        scopeKey,
        updatedAt: now,
        source: "migration",
        freshness: "current",
        tags: []
      });
    }
    for (const sum of state.memory.summaries) {
      docs.push({
        id: `migrated-summary-${sum.id}`,
        type: "plot",
        title: sum.text.slice(0, 60),
        description: sum.text,
        scopeKey,
        updatedAt: sum.updatedAt ?? now,
        source: "migration",
        freshness: "current",
        tags: []
      });
    }
    for (const doc of docs) {
      await store.putDocument(doc);
    }
    return {
      migratedCount: docs.length,
      docIds: docs.map((d) => d.id)
    };
  }

  // src/memory/canonicalStore.ts
  var DIRECTOR_STATE_STORAGE_KEY = "director-plugin-state";
  var MEMDIR_MIGRATION_MARKER_NS = "director-memdir:migrated";
  var MEMDIR_SCHEMA_VERSION = 2;
  function patchLegacyMemory(state) {
    if (!Array.isArray(state.memory.continuityFacts)) {
      if (Array.isArray(state.director.continuityFacts) && state.director.continuityFacts.length > 0) {
        state.memory.continuityFacts = structuredClone(state.director.continuityFacts);
      } else {
        state.memory.continuityFacts = [];
      }
    }
    if (!Array.isArray(state.memory.worldFacts)) {
      state.memory.worldFacts = [];
    }
    if (!Array.isArray(state.memory.entities)) {
      state.memory.entities = [];
    }
    if (!Array.isArray(state.memory.relations)) {
      state.memory.relations = [];
    }
  }
  function isValidState(value) {
    if (value == null || typeof value !== "object") return false;
    const v = value;
    return typeof v.schemaVersion === "number" && typeof v.projectKey === "string" && typeof v.characterKey === "string" && typeof v.sessionKey === "string" && typeof v.updatedAt === "number" && v.settings != null && typeof v.settings === "object" && v.director != null && typeof v.director === "object" && v.actor != null && typeof v.actor === "object" && v.memory != null && typeof v.memory === "object" && v.metrics != null && typeof v.metrics === "object";
  }
  function migrationMarkerKey(scopeKey) {
    return `${MEMDIR_MIGRATION_MARKER_NS}:${scopeKey}`;
  }
  var CanonicalStore = class {
    storage;
    storageKey;
    migrateFromFlatKey;
    memdirStore;
    current = null;
    migrationMarker = null;
    constructor(storage, options) {
      this.storage = storage;
      this.storageKey = options?.storageKey ?? DIRECTOR_STATE_STORAGE_KEY;
      this.migrateFromFlatKey = options?.migrateFromFlatKey === true && this.storageKey !== DIRECTOR_STATE_STORAGE_KEY;
      this.memdirStore = options?.memdirStore ?? null;
    }
    /** The storage key this store reads/writes. */
    get stateStorageKey() {
      return this.storageKey;
    }
    snapshot() {
      if (this.current == null) {
        throw new Error("CanonicalStore has not been loaded yet");
      }
      return structuredClone(this.current);
    }
    /**
     * Read the persisted migration marker for this scope, or `null`
     * if memdir migration has not been completed (or no memdirStore).
     */
    async getMigrationMarker() {
      if (this.migrationMarker != null) return this.migrationMarker;
      if (this.memdirStore == null) return null;
      const raw = await this.storage.getItem(
        migrationMarkerKey(this.memdirStore.scopeKey)
      );
      if (raw != null && typeof raw === "object" && typeof raw.scopeKey === "string") {
        this.migrationMarker = raw;
        return raw;
      }
      return null;
    }
    async load() {
      const raw = await this.storage.getItem(this.storageKey);
      if (isValidState(raw)) {
        this.current = structuredClone(raw);
        patchLegacyMemory(this.current);
        await this.tryMemdirMigration();
        return structuredClone(this.current);
      }
      if (this.migrateFromFlatKey) {
        const legacy = await this.storage.getItem(
          DIRECTOR_STATE_STORAGE_KEY
        );
        if (isValidState(legacy)) {
          this.current = structuredClone(legacy);
          patchLegacyMemory(this.current);
          await this.storage.setItem(
            this.storageKey,
            structuredClone(this.current)
          );
          await this.tryMemdirMigration();
          return structuredClone(this.current);
        }
      }
      this.current = createEmptyState();
      return structuredClone(this.current);
    }
    async writeFirst(mutator, onAfterPersist) {
      if (this.current == null) {
        await this.load();
      }
      const next = await mutator(structuredClone(this.current));
      next.updatedAt = Date.now();
      next.metrics.totalMemoryWrites += 1;
      next.metrics.lastUpdatedAt = next.updatedAt;
      const toStore = structuredClone(next);
      await this.storage.setItem(this.storageKey, toStore);
      this.current = structuredClone(next);
      if (onAfterPersist) {
        await onAfterPersist();
      }
      return structuredClone(this.current);
    }
    // ── Private: memdir migration ───────────────────────────────────────
    /**
     * Lazily migrate canonical memory into memdir on first successful load.
     * The migration is idempotent and non-destructive: the canonical blob
     * is never modified, and a per-scope marker prevents re-migration.
     */
    async tryMemdirMigration() {
      if (this.memdirStore == null || this.current == null) return;
      const existing = await this.getMigrationMarker();
      if (existing != null) return;
      try {
        const result = await migrateCanonicalToMemdir(this.current, this.memdirStore);
        const marker = {
          scopeKey: this.memdirStore.scopeKey,
          migratedAt: Date.now(),
          schemaVersion: MEMDIR_SCHEMA_VERSION,
          docCount: result.migratedCount
        };
        await this.storage.setItem(
          migrationMarkerKey(this.memdirStore.scopeKey),
          marker
        );
        this.migrationMarker = marker;
      } catch {
      }
    }
  };

  // src/contracts/memorySchema.ts
  function createScopeRegistry() {
    return { entries: [] };
  }
  function generateScopeId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `sc-${ts}-${rand}`;
  }
  function registerFingerprint(registry, fingerprint, label, options) {
    const existing = registry.entries.find(
      (e) => e.fingerprints.includes(fingerprint)
    );
    if (existing) return existing.scopeId;
    const idFn = options?.generateId ?? generateScopeId;
    const now = Date.now();
    const entry = {
      scopeId: idFn(),
      fingerprints: [fingerprint],
      createdAt: now,
      updatedAt: now
    };
    if (label !== void 0) {
      entry.label = label;
    }
    registry.entries.push(entry);
    return entry.scopeId;
  }
  function resolveScope(registry, fingerprint) {
    return registry.entries.find(
      (e) => e.fingerprints.includes(fingerprint)
    )?.scopeId;
  }
  function aliasFingerprint(registry, scopeId, fingerprint) {
    const entry = registry.entries.find((e) => e.scopeId === scopeId);
    if (!entry) {
      throw new Error(`Scope ID "${scopeId}" not found in registry`);
    }
    if (!entry.fingerprints.includes(fingerprint)) {
      entry.fingerprints.push(fingerprint);
      entry.updatedAt = Date.now();
    }
  }

  // src/memory/scopeKeys.ts
  var MAX_CHAT_FINGERPRINT_MESSAGES = 3;
  function fnv1a(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function normalizeTextForFingerprint(text) {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }
  function characterScopeIdentity(chaId, name) {
    const normalizedName = normalizeTextForFingerprint(name);
    const fingerprint = fnv1a(`char\0${chaId}\0${normalizedName}`);
    return { chaId, name, fingerprint };
  }
  function chatFingerprint(chaId, chatName, lastDate, messages) {
    const nonEmpty = messages.map((m) => normalizeTextForFingerprint(m)).filter((m) => m.length > 0).slice(0, MAX_CHAT_FINGERPRINT_MESSAGES);
    const normalizedName = normalizeTextForFingerprint(chatName);
    const payload = [
      "chat",
      chaId,
      normalizedName,
      String(lastDate),
      ...nonEmpty
    ].join("\0");
    return fnv1a(payload);
  }
  function composeScopeKey(characterFingerprint, chatFp) {
    return `scope:${characterFingerprint}:${chatFp}`;
  }
  function composeStorageKey(namespace, scopeKey) {
    return `${namespace}::${scopeKey}`;
  }

  // src/memory/scopeResolver.ts
  var SCOPE_REGISTRY_KEY = "director-scope-registry";
  var STORAGE_NAMESPACE = "director-plugin-state";
  async function tryGetCharacter(api) {
    try {
      const anyApi = api;
      const getCharacter = anyApi["getCharacter"];
      if (typeof getCharacter !== "function") return null;
      const char = await getCharacter.call(api);
      if (char != null && typeof char === "object" && typeof char.chaId === "string" && typeof char.name === "string") {
        return {
          chaId: char.chaId,
          name: char.name
        };
      }
      return null;
    } catch {
      return null;
    }
  }
  async function tryGetChat(api) {
    try {
      const anyApi = api;
      const getCurrentCharacterIndex = anyApi["getCurrentCharacterIndex"];
      const getCurrentChatIndex = anyApi["getCurrentChatIndex"];
      const getChatFromIndex = anyApi["getChatFromIndex"];
      if (typeof getCurrentCharacterIndex !== "function" || typeof getCurrentChatIndex !== "function" || typeof getChatFromIndex !== "function") {
        return null;
      }
      const charIndex = await getCurrentCharacterIndex.call(api);
      const chatIndex = await getCurrentChatIndex.call(api);
      const chat = await getChatFromIndex.call(api, charIndex, chatIndex);
      if (chat == null || typeof chat !== "object") return null;
      const c = chat;
      const name = typeof c.name === "string" ? c.name : "";
      const lastDate = typeof c.lastDate === "number" ? c.lastDate : 0;
      const messages = Array.isArray(c.messages) ? c.messages.filter(
        (entry) => entry != null && typeof entry.role === "string" && typeof entry.content === "string"
      ) : Array.isArray(c.message) ? c.message.filter(
        (entry) => entry != null && typeof entry.role === "string" && typeof entry.data === "string"
      ).map((entry) => ({ role: entry.role, content: entry.data })) : [];
      const messageChatId = Array.isArray(c.message) ? c.message.find(
        (entry) => typeof entry?.chatId === "string" && entry.chatId.length > 0
      )?.chatId : void 0;
      const chatId = typeof c.id === "string" ? c.id : typeof c.id === "number" ? String(c.id) : typeof messageChatId === "string" ? messageChatId : void 0;
      const result = { name, lastDate, messages };
      if (chatId !== void 0) {
        result.chatId = chatId;
      }
      return result;
    } catch {
      return null;
    }
  }
  async function loadRegistry(storage) {
    const raw = await storage.getItem(SCOPE_REGISTRY_KEY);
    if (raw != null && typeof raw === "object" && Array.isArray(raw.entries)) {
      return raw;
    }
    return createScopeRegistry();
  }
  async function saveRegistry(storage, registry) {
    await storage.setItem(SCOPE_REGISTRY_KEY, structuredClone(registry));
  }
  function uniqueFingerprints(fingerprints) {
    return Array.from(new Set(fingerprints));
  }
  function resolveFirstScope(registry, fingerprints) {
    return fingerprints.map((fingerprint) => resolveScope(registry, fingerprint)).find((value) => typeof value === "string" && value.length > 0);
  }
  function removeFingerprintFromScope(registry, scopeId, fingerprint) {
    const entry = registry.entries.find((candidate) => candidate.scopeId === scopeId);
    if (!entry) {
      return;
    }
    const nextFingerprints = entry.fingerprints.filter(
      (candidate) => candidate !== fingerprint
    );
    if (nextFingerprints.length === entry.fingerprints.length) {
      return;
    }
    entry.fingerprints = nextFingerprints;
    entry.updatedAt = Date.now();
  }
  function buildNoIdFingerprints(chaId, chatName, messageTexts) {
    const emptyFingerprint = chatFingerprint(chaId, chatName, 0, []);
    const aliasFingerprints = [];
    for (let count = messageTexts.length; count >= 1; count--) {
      aliasFingerprints.push(
        chatFingerprint(chaId, chatName, 0, messageTexts.slice(0, count))
      );
    }
    if (aliasFingerprints.length === 0) {
      aliasFingerprints.push(emptyFingerprint);
    }
    const resolveFingerprints = aliasFingerprints[0] === emptyFingerprint ? aliasFingerprints : [...aliasFingerprints, emptyFingerprint];
    return {
      resolveFingerprints: uniqueFingerprints(resolveFingerprints),
      aliasFingerprints: uniqueFingerprints(aliasFingerprints),
      emptyFingerprint
    };
  }
  async function resolveScopeStorageKey(api) {
    const character = await tryGetCharacter(api);
    if (!character) {
      return { storageKey: DIRECTOR_STATE_STORAGE_KEY, isFallback: true };
    }
    const chat = await tryGetChat(api);
    if (!chat) {
      return { storageKey: DIRECTOR_STATE_STORAGE_KEY, isFallback: true };
    }
    const charIdentity = characterScopeIdentity(character.chaId, character.name);
    const registry = await loadRegistry(api.pluginStorage);
    let scopeId;
    let aliasFingerprints = [];
    let emptyFingerprint;
    if (chat.chatId != null && chat.chatId.length > 0) {
      const stableFingerprint = chatFingerprint(character.chaId, chat.chatId, 0, []);
      scopeId = resolveFirstScope(registry, [stableFingerprint]);
      aliasFingerprints = [stableFingerprint];
    } else {
      const messageTexts = chat.messages.map((m) => m.content);
      const noIdFingerprints = buildNoIdFingerprints(
        character.chaId,
        chat.name,
        messageTexts
      );
      scopeId = resolveFirstScope(registry, noIdFingerprints.resolveFingerprints);
      aliasFingerprints = noIdFingerprints.aliasFingerprints;
      emptyFingerprint = noIdFingerprints.emptyFingerprint;
    }
    if (!scopeId) {
      const primaryFingerprint = aliasFingerprints[0];
      scopeId = registerFingerprint(
        registry,
        primaryFingerprint,
        `${character.name} / ${chat.name}`,
        {
          generateId: () => `sc-${primaryFingerprint}`
        }
      );
    }
    for (const fingerprint of aliasFingerprints) {
      aliasFingerprint(registry, scopeId, fingerprint);
    }
    if (chat.chatId == null && emptyFingerprint !== void 0 && !aliasFingerprints.includes(emptyFingerprint)) {
      removeFingerprintFromScope(registry, scopeId, emptyFingerprint);
    }
    await saveRegistry(api.pluginStorage, registry);
    const scopeKey = composeScopeKey(charIdentity.fingerprint, scopeId);
    const storageKey = composeStorageKey(STORAGE_NAMESPACE, scopeKey);
    return { storageKey, isFallback: false };
  }

  // src/memory/memoryMutations.ts
  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function uniqueStrings(values) {
    return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  }
  function upsertSummary(state, input) {
    const now = Date.now();
    const { id, text, recencyWeight, sceneId, entityIds } = input;
    const summaries = state.memory.summaries;
    const existing = id ? summaries.find((s) => s.id === id) : void 0;
    if (existing) {
      existing.text = text;
      existing.recencyWeight = recencyWeight;
      if (sceneId !== void 0) existing.sceneId = sceneId;
      if (entityIds) {
        existing.entityIds = uniqueStrings([...existing.entityIds ?? [], ...entityIds]);
      }
      existing.updatedAt = now;
      return;
    }
    const entry = {
      id: id ?? createId("summary"),
      text,
      recencyWeight,
      updatedAt: now
    };
    if (sceneId !== void 0) entry.sceneId = sceneId;
    if (entityIds && entityIds.length > 0) entry.entityIds = entityIds;
    summaries.push(entry);
  }
  function deleteSummary(state, id) {
    const idx = state.memory.summaries.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    state.memory.summaries.splice(idx, 1);
    return true;
  }
  function upsertWorldFact(state, input) {
    const now = Date.now();
    const { id, text, tags } = input;
    const worldFacts = state.memory.worldFacts;
    const existing = id ? worldFacts.find((w) => w.id === id) : void 0;
    if (existing) {
      existing.text = text;
      if (tags) existing.tags = uniqueStrings([...existing.tags ?? [], ...tags]);
      existing.updatedAt = now;
      return;
    }
    const entry = {
      id: id ?? createId("world"),
      text,
      updatedAt: now
    };
    if (tags && tags.length > 0) entry.tags = tags;
    worldFacts.push(entry);
  }
  function deleteWorldFact(state, id) {
    const idx = state.memory.worldFacts.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    state.memory.worldFacts.splice(idx, 1);
    return true;
  }
  function upsertEntity(state, input) {
    const now = Date.now();
    const { id, name, facts = [], tags = [] } = input;
    const entities = state.memory.entities;
    const existing = id ? entities.find((e) => e.id === id) : name ? entities.find((e) => e.name === name) : void 0;
    if (existing) {
      if (name) existing.name = name;
      existing.facts = uniqueStrings([...existing.facts, ...facts]);
      existing.tags = uniqueStrings([...existing.tags ?? [], ...tags]);
      existing.updatedAt = now;
      return;
    }
    entities.push({
      id: id ?? createId("entity"),
      name: name ?? `entity-${entities.length + 1}`,
      facts,
      tags,
      updatedAt: now
    });
  }
  function deleteEntity(state, id) {
    const idx = state.memory.entities.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    state.memory.entities.splice(idx, 1);
    return true;
  }
  function upsertRelation(state, input) {
    const now = Date.now();
    const { id, sourceId, targetId, label, facts = [] } = input;
    const relations = state.memory.relations;
    const existing = id ? relations.find((r) => r.id === id) : void 0;
    if (existing) {
      if (sourceId) existing.sourceId = sourceId;
      if (targetId) existing.targetId = targetId;
      if (label) existing.label = label;
      existing.facts = uniqueStrings([...existing.facts ?? [], ...facts]);
      existing.updatedAt = now;
      return;
    }
    relations.push({
      id: id ?? createId("relation"),
      sourceId: sourceId ?? "unknown-source",
      targetId: targetId ?? "unknown-target",
      label: label ?? "related",
      facts,
      updatedAt: now
    });
  }
  function deleteRelation(state, id) {
    const idx = state.memory.relations.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    state.memory.relations.splice(idx, 1);
    return true;
  }
  function upsertContinuityFact(state, input) {
    const { id, text, priority, sceneId, entityIds } = input;
    let resolvedId = id;
    function upsertInto(arr) {
      const existing = id ? arr.find((f) => f.id === id) : arr.find((f) => f.text === text);
      if (existing) {
        if (!resolvedId) {
          resolvedId = existing.id;
        } else if (existing.id !== resolvedId) {
          existing.id = resolvedId;
        }
        existing.text = text;
        existing.priority = priority;
        if (sceneId !== void 0) existing.sceneId = sceneId;
        if (entityIds) {
          existing.entityIds = uniqueStrings([...existing.entityIds ?? [], ...entityIds]);
        }
        return;
      }
      if (!resolvedId) {
        resolvedId = createId("continuity");
      }
      const entry = { id: resolvedId, text, priority };
      if (sceneId !== void 0) entry.sceneId = sceneId;
      if (entityIds && entityIds.length > 0) entry.entityIds = entityIds;
      arr.push(entry);
    }
    upsertInto(state.memory.continuityFacts);
    upsertInto(state.director.continuityFacts);
  }
  function deleteContinuityFact(state, id) {
    const memIdx = state.memory.continuityFacts.findIndex((f) => f.id === id);
    const dirIdx = state.director.continuityFacts.findIndex((f) => f.id === id);
    let removed = false;
    if (memIdx !== -1) {
      state.memory.continuityFacts.splice(memIdx, 1);
      removed = true;
    }
    if (dirIdx !== -1) {
      state.director.continuityFacts.splice(dirIdx, 1);
      removed = true;
    }
    return removed;
  }

  // src/memory/applyUpdate.ts
  var MAX_FAILURE_HISTORY = 50;
  var MAX_SCENE_LEDGER = 200;
  function createId2(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function asRecord(value) {
    return value != null && typeof value === "object" ? value : null;
  }
  function readString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
  function readNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function readStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => readString(entry)).filter((entry) => entry != null);
  }
  function isScenePhase(value) {
    return value === "setup" || value === "pressure" || value === "turn" || value === "aftermath";
  }
  function uniqueStrings2(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }
  function upsertSummary2(summaries, text, now, partial) {
    const existing = summaries.find((entry) => entry.text === text || entry.id === partial?.id);
    if (existing) {
      existing.text = text;
      if (partial?.sceneId !== void 0) {
        existing.sceneId = partial.sceneId;
      }
      existing.recencyWeight = partial?.recencyWeight ?? Math.max(existing.recencyWeight, 1);
      existing.entityIds = uniqueStrings2([
        ...existing.entityIds ?? [],
        ...readStringArray(partial?.entityIds)
      ]);
      existing.updatedAt = now;
      return;
    }
    const next = {
      id: partial?.id ?? createId2("summary"),
      text,
      recencyWeight: partial?.recencyWeight ?? 1,
      updatedAt: now
    };
    if (partial?.sceneId !== void 0) {
      next.sceneId = partial.sceneId;
    }
    const entityIds = readStringArray(partial?.entityIds);
    if (entityIds.length > 0) {
      next.entityIds = entityIds;
    }
    summaries.push(next);
  }
  function upsertWorldFact2(worldFacts, text, now, partial) {
    const existing = worldFacts.find((entry) => entry.text === text || entry.id === partial?.id);
    if (existing) {
      existing.text = text;
      existing.tags = uniqueStrings2([...existing.tags ?? [], ...readStringArray(partial?.tags)]);
      existing.updatedAt = now;
      return;
    }
    const next = {
      id: partial?.id ?? createId2("world"),
      text,
      updatedAt: now
    };
    const tags = readStringArray(partial?.tags);
    if (tags.length > 0) {
      next.tags = tags;
    }
    worldFacts.push(next);
  }
  function upsertContinuityFact2(state, text, _now, partial) {
    const input = {
      text,
      priority: partial?.priority ?? 0.8
    };
    if (partial?.id != null) input.id = partial.id;
    if (partial?.sceneId != null) input.sceneId = partial.sceneId;
    if (partial?.entityIds != null) input.entityIds = partial.entityIds;
    upsertContinuityFact(state, input);
  }
  function upsertEntity2(entities, payload, now, warnings) {
    const id = readString(payload.id);
    const name = readString(payload.name);
    if (!id && !name) {
      warnings.push("Ignored entity update without id or name.");
      return;
    }
    const existing = entities.find((entry) => entry.id === id || entry.name === name);
    const facts = readStringArray(payload.facts);
    const tags = readStringArray(payload.tags);
    if (existing) {
      if (name) existing.name = name;
      existing.facts = uniqueStrings2([...existing.facts, ...facts]);
      existing.tags = uniqueStrings2([...existing.tags ?? [], ...tags]);
      existing.updatedAt = now;
      return;
    }
    entities.push({
      id: id ?? createId2("entity"),
      name: name ?? `entity-${entities.length + 1}`,
      facts,
      tags,
      updatedAt: now
    });
  }
  function upsertRelation2(relations, payload, now, warnings) {
    const id = readString(payload.id);
    const sourceId = readString(payload.sourceId);
    const targetId = readString(payload.targetId);
    const label = readString(payload.label);
    if (!id && (!sourceId || !targetId || !label)) {
      warnings.push("Ignored relation update without id or relation keys.");
      return;
    }
    const existing = relations.find(
      (entry) => entry.id === id || entry.sourceId === sourceId && entry.targetId === targetId && entry.label === label
    );
    const facts = readStringArray(payload.facts);
    if (existing) {
      existing.facts = uniqueStrings2([...existing.facts ?? [], ...facts]);
      existing.updatedAt = now;
      return;
    }
    relations.push({
      id: id ?? createId2("relation"),
      sourceId: sourceId ?? "unknown-source",
      targetId: targetId ?? "unknown-target",
      label: label ?? "related",
      facts,
      updatedAt: now
    });
  }
  function upsertArc(arcs, payload, warnings) {
    const id = readString(payload.id);
    const label = readString(payload.label);
    if (!id && !label) {
      warnings.push("Ignored active arc operation without id or label.");
      return;
    }
    const existing = arcs.find((entry) => entry.id === id || entry.label === label);
    const weight = readNumber(payload.weight) ?? 1;
    const status = payload.status === "active" || payload.status === "paused" || payload.status === "resolved" ? payload.status : "active";
    if (existing) {
      existing.label = label ?? existing.label;
      existing.weight = weight;
      existing.status = status;
      return;
    }
    arcs.push({
      id: id ?? createId2("arc"),
      label: label ?? `arc-${arcs.length + 1}`,
      status,
      weight
    });
  }
  function removeByIdentity(entries, payload, predicate) {
    const id = readString(payload.id);
    const index = entries.findIndex((entry) => entry.id === id || predicate?.(entry) === true);
    if (index === -1) return false;
    entries.splice(index, 1);
    return true;
  }
  function normalizeTarget(target) {
    return target.replace(/[\s_-]+/g, "").toLowerCase();
  }
  function applyMemoryOperation(state, operation, now, input, warnings) {
    const payload = asRecord(operation.payload);
    if (!payload) {
      warnings.push(`Ignored memory operation "${operation.target}" because payload was not an object.`);
      return;
    }
    const target = normalizeTarget(operation.target);
    const text = readString(payload.text);
    switch (target) {
      case "summaries":
      case "summary": {
        if (operation.op === "drop") {
          if (!removeByIdentity(state.memory.summaries, payload, (entry) => entry.text === text)) {
            warnings.push(`Could not drop summary "${text ?? payload.id ?? "unknown"}".`);
          }
          return;
        }
        if (operation.op === "archive") {
          const summary = state.memory.summaries.find(
            (entry) => entry.id === payload.id || entry.text === text
          );
          if (!summary) {
            warnings.push(`Could not archive summary "${text ?? payload.id ?? "unknown"}".`);
            return;
          }
          state.memory.turnArchive.push({
            id: createId2("archive"),
            summaryId: summary.id,
            sourceTurnIds: [input.turnId],
            createdAt: now
          });
          state.memory.summaries = state.memory.summaries.filter((entry) => entry.id !== summary.id);
          return;
        }
        if (!text) {
          warnings.push("Ignored summary operation without text.");
          return;
        }
        const summaryPartial = {};
        const summaryId = readString(payload.id);
        const summarySceneId = readString(payload.sceneId);
        const summaryRecencyWeight = readNumber(payload.recencyWeight);
        const summaryEntityIds = readStringArray(payload.entityIds);
        if (summaryId !== null) summaryPartial.id = summaryId;
        if (summarySceneId !== null) summaryPartial.sceneId = summarySceneId;
        if (summaryRecencyWeight !== null) {
          summaryPartial.recencyWeight = summaryRecencyWeight;
        }
        if (summaryEntityIds.length > 0) {
          summaryPartial.entityIds = summaryEntityIds;
        }
        upsertSummary2(state.memory.summaries, text, now, {
          ...summaryPartial
        });
        return;
      }
      case "worldfacts":
      case "worldfact": {
        if (operation.op === "drop") {
          if (!removeByIdentity(state.memory.worldFacts, payload, (entry) => entry.text === text)) {
            warnings.push(`Could not drop world fact "${text ?? payload.id ?? "unknown"}".`);
          }
          return;
        }
        if (!text) {
          warnings.push("Ignored world fact operation without text.");
          return;
        }
        const worldFactPartial = {};
        const worldFactId = readString(payload.id);
        const worldFactTags = readStringArray(payload.tags);
        if (worldFactId !== null) worldFactPartial.id = worldFactId;
        if (worldFactTags.length > 0) worldFactPartial.tags = worldFactTags;
        upsertWorldFact2(state.memory.worldFacts, text, now, {
          ...worldFactPartial
        });
        return;
      }
      case "continuityfacts":
      case "continuityfact": {
        if (operation.op === "drop") {
          const dropId = readString(payload.id);
          if (dropId) {
            if (!deleteContinuityFact(state, dropId)) {
              warnings.push(`Could not drop continuity fact "${dropId}".`);
            }
          } else if (text) {
            const dirIdx = state.director.continuityFacts.findIndex((e) => e.text === text);
            const memIdx = state.memory.continuityFacts.findIndex((e) => e.text === text);
            if (dirIdx === -1 && memIdx === -1) {
              warnings.push(`Could not drop continuity fact "${text}".`);
            }
            if (dirIdx !== -1) state.director.continuityFacts.splice(dirIdx, 1);
            if (memIdx !== -1) state.memory.continuityFacts.splice(memIdx, 1);
          } else {
            warnings.push('Could not drop continuity fact "unknown".');
          }
          return;
        }
        if (!text) {
          warnings.push("Ignored continuity fact operation without text.");
          return;
        }
        const continuityPartial = {};
        const continuityId = readString(payload.id);
        const continuityPriority = readNumber(payload.priority);
        const continuitySceneId = readString(payload.sceneId);
        const continuityEntityIds = readStringArray(payload.entityIds);
        if (continuityId !== null) continuityPartial.id = continuityId;
        if (continuityPriority !== null) continuityPartial.priority = continuityPriority;
        if (continuitySceneId !== null) continuityPartial.sceneId = continuitySceneId;
        if (continuityEntityIds.length > 0) {
          continuityPartial.entityIds = continuityEntityIds;
        }
        upsertContinuityFact2(state, text, now, {
          ...continuityPartial
        });
        return;
      }
      case "entities":
      case "entity":
        if (operation.op === "drop") {
          if (!removeByIdentity(
            state.memory.entities,
            payload,
            (entry) => entry.name === readString(payload.name)
          )) {
            warnings.push(`Could not drop entity "${readString(payload.name) ?? payload.id ?? "unknown"}".`);
          }
          return;
        }
        upsertEntity2(state.memory.entities, payload, now, warnings);
        return;
      case "relations":
      case "relation":
        if (operation.op === "drop") {
          if (!removeByIdentity(state.memory.relations, payload, (entry) => {
            const sourceId = readString(payload.sourceId);
            const targetId = readString(payload.targetId);
            const label = readString(payload.label);
            return entry.sourceId === sourceId && entry.targetId === targetId && entry.label === label;
          })) {
            warnings.push(`Could not drop relation "${payload.id ?? "unknown"}".`);
          }
          return;
        }
        upsertRelation2(state.memory.relations, payload, now, warnings);
        return;
      case "activearcs":
      case "activearc":
        if (operation.op === "drop") {
          if (!removeByIdentity(
            state.director.activeArcs,
            payload,
            (entry) => entry.label === readString(payload.label)
          )) {
            warnings.push(`Could not drop active arc "${readString(payload.label) ?? payload.id ?? "unknown"}".`);
          }
          return;
        }
        upsertArc(state.director.activeArcs, payload, warnings);
        return;
      default:
        warnings.push(`Unknown memory operation target "${operation.target}".`);
    }
  }
  function applyMemoryUpdate(state, update, input) {
    const next = structuredClone(state);
    const warnings = [];
    const now = Date.now();
    next.director.pacingMode = input.brief.pacing;
    next.director.ensembleWeights = {
      ...next.director.ensembleWeights,
      ...input.brief.ensembleWeights
    };
    for (const lock of input.brief.continuityLocks) {
      upsertContinuityFact2(next, lock, now, { sceneId: next.director.currentSceneId });
    }
    if (isScenePhase(update.sceneDelta.scenePhase)) {
      next.director.scenePhase = update.sceneDelta.scenePhase;
    }
    for (const durableFact of uniqueStrings2(update.durableFacts)) {
      upsertSummary2(next.memory.summaries, durableFact, now, {
        sceneId: next.director.currentSceneId,
        recencyWeight: 1
      });
    }
    for (const worldChange of uniqueStrings2(update.sceneDelta.worldStateChanges ?? [])) {
      upsertWorldFact2(next.memory.worldFacts, worldChange, now);
    }
    next.memory.sceneLedger.push({
      id: input.turnId,
      sceneId: next.director.currentSceneId,
      userText: input.userText,
      actorText: input.actorText,
      createdAt: now
    });
    if (next.memory.sceneLedger.length > MAX_SCENE_LEDGER) {
      next.memory.sceneLedger = next.memory.sceneLedger.slice(-MAX_SCENE_LEDGER);
    }
    for (const entityUpdate of update.entityUpdates) {
      const payload = asRecord(entityUpdate);
      if (!payload) {
        warnings.push("Ignored non-object entity update.");
        continue;
      }
      upsertEntity2(next.memory.entities, payload, now, warnings);
    }
    for (const relationUpdate of update.relationUpdates) {
      const payload = asRecord(relationUpdate);
      if (!payload) {
        warnings.push("Ignored non-object relation update.");
        continue;
      }
      upsertRelation2(next.memory.relations, payload, now, warnings);
    }
    for (const operation of update.memoryOps) {
      applyMemoryOperation(next, operation, now, input, warnings);
    }
    if (update.violations.length > 0) {
      const severity = update.status === "hard-fail" ? "high" : update.status === "soft-fail" ? "medium" : "low";
      next.director.failureHistory.unshift(
        ...update.violations.map((reason) => ({
          timestamp: now,
          reason,
          severity
        }))
      );
      next.director.failureHistory = next.director.failureHistory.slice(0, MAX_FAILURE_HISTORY);
    }
    if (update.correction) {
      next.actor.currentIntentHints = uniqueStrings2([
        update.correction,
        ...next.actor.currentIntentHints
      ]).slice(0, 12);
    }
    return { state: next, warnings };
  }

  // src/memory/retrieval.ts
  var STOP_WORDS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "out",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "because",
    "but",
    "and",
    "or",
    "if",
    "while",
    "about",
    "this",
    "that",
    "these",
    "those",
    "i",
    "me",
    "my",
    "myself",
    "we",
    "our",
    "ours",
    "ourselves",
    "you",
    "your",
    "yours",
    "yourself",
    "he",
    "him",
    "his",
    "himself",
    "she",
    "her",
    "hers",
    "herself",
    "it",
    "its",
    "itself",
    "they",
    "them",
    "their",
    "theirs",
    "themselves",
    "what",
    "which",
    "who",
    "whom"
  ]);
  var HIGH_PRIORITY_THRESHOLD = 0.4;
  var SCENE_MATCH_WEIGHT = 0.3;
  var RECENCY_WEIGHT = 0.3;
  var ENTITY_OVERLAP_WEIGHT = 0.3;
  var TEXT_OVERLAP_WEIGHT = 0.2;
  var DEFAULT_WORLD_FACT_RECENCY = 0.1;
  function tokenize(text) {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  }
  function computeScore(item, currentSceneId, messageTokens) {
    const sceneMatch = item.sceneId === currentSceneId ? SCENE_MATCH_WEIGHT : 0;
    const recency = (item.recencyWeight ?? DEFAULT_WORLD_FACT_RECENCY) * RECENCY_WEIGHT;
    let entityOverlap = 0;
    if (item.entityIds && item.entityIds.length > 0) {
      const matched = item.entityIds.filter((id) => messageTokens.has(id.toLowerCase())).length;
      entityOverlap = matched / item.entityIds.length * ENTITY_OVERLAP_WEIGHT;
    }
    const itemTokens = tokenize(item.text);
    const textOverlap = itemTokens.length > 0 ? itemTokens.filter((t2) => messageTokens.has(t2)).length / itemTokens.length * TEXT_OVERLAP_WEIGHT : 0;
    return sceneMatch + recency + entityOverlap + textOverlap;
  }
  function retrieveMemory({ state, messages }) {
    const result = {
      mustInject: [],
      highPriority: [],
      opportunistic: [],
      scores: {}
    };
    for (const fact of state.director.continuityFacts) {
      result.mustInject.push(fact.text);
      result.scores[fact.id] = 1;
    }
    const messageText = messages.map((m) => m.content).join(" ");
    const messageTokens = new Set(tokenize(messageText));
    const currentSceneId = state.director.currentSceneId;
    for (const summary of state.memory.summaries) {
      const score = computeScore(summary, currentSceneId, messageTokens);
      result.scores[summary.id] = score;
      if (score >= HIGH_PRIORITY_THRESHOLD) {
        result.highPriority.push(summary.text);
      } else {
        result.opportunistic.push(summary.text);
      }
    }
    for (const fact of state.memory.worldFacts) {
      const score = computeScore(fact, currentSceneId, messageTokens);
      result.scores[fact.id] = score;
      if (score >= HIGH_PRIORITY_THRESHOLD) {
        result.highPriority.push(fact.text);
      } else {
        result.opportunistic.push(fact.text);
      }
    }
    return result;
  }
  var DEFAULT_FALLBACK_MAX = 5;
  function rankDocsByKeywordOverlap(docs, queryText, maxResults = DEFAULT_FALLBACK_MAX) {
    if (docs.length === 0) return [];
    const queryTokens = new Set(tokenize(queryText));
    if (queryTokens.size === 0) return docs.slice(0, maxResults);
    const scored = docs.map((doc) => {
      const docText = `${doc.title} ${doc.description} ${doc.tags.join(" ")}`;
      const docTokens = tokenize(docText);
      const overlap = docTokens.filter((t2) => queryTokens.has(t2)).length;
      const score = docTokens.length > 0 ? overlap / docTokens.length : 0;
      return { doc, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.doc);
  }

  // src/memory/turnCache.ts
  var nextId = 0;
  function generateTurnId() {
    return `turn-${Date.now()}-${++nextId}`;
  }
  var TurnCache = class {
    turns = /* @__PURE__ */ new Map();
    begin(type, messages) {
      const turn = {
        turnId: generateTurnId(),
        type,
        originalMessages: structuredClone(messages),
        finalized: false,
        createdAt: Date.now()
      };
      this.turns.set(turn.turnId, turn);
      return structuredClone(turn);
    }
    get(turnId) {
      const turn = this.turns.get(turnId);
      return turn ? structuredClone(turn) : void 0;
    }
    patch(turnId, updates) {
      const turn = this.turns.get(turnId);
      if (!turn) {
        throw new Error(`TurnCache: unknown turnId "${turnId}"`);
      }
      Object.assign(turn, updates);
      return structuredClone(turn);
    }
    finalize(turnId) {
      const turn = this.turns.get(turnId);
      if (!turn) {
        throw new Error(`TurnCache: unknown turnId "${turnId}"`);
      }
      turn.finalized = true;
    }
    drop(turnId) {
      this.turns.delete(turnId);
    }
  };

  // src/memory/extractMemories.ts
  var MAX_SEEN_HASHES = 200;
  function createExtractionWorker(deps, options) {
    const seenHashes = options.seenHashes ?? /* @__PURE__ */ new Set();
    let pending = null;
    let inFlight = null;
    let drainScheduled = false;
    async function runOne(ctx) {
      const hash = deps.hashRequest(ctx);
      if (seenHashes.has(hash)) {
        return;
      }
      const lastCursor = await deps.getLastProcessedCursor();
      const gap = ctx.turnIndex - lastCursor;
      if (lastCursor > 0 && gap > 0 && gap < options.extractionMinTurnInterval) {
        return;
      }
      try {
        const result = await deps.runExtraction(ctx);
        if (result.applied && result.memoryUpdate) {
          await deps.persistDocuments(result.memoryUpdate, ctx);
        }
        seenHashes.add(hash);
        if (seenHashes.size > MAX_SEEN_HASHES) {
          const first = seenHashes.values().next().value;
          if (first !== void 0) seenHashes.delete(first);
        }
        await deps.setLastProcessedCursor(ctx.turnIndex);
        await deps.setLastExtractionTs(Date.now());
      } catch (err) {
        deps.log(`[extraction-worker] Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    async function drainPending() {
      while (pending !== null) {
        const ctx = pending;
        pending = null;
        await runOne(ctx);
      }
    }
    function scheduleDrain() {
      if (drainScheduled || inFlight !== null) return;
      drainScheduled = true;
      void Promise.resolve().then(async () => {
        drainScheduled = false;
        if (inFlight !== null || pending === null) return;
        inFlight = drainPending();
        try {
          await inFlight;
        } finally {
          inFlight = null;
        }
      });
    }
    async function submit(ctx) {
      pending = ctx;
      scheduleDrain();
    }
    async function flush() {
      if (inFlight !== null) {
        await inFlight;
      }
      if (pending !== null) {
        inFlight = drainPending();
        try {
          await inFlight;
        } finally {
          inFlight = null;
        }
      }
    }
    return { submit, flush };
  }

  // src/memory/memdirStore.ts
  var NS_INDEX = "director-memdir:index";
  var NS_DOC = "director-memdir:doc";
  var NS_MEMORY_MD = "director-memdir:memory-md";
  function indexKey(scopeKey) {
    return `${NS_INDEX}:${scopeKey}`;
  }
  function docKey(scopeKey, docId) {
    return `${NS_DOC}:${scopeKey}:${docId}`;
  }
  function memoryMdKey(scopeKey) {
    return `${NS_MEMORY_MD}:${scopeKey}`;
  }
  var MemdirStore = class {
    storage;
    _scopeKey;
    indexCache = null;
    constructor(storage, scopeKey) {
      this.storage = storage;
      this._scopeKey = scopeKey;
    }
    get scopeKey() {
      return this._scopeKey;
    }
    async loadIndex() {
      const raw = await this.storage.getItem(
        indexKey(this.scopeKey)
      );
      if (raw != null && typeof raw === "object" && Array.isArray(raw.docIds)) {
        this.indexCache = raw;
        return structuredClone(raw);
      }
      const now = Date.now();
      const fresh = {
        scopeKey: this.scopeKey,
        docIds: [],
        createdAt: now,
        updatedAt: now
      };
      this.indexCache = fresh;
      await this.storage.setItem(indexKey(this.scopeKey), structuredClone(fresh));
      return structuredClone(fresh);
    }
    async ensureIndex() {
      if (this.indexCache != null) return this.indexCache;
      return this.loadIndex();
    }
    async persistIndex(index) {
      index.updatedAt = Date.now();
      this.indexCache = index;
      await this.storage.setItem(
        indexKey(this.scopeKey),
        structuredClone(index)
      );
    }
    async putDocument(doc) {
      await this.storage.setItem(
        docKey(this.scopeKey, doc.id),
        structuredClone(doc)
      );
      const index = await this.ensureIndex();
      if (!index.docIds.includes(doc.id)) {
        index.docIds.push(doc.id);
        await this.persistIndex(index);
      }
    }
    async getDocument(docId) {
      const raw = await this.storage.getItem(
        docKey(this.scopeKey, docId)
      );
      return raw ?? null;
    }
    async removeDocument(docId) {
      await this.storage.removeItem(docKey(this.scopeKey, docId));
      const index = await this.ensureIndex();
      index.docIds = index.docIds.filter((id) => id !== docId);
      await this.persistIndex(index);
    }
    async listDocuments(options) {
      const index = await this.ensureIndex();
      const docs = [];
      for (const id of index.docIds) {
        const doc = await this.getDocument(id);
        if (doc == null) continue;
        if (options?.type != null && doc.type !== options.type) continue;
        docs.push(doc);
      }
      docs.sort((a, b) => b.updatedAt - a.updatedAt);
      return docs;
    }
    async putMemoryMd(content) {
      await this.storage.setItem(memoryMdKey(this.scopeKey), content);
    }
    async getMemoryMd() {
      const raw = await this.storage.getItem(
        memoryMdKey(this.scopeKey)
      );
      return raw ?? null;
    }
  };

  // src/memory/findRelevantMemories.ts
  var DEFAULT_MAX_RESULTS = 5;
  var STALE_FRESHNESS = /* @__PURE__ */ new Set([
    "stale",
    "archived"
  ]);
  function formatManifest(docs) {
    if (docs.length === 0) return "(no memory documents)";
    return docs.map((doc) => {
      const tags = doc.tags.length > 0 ? doc.tags.join(", ") : "none";
      const fresh = doc.freshness !== "current" ? ` [${doc.freshness}]` : "";
      return `ID: ${doc.id} | Type: ${doc.type} | Title: ${doc.title}${fresh} | Tags: ${tags}`;
    }).join("\n");
  }
  var RecallCache = class {
    cooldownMs;
    entry = null;
    constructor(cooldownMs) {
      this.cooldownMs = cooldownMs;
    }
    get(nowMs) {
      if (!this.entry) return null;
      const now = nowMs ?? Date.now();
      if (now - this.entry.timestamp > this.cooldownMs) return null;
      return this.entry.result;
    }
    set(result, nowMs) {
      this.entry = { result, timestamp: nowMs ?? Date.now() };
    }
  };
  function buildFreshnessWarnings(docs) {
    const warnings = [];
    for (const doc of docs) {
      if (STALE_FRESHNESS.has(doc.freshness)) {
        warnings.push(
          `Memory "${doc.title}" may be outdated (marked as ${doc.freshness})`
        );
      }
    }
    return warnings;
  }
  function parseRecallResponse(text) {
    try {
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return null;
      const ids = parsed.filter(
        (item) => typeof item === "string"
      );
      if (ids.length === 0 && parsed.length > 0) return null;
      return ids;
    } catch {
      return null;
    }
  }
  function buildFallbackResult(docs, recentText, memoryMdContent, maxResults) {
    const selected = rankDocsByKeywordOverlap(docs, recentText, maxResults);
    const warnings = buildFreshnessWarnings(selected);
    return {
      selectedDocs: selected,
      warnings,
      source: "fallback",
      memoryMdBlock: memoryMdContent
    };
  }
  async function findRelevantMemories(deps, input, cache) {
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
    if (cache) {
      const cached = cache.get(input.nowMs);
      if (cached) {
        return { ...cached, source: "cache" };
      }
    }
    if (input.docs.length === 0) {
      const result = {
        selectedDocs: [],
        warnings: [],
        source: "recall",
        memoryMdBlock: input.memoryMdContent
      };
      if (cache) cache.set(result, input.nowMs);
      return result;
    }
    const manifest = formatManifest(input.docs);
    try {
      const response = await deps.runRecallModel(manifest, input.recentText);
      if (!response.ok) {
        deps.log(`Recall model failed: ${response.text}`);
        const fallback = buildFallbackResult(
          input.docs,
          input.recentText,
          input.memoryMdContent,
          maxResults
        );
        if (cache) cache.set(fallback, input.nowMs);
        return fallback;
      }
      const selectedIds = parseRecallResponse(response.text);
      if (!selectedIds) {
        deps.log(`Recall model returned malformed response: ${response.text}`);
        const fallback = buildFallbackResult(
          input.docs,
          input.recentText,
          input.memoryMdContent,
          maxResults
        );
        if (cache) cache.set(fallback, input.nowMs);
        return fallback;
      }
      const idSet = new Set(selectedIds.slice(0, maxResults));
      const selectedDocs = input.docs.filter((d) => idSet.has(d.id));
      const warnings = buildFreshnessWarnings(selectedDocs);
      const result = {
        selectedDocs,
        warnings,
        source: "recall",
        memoryMdBlock: input.memoryMdContent
      };
      if (cache) cache.set(result, input.nowMs);
      return result;
    } catch (err) {
      deps.log(`Recall model threw: ${err}`);
      const fallback = buildFallbackResult(
        input.docs,
        input.recentText,
        input.memoryMdContent,
        maxResults
      );
      if (cache) cache.set(fallback, input.nowMs);
      return fallback;
    }
  }
  function formatRecalledDocsBlock(result) {
    const lines = [result.memoryMdBlock];
    if (result.selectedDocs.length > 0) {
      lines.push("");
      lines.push("## Recalled Memory Documents");
      for (const doc of result.selectedDocs) {
        lines.push(`- **${doc.title}** (${doc.type}): ${doc.description}`);
      }
    }
    if (result.warnings.length > 0) {
      lines.push("");
      for (const warning of result.warnings) {
        lines.push(`\u26A0\uFE0F ${warning}`);
      }
    }
    return lines.join("\n");
  }

  // src/runtime/network.ts
  var FNV_OFFSET = 2166136261;
  var FNV_PRIME = 16777619;
  function fnv1aHash(input) {
    let hash = FNV_OFFSET;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function hashExtractionContext(ctx) {
    const contentPrefix = ctx.content.slice(0, 200);
    const raw = `${ctx.turnId}|${ctx.type}|${ctx.messages.length}|${contentPrefix}`;
    return fnv1aHash(raw);
  }
  var RECALL_SYSTEM_PROMPT = [
    "You are a memory retrieval assistant for collaborative fiction.",
    "Given a manifest of memory documents (headers only) and recent conversation context,",
    "select the IDs of the most relevant documents.",
    "",
    "Rules:",
    '- Return ONLY a JSON array of document ID strings, e.g.: ["doc-1", "doc-3"]',
    "- Select only documents directly relevant to the current conversation",
    "- Prefer documents about active characters, ongoing plot points, or referenced world elements",
    "- If nothing is relevant, return an empty array: []"
  ].join("\n");
  async function makeRecallRequest(api, manifest, recentText, options) {
    const messages = [
      { role: "system", content: RECALL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `## Memory Manifest
${manifest}

## Recent Conversation
${recentText}`
      }
    ];
    const result = await api.runLLMModel({
      messages,
      ...options?.model ? { staticModel: options.model } : {},
      mode: options?.mode ?? "otherAx"
    });
    if (result.type === "fail") {
      return { ok: false, text: result.result };
    }
    return { ok: true, text: result.result };
  }

  // src/memory/sessionMemory.ts
  var NOTEBOOK_SECTIONS = [
    "currentState",
    "immediateGoals",
    "recentDevelopments",
    "unresolvedThreads",
    "recentMistakes"
  ];
  var SECTION_LABELS = {
    currentState: "Current State",
    immediateGoals: "Immediate Goals",
    recentDevelopments: "Important Recent Developments",
    unresolvedThreads: "Unresolved Threads",
    recentMistakes: "Recent Mistakes / Constraints"
  };
  var DEFAULT_NOTEBOOK_THRESHOLDS = {
    turnThreshold: 3,
    tokenThreshold: 500
  };
  var SessionNotebook = class {
    scopeKey;
    opts;
    sections;
    _turnsSinceUpdate = 0;
    _tokensSinceUpdate = 0;
    constructor(scopeKey, opts) {
      this.scopeKey = scopeKey;
      this.opts = { ...DEFAULT_NOTEBOOK_THRESHOLDS, ...opts };
      this.sections = Object.fromEntries(
        NOTEBOOK_SECTIONS.map((s) => [s, ""])
      );
    }
    // ── Accessors ───────────────────────────────────────────────────────
    get turnsSinceUpdate() {
      return this._turnsSinceUpdate;
    }
    get tokensSinceUpdate() {
      return this._tokensSinceUpdate;
    }
    /** Return a frozen copy of the current section contents. */
    snapshot() {
      return Object.freeze({ ...this.sections });
    }
    // ── Turn tracking ───────────────────────────────────────────────────
    /** Record a finalized turn with an estimated token count. */
    recordTurn(estimatedTokens) {
      this._turnsSinceUpdate += 1;
      this._tokensSinceUpdate += estimatedTokens;
    }
    // ── Threshold-gated update ──────────────────────────────────────────
    /**
     * Attempt to update notebook sections.  The update is accepted only when
     * at least one threshold (turns or tokens) has been met since the last
     * successful update.
     *
     * Only the keys present in `patch` are overwritten; unmentioned sections
     * retain their previous values (merge semantics).
     *
     * @returns `true` if the update was accepted.
     */
    tryUpdate(patch) {
      if (!this.meetsThreshold()) return false;
      this.applyPatch(patch);
      this.resetCounters();
      return true;
    }
    /** Write sections unconditionally, bypassing all thresholds. */
    forceUpdate(patch) {
      this.applyPatch(patch);
      this.resetCounters();
    }
    // ── Internal ────────────────────────────────────────────────────────
    meetsThreshold() {
      return this._turnsSinceUpdate >= this.opts.turnThreshold || this._tokensSinceUpdate >= this.opts.tokenThreshold;
    }
    applyPatch(patch) {
      for (const key of NOTEBOOK_SECTIONS) {
        if (patch[key] !== void 0) {
          this.sections[key] = patch[key];
        }
      }
    }
    resetCounters() {
      this._turnsSinceUpdate = 0;
      this._tokensSinceUpdate = 0;
    }
  };
  function formatNotebookBlock(snap) {
    const lines = [];
    for (const section of NOTEBOOK_SECTIONS) {
      const value = snap[section];
      if (value) {
        lines.push(`### ${SECTION_LABELS[section]}`);
        lines.push(value);
        lines.push("");
      }
    }
    if (lines.length === 0) return "";
    return `## Session Notebook
${lines.join("\n").trimEnd()}`;
  }

  // src/runtime/backgroundHousekeeping.ts
  function createBackgroundHousekeeping(deps, dreamDeps) {
    let pendingCtx = null;
    let scheduled = false;
    async function drainPending() {
      scheduled = false;
      if (pendingCtx === null) return;
      const ctx = pendingCtx;
      pendingCtx = null;
      try {
        await deps.submitExtraction(ctx);
      } catch (err) {
        deps.log(
          `[housekeeping] Extraction submission failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    async function tryDream() {
      if (!dreamDeps) return null;
      const gate = await dreamDeps.buildCadenceGate();
      if (!dreamDeps.dreamWorker.shouldRun(gate)) return null;
      const result = await dreamDeps.consolidationLock.withLock(async () => {
        return dreamDeps.dreamWorker.run();
      });
      if (result != null) {
        await dreamDeps.onDreamComplete(result);
        dreamDeps.log(
          `[housekeeping] Dream pass complete: merged=${result.merged} pruned=${result.pruned} updated=${result.updated}`
        );
      }
      return result;
    }
    async function afterTurn(ctx) {
      pendingCtx = ctx;
      if (!scheduled) {
        scheduled = true;
        await Promise.resolve();
        await drainPending();
      }
      try {
        await tryDream();
      } catch (err) {
        deps.log(
          `[housekeeping] Dream attempt failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    async function shutdown() {
      await drainPending();
      await deps.flushExtraction();
    }
    return { afterTurn, shutdown, tryDream };
  }

  // src/memory/autoDream.ts
  var MIN_DOCS_FOR_CONSOLIDATION = 2;
  var CONSOLIDATION_ELIGIBLE_SOURCES = /* @__PURE__ */ new Set([
    "extraction"
  ]);
  var USER_LOCKED_SOURCES = /* @__PURE__ */ new Set([
    "operator",
    "manual"
  ]);
  function createAutoDreamWorker(deps) {
    function shouldRun(gate) {
      if (!gate.enabled) return false;
      if (gate.dreamMinHoursElapsed > 0) {
        const elapsedMs = Date.now() - gate.lastDreamTs;
        const requiredMs = gate.dreamMinHoursElapsed * 36e5;
        if (elapsedMs < requiredMs) return false;
      }
      if (gate.turnsSinceLastDream < gate.dreamMinTurnsElapsed) return false;
      if (gate.sessionsSinceLastDream < gate.dreamMinSessionsElapsed) return false;
      if (gate.userInteractionGuardMs > 0) {
        const sinceInteraction = Date.now() - gate.lastUserInteractionTs;
        if (sinceInteraction < gate.userInteractionGuardMs) return false;
      }
      return true;
    }
    async function run() {
      const result = { merged: 0, pruned: 0, updated: 0, skipped: false };
      deps.log("[dream] orient: loading manifest");
      const allDocs = await deps.memdirStore.listDocuments();
      const eligibleDocs = allDocs.filter(
        (d) => CONSOLIDATION_ELIGIBLE_SOURCES.has(d.source)
      );
      if (eligibleDocs.length < MIN_DOCS_FOR_CONSOLIDATION) {
        deps.log("[dream] orient: not enough eligible docs, skipping");
        result.skipped = true;
        return result;
      }
      const docMap = /* @__PURE__ */ new Map();
      for (const doc of allDocs) {
        docMap.set(doc.id, doc);
      }
      deps.log("[dream] gather: building consolidation prompt");
      const prompt = buildConsolidationPrompt(eligibleDocs);
      deps.log("[dream] consolidate: calling model");
      const rawResponse = await deps.runConsolidationModel(prompt);
      let response;
      try {
        response = JSON.parse(rawResponse);
      } catch {
        deps.log("[dream] consolidate: failed to parse model response");
        return result;
      }
      if (!response || typeof response !== "object") {
        deps.log("[dream] consolidate: invalid response structure");
        return result;
      }
      const merges = Array.isArray(response.merges) ? response.merges : [];
      const prunes = Array.isArray(response.prunes) ? response.prunes : [];
      const updates = Array.isArray(response.updates) ? response.updates : [];
      const consumedIds = /* @__PURE__ */ new Set();
      for (const merge of merges) {
        if (!Array.isArray(merge.sourceIds) || merge.sourceIds.length === 0) continue;
        if (!merge.mergedDoc || typeof merge.mergedDoc.title !== "string") continue;
        const hasUserLocked = merge.sourceIds.some((id) => {
          const doc = docMap.get(id);
          return doc != null && USER_LOCKED_SOURCES.has(doc.source);
        });
        if (hasUserLocked) {
          deps.log(`[dream] consolidate: refusing to merge user-locked docs`);
          continue;
        }
        const now = Date.now();
        const mergedDoc = {
          id: `dream-merged-${now}-${Math.random().toString(36).slice(2, 8)}`,
          type: isValidDocType(merge.mergedDoc.type) ? merge.mergedDoc.type : "continuity",
          title: merge.mergedDoc.title,
          description: merge.mergedDoc.description ?? "",
          scopeKey: deps.memdirStore.scopeKey,
          updatedAt: now,
          source: "extraction",
          // dream-managed docs inherit extraction source
          freshness: "current",
          tags: Array.isArray(merge.mergedDoc.tags) ? merge.mergedDoc.tags : []
        };
        await deps.memdirStore.putDocument(mergedDoc);
        for (const sourceId of merge.sourceIds) {
          await deps.memdirStore.removeDocument(sourceId);
          consumedIds.add(sourceId);
        }
        result.merged += merge.sourceIds.length;
      }
      deps.log("[dream] prune: processing prune list");
      for (const pruneId of prunes) {
        if (typeof pruneId !== "string") continue;
        const doc = docMap.get(pruneId);
        if (doc != null && USER_LOCKED_SOURCES.has(doc.source)) {
          deps.log(`[dream] prune: refusing to prune user-locked doc ${pruneId}`);
          continue;
        }
        await deps.memdirStore.removeDocument(pruneId);
        consumedIds.add(pruneId);
        result.pruned += 1;
      }
      for (const update of updates) {
        if (typeof update.id !== "string") continue;
        if (consumedIds.has(update.id)) {
          deps.log(`[dream] update: skipping consumed doc ${update.id}`);
          continue;
        }
        const doc = docMap.get(update.id);
        if (doc == null) continue;
        const patched = { ...doc };
        if (typeof update.description === "string") {
          patched.description = update.description;
        }
        if (typeof update.freshness === "string" && isValidFreshness(update.freshness)) {
          patched.freshness = update.freshness;
        }
        if (Array.isArray(update.tags)) {
          patched.tags = update.tags.filter((t2) => typeof t2 === "string");
        }
        patched.updatedAt = Date.now();
        await deps.memdirStore.putDocument(patched);
        result.updated += 1;
      }
      return result;
    }
    return { shouldRun, run };
  }
  function buildConsolidationPrompt(docs) {
    const lines = [
      "You are a memory consolidation assistant for a roleplay AI.",
      "Below is a list of memory documents. Identify duplicates to merge,",
      "stale or redundant entries to prune, and descriptions to update.",
      "",
      "Respond with a JSON object: { merges: [...], prunes: [...], updates: [...] }",
      "",
      "merges: [{ sourceIds: string[], mergedDoc: { type, title, description, tags } }]",
      "prunes: string[] (doc IDs to remove)",
      "updates: [{ id, description?, freshness?, tags? }]",
      "",
      "Documents:"
    ];
    for (const doc of docs) {
      lines.push(
        `- id: ${doc.id} | type: ${doc.type} | title: ${doc.title} | freshness: ${doc.freshness}`,
        `  description: ${doc.description}`,
        `  tags: ${doc.tags.join(", ") || "(none)"}`
      );
    }
    return lines.join("\n");
  }
  var VALID_DOC_TYPES = /* @__PURE__ */ new Set([
    "character",
    "relationship",
    "world",
    "plot",
    "continuity",
    "operator"
  ]);
  function isValidDocType(type) {
    return VALID_DOC_TYPES.has(type);
  }
  var VALID_FRESHNESS = /* @__PURE__ */ new Set(["current", "stale", "archived"]);
  function isValidFreshness(value) {
    return VALID_FRESHNESS.has(value);
  }

  // src/memory/consolidationLock.ts
  var STALE_THRESHOLD_MS = 5 * 60 * 1e3;
  var LOCK_KEY_PREFIX = "director-memdir:consolidate-lock";
  var ConsolidationLock = class {
    storage;
    key;
    workerId;
    constructor(storage, scopeKey, workerId) {
      this.storage = storage;
      this.key = `${LOCK_KEY_PREFIX}:${scopeKey}`;
      this.workerId = workerId;
    }
    // ── Acquire ───────────────────────────────────────────────────────
    /**
     * Try to acquire the consolidation lock.
     *
     * Returns `true` if this worker now holds the lock, `false` otherwise.
     * Performs read-after-write verification before returning `true`.
     */
    async tryAcquire() {
      const existing = await this.storage.getItem(this.key);
      if (existing != null) {
        if (existing.workerId === this.workerId) {
          return true;
        }
        const now2 = Date.now();
        const isStale = now2 - existing.lastTouchedAt > STALE_THRESHOLD_MS;
        if (!isStale) {
          return false;
        }
      }
      const now = Date.now();
      const lease = {
        workerId: this.workerId,
        acquiredAt: now,
        expiresAt: now + STALE_THRESHOLD_MS,
        lastTouchedAt: now
      };
      await this.storage.setItem(this.key, lease);
      const readBack = await this.storage.getItem(this.key);
      if (readBack == null || readBack.workerId !== this.workerId) {
        return false;
      }
      return true;
    }
    // ── Release ───────────────────────────────────────────────────────
    /**
     * Release the lock. Safe to call even if we don't hold it.
     */
    async release() {
      const existing = await this.storage.getItem(this.key);
      if (existing != null && existing.workerId === this.workerId) {
        await this.storage.removeItem(this.key);
      }
    }
    // ── Touch / heartbeat ─────────────────────────────────────────────
    /**
     * Update the lease timestamp to prevent stale-lock recovery.
     * Only touches if we own the lock.
     */
    async touch() {
      const existing = await this.storage.getItem(this.key);
      if (existing == null || existing.workerId !== this.workerId) return;
      const now = Date.now();
      const updated = {
        ...existing,
        lastTouchedAt: now,
        expiresAt: now + STALE_THRESHOLD_MS
      };
      await this.storage.setItem(this.key, updated);
    }
    // ── RAII-style helper ─────────────────────────────────────────────
    /**
     * Acquire, execute `fn`, then release — regardless of success or failure.
     * Returns `null` if acquisition failed (lock is held by another worker).
     */
    async withLock(fn) {
      const acquired = await this.tryAcquire();
      if (!acquired) return null;
      try {
        return await fn();
      } finally {
        await this.release();
      }
    }
  };

  // src/ui/i18n.ts
  var activeLocale = "en";
  function getLocale() {
    return activeLocale;
  }
  function setLocale(locale) {
    activeLocale = locale;
  }
  var EN_CATALOG = {
    // Sidebar
    "sidebar.kicker": "Director Actor",
    "sidebar.title": "Director Dashboard",
    "sidebar.subtitle": "Fullscreen control center for settings, models, prompts, memory, and profiles.",
    // Sidebar group labels
    "sidebar.group.general": "General",
    "sidebar.group.tuning": "Prompt Tuning",
    "sidebar.group.memory": "Memory",
    "sidebar.group.profiles": "Profiles",
    // Tab labels
    "tab.general": "General",
    "tab.promptTuning": "Prompt Tuning",
    "tab.modelSettings": "Model Settings",
    "tab.memoryCache": "Memory & Cache",
    "tab.settingsProfiles": "Settings Profiles",
    // Toolbar
    "toolbar.kicker": "Cupcake-style dashboard",
    "toolbar.tagline": "Modern control surface for Director behavior, models, and memory.",
    // Buttons
    "btn.save": "Save",
    "btn.saveChanges": "Save Changes",
    "btn.discard": "Discard",
    "btn.cancel": "Cancel",
    "btn.close": "Close",
    "btn.closeIcon": "\u2715 Close",
    "btn.reset": "Reset",
    "btn.exportSettings": "Export Settings",
    "btn.testConnection": "Test Connection",
    "btn.refreshModels": "Refresh Models",
    "btn.newProfile": "New Profile",
    "btn.newPromptPreset": "New Prompt Preset",
    "btn.deletePromptPreset": "Delete Preset",
    "btn.backfillCurrentChat": "Extract Current Chat",
    "btn.regenerateCurrentChat": "Regenerate from Current Chat",
    "btn.deleteSelected": "Delete Selected",
    "btn.edit": "Edit",
    "btn.export": "Export",
    "btn.import": "Import",
    // Dirty indicator
    "dirty.unsavedChanges": "Unsaved changes",
    "dirty.unsavedHint": "Unsaved changes stay local until you save.",
    // Card: Plugin Status
    "card.pluginStatus.title": "Plugin Status",
    "card.pluginStatus.copy": "Enable the director, tune tone strictness, and keep a quick view of connection health.",
    "label.enabled": "Enabled",
    "label.assertiveness": "Assertiveness",
    "label.mode": "Mode",
    "label.injectionMode": "Injection Mode",
    "option.light": "Light",
    "option.standard": "Standard",
    "option.firm": "Firm",
    "option.risuAux": "Risu Aux Model",
    "option.independentProvider": "Independent Provider",
    "option.auto": "Auto",
    "option.authorNote": "Author Note",
    "option.adjacentUser": "Adjacent User",
    "option.postConstraint": "Post Constraint",
    "option.bottom": "Bottom",
    // Card: Metrics Snapshot
    "card.metricsSnapshot.title": "Metrics Snapshot",
    "card.metricsSnapshot.copy": "Quick read-only visibility into runtime behavior before you dive deeper.",
    "metric.totalDirectorCalls": "Total Director Calls",
    "metric.totalFailures": "Total Failures",
    "metric.memoryWrites": "Memory Writes",
    "metric.scenePhase": "Scene Phase",
    // Card: Prompt Tuning
    "card.promptTuning.title": "Prompt Tuning",
    "card.promptTuning.copy": "Tune how strongly the Director pushes, how large the brief is, and whether post-review stays active.",
    "card.promptPresets.title": "Prompt Presets",
    "card.promptPresets.copy": "Choose the active preset, clone it into a custom preset, and edit the prompt templates used by the Director.",
    "label.briefTokenCap": "Brief Token Cap",
    "label.postReview": "Enable Post-review",
    "label.embeddings": "Enable Embeddings",
    "label.promptPreset": "Active Prompt Preset",
    "label.promptPresetName": "Preset Name",
    "label.preRequestSystemTemplate": "Pre-request System Template",
    "label.preRequestUserTemplate": "Pre-request User Template",
    "label.postResponseSystemTemplate": "Post-response System Template",
    "label.postResponseUserTemplate": "Post-response User Template",
    "label.maxRecentMessages": "Recent Message Cap",
    // Card: Timing & Limits
    "card.timingLimits.title": "Timing & Limits",
    "card.timingLimits.copy": "Cooldown and debounce controls keep the Director stable under streaming and bad responses.",
    "label.cooldownFailures": "Cooldown Failures",
    "label.cooldownMs": "Cooldown (ms)",
    "label.outputDebounceMs": "Output Debounce (ms)",
    // Card: Director Model Settings
    "card.directorModel.title": "Director Model Settings",
    "card.directorModel.copy": "Keep the Director on its own provider, base URL, key, and model without touching the main RP model.",
    "label.provider": "Provider",
    "label.baseUrl": "Base URL",
    "label.apiKey": "API Key",
    "label.model": "Model",
    "label.customModelId": "Custom Model ID",
    "option.openai": "OpenAI",
    "option.anthropic": "Anthropic",
    "option.google": "Google",
    "option.copilot": "GitHub Copilot",
    "option.vertex": "Google Vertex AI",
    "option.custom": "Custom",
    // Card: Embedding Settings
    "card.embeddingSettings.title": "Embedding Settings",
    "card.embeddingSettings.copy": "Configure the embedding provider used for semantic memory retrieval.",
    "label.embeddingProvider": "Embedding Provider",
    "label.embeddingBaseUrl": "Embedding Base URL",
    "label.embeddingApiKey": "Embedding API Key",
    "label.embeddingModel": "Embedding Model",
    "label.embeddingDimensions": "Embedding Dimensions",
    "option.embedding.voyageai": "Voyage AI",
    "option.embedding.openai": "OpenAI",
    "option.embedding.google": "Google",
    "option.embedding.vertex": "Google Vertex AI",
    "option.embedding.custom": "Custom",
    // Card: Memory & Cache
    "card.memoryCache.title": "Memory & Cache",
    "card.memoryCache.copy": "Inspect the long-memory substrate and keep an eye on the cache/memory write behavior.",
    "card.memoryCache.hint": "Memory summaries, entity graphs, and cache controls will appear here.",
    "card.memorySummaries.title": "Summaries",
    "card.continuityFacts.title": "Continuity Facts",
    "btn.delete": "Delete",
    "btn.add": "Add",
    "memory.addSummaryPlaceholder": "New summary text\u2026",
    "memory.addFactPlaceholder": "New continuity fact\u2026",
    "memory.addWorldFactPlaceholder": "New world fact\u2026",
    "memory.addEntityNamePlaceholder": "New entity name\u2026",
    "memory.addRelationSourcePlaceholder": "Source ID",
    "memory.addRelationLabelPlaceholder": "Label",
    "memory.addRelationTargetPlaceholder": "Target ID",
    "memory.filterPlaceholder": "Filter memory\u2026",
    "memory.emptyHint": "No memory items yet. Summaries and continuity facts will appear here as the story progresses.",
    "card.worldFacts.title": "World Facts",
    "card.entities.title": "Entities",
    "card.relations.title": "Relations",
    // Card: Memory Operations
    "card.memoryOps.title": "Memory Operations",
    "card.memoryOps.copy": "Live status of extraction and consolidation workers, with operator actions.",
    "memoryOps.lastExtract": "Last Extraction",
    "memoryOps.lastDream": "Last Consolidation",
    "memoryOps.freshness": "Notebook Freshness",
    "memoryOps.docCounts": "Document Counts",
    "memoryOps.freshnessUnknown": "Unknown",
    "memoryOps.freshnessCurrent": "Current",
    "memoryOps.freshnessStale": "Stale",
    "memoryOps.neverRun": "Never",
    "memoryOps.locked": "Memory locked \u2014 consolidation in progress",
    "memoryOps.staleExtract": "Memory extraction is more than 24 h old",
    "memoryOps.staleDream": "Last consolidation pass is more than 24 h old",
    "memoryOps.fallbackEnabled": "Fallback retrieval ON",
    "memoryOps.fallbackDisabled": "Fallback retrieval OFF",
    "btn.forceExtract": "Run Extract Now",
    "btn.forceDream": "Run Dream Now",
    "btn.inspectRecalled": "Inspect Recalled",
    "btn.toggleFallback": "Toggle Fallback Retrieval",
    "toast.extractStarted": "Extraction started",
    "toast.dreamStarted": "Consolidation started",
    "toast.extractFailed": "Extraction failed: {{error}}",
    "toast.dreamFailed": "Consolidation failed: {{error}}",
    "toast.fallbackToggled": "Fallback retrieval toggled",
    "toast.noCallback": "Action not available \u2014 runtime callback not configured",
    // Card: Settings Profiles
    "card.settingsProfiles.title": "Settings Profiles",
    "card.settingsProfiles.copy": "Save reusable presets, swap them in one click, and move them between saves with JSON import/export.",
    // Connection status
    "connection.notTested": "Not tested",
    "connection.testing": "Testing\u2026",
    "connection.connected": "Connected ({{count}} models)",
    // Toast messages
    "toast.settingsSaved": "Settings saved",
    "toast.changesDiscarded": "Changes discarded",
    "toast.profileCreated": "Profile created",
    "toast.profileExported": "Profile exported",
    "toast.profileImported": "Profile imported",
    "toast.noProfileSelected": "No profile selected",
    "toast.invalidProfileFormat": "Invalid profile format",
    "toast.failedParseProfile": "Failed to parse profile JSON",
    "toast.backfillCompleted": "Chat extraction completed ({{count}} updates)",
    "toast.backfillSkipped": "No chat memories were extracted",
    "error.backfillScopeMismatch": "The active chat changed while the dashboard was open. Return to the original chat and try again.",
    // Import alert
    "alert.importInstructions": 'To import a profile, save the JSON to plugin storage key "{{key}}" and click Import again.',
    // Placeholders
    "placeholder.customModelId": "type a model ID directly",
    // Profile names
    "profile.defaultName": "Profile {{n}}",
    "profile.balanced": "Balanced",
    "profile.gentle": "Gentle",
    "profile.strict": "Strict",
    "promptPreset.defaultName": "Default Preset",
    "promptPreset.customName": "Custom Preset {{n}}",
    "promptPreset.readOnlyHint": "Built-in presets are read-only. Clone the current preset to customize it.",
    // Fallback summary (settings.ts non-DOM path)
    "fallback.header": "\u2500\u2500 Director Plugin Settings \u2500\u2500",
    "fallback.enabled": "Enabled",
    "fallback.assertiveness": "Assertiveness",
    "fallback.provider": "Provider",
    "fallback.model": "Model",
    "fallback.injection": "Injection",
    "fallback.postReview": "Post-review",
    "fallback.briefCap": "Brief cap",
    "fallback.briefCapUnit": "tokens",
    // Language selector
    "lang.label": "Language",
    "lang.en": "English",
    "lang.ko": "\uD55C\uAD6D\uC5B4"
  };
  var KO_CATALOG = {
    // Sidebar
    "sidebar.kicker": "Director Actor",
    "sidebar.title": "\uB514\uB809\uD130 \uB300\uC2DC\uBCF4\uB4DC",
    "sidebar.subtitle": "\uC124\uC815, \uBAA8\uB378, \uD504\uB86C\uD504\uD2B8, \uBA54\uBAA8\uB9AC, \uD504\uB85C\uD544\uC744 \uC704\uD55C \uC804\uCCB4\uD654\uBA74 \uCEE8\uD2B8\uB864 \uC13C\uD130.",
    // Sidebar group labels
    "sidebar.group.general": "\uC77C\uBC18",
    "sidebar.group.tuning": "\uD504\uB86C\uD504\uD2B8 \uD29C\uB2DD",
    "sidebar.group.memory": "\uBA54\uBAA8\uB9AC",
    "sidebar.group.profiles": "\uD504\uB85C\uD544",
    // Tab labels
    "tab.general": "\uC77C\uBC18",
    "tab.promptTuning": "\uD504\uB86C\uD504\uD2B8 \uD29C\uB2DD",
    "tab.modelSettings": "\uBAA8\uB378 \uC124\uC815",
    "tab.memoryCache": "\uBA54\uBAA8\uB9AC & \uCE90\uC2DC",
    "tab.settingsProfiles": "\uC124\uC815 \uD504\uB85C\uD544",
    // Toolbar
    "toolbar.kicker": "\uCEF5\uCF00\uC774\uD06C \uC2A4\uD0C0\uC77C \uB300\uC2DC\uBCF4\uB4DC",
    "toolbar.tagline": "\uB514\uB809\uD130 \uD589\uB3D9, \uBAA8\uB378, \uBA54\uBAA8\uB9AC\uB97C \uC704\uD55C \uBAA8\uB358 \uCEE8\uD2B8\uB864 \uC11C\uD53C\uC2A4.",
    // Buttons
    "btn.save": "\uC800\uC7A5",
    "btn.saveChanges": "\uBCC0\uACBD\uC0AC\uD56D \uC800\uC7A5",
    "btn.discard": "\uB418\uB3CC\uB9AC\uAE30",
    "btn.cancel": "\uCDE8\uC18C",
    "btn.close": "\uB2EB\uAE30",
    "btn.closeIcon": "\u2715 \uB2EB\uAE30",
    "btn.reset": "\uCD08\uAE30\uD654",
    "btn.exportSettings": "\uC124\uC815 \uB0B4\uBCF4\uB0B4\uAE30",
    "btn.testConnection": "\uC5F0\uACB0 \uD14C\uC2A4\uD2B8",
    "btn.refreshModels": "\uBAA8\uB378 \uC0C8\uB85C\uACE0\uCE68",
    "btn.newProfile": "\uC0C8 \uD504\uB85C\uD544",
    "btn.newPromptPreset": "\uC0C8 \uD504\uB86C\uD504\uD2B8 \uD504\uB9AC\uC14B",
    "btn.deletePromptPreset": "\uD504\uB9AC\uC14B \uC0AD\uC81C",
    "btn.backfillCurrentChat": "\uD604\uC7AC \uCC44\uD305 \uCD94\uCD9C",
    "btn.regenerateCurrentChat": "\uD604\uC7AC \uCC44\uD305 \uAE30\uC900 \uC7AC\uC0DD\uC131",
    "btn.deleteSelected": "\uC120\uD0DD \uC0AD\uC81C",
    "btn.edit": "\uD3B8\uC9D1",
    "btn.export": "\uB0B4\uBCF4\uB0B4\uAE30",
    "btn.import": "\uAC00\uC838\uC624\uAE30",
    // Dirty indicator
    "dirty.unsavedChanges": "\uC800\uC7A5\uB418\uC9C0 \uC54A\uC740 \uBCC0\uACBD\uC0AC\uD56D",
    "dirty.unsavedHint": "\uC800\uC7A5\uD558\uAE30 \uC804\uAE4C\uC9C0 \uBCC0\uACBD\uC0AC\uD56D\uC740 \uB85C\uCEEC\uC5D0 \uC720\uC9C0\uB429\uB2C8\uB2E4.",
    // Card: Plugin Status
    "card.pluginStatus.title": "\uD50C\uB7EC\uADF8\uC778 \uC0C1\uD0DC",
    "card.pluginStatus.copy": "\uB514\uB809\uD130\uB97C \uD65C\uC131\uD654\uD558\uACE0, \uD1A4 \uC5C4\uACA9\uB3C4\uB97C \uC870\uC808\uD558\uBA70, \uC5F0\uACB0 \uC0C1\uD0DC\uB97C \uBE60\uB974\uAC8C \uD655\uC778\uD558\uC138\uC694.",
    "label.enabled": "\uD65C\uC131\uD654",
    "label.assertiveness": "\uC801\uADF9\uC131",
    "label.mode": "\uBAA8\uB4DC",
    "label.injectionMode": "\uC8FC\uC785 \uBAA8\uB4DC",
    "option.light": "\uAC00\uBCBC\uC6C0",
    "option.standard": "\uD45C\uC900",
    "option.firm": "\uC5C4\uACA9",
    "option.risuAux": "Risu \uBCF4\uC870 \uBAA8\uB378",
    "option.independentProvider": "\uB3C5\uB9BD \uD504\uB85C\uBC14\uC774\uB354",
    "option.auto": "\uC790\uB3D9",
    "option.authorNote": "\uC791\uC131\uC790 \uB178\uD2B8",
    "option.adjacentUser": "\uC778\uC811 \uC0AC\uC6A9\uC790",
    "option.postConstraint": "\uD6C4\uC18D \uC81C\uC57D",
    "option.bottom": "\uD558\uB2E8",
    // Card: Metrics Snapshot
    "card.metricsSnapshot.title": "\uBA54\uD2B8\uB9AD \uC2A4\uB0C5\uC0F7",
    "card.metricsSnapshot.copy": "\uB354 \uAE4A\uC774 \uB4E4\uC5B4\uAC00\uAE30 \uC804\uC5D0 \uB7F0\uD0C0\uC784 \uB3D9\uC791\uC744 \uBE60\uB974\uAC8C \uC77D\uAE30 \uC804\uC6A9\uC73C\uB85C \uD655\uC778\uD558\uC138\uC694.",
    "metric.totalDirectorCalls": "\uCD1D \uB514\uB809\uD130 \uD638\uCD9C \uC218",
    "metric.totalFailures": "\uCD1D \uC2E4\uD328 \uC218",
    "metric.memoryWrites": "\uBA54\uBAA8\uB9AC \uC4F0\uAE30 \uC218",
    "metric.scenePhase": "\uC7A5\uBA74 \uB2E8\uACC4",
    // Card: Prompt Tuning
    "card.promptTuning.title": "\uD504\uB86C\uD504\uD2B8 \uD29C\uB2DD",
    "card.promptTuning.copy": "\uB514\uB809\uD130\uAC00 \uC5BC\uB9C8\uB098 \uAC15\uD558\uAC8C \uC720\uB3C4\uD560\uC9C0, \uBE0C\uB9AC\uD504 \uD06C\uAE30, \uC0AC\uD6C4 \uB9AC\uBDF0 \uD65C\uC131\uD654 \uC5EC\uBD80\uB97C \uC870\uC808\uD558\uC138\uC694.",
    "card.promptPresets.title": "\uD504\uB86C\uD504\uD2B8 \uD504\uB9AC\uC14B",
    "card.promptPresets.copy": "\uD65C\uC131 \uD504\uB9AC\uC14B\uC744 \uC120\uD0DD\uD558\uACE0, \uD604\uC7AC \uD504\uB9AC\uC14B\uC744 \uBCF5\uC81C\uD574 \uCEE4\uC2A4\uD140 \uD504\uB9AC\uC14B\uC744 \uB9CC\uB4E0 \uB4A4 \uB514\uB809\uD130 \uD504\uB86C\uD504\uD2B8 \uD15C\uD50C\uB9BF\uC744 \uD3B8\uC9D1\uD558\uC138\uC694.",
    "label.briefTokenCap": "\uBE0C\uB9AC\uD504 \uD1A0\uD070 \uC0C1\uD55C",
    "label.postReview": "\uC0AC\uD6C4 \uB9AC\uBDF0 \uD65C\uC131\uD654",
    "label.embeddings": "\uC784\uBCA0\uB529 \uD65C\uC131\uD654",
    "label.promptPreset": "\uD65C\uC131 \uD504\uB86C\uD504\uD2B8 \uD504\uB9AC\uC14B",
    "label.promptPresetName": "\uD504\uB9AC\uC14B \uC774\uB984",
    "label.preRequestSystemTemplate": "\uC0AC\uC804 \uC694\uCCAD \uC2DC\uC2A4\uD15C \uD15C\uD50C\uB9BF",
    "label.preRequestUserTemplate": "\uC0AC\uC804 \uC694\uCCAD \uC0AC\uC6A9\uC790 \uD15C\uD50C\uB9BF",
    "label.postResponseSystemTemplate": "\uC0AC\uD6C4 \uC751\uB2F5 \uC2DC\uC2A4\uD15C \uD15C\uD50C\uB9BF",
    "label.postResponseUserTemplate": "\uC0AC\uD6C4 \uC751\uB2F5 \uC0AC\uC6A9\uC790 \uD15C\uD50C\uB9BF",
    "label.maxRecentMessages": "\uCD5C\uADFC \uBA54\uC2DC\uC9C0 \uC0C1\uD55C",
    // Card: Timing & Limits
    "card.timingLimits.title": "\uD0C0\uC774\uBC0D & \uC81C\uD55C",
    "card.timingLimits.copy": "\uCFE8\uB2E4\uC6B4\uACFC \uB514\uBC14\uC6B4\uC2A4 \uC81C\uC5B4\uB85C \uC2A4\uD2B8\uB9AC\uBC0D \uBC0F \uC798\uBABB\uB41C \uC751\uB2F5\uC5D0\uC11C \uB514\uB809\uD130\uB97C \uC548\uC815\uC801\uC73C\uB85C \uC720\uC9C0\uD569\uB2C8\uB2E4.",
    "label.cooldownFailures": "\uCFE8\uB2E4\uC6B4 \uC2E4\uD328 \uD69F\uC218",
    "label.cooldownMs": "\uCFE8\uB2E4\uC6B4 (ms)",
    "label.outputDebounceMs": "\uCD9C\uB825 \uB514\uBC14\uC6B4\uC2A4 (ms)",
    // Card: Director Model Settings
    "card.directorModel.title": "\uB514\uB809\uD130 \uBAA8\uB378 \uC124\uC815",
    "card.directorModel.copy": "\uBA54\uC778 RP \uBAA8\uB378\uC744 \uAC74\uB4DC\uB9AC\uC9C0 \uC54A\uACE0 \uB514\uB809\uD130 \uC804\uC6A9 \uD504\uB85C\uBC14\uC774\uB354, Base URL, \uD0A4, \uBAA8\uB378\uC744 \uC720\uC9C0\uD558\uC138\uC694.",
    "label.provider": "\uD504\uB85C\uBC14\uC774\uB354",
    "label.baseUrl": "Base URL",
    "label.apiKey": "API \uD0A4",
    "label.model": "\uBAA8\uB378",
    "label.customModelId": "\uCEE4\uC2A4\uD140 \uBAA8\uB378 ID",
    "option.openai": "OpenAI",
    "option.anthropic": "Anthropic",
    "option.google": "Google",
    "option.copilot": "GitHub Copilot",
    "option.vertex": "Google Vertex AI",
    "option.custom": "\uCEE4\uC2A4\uD140",
    // Card: Embedding Settings
    "card.embeddingSettings.title": "\uC784\uBCA0\uB529 \uC124\uC815",
    "card.embeddingSettings.copy": "\uC2DC\uB9E8\uD2F1 \uBA54\uBAA8\uB9AC \uAC80\uC0C9\uC5D0 \uC0AC\uC6A9\uD560 \uC784\uBCA0\uB529 \uD504\uB85C\uBC14\uC774\uB354\uB97C \uC124\uC815\uD558\uC138\uC694.",
    "label.embeddingProvider": "\uC784\uBCA0\uB529 \uD504\uB85C\uBC14\uC774\uB354",
    "label.embeddingBaseUrl": "\uC784\uBCA0\uB529 Base URL",
    "label.embeddingApiKey": "\uC784\uBCA0\uB529 API \uD0A4",
    "label.embeddingModel": "\uC784\uBCA0\uB529 \uBAA8\uB378",
    "label.embeddingDimensions": "\uC784\uBCA0\uB529 \uCC28\uC6D0",
    "option.embedding.voyageai": "Voyage AI",
    "option.embedding.openai": "OpenAI",
    "option.embedding.google": "Google",
    "option.embedding.vertex": "Google Vertex AI",
    "option.embedding.custom": "\uCEE4\uC2A4\uD140",
    // Card: Memory & Cache
    "card.memoryCache.title": "\uBA54\uBAA8\uB9AC & \uCE90\uC2DC",
    "card.memoryCache.copy": "\uC7A5\uAE30 \uBA54\uBAA8\uB9AC \uAE30\uBC18\uACFC \uCE90\uC2DC/\uBA54\uBAA8\uB9AC \uC4F0\uAE30 \uB3D9\uC791\uC744 \uC810\uAC80\uD558\uC138\uC694.",
    "card.memoryCache.hint": "\uBA54\uBAA8\uB9AC \uC694\uC57D, \uC5D4\uD2F0\uD2F0 \uADF8\uB798\uD504, \uCE90\uC2DC \uC81C\uC5B4\uAC00 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    "card.memorySummaries.title": "\uC694\uC57D",
    "card.continuityFacts.title": "\uC5F0\uC18D\uC131 \uC0AC\uC2E4",
    "btn.delete": "\uC0AD\uC81C",
    "btn.add": "\uCD94\uAC00",
    "memory.addSummaryPlaceholder": "\uC0C8 \uC694\uC57D \uD14D\uC2A4\uD2B8\u2026",
    "memory.addFactPlaceholder": "\uC0C8 \uC5F0\uC18D\uC131 \uC0AC\uC2E4\u2026",
    "memory.addWorldFactPlaceholder": "\uC0C8 \uC138\uACC4 \uC0AC\uC2E4\u2026",
    "memory.addEntityNamePlaceholder": "\uC0C8 \uC5D4\uD2F0\uD2F0 \uC774\uB984\u2026",
    "memory.addRelationSourcePlaceholder": "\uC18C\uC2A4 ID",
    "memory.addRelationLabelPlaceholder": "\uB77C\uBCA8",
    "memory.addRelationTargetPlaceholder": "\uB300\uC0C1 ID",
    "memory.filterPlaceholder": "\uBA54\uBAA8\uB9AC \uD544\uD130\u2026",
    "memory.emptyHint": "\uC544\uC9C1 \uBA54\uBAA8\uB9AC \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC774\uC57C\uAE30\uAC00 \uC9C4\uD589\uB428\uC5D0 \uB530\uB77C \uC694\uC57D \uBC0F \uC5F0\uC18D\uC131 \uC0AC\uC2E4\uC774 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    "card.worldFacts.title": "\uC138\uACC4 \uC0AC\uC2E4",
    "card.entities.title": "\uC5D4\uD2F0\uD2F0",
    "card.relations.title": "\uAD00\uACC4",
    // Card: Memory Operations
    "card.memoryOps.title": "\uBA54\uBAA8\uB9AC \uC791\uC5C5",
    "card.memoryOps.copy": "\uCD94\uCD9C \uBC0F \uD1B5\uD569 \uC6CC\uCEE4\uC758 \uC2E4\uC2DC\uAC04 \uC0C1\uD0DC\uC640 \uC6B4\uC601\uC790 \uC791\uC5C5.",
    "memoryOps.lastExtract": "\uB9C8\uC9C0\uB9C9 \uCD94\uCD9C",
    "memoryOps.lastDream": "\uB9C8\uC9C0\uB9C9 \uD1B5\uD569",
    "memoryOps.freshness": "\uB178\uD2B8\uBD81 \uC2E0\uC120\uB3C4",
    "memoryOps.docCounts": "\uBB38\uC11C \uC218",
    "memoryOps.freshnessUnknown": "\uC54C \uC218 \uC5C6\uC74C",
    "memoryOps.freshnessCurrent": "\uCD5C\uC2E0",
    "memoryOps.freshnessStale": "\uC624\uB798\uB428",
    "memoryOps.neverRun": "\uC5C6\uC74C",
    "memoryOps.locked": "\uBA54\uBAA8\uB9AC \uC7A0\uAE40 \u2014 \uD1B5\uD569 \uC9C4\uD589 \uC911",
    "memoryOps.staleExtract": "\uBA54\uBAA8\uB9AC \uCD94\uCD9C\uC774 24\uC2DC\uAC04 \uC774\uC0C1 \uACBD\uACFC\uD588\uC2B5\uB2C8\uB2E4",
    "memoryOps.staleDream": "\uB9C8\uC9C0\uB9C9 \uD1B5\uD569 \uD328\uC2A4\uAC00 24\uC2DC\uAC04 \uC774\uC0C1 \uACBD\uACFC\uD588\uC2B5\uB2C8\uB2E4",
    "memoryOps.fallbackEnabled": "\uB300\uCCB4 \uAC80\uC0C9 \uCF1C\uC9D0",
    "memoryOps.fallbackDisabled": "\uB300\uCCB4 \uAC80\uC0C9 \uAEBC\uC9D0",
    "btn.forceExtract": "\uC9C0\uAE08 \uCD94\uCD9C \uC2E4\uD589",
    "btn.forceDream": "\uC9C0\uAE08 \uD1B5\uD569 \uC2E4\uD589",
    "btn.inspectRecalled": "\uD68C\uC0C1 \uBB38\uC11C \uD655\uC778",
    "btn.toggleFallback": "\uB300\uCCB4 \uAC80\uC0C9 \uD1A0\uAE00",
    "toast.extractStarted": "\uCD94\uCD9C\uC774 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    "toast.dreamStarted": "\uD1B5\uD569\uC774 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    "toast.extractFailed": "\uCD94\uCD9C \uC2E4\uD328: {{error}}",
    "toast.dreamFailed": "\uD1B5\uD569 \uC2E4\uD328: {{error}}",
    "toast.fallbackToggled": "\uB300\uCCB4 \uAC80\uC0C9\uC774 \uD1A0\uAE00\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    "toast.noCallback": "\uC0AC\uC6A9 \uBD88\uAC00 \u2014 \uB7F0\uD0C0\uC784 \uCF5C\uBC31\uC774 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4",
    // Card: Settings Profiles
    "card.settingsProfiles.title": "\uC124\uC815 \uD504\uB85C\uD544",
    "card.settingsProfiles.copy": "\uC7AC\uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uD504\uB9AC\uC14B\uC744 \uC800\uC7A5\uD558\uACE0, \uD55C \uBC88\uC758 \uD074\uB9AD\uC73C\uB85C \uAD50\uCCB4\uD558\uBA70, JSON \uAC00\uC838\uC624\uAE30/\uB0B4\uBCF4\uB0B4\uAE30\uB85C \uC774\uB3D9\uD558\uC138\uC694.",
    // Connection status
    "connection.notTested": "\uD14C\uC2A4\uD2B8\uB418\uC9C0 \uC54A\uC74C",
    "connection.testing": "\uD14C\uC2A4\uD2B8 \uC911\u2026",
    "connection.connected": "\uC5F0\uACB0\uB428 ({{count}}\uAC1C \uBAA8\uB378)",
    // Toast messages
    "toast.settingsSaved": "\uC124\uC815\uC774 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    "toast.changesDiscarded": "\uBCC0\uACBD\uC0AC\uD56D\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    "toast.profileCreated": "\uD504\uB85C\uD544\uC774 \uC0DD\uC131\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    "toast.profileExported": "\uD504\uB85C\uD544\uC774 \uB0B4\uBCF4\uB0B4\uC84C\uC2B5\uB2C8\uB2E4",
    "toast.profileImported": "\uD504\uB85C\uD544\uC744 \uAC00\uC838\uC654\uC2B5\uB2C8\uB2E4",
    "toast.noProfileSelected": "\uC120\uD0DD\uB41C \uD504\uB85C\uD544\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
    "toast.invalidProfileFormat": "\uC798\uBABB\uB41C \uD504\uB85C\uD544 \uD615\uC2DD\uC785\uB2C8\uB2E4",
    "toast.failedParseProfile": "\uD504\uB85C\uD544 JSON \uD30C\uC2F1\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4",
    "toast.backfillCompleted": "\uCC44\uD305 \uCD94\uCD9C\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4 ({{count}}\uAC1C \uC5C5\uB370\uC774\uD2B8)",
    "toast.backfillSkipped": "\uCD94\uCD9C\uB41C \uCC44\uD305 \uBA54\uBAA8\uB9AC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
    "error.backfillScopeMismatch": "\uB300\uC2DC\uBCF4\uB4DC\uB97C \uC5F0 \uB4A4 \uD65C\uC131 \uCC44\uD305\uC774 \uBC14\uB00C\uC5C8\uC2B5\uB2C8\uB2E4. \uC6D0\uB798 \uCC44\uD305\uC73C\uB85C \uB3CC\uC544\uAC04 \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.",
    // Import alert
    "alert.importInstructions": '\uD504\uB85C\uD544\uC744 \uAC00\uC838\uC624\uB824\uBA74 JSON\uC744 \uD50C\uB7EC\uADF8\uC778 \uC800\uC7A5\uC18C \uD0A4 "{{key}}"\uC5D0 \uC800\uC7A5\uD55C \uD6C4 \uAC00\uC838\uC624\uAE30\uB97C \uB2E4\uC2DC \uD074\uB9AD\uD558\uC138\uC694.',
    // Placeholders
    "placeholder.customModelId": "\uBAA8\uB378 ID\uB97C \uC9C1\uC811 \uC785\uB825\uD558\uC138\uC694",
    // Profile names
    "profile.defaultName": "\uD504\uB85C\uD544 {{n}}",
    "profile.balanced": "\uADE0\uD615",
    "profile.gentle": "\uBD80\uB4DC\uB7EC\uC6C0",
    "profile.strict": "\uC5C4\uACA9",
    "promptPreset.defaultName": "\uAE30\uBCF8 \uD504\uB9AC\uC14B",
    "promptPreset.customName": "\uCEE4\uC2A4\uD140 \uD504\uB9AC\uC14B {{n}}",
    "promptPreset.readOnlyHint": "\uB0B4\uC7A5 \uD504\uB9AC\uC14B\uC740 \uC77D\uAE30 \uC804\uC6A9\uC785\uB2C8\uB2E4. \uD604\uC7AC \uD504\uB9AC\uC14B\uC744 \uBCF5\uC81C\uD574 \uC0AC\uC6A9\uC790 \uC815\uC758\uD558\uC138\uC694.",
    // Fallback summary
    "fallback.header": "\u2500\u2500 \uB514\uB809\uD130 \uD50C\uB7EC\uADF8\uC778 \uC124\uC815 \u2500\u2500",
    "fallback.enabled": "\uD65C\uC131\uD654",
    "fallback.assertiveness": "\uC801\uADF9\uC131",
    "fallback.provider": "\uD504\uB85C\uBC14\uC774\uB354",
    "fallback.model": "\uBAA8\uB378",
    "fallback.injection": "\uC8FC\uC785",
    "fallback.postReview": "\uC0AC\uD6C4 \uB9AC\uBDF0",
    "fallback.briefCap": "\uBE0C\uB9AC\uD504 \uC0C1\uD55C",
    "fallback.briefCapUnit": "\uD1A0\uD070",
    // Language selector
    "lang.label": "\uC5B8\uC5B4",
    "lang.en": "English",
    "lang.ko": "\uD55C\uAD6D\uC5B4"
  };
  var CATALOGS = {
    en: EN_CATALOG,
    ko: KO_CATALOG
  };
  function t(key, params) {
    const catalog = CATALOGS[activeLocale];
    let value = catalog[key] ?? CATALOGS.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replaceAll(`{{${k}}}`, v);
      }
    }
    return value;
  }
  var TAB_KEY_MAP = {
    "general": "tab.general",
    "prompt-tuning": "tab.promptTuning",
    "model-settings": "tab.modelSettings",
    "memory-cache": "tab.memoryCache",
    "settings-profiles": "tab.settingsProfiles"
  };
  function tabLabel(tabId) {
    const key = TAB_KEY_MAP[tabId];
    return key ? t(key) : tabId;
  }
  var SIDEBAR_GROUP_KEY_MAP = {
    "general": "sidebar.group.general",
    "tuning": "sidebar.group.tuning",
    "memory": "sidebar.group.memory",
    "profiles": "sidebar.group.profiles"
  };
  function sidebarGroupLabel(groupId) {
    const key = SIDEBAR_GROUP_KEY_MAP[groupId];
    return key ? t(key) : groupId;
  }
  var EMBEDDING_PROVIDER_KEY_MAP = {
    openai: "option.embedding.openai",
    voyageai: "option.embedding.voyageai",
    google: "option.embedding.google",
    vertex: "option.embedding.vertex",
    custom: "option.embedding.custom"
  };
  function embeddingProviderLabel(providerId) {
    return t(EMBEDDING_PROVIDER_KEY_MAP[providerId]);
  }
  var BUILTIN_PROFILE_KEY_MAP = {
    "builtin-balanced": "profile.balanced",
    "builtin-gentle": "profile.gentle",
    "builtin-strict": "profile.strict"
  };
  function profileDisplayName(id, fallbackName) {
    const key = BUILTIN_PROFILE_KEY_MAP[id];
    return key ? t(key) : fallbackName;
  }

  // src/ui/dashboardState.ts
  var DASHBOARD_SETTINGS_KEY = "dashboard-settings-v1";
  var DASHBOARD_PROFILE_MANIFEST_KEY = "dashboard-profile-manifest-v1";
  var DASHBOARD_LOCALE_KEY = "dashboard-locale-v1";
  var DASHBOARD_SCHEMA_VERSION = 1;
  function normalizePersistedSettings(raw) {
    return {
      ...DEFAULT_DIRECTOR_SETTINGS,
      ...raw,
      promptPresetId: typeof raw.promptPresetId === "string" ? raw.promptPresetId : DEFAULT_DIRECTOR_SETTINGS.promptPresetId,
      promptPresets: normalizePromptPresets(raw.promptPresets)
    };
  }
  function createDashboardDraft(settings) {
    return {
      isDirty: false,
      settings: { ...settings }
    };
  }
  function isValidPromptPreset(value) {
    if (value == null || typeof value !== "object") return false;
    const record = value;
    const directives = record.assertivenessDirectives;
    if (directives == null || typeof directives !== "object") return false;
    const directiveRecord = directives;
    return typeof record.preRequestSystemTemplate === "string" && typeof record.preRequestUserTemplate === "string" && typeof record.postResponseSystemTemplate === "string" && typeof record.postResponseUserTemplate === "string" && typeof record.sceneBriefSchema === "string" && typeof record.memoryUpdateSchema === "string" && typeof record.maxRecentMessages === "number" && typeof directiveRecord.light === "string" && typeof directiveRecord.standard === "string" && typeof directiveRecord.firm === "string";
  }
  function normalizePromptPresets(raw) {
    if (raw == null || typeof raw !== "object") return {};
    const entries = Object.entries(raw);
    const normalized = {};
    for (const [key, value] of entries) {
      if (value == null || typeof value !== "object") continue;
      const candidate = value;
      if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.createdAt !== "number" || typeof candidate.updatedAt !== "number" || !isValidPromptPreset(candidate.preset)) {
        continue;
      }
      normalized[key] = {
        id: candidate.id,
        name: candidate.name,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        preset: structuredClone(candidate.preset)
      };
    }
    return normalized;
  }
  function createBuiltinPromptPresetRecord() {
    return {
      id: BUILTIN_PROMPT_PRESET_ID,
      name: BUILTIN_PROMPT_PRESET_NAME,
      createdAt: 0,
      updatedAt: 0,
      preset: structuredClone(DEFAULT_DIRECTOR_PROMPT_PRESET)
    };
  }
  function resolveSelectedPromptPreset(settings) {
    const stored = settings.promptPresets[settings.promptPresetId];
    if (stored) {
      return structuredClone(stored);
    }
    return createBuiltinPromptPresetRecord();
  }
  function createPromptPresetFromSettings(settings, name) {
    const now = Date.now();
    const count = Object.keys(settings.promptPresets).length + 1;
    return {
      id: `prompt-preset-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: name?.trim() || t("promptPreset.customName", { n: String(count) }),
      createdAt: now,
      updatedAt: now,
      preset: structuredClone(resolvePromptPreset(settings))
    };
  }
  var BUILTIN_PROFILES = [
    {
      id: "builtin-balanced",
      name: "Balanced",
      createdAt: 0,
      updatedAt: 0,
      basedOn: null,
      overrides: { assertiveness: "standard" }
    },
    {
      id: "builtin-gentle",
      name: "Gentle",
      createdAt: 0,
      updatedAt: 0,
      basedOn: null,
      overrides: { assertiveness: "light" }
    },
    {
      id: "builtin-strict",
      name: "Strict",
      createdAt: 0,
      updatedAt: 0,
      basedOn: null,
      overrides: { assertiveness: "firm", postReviewEnabled: true }
    }
  ];
  function createDefaultProfileManifest() {
    const activeProfileId = BUILTIN_PROFILES[0]?.id ?? "builtin-balanced";
    return {
      version: DASHBOARD_SCHEMA_VERSION,
      activeProfileId,
      profiles: BUILTIN_PROFILES.map((p) => ({ ...p }))
    };
  }
  function createProfileExportPayload(profile) {
    return {
      schema: "director-actor-dashboard-profile",
      version: 1,
      profile: { ...profile }
    };
  }
  var DASHBOARD_DREAM_STATE_KEY = "dashboard-dream-state-v1";
  function createDefaultDreamState() {
    return {
      lastDreamTs: 0,
      turnsSinceLastDream: 0,
      sessionsSinceLastDream: 0
    };
  }
  async function loadDreamState(storage) {
    const raw = await storage.getItem(DASHBOARD_DREAM_STATE_KEY);
    if (raw != null && typeof raw === "object" && typeof raw.lastDreamTs === "number" && typeof raw.turnsSinceLastDream === "number" && typeof raw.sessionsSinceLastDream === "number") {
      return raw;
    }
    return createDefaultDreamState();
  }
  async function saveDreamState(storage, state) {
    await storage.setItem(DASHBOARD_DREAM_STATE_KEY, state);
  }
  function mergeDashboardSettingsIntoPluginState(state, dashboardSettings) {
    return {
      ...state,
      settings: { ...state.settings, ...dashboardSettings }
    };
  }
  var DASHBOARD_MEMORY_OPS_PREFS_KEY = "dashboard-memory-ops-prefs-v1";
  var FRESHNESS_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1e3;
  function computeDocumentCounts(memory) {
    return {
      summaries: memory.summaries.length,
      continuityFacts: memory.continuityFacts.length,
      worldFacts: memory.worldFacts.length,
      entities: memory.entities.length,
      relations: memory.relations.length
    };
  }
  function computeNotebookFreshness(lastExtractTs, lastDreamTs) {
    const latest = Math.max(lastExtractTs, lastDreamTs);
    if (latest === 0) return "unknown";
    const elapsed = Date.now() - latest;
    return elapsed > FRESHNESS_STALE_THRESHOLD_MS ? "stale" : "current";
  }
  async function loadMemoryOpsPrefs(storage) {
    const raw = await storage.getItem(DASHBOARD_MEMORY_OPS_PREFS_KEY);
    if (raw != null && typeof raw === "object" && typeof raw.fallbackRetrievalEnabled === "boolean") {
      return raw;
    }
    return { fallbackRetrievalEnabled: false };
  }
  async function saveMemoryOpsPrefs(storage, prefs) {
    await storage.setItem(DASHBOARD_MEMORY_OPS_PREFS_KEY, prefs);
  }

  // src/runtime/circuitBreaker.ts
  var CircuitBreaker = class {
    threshold;
    cooldownMs;
    clock;
    failures = 0;
    open = false;
    lastFailureReason = null;
    openedAt = null;
    constructor(threshold, cooldownMs, clock = Date.now) {
      this.threshold = threshold;
      this.cooldownMs = cooldownMs;
      this.clock = clock;
    }
    recordFailure(reason) {
      this.failures++;
      this.lastFailureReason = reason;
      if (this.failures >= this.threshold) {
        this.open = true;
        this.openedAt = this.clock();
      }
    }
    recordSuccess() {
      this.failures = 0;
      this.open = false;
      this.openedAt = null;
      this.lastFailureReason = null;
    }
    isOpen() {
      if (!this.open) return false;
      if (this.openedAt !== null && this.clock() - this.openedAt >= this.cooldownMs) {
        this.open = false;
        this.failures = 0;
        this.openedAt = null;
        return false;
      }
      return true;
    }
    getState() {
      return {
        failures: this.failures,
        open: this.isOpen(),
        lastFailureReason: this.lastFailureReason,
        openedAt: this.openedAt,
        cooldownMs: this.cooldownMs,
        threshold: this.threshold
      };
    }
  };

  // src/adapter/segmentClassifier.ts
  var AUTHOR_NOTE_PATTERN = /(?:^|\[)\s*author(?:'s)?\s*note\s*[\]:]|<author[_-]?note>/i;
  var CONSTRAINT_KEYWORDS = /\b(?:you\s+must|must\s+not|must\s+never|always\s+(?:stay|keep|remain|be)|never\s+(?:break|reveal|mention|use)|do\s+not|don't|forbidden|prohibited|under\s+no\s+circumstances|important\s*:\s*(?:do\s+not|never))\b/i;
  var OUTPUT_FORMAT_PATTERN = /\b(?:respond\s+(?:in|with|using)\s+(?:json|xml|yaml|markdown|csv)|format\s*:|output\s+format|schema\s*:|structured\s+(?:output|response))\b/i;
  var PERSONA_PATTERN = /(?:\bcharacter\s*:|{{char}}|\bpersona\s*:|\bplay\s+(?:the\s+)?(?:role|part)\s+of\b)/i;
  var LOREBOOK_PATTERN = /(?:\[world\s*info\]|\[lore(?:book)?\]|\bworld\s*info\s*:|lore\s*entry\s*:)/i;
  var MEMORY_PATTERN = /(?:\[(?:summary|recap|memory|context)\b|summary\s+of\s+(?:past|previous|recent)|chat\s+(?:history|summary)|previously\s+(?:on|in))/i;
  var STYLE_REGISTER_PATTERN = /\b(?:writing\s+style|narrative\s+(?:style|voice|tone)|register\s*:|prose\s+style|stylistic\s+(?:guidance|direction)|tone\s*:|voice\s*:)\b/i;
  var CHARACTER_RULES_PATTERN = /\b(?:character\s+rules|behavior(?:al)?\s+(?:rules|guidelines)|{{char}}\s+(?:must|should|will|always|never))\b/i;
  var PREFILL_MAX_LENGTH = 20;
  function scoreContentHeuristics(content) {
    const scores = [];
    if (AUTHOR_NOTE_PATTERN.test(content)) {
      scores.push({ kind: "author-note", score: 0.95 });
    }
    if (CONSTRAINT_KEYWORDS.test(content)) {
      scores.push({ kind: "constraint", score: 0.8 });
    }
    if (OUTPUT_FORMAT_PATTERN.test(content)) {
      scores.push({ kind: "output-format", score: 0.85 });
    }
    if (PERSONA_PATTERN.test(content)) {
      scores.push({ kind: "persona", score: 0.75 });
    }
    if (LOREBOOK_PATTERN.test(content)) {
      scores.push({ kind: "lorebook", score: 0.8 });
    }
    if (MEMORY_PATTERN.test(content)) {
      scores.push({ kind: "memory", score: 0.8 });
    }
    if (STYLE_REGISTER_PATTERN.test(content)) {
      scores.push({ kind: "style-register", score: 0.75 });
    }
    if (CHARACTER_RULES_PATTERN.test(content)) {
      scores.push({ kind: "character-rules", score: 0.7 });
    }
    return scores;
  }
  function scorePositionHeuristics(role, index, _totalCount, isLastUser, isLastAssistant, isTrailingAssistant, contentLength) {
    const scores = [];
    if (role === "system" && index === 0) {
      scores.push({ kind: "system-canon", score: 0.85 });
    }
    if (isTrailingAssistant && contentLength <= PREFILL_MAX_LENGTH) {
      scores.push({ kind: "prefill", score: 0.9 });
    }
    if (isLastUser) {
      scores.push({ kind: "latest-user", score: 1 });
    } else if (role === "user") {
      scores.push({ kind: "conversation", score: 0.7 });
    }
    if (isLastAssistant && !isTrailingAssistant) {
      scores.push({ kind: "latest-assistant", score: 1 });
    } else if (role === "assistant" && !isTrailingAssistant) {
      scores.push({ kind: "conversation", score: 0.7 });
    }
    return scores;
  }
  function pickBestKind(positionScores, contentScores) {
    const merged = /* @__PURE__ */ new Map();
    for (const { kind, score } of positionScores) {
      merged.set(kind, Math.max(merged.get(kind) ?? 0, score));
    }
    for (const { kind, score } of contentScores) {
      const existing = merged.get(kind) ?? 0;
      merged.set(kind, Math.min(1, existing + score));
    }
    const positionalOverrides = [
      "latest-user",
      "latest-assistant",
      "prefill"
    ];
    for (const override of positionalOverrides) {
      if (merged.has(override)) {
        return { kind: override, confidence: merged.get(override) };
      }
    }
    let bestKind = "unknown";
    let bestScore = 0;
    for (const [kind, score] of merged) {
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
      }
    }
    return {
      kind: bestKind,
      confidence: Math.round(bestScore * 100) / 100
    };
  }
  function classifySegment(message, index, totalCount, allMessages) {
    if (message.__directorInjected) {
      return { index, message, kind: "director-like", confidence: 1 };
    }
    const { role, content } = message;
    let isLastUser = false;
    let isLastAssistant = false;
    const isTrailingAssistant = role === "assistant" && index === totalCount - 1;
    if (allMessages) {
      let lastUserIdx = -1;
      let lastAssistantIdx = -1;
      for (let i = allMessages.length - 1; i >= 0; i--) {
        if (allMessages[i].role === "user" && lastUserIdx === -1) {
          lastUserIdx = i;
        }
        if (allMessages[i].role === "assistant" && lastAssistantIdx === -1) {
          const isPrefillCandidate = i === allMessages.length - 1 && allMessages[i].content.length <= PREFILL_MAX_LENGTH;
          if (!isPrefillCandidate) {
            lastAssistantIdx = i;
          }
        }
        if (lastUserIdx !== -1 && lastAssistantIdx !== -1) break;
      }
      isLastUser = index === lastUserIdx;
      isLastAssistant = index === lastAssistantIdx;
    }
    const contentScores = role === "system" ? scoreContentHeuristics(content) : [];
    const positionScores = scorePositionHeuristics(
      role,
      index,
      totalCount,
      isLastUser,
      isLastAssistant,
      isTrailingAssistant,
      content.length
    );
    const { kind, confidence } = pickBestKind(positionScores, contentScores);
    return { index, message, kind, confidence };
  }
  function buildTopology(messages) {
    const segments = messages.map(
      (m, i) => classifySegment(m, i, messages.length, messages)
    );
    let authorNoteIndex = null;
    let latestUserIndex = null;
    let latestAssistantIndex = null;
    let constraintIndex = null;
    let hasPrefill = false;
    for (const seg of segments) {
      switch (seg.kind) {
        case "author-note":
          if (authorNoteIndex === null) authorNoteIndex = seg.index;
          break;
        case "latest-user":
          latestUserIndex = seg.index;
          break;
        case "latest-assistant":
          latestAssistantIndex = seg.index;
          break;
        case "constraint":
          constraintIndex = seg.index;
          break;
        case "prefill":
          hasPrefill = true;
          break;
      }
    }
    const confidence = segments.length > 0 ? Math.round(
      segments.reduce((acc, s) => acc * s.confidence, 1) ** (1 / segments.length) * 100
    ) / 100 : 0;
    return {
      family: detectFamily(messages),
      confidence,
      segments,
      authorNoteIndex,
      latestUserIndex,
      latestAssistantIndex,
      constraintIndex,
      hasPrefill
    };
  }
  function classifyAllSegments(messages) {
    return buildTopology(messages).segments;
  }
  function detectFamily(messages) {
    for (const m of messages) {
      if (m.role !== "system") continue;
      if (/\bmythos\b/i.test(m.content)) return "mythos";
    }
    return "unknown";
  }

  // src/utils/xml.ts
  function escapeXml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // src/adapter/universalPromptAdapter.ts
  var DIRECTOR_TAG = "director-brief";
  var BRIEF_VERSION = "1";
  function classifyPromptTopology(messages) {
    const segments = classifyAllSegments(messages);
    let authorNoteIndex = null;
    let latestUserIndex = null;
    let latestAssistantIndex = null;
    let constraintIndex = null;
    let hasPrefill = false;
    for (const seg of segments) {
      switch (seg.kind) {
        case "author-note":
          authorNoteIndex = seg.index;
          break;
        case "latest-user":
          latestUserIndex = seg.index;
          break;
        case "latest-assistant":
          latestAssistantIndex = seg.index;
          break;
        case "constraint":
          constraintIndex = seg.index;
          break;
        case "prefill":
          hasPrefill = true;
          break;
      }
    }
    const avgConfidence = segments.length > 0 ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length : 0;
    return {
      family: "unknown",
      confidence: Math.round(avgConfidence * 100) / 100,
      segments,
      authorNoteIndex,
      latestUserIndex,
      latestAssistantIndex,
      constraintIndex,
      hasPrefill
    };
  }
  function xmlLine(tag, content, indent = "  ") {
    return `${indent}<${tag}>${escapeXml(content)}</${tag}>`;
  }
  function serializeDirectorBrief(brief) {
    const lines = [];
    lines.push(`<${DIRECTOR_TAG} version="${BRIEF_VERSION}">`);
    lines.push(xmlLine("confidence", String(brief.confidence)));
    lines.push(xmlLine("pacing", brief.pacing));
    if (brief.beats.length > 0) {
      lines.push("  <beats>");
      for (const beat of brief.beats) {
        lines.push("    <beat>");
        lines.push(xmlLine("goal", beat.goal, "      "));
        lines.push(xmlLine("reason", beat.reason, "      "));
        if (beat.targetCharacter) {
          lines.push(xmlLine("target-character", beat.targetCharacter, "      "));
        }
        if (beat.stakes) {
          lines.push(xmlLine("stakes", beat.stakes, "      "));
        }
        lines.push("    </beat>");
      }
      lines.push("  </beats>");
    }
    if (brief.continuityLocks.length > 0) {
      lines.push("  <continuity-locks>");
      for (const lock of brief.continuityLocks) {
        lines.push(xmlLine("lock", lock, "    "));
      }
      lines.push("  </continuity-locks>");
    }
    const entries = Object.entries(brief.ensembleWeights);
    if (entries.length > 0) {
      lines.push("  <ensemble-weights>");
      for (const [name, weight] of entries) {
        lines.push(`    <weight name="${escapeXml(name)}">${weight}</weight>`);
      }
      lines.push("  </ensemble-weights>");
    }
    const style = brief.styleInheritance;
    const styleEntries = Object.entries(style).filter(
      (pair) => pair[1] != null
    );
    if (styleEntries.length > 0) {
      lines.push("  <style-inheritance>");
      for (const [key, val] of styleEntries) {
        lines.push(xmlLine(key, val, "    "));
      }
      lines.push("  </style-inheritance>");
    }
    if (brief.forbiddenMoves.length > 0) {
      lines.push("  <forbidden-moves>");
      for (const move of brief.forbiddenMoves) {
        lines.push(xmlLine("move", move, "    "));
      }
      lines.push("  </forbidden-moves>");
    }
    if (brief.memoryHints.length > 0) {
      lines.push("  <memory-hints>");
      for (const hint of brief.memoryHints) {
        lines.push(xmlLine("hint", hint, "    "));
      }
      lines.push("  </memory-hints>");
    }
    lines.push(`</${DIRECTOR_TAG}>`);
    return lines.join("\n");
  }
  function makeDirectorMessage(brief) {
    return {
      role: "system",
      content: serializeDirectorBrief(brief),
      __directorInjected: true,
      __directorTag: DIRECTOR_TAG
    };
  }
  function stripStaleInjections(messages) {
    return messages.filter((m) => !m.__directorInjected);
  }
  function insertAt(arr, position, element) {
    const copy = [...arr];
    copy.splice(position, 0, element);
    return copy;
  }
  function injectDirectorBrief(messages, brief, mode) {
    const cleaned = stripStaleInjections(messages);
    const topology = classifyPromptTopology(cleaned);
    const directorMsg = makeDirectorMessage(brief);
    const notes = [];
    const resolvedMode = mode === "auto" ? resolveAutoMode(topology, notes) : mode;
    let resultMessages;
    switch (resolvedMode) {
      case "author-note": {
        const idx = topology.authorNoteIndex;
        resultMessages = insertAt(cleaned, idx + 1, directorMsg);
        break;
      }
      case "adjacent-user": {
        const idx = topology.latestUserIndex;
        resultMessages = insertAt(cleaned, idx, directorMsg);
        break;
      }
      case "post-constraint": {
        const idx = topology.constraintIndex ?? cleaned.length;
        resultMessages = insertAt(cleaned, idx + 1, directorMsg);
        break;
      }
      case "bottom":
      default: {
        resultMessages = [...cleaned, directorMsg];
        notes.push("Fell through to bottom injection.");
        break;
      }
    }
    const diagnostics = {
      strategy: resolvedMode,
      topologyConfidence: topology.confidence,
      degraded: resolvedMode === "bottom",
      notes
    };
    return { messages: resultMessages, diagnostics };
  }
  function resolveAutoMode(topology, notes) {
    if (topology.authorNoteIndex != null) {
      notes.push("Author-note landmark detected; injecting after it.");
      return "author-note";
    }
    if (topology.latestUserIndex != null) {
      notes.push("No author-note found; injecting before latest user message.");
      return "adjacent-user";
    }
    notes.push("No suitable landmark found; falling back to bottom.");
    return "bottom";
  }

  // src/ui/dashboardCss.ts
  var DASHBOARD_ROOT_CLASS = "da-root";
  var DASHBOARD_STYLE_ID = "da-dashboard-styles";
  function buildDashboardCss() {
    return (
      /* css */
      `
.${DASHBOARD_ROOT_CLASS},
.da-dashboard {
  --da-bg: var(--risu-theme-bgcolor, #10131a);
  --da-bg-elevated: var(--risu-theme-darkbg, #171d28);
  --da-bg-muted: color-mix(in srgb, var(--da-bg-elevated) 82%, black);
  --da-border: var(--risu-theme-darkborderc, rgba(255, 255, 255, 0.08));
  --da-border-strong: var(--risu-theme-borderc, rgba(255, 255, 255, 0.14));
  --da-text: var(--risu-theme-textcolor, #eff3ff);
  --da-text-muted: var(--risu-theme-textcolor2, #9ca4b5);
  --da-accent: var(--risu-theme-selected, #64a2ff);
  --da-accent-soft: color-mix(in srgb, var(--da-accent) 18%, transparent);
  --da-danger: var(--risu-theme-draculared, #ff6b7f);
  --da-button: var(--risu-theme-darkbutton, #232b38);
  --da-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
  --da-radius-lg: 20px;
  --da-radius-md: 14px;
  --da-radius-sm: 10px;
  --da-sidebar-width: 280px;

  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(240px, var(--da-sidebar-width)) minmax(0, 1fr);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--da-accent) 18%, transparent), transparent 36%),
    linear-gradient(180deg, color-mix(in srgb, var(--da-bg) 90%, black), var(--da-bg));
  color: var(--da-text);
  font-family: Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
}

.${DASHBOARD_ROOT_CLASS},
.${DASHBOARD_ROOT_CLASS} *,
.${DASHBOARD_ROOT_CLASS} *::before,
.${DASHBOARD_ROOT_CLASS} *::after,
.da-dashboard,
.da-dashboard *,
.da-dashboard *::before,
.da-dashboard *::after {
  box-sizing: border-box;
}

.da-sidebar {
  position: sticky;
  top: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 18px 18px;
  border-right: 1px solid var(--da-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--da-bg-elevated) 92%, black), color-mix(in srgb, var(--da-bg-elevated) 78%, black));
  backdrop-filter: blur(14px);
}

.da-sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-lg);
  background: color-mix(in srgb, var(--da-bg-elevated) 90%, black);
  box-shadow: var(--da-shadow);
}

.da-kicker {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-text-muted);
}

.da-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 800;
}

.da-subtitle {
  margin: 0;
  color: var(--da-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.da-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  overflow-y: auto;
  padding-right: 6px;
}

.da-nav-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.da-nav-group-label {
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-text-muted);
}

.da-sidebar-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--da-radius-md);
  background: transparent;
  color: var(--da-text-muted);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.da-sidebar-btn:hover,
.da-sidebar-btn:focus-visible {
  background: color-mix(in srgb, var(--da-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--da-accent) 22%, var(--da-border));
  color: var(--da-text);
  outline: none;
  transform: translateX(2px);
}

.da-sidebar-btn--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 22%, transparent), color-mix(in srgb, var(--da-accent) 12%, transparent));
  border-color: color-mix(in srgb, var(--da-accent) 32%, var(--da-border-strong));
  color: var(--da-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--da-accent) 18%, transparent);
}

.da-sidebar-footer {
  display: grid;
  gap: 10px;
}

.da-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px 34px 40px;
}

.da-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-lg);
  background: color-mix(in srgb, var(--da-bg-elevated) 90%, black);
  box-shadow: var(--da-shadow);
}

.da-toolbar-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.da-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.da-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.da-page-section {
  display: grid;
  gap: 14px;
}

.da-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.da-hidden {
  display: none !important;
}

.da-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.da-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-lg);
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-bg-elevated) 92%, white 3%), color-mix(in srgb, var(--da-bg) 94%, black));
  box-shadow: var(--da-shadow);
}

.da-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.da-card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.da-card-copy,
.da-hint,
.da-empty {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--da-text-muted);
}

.da-form-grid {
  display: grid;
  gap: 14px;
}

.da-label {
  display: grid;
  gap: 8px;
}

.da-label-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--da-text);
}

.da-input,
.da-select,
.da-textarea {
  width: 100%;
  min-height: 44px;
  padding: 12px 14px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 88%, black);
  color: var(--da-text);
  font-size: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.da-textarea {
  min-height: 112px;
  resize: vertical;
}

.da-input:focus,
.da-select:focus,
.da-textarea:focus {
  border-color: color-mix(in srgb, var(--da-accent) 58%, var(--da-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--da-accent) 18%, transparent);
  outline: none;
}

.da-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.da-inline > * {
  flex: 1 1 180px;
}

.da-toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--da-text);
  cursor: pointer;
}

.da-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--da-accent);
}

.da-toggle input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.da-toggle-track {
  position: relative;
  width: 46px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--da-border-strong);
  background: color-mix(in srgb, var(--da-button) 82%, black);
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.da-toggle-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: transform 0.18s ease;
}

.da-toggle input[type="checkbox"]:checked + .da-toggle-track {
  background: color-mix(in srgb, var(--da-accent) 84%, black);
  border-color: color-mix(in srgb, var(--da-accent) 72%, white 6%);
}

.da-toggle input[type="checkbox"]:checked + .da-toggle-track .da-toggle-dot {
  transform: translateX(18px);
}

.da-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid color-mix(in srgb, var(--da-border-strong) 90%, transparent);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-button) 88%, black);
  color: var(--da-text);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.da-btn:hover,
.da-btn:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--da-accent) 18%, var(--da-border-strong));
  outline: none;
}

.da-btn--primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 76%, white 10%), color-mix(in srgb, var(--da-accent) 62%, black));
  border-color: color-mix(in srgb, var(--da-accent) 58%, black);
}

.da-btn--ghost {
  background: transparent;
}

.da-btn--danger {
  background: color-mix(in srgb, var(--da-danger) 22%, transparent);
  border-color: color-mix(in srgb, var(--da-danger) 32%, var(--da-border));
}

.da-close-btn {
  align-self: flex-start;
}

.da-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--da-accent) 18%, transparent);
  color: var(--da-text);
  font-size: 12px;
  font-weight: 700;
}

.da-badge[data-kind="success"] {
  background: color-mix(in srgb, #25c281 22%, transparent);
}

.da-badge[data-kind="error"] {
  background: color-mix(in srgb, var(--da-danger) 24%, transparent);
}

.da-toast {
  padding: 10px 12px;
  border-radius: var(--da-radius-sm);
  border: 1px solid var(--da-border);
  background: color-mix(in srgb, var(--da-bg-elevated) 84%, black);
  color: var(--da-text);
}

.da-profile-list,
.da-chip-list,
.da-metric-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.da-profile-item,
.da-chip,
.da-metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 92%, black);
}

.da-profile-item {
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.da-profile-item:hover {
  transform: translateX(2px);
  border-color: color-mix(in srgb, var(--da-accent) 28%, var(--da-border));
}

.da-profile--active {
  border-color: color-mix(in srgb, var(--da-accent) 48%, var(--da-border));
  background: color-mix(in srgb, var(--da-accent) 14%, transparent);
}

.da-connection-status[data-da-status="idle"] { color: var(--da-text-muted); }
.da-connection-status[data-da-status="loading"],
.da-connection-status[data-da-status="testing"] { color: var(--da-accent); }
.da-connection-status[data-da-status="success"],
.da-connection-status[data-da-status="ok"] { color: #4ee0a2; }
.da-connection-status[data-da-status="error"] { color: var(--da-danger); }

.da-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.da-dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--da-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.da-dirty-indicator::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--da-accent) 88%, white 8%);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--da-accent) 12%, transparent);
}

.da-split {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.da-memory-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.da-memory-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 92%, black);
}

.da-btn--sm {
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
}

.da-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.da-add-row .da-input--add {
  flex: 1;
  min-height: 36px;
}

@media (max-width: 960px) {
  .${DASHBOARD_ROOT_CLASS},
  .da-dashboard {
    grid-template-columns: 1fr;
  }

  .da-sidebar {
    min-height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid var(--da-border);
  }

  .da-content {
    padding: 18px 18px 28px;
  }
}

.da-dashboard {
  position: relative;
}

.da-sidebar-header {
  position: relative;
}

.da-content {
  flex: 1;
  overflow-y: auto;
}

.da-page-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.da-page-section {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-md);
  background: color-mix(in srgb, var(--da-bg-elevated) 88%, black);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
}

.da-page-section > h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.da-page-section > .da-btn,
.da-page-section > .da-connection-status {
  justify-self: start;
}

.da-label > span {
  font-size: 13px;
  font-weight: 700;
  color: var(--da-text);
}

.da-checkbox {
  inline-size: 16px;
  block-size: 16px;
  margin: 0;
  accent-color: var(--da-accent);
  cursor: pointer;
}

.da-connection-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--da-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--da-bg) 82%, black);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.da-connection-status[data-da-status="ok"],
.da-connection-status[data-da-status="success"] {
  color: #4ee0a2;
  border-color: color-mix(in srgb, #4ee0a2 32%, var(--da-border));
  background: color-mix(in srgb, #4ee0a2 10%, transparent);
}

.da-connection-status[data-da-status="error"] {
  border-color: color-mix(in srgb, var(--da-danger) 32%, var(--da-border));
  background: color-mix(in srgb, var(--da-danger) 10%, transparent);
}

.da-connection-status[data-da-status="testing"],
.da-connection-status[data-da-status="loading"] {
  color: #f4c95d;
  border-color: color-mix(in srgb, #f4c95d 32%, var(--da-border));
  background: color-mix(in srgb, #f4c95d 10%, transparent);
}

.da-close-btn {
  background: transparent;
  color: var(--da-text-muted);
  border-color: color-mix(in srgb, var(--da-danger) 28%, var(--da-border));
}

.da-close-btn:hover,
.da-close-btn:focus-visible {
  background: color-mix(in srgb, var(--da-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--da-accent) 28%, var(--da-border));
  color: var(--da-text);
}

.da-sidebar-header .da-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  min-width: 32px;
  padding: 0;
  aspect-ratio: 1;
  border-radius: 999px;
}

.da-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  padding: 18px 0 4px;
  margin-top: auto;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--da-bg) 96%, black) 42%);
  backdrop-filter: blur(10px);
}

.da-dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--da-accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--da-accent) 24%, transparent);
  color: var(--da-text);
  font-size: 12px;
  font-weight: 700;
}

.da-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 10001;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: min(320px, calc(100vw - 32px));
  padding: 12px 18px;
  border: 1px solid color-mix(in srgb, var(--da-accent) 38%, var(--da-border));
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 76%, white 6%), color-mix(in srgb, var(--da-accent) 62%, black));
  box-shadow: var(--da-shadow);
  color: #09111f;
  font-size: 14px;
  font-weight: 700;
  transform: translateX(-50%);
  animation: da-toast-fade-in 0.18s ease-out;
}

@keyframes da-toast-fade-in {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
`
    );
  }

  // src/ui/dashboardModel.ts
  var DIRECTOR_PROVIDER_CATALOG = [
    {
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      manualModelOnly: false,
      authMode: "api-key",
      curatedModels: [
        "gpt-4.1-mini",
        "gpt-4.1",
        "gpt-5.3-codex",
        "gpt-5.4-nano",
        "gpt-5.4-mini",
        "gpt-5.4",
        "gpt-5.4-pro"
      ]
    },
    {
      id: "anthropic",
      label: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      manualModelOnly: true,
      authMode: "api-key",
      curatedModels: [
        "claude-3-5-haiku-latest",
        "claude-3-5-sonnet-latest",
        "claude-3-7-sonnet-latest",
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "claude-opus-4-6-fast"
      ]
    },
    {
      id: "google",
      label: "Google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      manualModelOnly: true,
      authMode: "api-key",
      curatedModels: [
        "gemini-2.0-flash",
        "gemini-2.5-flash-preview-04-17",
        "gemini-2.5-pro-preview-05-06",
        "gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview-customtools",
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-live-preview"
      ]
    },
    {
      id: "copilot",
      label: "GitHub Copilot",
      baseUrl: "https://api.githubcopilot.com/v1",
      manualModelOnly: true,
      authMode: "oauth-device-flow",
      curatedModels: ["gpt-4.1", "gpt-5.4", "claude-sonnet-4-6", "claude-opus-4-6"]
    },
    {
      id: "vertex",
      label: "Google Vertex AI",
      baseUrl: "",
      manualModelOnly: true,
      authMode: "manual-advanced",
      curatedModels: [
        "gemini-2.5-pro-preview-05-06",
        "gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview-customtools",
        "gemini-3.1-flash-lite-preview",
        "claude-sonnet-4-6",
        "claude-opus-4-6"
      ]
    },
    {
      id: "custom",
      label: "Custom (OpenAI-compatible)",
      baseUrl: "",
      manualModelOnly: false,
      authMode: "api-key",
      curatedModels: []
    }
  ];
  var EMBEDDING_PROVIDER_CATALOG = [
    {
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
      authMode: "api-key"
    },
    {
      id: "voyageai",
      baseUrl: "https://api.voyageai.com/v1",
      authMode: "api-key"
    },
    {
      id: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authMode: "api-key"
    },
    {
      id: "vertex",
      baseUrl: "",
      authMode: "manual-advanced"
    },
    {
      id: "custom",
      baseUrl: "",
      authMode: "api-key"
    }
  ];
  function resolveProviderDefaults(providerId) {
    const entry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === providerId);
    if (entry) return { ...entry };
    return {
      id: providerId,
      label: providerId,
      baseUrl: "",
      manualModelOnly: true,
      authMode: "api-key",
      curatedModels: []
    };
  }
  function resolveEmbeddingDefaults(providerId) {
    const entry = EMBEDDING_PROVIDER_CATALOG.find((e) => e.id === providerId);
    if (entry) return { ...entry };
    return {
      id: providerId,
      baseUrl: "",
      authMode: "api-key"
    };
  }
  async function loadProviderModels(api, settings) {
    const provider = settings.directorProvider;
    const catalogEntry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === provider);
    if (catalogEntry?.manualModelOnly) {
      return [...catalogEntry.curatedModels];
    }
    const baseUrl = settings.directorBaseUrl;
    if (!baseUrl) {
      throw new Error("Base URL is required for model listing");
    }
    if (!settings.directorApiKey) {
      throw new Error("API key is required for model listing");
    }
    const response = await api.nativeFetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${settings.directorApiKey}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(
        `Model listing failed (HTTP ${String(response.status)})`
      );
    }
    const json = await response.json();
    const entries = json.data ?? [];
    const ids = entries.map((entry) => entry.id);
    return [...new Set(ids)].sort();
  }
  async function testDirectorConnection(api, settings) {
    try {
      const provider = settings.directorProvider;
      const catalogEntry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === provider);
      if (catalogEntry?.manualModelOnly) {
        if (catalogEntry.authMode === "api-key" && !settings.directorApiKey) {
          return { ok: false, error: "API key is not configured" };
        }
        return { ok: true, models: [...catalogEntry.curatedModels] };
      }
      if (!settings.directorApiKey) {
        return { ok: false, error: "API key is not configured" };
      }
      const baseUrl = settings.directorBaseUrl;
      if (!baseUrl) {
        return { ok: false, error: "Base URL is not configured" };
      }
      const response = await api.nativeFetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${settings.directorApiKey}`,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        return {
          ok: false,
          error: `Server returned HTTP ${String(response.status)}`
        };
      }
      const json = await response.json();
      const entries = json.data ?? [];
      const models = [...new Set(entries.map((e) => e.id))].sort();
      return { ok: true, models };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown connection error";
      return { ok: false, error: message };
    }
  }

  // src/ui/dashboardDom.ts
  var DASHBOARD_TABS = [
    { id: "general", group: "general" },
    { id: "prompt-tuning", group: "tuning" },
    { id: "model-settings", group: "tuning" },
    { id: "memory-cache", group: "memory" },
    { id: "settings-profiles", group: "profiles" }
  ];
  function buildSidebar(activeTab) {
    const groups = [
      { id: "general", labelId: "general" },
      { id: "tuning", labelId: "tuning" },
      { id: "memory", labelId: "memory" },
      { id: "profiles", labelId: "profiles" }
    ];
    const sections = groups.map((group) => {
      const buttons = DASHBOARD_TABS.filter((tab) => tab.group === group.id).map((tab) => {
        const activeClass = tab.id === activeTab ? " da-sidebar-btn--active" : "";
        return `<button class="da-sidebar-btn${activeClass}" data-da-target="${tab.id}"><span>${tabLabel(tab.id)}</span><span aria-hidden="true">\u203A</span></button>`;
      }).join("\n");
      return `<section class="da-nav-group"><div class="da-nav-group-label">${sidebarGroupLabel(group.id)}</div>${buttons}</section>`;
    }).join("\n");
    const currentLocale = getLocale();
    const nextLocale = currentLocale === "en" ? "ko" : "en";
    const nextLabel = currentLocale === "en" ? t("lang.ko") : t("lang.en");
    return `
    <aside class="da-sidebar">
      <div class="da-sidebar-header">
        <div class="da-kicker">${t("sidebar.kicker")}</div>
        <h1 class="da-title">${t("sidebar.title")}</h1>
        <p class="da-subtitle">${t("sidebar.subtitle")}</p>
      </div>
      <nav class="da-sidebar-nav">${sections}</nav>
      <div class="da-sidebar-footer da-footer">
        <button class="da-btn" data-da-action="switch-lang" data-da-lang="${nextLocale}">${nextLabel}</button>
        <button class="da-btn da-btn--ghost" data-da-action="export-settings">${t("btn.exportSettings")}</button>
        <button class="da-btn da-btn--danger da-close-btn" data-da-action="close-dashboard">${t("btn.close")}</button>
      </div>
    </aside>`;
  }
  function buildGeneralPage(input) {
    const { settings, connectionStatus } = input;
    return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.pluginStatus.title")}</h3>
              <p class="da-card-copy">${t("card.pluginStatus.copy")}</p>
            </div>
            <span class="da-badge" data-kind="${connectionStatus.kind === "error" ? "error" : connectionStatus.kind === "success" ? "success" : "neutral"}">${connectionStatus.kind}</span>
          </div>
          <label class="da-toggle">
            <input type="checkbox" data-da-field="enabled"${settings.enabled ? " checked" : ""} />
            <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
            <span>${t("label.enabled")}</span>
          </label>
          <label class="da-label">
            <span class="da-label-text">${t("label.assertiveness")}</span>
            <select class="da-select" data-da-field="assertiveness">
            <option value="light"${settings.assertiveness === "light" ? " selected" : ""}>${t("option.light")}</option>
            <option value="standard"${settings.assertiveness === "standard" ? " selected" : ""}>${t("option.standard")}</option>
            <option value="firm"${settings.assertiveness === "firm" ? " selected" : ""}>${t("option.firm")}</option>
            </select>
          </label>
          <div class="da-inline">
            <label class="da-label">
              <span class="da-label-text">${t("label.mode")}</span>
              <select class="da-select" data-da-field="directorMode">
                <option value="otherAx"${settings.directorMode === "otherAx" ? " selected" : ""}>${t("option.risuAux")}</option>
                <option value="model"${settings.directorMode === "model" ? " selected" : ""}>${t("option.independentProvider")}</option>
              </select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.injectionMode")}</span>
              <select class="da-select" data-da-field="injectionMode">
                <option value="auto"${settings.injectionMode === "auto" ? " selected" : ""}>${t("option.auto")}</option>
                <option value="author-note"${settings.injectionMode === "author-note" ? " selected" : ""}>${t("option.authorNote")}</option>
                <option value="adjacent-user"${settings.injectionMode === "adjacent-user" ? " selected" : ""}>${t("option.adjacentUser")}</option>
                <option value="post-constraint"${settings.injectionMode === "post-constraint" ? " selected" : ""}>${t("option.postConstraint")}</option>
                <option value="bottom"${settings.injectionMode === "bottom" ? " selected" : ""}>${t("option.bottom")}</option>
              </select>
            </label>
          </div>
          <span class="da-connection-status" data-da-status="${connectionStatus.kind}">${connectionStatus.message}</span>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.metricsSnapshot.title")}</h3>
              <p class="da-card-copy">${t("card.metricsSnapshot.copy")}</p>
            </div>
          </div>
          <ul class="da-metric-list">
            <li class="da-metric-item"><span>${t("metric.totalDirectorCalls")}</span><strong>${input.pluginState.metrics.totalDirectorCalls}</strong></li>
            <li class="da-metric-item"><span>${t("metric.totalFailures")}</span><strong>${input.pluginState.metrics.totalDirectorFailures}</strong></li>
            <li class="da-metric-item"><span>${t("metric.memoryWrites")}</span><strong>${input.pluginState.metrics.totalMemoryWrites}</strong></li>
            <li class="da-metric-item"><span>${t("metric.scenePhase")}</span><strong>${input.pluginState.director.scenePhase}</strong></li>
          </ul>
        </section>
      </div>`;
  }
  function buildPromptTuningPage(input) {
    const { settings } = input;
    const selectedPreset = resolveSelectedPromptPreset(settings);
    const selectedPresetId = settings.promptPresets[settings.promptPresetId] ? settings.promptPresetId : BUILTIN_PROMPT_PRESET_ID;
    const isBuiltinPreset = selectedPresetId === BUILTIN_PROMPT_PRESET_ID;
    const presetDisabled = isBuiltinPreset ? " disabled" : "";
    const promptPresetOptions = [
      `<option value="${BUILTIN_PROMPT_PRESET_ID}"${selectedPresetId === BUILTIN_PROMPT_PRESET_ID ? " selected" : ""}>${t("promptPreset.defaultName")}</option>`,
      ...Object.values(settings.promptPresets).sort((a, b) => a.createdAt - b.createdAt).map(
        (preset) => `<option value="${escapeXml(preset.id)}"${preset.id === selectedPresetId ? " selected" : ""}>${escapeXml(preset.name)}</option>`
      )
    ].join("");
    return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.promptTuning.title")}</h3>
              <p class="da-card-copy">${t("card.promptTuning.copy")}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t("label.briefTokenCap")}</span>
              <input type="number" class="da-input" data-da-field="briefTokenCap" value="${settings.briefTokenCap}" />
            </label>
            <label class="da-toggle">
              <input type="checkbox" data-da-field="postReviewEnabled"${settings.postReviewEnabled ? " checked" : ""} />
              <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
              <span>${t("label.postReview")}</span>
            </label>
            <label class="da-toggle">
              <input type="checkbox" data-da-field="embeddingsEnabled"${settings.embeddingsEnabled ? " checked" : ""} />
              <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
              <span>${t("label.embeddings")}</span>
            </label>
          </div>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.promptPresets.title")}</h3>
              <p class="da-card-copy">${t("card.promptPresets.copy")}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t("label.promptPreset")}</span>
              <select class="da-select" data-da-role="prompt-preset-select">${promptPresetOptions}</select>
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="create-prompt-preset">${t("btn.newPromptPreset")}</button>
              <button class="da-btn da-btn--danger" data-da-action="delete-prompt-preset"${isBuiltinPreset ? " disabled" : ""}>${t("btn.deletePromptPreset")}</button>
            </div>
            ${isBuiltinPreset ? `<p class="da-hint">${t("promptPreset.readOnlyHint")}</p>` : ""}
            <label class="da-label">
              <span class="da-label-text">${t("label.promptPresetName")}</span>
              <input type="text" class="da-input" data-da-role="prompt-preset-name" value="${escapeXml(isBuiltinPreset ? t("promptPreset.defaultName") : selectedPreset.name)}"${presetDisabled} />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.preRequestSystemTemplate")}</span>
              <textarea class="da-textarea" data-da-role="prompt-pre-request-system"${presetDisabled}>${escapeXml(selectedPreset.preset.preRequestSystemTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.preRequestUserTemplate")}</span>
              <textarea class="da-textarea" data-da-role="prompt-pre-request-user"${presetDisabled}>${escapeXml(selectedPreset.preset.preRequestUserTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.postResponseSystemTemplate")}</span>
              <textarea class="da-textarea" data-da-role="prompt-post-response-system"${presetDisabled}>${escapeXml(selectedPreset.preset.postResponseSystemTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.postResponseUserTemplate")}</span>
              <textarea class="da-textarea" data-da-role="prompt-post-response-user"${presetDisabled}>${escapeXml(selectedPreset.preset.postResponseUserTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.maxRecentMessages")}</span>
              <input type="number" class="da-input" data-da-role="prompt-max-recent-messages" value="${selectedPreset.preset.maxRecentMessages}"${presetDisabled} />
            </label>
          </div>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.timingLimits.title")}</h3>
              <p class="da-card-copy">${t("card.timingLimits.copy")}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t("label.cooldownFailures")}</span>
              <input type="number" class="da-input" data-da-field="cooldownFailureThreshold" value="${settings.cooldownFailureThreshold}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.cooldownMs")}</span>
              <input type="number" class="da-input" data-da-field="cooldownMs" value="${settings.cooldownMs}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.outputDebounceMs")}</span>
              <input type="number" class="da-input" data-da-field="outputDebounceMs" value="${settings.outputDebounceMs}" />
            </label>
          </div>
        </section>
      </div>`;
  }
  function buildModelSettingsPage(input) {
    const { settings, modelOptions } = input;
    const modelOptionEls = modelOptions.map(
      (m) => `<option value="${escapeXml(m)}"${m === settings.directorModel ? " selected" : ""}>${escapeXml(m)}</option>`
    ).join("");
    const embeddingProviderOptionEls = EMBEDDING_PROVIDER_CATALOG.map(
      (entry) => `<option value="${entry.id}"${settings.embeddingProvider === entry.id ? " selected" : ""}>${embeddingProviderLabel(entry.id)}</option>`
    ).join("");
    const embeddingSection = `
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.embeddingSettings.title")}</h3>
              <p class="da-card-copy">${t("card.embeddingSettings.copy")}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingProvider")}</span>
              <select class="da-select" data-da-field="embeddingProvider">${embeddingProviderOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingBaseUrl")}</span>
              <input type="text" class="da-input" data-da-field="embeddingBaseUrl" value="${escapeXml(settings.embeddingBaseUrl)}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingApiKey")}</span>
              <input type="password" class="da-input" data-da-field="embeddingApiKey" value="${escapeXml(settings.embeddingApiKey)}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingModel")}</span>
              <input type="text" class="da-input" data-da-field="embeddingModel" value="${escapeXml(settings.embeddingModel)}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingDimensions")}</span>
              <input type="number" class="da-input" data-da-field="embeddingDimensions" value="${settings.embeddingDimensions}" />
            </label>
          </div>
        </section>`;
    return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.directorModel.title")}</h3>
              <p class="da-card-copy">${t("card.directorModel.copy")}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t("label.provider")}</span>
              <select class="da-select" data-da-field="directorProvider">
                <option value="openai"${settings.directorProvider === "openai" ? " selected" : ""}>${t("option.openai")}</option>
                <option value="anthropic"${settings.directorProvider === "anthropic" ? " selected" : ""}>${t("option.anthropic")}</option>
                <option value="google"${settings.directorProvider === "google" ? " selected" : ""}>${t("option.google")}</option>
                <option value="copilot"${settings.directorProvider === "copilot" ? " selected" : ""}>${t("option.copilot")}</option>
                <option value="vertex"${settings.directorProvider === "vertex" ? " selected" : ""}>${t("option.vertex")}</option>
                <option value="custom"${settings.directorProvider === "custom" ? " selected" : ""}>${t("option.custom")}</option>
              </select>
            </label>
            <div class="da-split">
              <label class="da-label">
                <span class="da-label-text">${t("label.baseUrl")}</span>
                <input type="text" class="da-input" data-da-field="directorBaseUrl" value="${escapeXml(settings.directorBaseUrl)}" />
              </label>
              <label class="da-label">
                <span class="da-label-text">${t("label.apiKey")}</span>
                <input type="password" class="da-input" data-da-field="directorApiKey" value="${escapeXml(settings.directorApiKey)}" />
              </label>
            </div>
            <label class="da-label">
              <span class="da-label-text">${t("label.model")}</span>
              <select class="da-select" data-da-field="directorModel">${modelOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.customModelId")}</span>
              <input type="text" class="da-input" data-da-field="directorModel" value="${escapeXml(settings.directorModel)}" placeholder="${t("placeholder.customModelId")}" />
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="test-connection">${t("btn.testConnection")}</button>
              <button class="da-btn" data-da-action="refresh-models">${t("btn.refreshModels")}</button>
            </div>
          </div>
        </section>${embeddingSection}
      </div>`;
  }
  function formatTimestamp(ts) {
    if (ts === 0) return t("memoryOps.neverRun");
    return new Date(ts).toLocaleString();
  }
  function freshnessLabel(freshness) {
    switch (freshness) {
      case "current":
        return t("memoryOps.freshnessCurrent");
      case "stale":
        return t("memoryOps.freshnessStale");
      default:
        return t("memoryOps.freshnessUnknown");
    }
  }
  function buildMemoryOpsCard(status) {
    const { documentCounts: dc } = status;
    const freshnessBadge = `<span class="da-badge" data-kind="${status.notebookFreshness === "stale" ? "error" : status.notebookFreshness === "current" ? "success" : "neutral"}">${freshnessLabel(status.notebookFreshness)}</span>`;
    const lockedHtml = status.isMemoryLocked ? `<div class="da-warning" data-da-role="memory-locked"><span class="da-badge" data-kind="error">${escapeXml(t("memoryOps.locked"))}</span></div>` : "";
    const staleHtml = status.staleWarnings.length > 0 ? `<div class="da-warning-list" data-da-role="stale-warnings">${status.staleWarnings.map((w) => `<div class="da-warning-item">${escapeXml(w)}</div>`).join("")}</div>` : "";
    const fallbackLabel = status.fallbackRetrievalEnabled ? t("memoryOps.fallbackEnabled") : t("memoryOps.fallbackDisabled");
    const recalledHtml = status.recalledDocs.length > 0 ? `<ul class="da-recalled-list" data-da-role="recalled-docs">${status.recalledDocs.map((d) => {
      const badge = d.freshness !== "current" ? ` <span class="da-badge da-badge--sm" data-kind="${d.freshness === "stale" ? "error" : "neutral"}">${escapeXml(d.freshness)}</span>` : "";
      return `<li class="da-recalled-item">${escapeXml(d.title)}${badge}</li>`;
    }).join("")}</ul>` : "";
    return `
        <section class="da-card" data-da-role="memory-ops-status">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.memoryOps.title")}</h3>
              <p class="da-card-copy">${t("card.memoryOps.copy")}</p>
            </div>
            ${freshnessBadge}
          </div>
          ${lockedHtml}${staleHtml}
          <ul class="da-metric-list">
            <li class="da-metric-item"><span>${t("memoryOps.lastExtract")}</span><strong>${formatTimestamp(status.lastExtractTs)}</strong></li>
            <li class="da-metric-item"><span>${t("memoryOps.lastDream")}</span><strong>${formatTimestamp(status.lastDreamTs)}</strong></li>
            <li class="da-metric-item"><span>${t("memoryOps.docCounts")}</span><strong>${t("card.memorySummaries.title")}: ${dc.summaries} \xB7 ${t("card.continuityFacts.title")}: ${dc.continuityFacts} \xB7 ${t("card.worldFacts.title")}: ${dc.worldFacts} \xB7 ${t("card.entities.title")}: ${dc.entities} \xB7 ${t("card.relations.title")}: ${dc.relations}</strong></li>
            <li class="da-metric-item"><span>${fallbackLabel}</span></li>
          </ul>
          <div class="da-inline">
            <button class="da-btn da-btn--primary da-btn--sm" data-da-action="force-extract">${t("btn.forceExtract")}</button>
            <button class="da-btn da-btn--sm" data-da-action="force-dream">${t("btn.forceDream")}</button>
            <button class="da-btn da-btn--sm" data-da-action="inspect-recalled">${t("btn.inspectRecalled")}</button>
            <button class="da-btn da-btn--sm" data-da-action="toggle-fallback-retrieval">${t("btn.toggleFallback")}</button>
          </div>
          ${recalledHtml}
        </section>`;
  }
  function buildMemoryCachePage(input) {
    const { pluginState } = input;
    const summaries = pluginState.memory.summaries;
    const facts = pluginState.memory.continuityFacts;
    const worldFacts = pluginState.memory.worldFacts;
    const entities = pluginState.memory.entities;
    const relations = pluginState.memory.relations;
    const selectedKeys = new Set(input.selectedMemoryKeys ?? []);
    const editingMemory = input.editingMemory ?? null;
    const isEmpty = summaries.length === 0 && facts.length === 0 && worldFacts.length === 0 && entities.length === 0 && relations.length === 0;
    const selectedCount = selectedKeys.size;
    const backfillHtml = `<div class="da-inline"><button class="da-btn da-btn--primary" data-da-action="backfill-current-chat">${t("btn.backfillCurrentChat")}</button></div>`;
    const regenerateHtml = `<div class="da-inline"><button class="da-btn" data-da-action="regenerate-current-chat">${t("btn.regenerateCurrentChat")}</button></div>`;
    const bulkDeleteHtml = `<div class="da-inline"><button class="da-btn da-btn--danger" data-da-action="bulk-delete-memory"${selectedCount === 0 ? " disabled" : ""}>${t("btn.deleteSelected")}</button></div>`;
    const filterHtml = `<input type="text" class="da-input" data-da-role="memory-filter" placeholder="${t("memory.filterPlaceholder")}" />`;
    const addSummaryHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-summary-text" placeholder="${t("memory.addSummaryPlaceholder")}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-summary">${t("btn.add")}</button></div>`;
    const addFactHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-fact-text" placeholder="${t("memory.addFactPlaceholder")}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-continuity-fact">${t("btn.add")}</button></div>`;
    const addWorldFactHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-world-fact-text" placeholder="${t("memory.addWorldFactPlaceholder")}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-world-fact">${t("btn.add")}</button></div>`;
    const addEntityHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-entity-name" placeholder="${t("memory.addEntityNamePlaceholder")}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-entity">${t("btn.add")}</button></div>`;
    const addRelationHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-relation-source" placeholder="${t("memory.addRelationSourcePlaceholder")}" /><input type="text" class="da-input da-input--add" data-da-role="add-relation-label" placeholder="${t("memory.addRelationLabelPlaceholder")}" /><input type="text" class="da-input da-input--add" data-da-role="add-relation-target" placeholder="${t("memory.addRelationTargetPlaceholder")}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-relation">${t("btn.add")}</button></div>`;
    function renderMemoryItem(kind, id, displayText, deleteAction, editRole, editValue, extraEditFields = "") {
      const itemKey = `${kind}:${id}`;
      const checked = selectedKeys.has(itemKey) ? " checked" : "";
      const isEditing = editingMemory?.kind === kind && editingMemory.id === id;
      if (isEditing) {
        return `<li class="da-memory-item">
        <input type="checkbox" data-da-role="memory-select" data-da-item-key="${escapeXml(itemKey)}"${checked} />
        <div class="da-form-grid" style="flex:1">
          <input type="text" class="da-input" data-da-role="${editRole}" data-da-item-id="${escapeXml(id)}" value="${escapeXml(editValue)}" />
          ${extraEditFields}
        </div>
        <button class="da-btn da-btn--primary da-btn--sm" data-da-action="save-memory-edit" data-da-item-key="${escapeXml(itemKey)}">${t("btn.save")}</button>
        <button class="da-btn da-btn--sm" data-da-action="cancel-memory-edit" data-da-item-key="${escapeXml(itemKey)}">${t("btn.cancel")}</button>
      </li>`;
      }
      return `<li class="da-memory-item">
      <input type="checkbox" data-da-role="memory-select" data-da-item-key="${escapeXml(itemKey)}"${checked} />
      <span>${escapeXml(displayText)}</span>
      <button class="da-btn da-btn--sm" data-da-action="edit-memory-item" data-da-item-key="${escapeXml(itemKey)}">${t("btn.edit")}</button>
      <button class="da-btn da-btn--danger da-btn--sm" data-da-action="${deleteAction}" data-da-item-id="${escapeXml(id)}">${t("btn.delete")}</button>
    </li>`;
    }
    const summaryItems = summaries.map(
      (s) => renderMemoryItem(
        "summary",
        s.id,
        s.text,
        "delete-summary",
        "edit-summary-text",
        s.text
      )
    ).join("");
    const factItems = facts.map(
      (f) => renderMemoryItem(
        "continuity-fact",
        f.id,
        f.text,
        "delete-continuity-fact",
        "edit-continuity-fact-text",
        f.text
      )
    ).join("");
    const worldFactItems = worldFacts.map(
      (w) => renderMemoryItem(
        "world-fact",
        w.id,
        w.text,
        "delete-world-fact",
        "edit-world-fact-text",
        w.text
      )
    ).join("");
    const entityItems = entities.map(
      (e) => renderMemoryItem(
        "entity",
        e.id,
        e.name,
        "delete-entity",
        "edit-entity-name",
        e.name
      )
    ).join("");
    const relationItems = relations.map(
      (r) => renderMemoryItem(
        "relation",
        r.id,
        `${r.sourceId} \u2192 ${r.label} \u2192 ${r.targetId}`,
        "delete-relation",
        "edit-relation-source",
        r.sourceId,
        `<div class="da-inline">
          <input type="text" class="da-input" data-da-role="edit-relation-label" data-da-item-id="${escapeXml(r.id)}" value="${escapeXml(r.label)}" />
          <input type="text" class="da-input" data-da-role="edit-relation-target" data-da-item-id="${escapeXml(r.id)}" value="${escapeXml(r.targetId)}" />
        </div>`
      )
    ).join("");
    const emptyHintHtml = isEmpty ? `<p class="da-empty" data-da-role="memory-empty">${t("memory.emptyHint")}</p>` : "";
    const memoryOpsCardHtml = input.memoryOpsStatus ? buildMemoryOpsCard(input.memoryOpsStatus) : "";
    return `
      ${backfillHtml}${regenerateHtml}${bulkDeleteHtml}${filterHtml}${emptyHintHtml}
      ${memoryOpsCardHtml}
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.memorySummaries.title")}</h3>
            </div>
          </div>${summaryItems ? `
          <ul class="da-memory-list">${summaryItems}</ul>` : ""}
          ${addSummaryHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.continuityFacts.title")}</h3>
            </div>
          </div>${factItems ? `
          <ul class="da-memory-list">${factItems}</ul>` : ""}
          ${addFactHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.worldFacts.title")}</h3>
            </div>
          </div>${worldFactItems ? `
          <ul class="da-memory-list">${worldFactItems}</ul>` : ""}
          ${addWorldFactHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.entities.title")}</h3>
            </div>
          </div>${entityItems ? `
          <ul class="da-memory-list">${entityItems}</ul>` : ""}
          ${addEntityHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.relations.title")}</h3>
            </div>
          </div>${relationItems ? `
          <ul class="da-memory-list">${relationItems}</ul>` : ""}
          ${addRelationHtml}
        </section>
      </div>`;
  }
  function buildSettingsProfilesPage(input) {
    const { profiles } = input;
    const profileItems = profiles.profiles.map((p) => {
      const active = p.id === profiles.activeProfileId ? " da-profile--active" : "";
      return `<li class="da-profile-item${active}" data-da-profile-id="${p.id}">${profileDisplayName(p.id, p.name)}</li>`;
    }).join("");
    return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.settingsProfiles.title")}</h3>
              <p class="da-card-copy">${t("card.settingsProfiles.copy")}</p>
            </div>
          </div>
          <ul class="da-profile-list">${profileItems}</ul>
          <div class="da-inline">
            <button class="da-btn da-btn--primary" data-da-action="create-profile">${t("btn.newProfile")}</button>
            <button class="da-btn" data-da-action="export-profile">${t("btn.export")}</button>
            <button class="da-btn" data-da-action="import-profile">${t("btn.import")}</button>
          </div>
        </section>
      </div>`;
  }
  var PAGE_BUILDERS = {
    general: buildGeneralPage,
    "prompt-tuning": buildPromptTuningPage,
    "model-settings": buildModelSettingsPage,
    "memory-cache": buildMemoryCachePage,
    "settings-profiles": buildSettingsProfilesPage
  };
  function buildContent(input) {
    const pages = DASHBOARD_TABS.map((tab) => {
      const hidden = tab.id !== input.activeTab ? " da-hidden" : "";
      const builder = PAGE_BUILDERS[tab.id];
      const inner = builder ? builder(input) : "";
      return `
    <div class="da-page${hidden}" id="da-page-${tab.id}">
      <h2 class="da-page-title">${tabLabel(tab.id)}</h2>${inner}
    </div>`;
    }).join("");
    return `
    <main class="da-content">
      <section class="da-toolbar">
        <div class="da-toolbar-meta">
          <div class="da-kicker">${t("toolbar.kicker")}</div>
          <strong>${t("toolbar.tagline")}</strong>
        </div>
        <div class="da-toolbar-actions">
          <span class="da-dirty-indicator">${t("dirty.unsavedHint")}</span>
          <button class="da-btn da-btn--primary" data-da-action="save-settings">${t("btn.saveChanges")}</button>
          <button class="da-btn" data-da-action="reset-settings">${t("btn.reset")}</button>
        </div>
      </section>${pages}
    </main>`;
  }
  function buildDashboardMarkup(input) {
    return `<div class="${DASHBOARD_ROOT_CLASS} da-dashboard">${buildSidebar(input.activeTab)}${buildContent(input)}
</div>`;
  }

  // src/ui/dashboardLifecycle.ts
  var DashboardLifecycle = class {
    ac = new AbortController();
    timers = [];
    callbacks = [];
    tornDown = false;
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, { ...options, signal: this.ac.signal });
    }
    setTimeout(cb, ms) {
      const id = globalThis.setTimeout(cb, ms);
      this.timers.push(id);
    }
    onTeardown(cb) {
      this.callbacks.push(cb);
    }
    teardown() {
      if (this.tornDown) return;
      this.tornDown = true;
      this.ac.abort();
      for (const id of this.timers) globalThis.clearTimeout(id);
      this.timers.length = 0;
      for (const cb of this.callbacks) cb();
      this.callbacks.length = 0;
    }
  };

  // src/director/backfill.ts
  var BACKFILL_WINDOW_MESSAGES = 8;
  var MAX_BACKFILL_ASSISTANT_TURNS = 50;
  function normalizeHostRole(role) {
    const normalized = role.trim().toLowerCase();
    if (normalized === "assistant" || normalized === "char" || normalized === "bot" || normalized === "model") {
      return "assistant";
    }
    if (normalized === "system" || normalized === "developer" || normalized === "note") {
      return "system";
    }
    if (normalized === "function" || normalized === "tool") {
      return "function";
    }
    return "user";
  }
  function buildWindowMessages(messages, assistantIndex) {
    const start = Math.max(0, assistantIndex - BACKFILL_WINDOW_MESSAGES + 1);
    return messages.slice(start, assistantIndex + 1).map((message) => ({
      role: normalizeHostRole(message.role),
      content: message.content
    }));
  }
  function findLatestUserText(messages, assistantIndex) {
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (normalizeHostRole(messages[index].role) === "user") {
        return messages[index].content;
      }
    }
    return "";
  }
  function buildBackfillBrief(state) {
    return {
      confidence: 0.5,
      pacing: state.director.pacingMode,
      beats: [],
      continuityLocks: [],
      ensembleWeights: {},
      styleInheritance: {},
      forbiddenMoves: [],
      memoryHints: []
    };
  }
  async function backfillCurrentChat(api, stateStore) {
    const chat = await tryGetChat(api);
    if (!chat) {
      return {
        totalAssistantTurns: 0,
        processedTurns: 0,
        appliedUpdates: 0,
        warnings: ["Current chat is unavailable for backfill."]
      };
    }
    const assistantIndexes = chat.messages.map(
      (message, index) => normalizeHostRole(message.role) === "assistant" ? index : -1
    ).filter((index) => index >= 0).slice(-MAX_BACKFILL_ASSISTANT_TURNS);
    if (assistantIndexes.length === 0) {
      return {
        totalAssistantTurns: 0,
        processedTurns: 0,
        appliedUpdates: 0,
        warnings: ["Current chat has no assistant turns to extract."]
      };
    }
    let state = await stateStore.load();
    const service = createDirectorService(api, state.settings);
    const warnings = [];
    let processedTurns = 0;
    let appliedUpdates = 0;
    await api.log(
      `[director-plugin] Backfill started for ${String(assistantIndexes.length)} assistant turns.`
    );
    for (const assistantIndex of assistantIndexes) {
      await api.log(
        `[director-plugin] Backfill progress ${String(processedTurns + 1)}/${String(assistantIndexes.length)}.`
      );
      const messages = buildWindowMessages(chat.messages, assistantIndex);
      const responseText = messages[messages.length - 1]?.content ?? "";
      const brief = buildBackfillBrief(state);
      const result = await service.postResponse({
        responseText,
        brief,
        messages,
        directorState: state.director,
        memory: state.memory,
        assertiveness: state.settings.assertiveness,
        promptPreset: resolvePromptPreset(state.settings)
      });
      processedTurns += 1;
      if (!result.ok) {
        warnings.push(result.error);
        continue;
      }
      const applied = applyMemoryUpdate(state, result.update, {
        turnId: `backfill-turn-${assistantIndex}`,
        userText: findLatestUserText(chat.messages, assistantIndex),
        actorText: responseText,
        brief
      });
      state = applied.state;
      state.updatedAt = Date.now();
      state.metrics.totalDirectorCalls += 1;
      state.metrics.totalMemoryWrites += 1;
      state.metrics.lastUpdatedAt = state.updatedAt;
      warnings.push(...applied.warnings);
      appliedUpdates += 1;
      await stateStore.save(state);
    }
    return {
      totalAssistantTurns: assistantIndexes.length,
      processedTurns,
      appliedUpdates,
      warnings
    };
  }

  // src/ui/dashboardApp.ts
  var TOAST_DURATION_MS = 2500;
  var PROFILE_ID_PREFIX = "user-profile-";
  var IMPORT_STAGING_KEY = "dashboard-profile-import-staging";
  var activeInstance = null;
  function createDashboardStore(api, canonicalWriteFirst, stateStorageKey) {
    const store = {
      storage: api.pluginStorage
    };
    if (stateStorageKey !== void 0) {
      store.stateStorageKey = stateStorageKey;
    }
    if (canonicalWriteFirst) {
      store.mirrorToCanonical = async (settings) => {
        await canonicalWriteFirst(
          (s) => mergeDashboardSettingsIntoPluginState(s, settings)
        );
      };
      store.writeCanonical = canonicalWriteFirst;
    }
    return store;
  }
  async function readCanonicalState(store) {
    if (store.readCanonical) {
      return structuredClone(await store.readCanonical());
    }
    const key = store.stateStorageKey ?? DIRECTOR_STATE_STORAGE_KEY;
    const raw = await store.storage.getItem(key);
    if (!raw) {
      return createEmptyState();
    }
    const state = structuredClone(raw);
    patchLegacyMemory(state);
    return state;
  }
  function computeLatestMemoryTs(state) {
    let latest = 0;
    for (const s of state.memory.summaries) latest = Math.max(latest, s.updatedAt ?? 0);
    for (const w of state.memory.worldFacts) latest = Math.max(latest, w.updatedAt ?? 0);
    for (const e of state.memory.entities) latest = Math.max(latest, e.updatedAt ?? 0);
    for (const r of state.memory.relations) latest = Math.max(latest, r.updatedAt ?? 0);
    return latest;
  }
  function buildStaleWarnings(lastExtractTs, lastDreamTs) {
    const warnings = [];
    const now = Date.now();
    const STALE_MS = 24 * 60 * 60 * 1e3;
    if (lastExtractTs > 0 && now - lastExtractTs > STALE_MS) {
      warnings.push(t("memoryOps.staleExtract"));
    }
    if (lastDreamTs > 0 && now - lastDreamTs > STALE_MS) {
      warnings.push(t("memoryOps.staleDream"));
    }
    return warnings;
  }
  async function buildMemoryOpsStatus(store, canonicalState) {
    const dreamState = await loadDreamState(store.storage);
    const prefs = await loadMemoryOpsPrefs(store.storage);
    const isLocked = store.isMemoryLocked ? await store.isMemoryLocked() : false;
    const latestMemoryTs = computeLatestMemoryTs(canonicalState);
    return {
      lastExtractTs: latestMemoryTs,
      lastDreamTs: dreamState.lastDreamTs,
      notebookFreshness: computeNotebookFreshness(latestMemoryTs, dreamState.lastDreamTs),
      documentCounts: computeDocumentCounts(canonicalState.memory),
      fallbackRetrievalEnabled: prefs.fallbackRetrievalEnabled,
      isMemoryLocked: isLocked,
      staleWarnings: buildStaleWarnings(latestMemoryTs, dreamState.lastDreamTs),
      recalledDocs: []
    };
  }
  var DashboardInstance = class {
    api;
    store;
    lifecycle = new DashboardLifecycle();
    doc;
    draft;
    profiles;
    activeTab;
    modelOptions;
    connectionStatus;
    root = null;
    canonicalState;
    selectedMemoryKeys = /* @__PURE__ */ new Set();
    editingMemory = null;
    memoryOpsStatus;
    constructor(api, store, doc, draft, profiles, modelOptions, canonicalState, memoryOpsStatus) {
      this.api = api;
      this.store = store;
      this.doc = doc;
      this.draft = draft;
      this.profiles = profiles;
      this.activeTab = DASHBOARD_TABS[0]?.id ?? "general";
      this.modelOptions = modelOptions;
      this.connectionStatus = { kind: "idle", message: t("connection.notTested") };
      this.canonicalState = canonicalState;
      this.memoryOpsStatus = memoryOpsStatus;
    }
    // ── public ────────────────────────────────────────────────────────────
    async mount() {
      this.injectCss();
      this.renderRoot();
      this.bindEvents();
      await this.api.showContainer("fullscreen");
    }
    async close() {
      this.lifecycle.teardown();
      this.removeDom();
      await this.api.hideContainer();
      if (activeInstance === this) activeInstance = null;
    }
    /** Return the storage key that canonical state is persisted under. */
    resolveStateKey() {
      return this.store.stateStorageKey ?? DIRECTOR_STATE_STORAGE_KEY;
    }
    // ── CSS ───────────────────────────────────────────────────────────────
    injectCss() {
      const existing = this.doc.getElementById(DASHBOARD_STYLE_ID);
      if (existing) existing.remove();
      const style = this.doc.createElement("style");
      style.id = DASHBOARD_STYLE_ID;
      style.textContent = buildDashboardCss();
      this.doc.head.appendChild(style);
      this.lifecycle.onTeardown(() => {
        const el = this.doc.getElementById(DASHBOARD_STYLE_ID);
        if (el) el.remove();
      });
    }
    // ── DOM ───────────────────────────────────────────────────────────────
    buildMarkupInput() {
      return {
        settings: this.draft.settings,
        pluginState: this.canonicalState,
        profiles: this.profiles,
        activeTab: this.activeTab,
        modelOptions: this.modelOptions,
        connectionStatus: this.connectionStatus,
        selectedMemoryKeys: Array.from(this.selectedMemoryKeys),
        editingMemory: this.editingMemory,
        memoryOpsStatus: this.memoryOpsStatus
      };
    }
    renderRoot() {
      for (const el of Array.from(this.doc.querySelectorAll(`.${DASHBOARD_ROOT_CLASS}`))) {
        el.remove();
      }
      const container = this.doc.createElement("div");
      container.innerHTML = buildDashboardMarkup(this.buildMarkupInput());
      const wrapper = container.firstElementChild;
      if (!wrapper) return;
      const sidebar = wrapper.querySelector(".da-sidebar");
      if (sidebar) {
        const closeBtn = this.doc.createElement("button");
        closeBtn.className = "da-btn da-close-btn";
        closeBtn.setAttribute("data-da-action", "close");
        closeBtn.textContent = t("btn.closeIcon");
        sidebar.appendChild(closeBtn);
      }
      const content = wrapper.querySelector(".da-content");
      if (content) {
        const footer = this.doc.createElement("div");
        footer.className = "da-footer";
        footer.innerHTML = this.buildFooterHtml();
        content.appendChild(footer);
      }
      this.doc.body.appendChild(wrapper);
      this.root = wrapper;
      this.lifecycle.onTeardown(() => {
        this.removeDom();
      });
    }
    buildFooterHtml() {
      const dirtyClass = this.draft.isDirty ? "" : " da-hidden";
      return [
        `<span class="da-dirty-indicator${dirtyClass}" data-da-role="dirty">${t("dirty.unsavedChanges")}</span>`,
        `<div style="display:flex;gap:8px;margin-left:auto">`,
        `  <button class="da-btn" data-da-action="discard">${t("btn.discard")}</button>`,
        `  <button class="da-btn da-btn--primary" data-da-action="save">${t("btn.save")}</button>`,
        `</div>`
      ].join("\n");
    }
    removeDom() {
      if (this.root?.parentNode) {
        this.root.parentNode.removeChild(this.root);
        this.root = null;
      }
    }
    // ── Re-render helpers ─────────────────────────────────────────────────
    fullReRender() {
      if (!this.root) return;
      const parent = this.root.parentNode;
      if (!parent) return;
      this.root.remove();
      const container = this.doc.createElement("div");
      container.innerHTML = buildDashboardMarkup(this.buildMarkupInput());
      const wrapper = container.firstElementChild;
      if (!wrapper) return;
      const sidebar = wrapper.querySelector(".da-sidebar");
      if (sidebar) {
        const closeBtn = this.doc.createElement("button");
        closeBtn.className = "da-btn da-close-btn";
        closeBtn.setAttribute("data-da-action", "close");
        closeBtn.textContent = t("btn.closeIcon");
        sidebar.appendChild(closeBtn);
      }
      const content = wrapper.querySelector(".da-content");
      if (content) {
        const footer = this.doc.createElement("div");
        footer.className = "da-footer";
        footer.innerHTML = this.buildFooterHtml();
        content.appendChild(footer);
      }
      parent.appendChild(wrapper);
      this.root = wrapper;
      this.bindEvents();
    }
    updateConnectionStatusDom() {
      if (!this.root) return;
      const el = this.root.querySelector(".da-connection-status");
      if (!el) return;
      el.setAttribute("data-da-status", this.connectionStatus.kind);
      el.textContent = this.connectionStatus.message;
    }
    updateModelSelectDom() {
      if (!this.root) return;
      const sel = this.root.querySelector(
        'select[data-da-field="directorModel"]'
      );
      if (!sel) return;
      sel.innerHTML = this.modelOptions.map(
        (m) => `<option value="${escapeXml(m)}"${m === this.draft.settings.directorModel ? " selected" : ""}>${escapeXml(m)}</option>`
      ).join("");
    }
    updateDirtyIndicator() {
      if (!this.root) return;
      const indicator = this.root.querySelector('[data-da-role="dirty"]');
      if (indicator) {
        indicator.classList.toggle("da-hidden", !this.draft.isDirty);
      }
    }
    getSelectedPromptPreset() {
      return resolveSelectedPromptPreset(this.draft.settings);
    }
    getSelectedCustomPromptPreset() {
      if (this.draft.settings.promptPresetId === BUILTIN_PROMPT_PRESET_ID) {
        return null;
      }
      return this.draft.settings.promptPresets[this.draft.settings.promptPresetId] ?? null;
    }
    markDirty() {
      this.draft.isDirty = true;
      this.updateDirtyIndicator();
    }
    // ── Event binding ─────────────────────────────────────────────────────
    bindEvents() {
      if (!this.root) return;
      this.lifecycle.listen(this.root, "click", (e) => {
        const target = e.target;
        this.handleTabClick(target);
        void this.handleActionClick(target);
        this.handleProfileSelect(target);
      });
      this.lifecycle.listen(this.root, "change", (e) => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.getAttribute("data-da-role") === "memory-select") {
          this.handleMemorySelectionChange(target);
          return;
        }
        if (target instanceof HTMLSelectElement && target.getAttribute("data-da-role") === "prompt-preset-select") {
          this.handlePromptPresetSelect(target.value);
          return;
        }
        this.handleFieldChange(target);
      });
      this.lifecycle.listen(this.root, "input", (e) => {
        const el = e.target;
        if (el instanceof HTMLInputElement && el.getAttribute("data-da-role") === "memory-filter") {
          this.handleMemoryFilter(el.value);
          return;
        }
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && typeof el.getAttribute("data-da-role") === "string" && el.getAttribute("data-da-role")?.startsWith("prompt-")) {
          this.handlePromptPresetInput(el);
          return;
        }
        if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "password" || el.type === "number")) {
          this.handleFieldChange(el);
        }
      });
    }
    handleTabClick(target) {
      const btn = target.closest("[data-da-target]");
      if (!btn) return;
      const tabId = btn.getAttribute("data-da-target");
      if (!tabId) return;
      this.activeTab = tabId;
      if (this.root) {
        for (const b of Array.from(this.root.querySelectorAll(".da-sidebar-btn"))) {
          b.classList.toggle(
            "da-sidebar-btn--active",
            b.getAttribute("data-da-target") === tabId
          );
        }
      }
      if (this.root) {
        for (const page of Array.from(this.root.querySelectorAll(".da-page"))) {
          const pageId = page.id.replace("da-page-", "");
          page.classList.toggle("da-hidden", pageId !== tabId);
        }
      }
    }
    async handleActionClick(target) {
      const btn = target.closest("[data-da-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-da-action");
      switch (action) {
        case "close":
          await this.close();
          break;
        case "save":
          await this.handleSave();
          break;
        case "discard":
          await this.handleDiscard();
          break;
        case "test-connection":
          await this.handleTestConnection();
          break;
        case "refresh-models":
          await this.handleRefreshModels();
          break;
        case "create-profile":
          await this.handleCreateProfile();
          break;
        case "export-profile":
          await this.handleExportProfile();
          break;
        case "import-profile":
          await this.handleImportProfile();
          break;
        case "create-prompt-preset":
          this.handleCreatePromptPreset();
          break;
        case "delete-prompt-preset":
          this.handleDeletePromptPreset();
          break;
        case "backfill-current-chat":
          await this.handleBackfillCurrentChat();
          break;
        case "regenerate-current-chat":
          await this.handleRegenerateCurrentChat();
          break;
        case "bulk-delete-memory":
          await this.handleBulkDeleteMemory();
          break;
        case "edit-memory-item":
          this.handleEditMemoryItem(btn);
          break;
        case "save-memory-edit":
          await this.handleSaveMemoryEdit(btn);
          break;
        case "cancel-memory-edit":
          this.handleCancelMemoryEdit();
          break;
        case "switch-lang":
          await this.handleSwitchLang(btn);
          break;
        case "delete-summary":
          await this.handleDeleteMemoryItem(btn, "summary");
          break;
        case "delete-continuity-fact":
          await this.handleDeleteMemoryItem(btn, "continuity-fact");
          break;
        case "add-summary":
          await this.handleAddMemoryItem("summary");
          break;
        case "add-continuity-fact":
          await this.handleAddMemoryItem("continuity-fact");
          break;
        case "delete-world-fact":
          await this.handleDeleteMemoryItem(btn, "world-fact");
          break;
        case "add-world-fact":
          await this.handleAddMemoryItem("world-fact");
          break;
        case "delete-entity":
          await this.handleDeleteMemoryItem(btn, "entity");
          break;
        case "add-entity":
          await this.handleAddMemoryItem("entity");
          break;
        case "delete-relation":
          await this.handleDeleteMemoryItem(btn, "relation");
          break;
        case "add-relation":
          await this.handleAddRelation();
          break;
        case "force-extract":
          await this.handleForceExtract();
          break;
        case "force-dream":
          await this.handleForceDream();
          break;
        case "inspect-recalled":
          await this.handleInspectRecalled();
          break;
        case "toggle-fallback-retrieval":
          await this.handleToggleFallbackRetrieval();
          break;
      }
    }
    handleProfileSelect(target) {
      const item = target.closest(".da-profile-item");
      if (!item) return;
      if (target.closest("[data-da-action]")) return;
      const profileId = item.getAttribute("data-da-profile-id");
      if (!profileId) return;
      this.selectProfile(profileId);
    }
    handleFieldChange(el) {
      const field = el.getAttribute("data-da-field");
      if (!field) return;
      if (!(field in this.draft.settings)) return;
      const key = field;
      let value;
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox") {
          value = el.checked;
        } else if (el.type === "number") {
          value = Number(el.value);
        } else {
          value = el.value;
        }
      } else if (el instanceof HTMLSelectElement) {
        value = el.value;
      } else {
        return;
      }
      const defaults = DEFAULT_DIRECTOR_SETTINGS;
      if (typeof defaults[key] === typeof value) {
        ;
        this.draft.settings[key] = value;
        this.markDirty();
      }
      if (key === "directorProvider") {
        const providerDefaults = resolveProviderDefaults(
          value
        );
        this.draft.settings.directorBaseUrl = providerDefaults.baseUrl;
        this.modelOptions = Array.from(
          /* @__PURE__ */ new Set([
            this.draft.settings.directorModel,
            ...providerDefaults.curatedModels
          ])
        );
        this.markDirty();
        const baseUrlInput = this.root?.querySelector(
          '[data-da-field="directorBaseUrl"]'
        );
        if (baseUrlInput) {
          baseUrlInput.value = providerDefaults.baseUrl;
        }
        this.updateModelSelectDom();
      }
      if (key === "embeddingProvider") {
        const providerDefaults = resolveEmbeddingDefaults(
          value
        );
        this.draft.settings.embeddingBaseUrl = providerDefaults.baseUrl;
        this.markDirty();
        const baseUrlInput = this.root?.querySelector(
          '[data-da-field="embeddingBaseUrl"]'
        );
        if (baseUrlInput) {
          baseUrlInput.value = providerDefaults.baseUrl;
        }
      }
    }
    // ── Save / Discard ────────────────────────────────────────────────────
    async handleSave() {
      await this.store.storage.setItem(
        DASHBOARD_SETTINGS_KEY,
        structuredClone(this.draft.settings)
      );
      await this.store.storage.setItem(
        DASHBOARD_PROFILE_MANIFEST_KEY,
        structuredClone(this.profiles)
      );
      if (this.store.mirrorToCanonical) {
        await this.store.mirrorToCanonical(this.draft.settings);
      }
      this.draft.isDirty = false;
      this.updateDirtyIndicator();
      this.showToast(t("toast.settingsSaved"));
    }
    async handleDiscard() {
      const raw = await this.store.storage.getItem(
        DASHBOARD_SETTINGS_KEY
      );
      this.draft = createDashboardDraft(
        normalizePersistedSettings(raw ?? {})
      );
      this.fullReRender();
      this.showToast(t("toast.changesDiscarded"));
    }
    // ── Connection status helpers ────────────────────────────────────────
    /** Re-derive a localized message from `kind`, preserving raw error text. */
    localizedConnectionMessage() {
      switch (this.connectionStatus.kind) {
        case "idle":
          return t("connection.notTested");
        case "testing":
          return t("connection.testing");
        case "ok":
          return t("connection.connected", { count: String(this.modelOptions.length) });
        default:
          return this.connectionStatus.message;
      }
    }
    // ── Connection test ───────────────────────────────────────────────────
    async handleTestConnection() {
      this.connectionStatus = { kind: "testing", message: t("connection.testing") };
      this.updateConnectionStatusDom();
      const result = await testDirectorConnection(
        this.api,
        this.draft.settings
      );
      if (result.ok) {
        this.connectionStatus = {
          kind: "ok",
          message: t("connection.connected", { count: String(result.models.length) })
        };
        this.modelOptions = result.models;
        this.updateModelSelectDom();
      } else {
        this.connectionStatus = {
          kind: "error",
          message: result.error
        };
      }
      this.updateConnectionStatusDom();
    }
    async handleRefreshModels() {
      try {
        const models = await loadProviderModels(this.api, this.draft.settings);
        this.modelOptions = models.includes(this.draft.settings.directorModel) ? models : [this.draft.settings.directorModel, ...models];
        this.updateModelSelectDom();
      } catch (error) {
        this.connectionStatus = {
          kind: "error",
          message: error instanceof Error ? error.message : String(error)
        };
        this.updateConnectionStatusDom();
      }
    }
    // ── Profile flows ─────────────────────────────────────────────────────
    async handleCreateProfile() {
      const now = Date.now();
      const id = `${PROFILE_ID_PREFIX}${String(now)}-${Math.random().toString(36).slice(2, 6)}`;
      const newProfile = {
        id,
        name: t("profile.defaultName", { n: String(this.profiles.profiles.length + 1) }),
        createdAt: now,
        updatedAt: now,
        basedOn: this.profiles.activeProfileId,
        overrides: {}
      };
      this.profiles.profiles.push(newProfile);
      this.profiles.activeProfileId = id;
      this.draft.isDirty = true;
      await this.store.storage.setItem(
        DASHBOARD_PROFILE_MANIFEST_KEY,
        structuredClone(this.profiles)
      );
      this.fullReRender();
      this.showToast(t("toast.profileCreated"));
    }
    selectProfile(profileId) {
      const profile = this.profiles.profiles.find((p) => p.id === profileId);
      if (!profile) return;
      this.profiles.activeProfileId = profileId;
      const base = normalizePersistedSettings({});
      const merged = { ...base, ...profile.overrides };
      this.draft.settings = merged;
      this.draft.isDirty = true;
      this.fullReRender();
    }
    async handleExportProfile() {
      const activeProfile = this.profiles.profiles.find(
        (p) => p.id === this.profiles.activeProfileId
      );
      if (!activeProfile) {
        this.showToast(t("toast.noProfileSelected"));
        return;
      }
      const payload = createProfileExportPayload(activeProfile);
      const json = JSON.stringify(payload, null, 2);
      await this.api.alert(json);
      this.showToast(t("toast.profileExported"));
    }
    async handleImportProfile() {
      const raw = await this.store.storage.getItem(IMPORT_STAGING_KEY);
      if (!raw) {
        await this.api.alert(
          t("alert.importInstructions", { key: IMPORT_STAGING_KEY })
        );
        return;
      }
      try {
        const text = typeof raw === "string" ? raw : JSON.stringify(raw);
        const parsed = JSON.parse(text);
        if (!isValidExportPayload(parsed)) {
          await this.api.alertError(t("toast.invalidProfileFormat"));
          return;
        }
        const payload = parsed;
        const imported = { ...payload.profile };
        if (this.profiles.profiles.some((p) => p.id === imported.id)) {
          imported.id = `${PROFILE_ID_PREFIX}imported-${String(Date.now())}`;
        }
        this.profiles.profiles.push(imported);
        this.profiles.activeProfileId = imported.id;
        this.draft.isDirty = true;
        await this.store.storage.setItem(
          DASHBOARD_PROFILE_MANIFEST_KEY,
          structuredClone(this.profiles)
        );
        await this.store.storage.removeItem(IMPORT_STAGING_KEY);
        this.fullReRender();
        this.showToast(t("toast.profileImported"));
      } catch {
        await this.api.alertError(t("toast.failedParseProfile"));
      }
    }
    handlePromptPresetSelect(presetId) {
      this.draft.settings.promptPresetId = presetId === BUILTIN_PROMPT_PRESET_ID || this.draft.settings.promptPresets[presetId] != null ? presetId : BUILTIN_PROMPT_PRESET_ID;
      this.markDirty();
      this.fullReRender();
    }
    handleCreatePromptPreset() {
      const preset = createPromptPresetFromSettings(this.draft.settings);
      this.draft.settings.promptPresets[preset.id] = preset;
      this.draft.settings.promptPresetId = preset.id;
      this.markDirty();
      this.fullReRender();
    }
    handleDeletePromptPreset() {
      const current = this.getSelectedCustomPromptPreset();
      if (!current) return;
      delete this.draft.settings.promptPresets[current.id];
      this.draft.settings.promptPresetId = BUILTIN_PROMPT_PRESET_ID;
      this.markDirty();
      this.fullReRender();
    }
    handlePromptPresetInput(el) {
      const current = this.getSelectedCustomPromptPreset();
      if (!current) return;
      const role = el.getAttribute("data-da-role");
      if (!role) return;
      switch (role) {
        case "prompt-preset-name":
          current.name = el.value.trim() || current.name;
          break;
        case "prompt-pre-request-system":
          current.preset.preRequestSystemTemplate = el.value;
          break;
        case "prompt-pre-request-user":
          current.preset.preRequestUserTemplate = el.value;
          break;
        case "prompt-post-response-system":
          current.preset.postResponseSystemTemplate = el.value;
          break;
        case "prompt-post-response-user":
          current.preset.postResponseUserTemplate = el.value;
          break;
        case "prompt-max-recent-messages": {
          const numeric = Number(el.value);
          current.preset.maxRecentMessages = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : this.getSelectedPromptPreset().preset.maxRecentMessages;
          break;
        }
        default:
          return;
      }
      current.updatedAt = Date.now();
      this.markDirty();
    }
    async handleBackfillCurrentChat() {
      const resolution = await resolveScopeStorageKey(this.api);
      if (resolution.storageKey !== this.resolveStateKey()) {
        await this.api.alertError(t("error.backfillScopeMismatch"));
        return;
      }
      const result = await backfillCurrentChat(this.api, {
        load: async () => structuredClone(await readCanonicalState(this.store)),
        save: async (next) => {
          if (this.store.writeCanonical) {
            const persisted = await this.store.writeCanonical(() => structuredClone(next));
            this.canonicalState = structuredClone(persisted);
            return;
          }
          await this.store.storage.setItem(this.resolveStateKey(), structuredClone(next));
          this.canonicalState = structuredClone(next);
        }
      });
      if (!this.store.writeCanonical) {
        this.canonicalState = await readCanonicalState(this.store);
      }
      this.fullReRender();
      if (result.appliedUpdates > 0) {
        this.showToast(
          t("toast.backfillCompleted", { count: String(result.appliedUpdates) })
        );
        return;
      }
      this.showToast(t("toast.backfillSkipped"));
    }
    async handleRegenerateCurrentChat() {
      const resolution = await resolveScopeStorageKey(this.api);
      if (resolution.storageKey !== this.resolveStateKey()) {
        await this.api.alertError(t("error.backfillScopeMismatch"));
        return;
      }
      const resetCanonical = async () => {
        if (this.store.writeCanonical) {
          const persisted = await this.store.writeCanonical((current2) => {
            const empty2 = createEmptyState({
              projectKey: current2.projectKey,
              characterKey: current2.characterKey,
              sessionKey: current2.sessionKey
            });
            empty2.settings = structuredClone(current2.settings);
            return empty2;
          });
          this.canonicalState = structuredClone(persisted);
          return;
        }
        const current = await readCanonicalState(this.store);
        const empty = createEmptyState({
          projectKey: current.projectKey,
          characterKey: current.characterKey,
          sessionKey: current.sessionKey
        });
        empty.settings = structuredClone(current.settings);
        await this.store.storage.setItem(this.resolveStateKey(), structuredClone(empty));
        this.canonicalState = empty;
      };
      await resetCanonical();
      this.selectedMemoryKeys.clear();
      this.editingMemory = null;
      await this.handleBackfillCurrentChat();
    }
    handleMemorySelectionChange(input) {
      const itemKey = input.getAttribute("data-da-item-key");
      if (!itemKey) return;
      if (input.checked) {
        this.selectedMemoryKeys.add(itemKey);
      } else {
        this.selectedMemoryKeys.delete(itemKey);
      }
      const bulkDeleteBtn = this.root?.querySelector(
        '[data-da-action="bulk-delete-memory"]'
      );
      if (bulkDeleteBtn) {
        bulkDeleteBtn.disabled = this.selectedMemoryKeys.size === 0;
      }
    }
    handleEditMemoryItem(btn) {
      const itemKey = btn.getAttribute("data-da-item-key");
      if (!itemKey) return;
      const [kind, id] = itemKey.split(":", 2);
      if (!kind || !id) return;
      this.editingMemory = {
        kind,
        id
      };
      this.fullReRender();
    }
    handleCancelMemoryEdit() {
      this.editingMemory = null;
      this.fullReRender();
    }
    async handleSaveMemoryEdit(btn) {
      const itemKey = btn.getAttribute("data-da-item-key");
      if (!itemKey) return;
      const [kind, id] = itemKey.split(":", 2);
      if (!kind || !id) return;
      const row = btn.closest(".da-memory-item");
      if (!row) return;
      const applyEdit = (state) => {
        switch (kind) {
          case "summary": {
            const input = row.querySelector(
              'input[data-da-role="edit-summary-text"]'
            );
            const text = input?.value.trim() ?? "";
            if (!text) return;
            upsertSummary(state, { id, text, recencyWeight: 1 });
            break;
          }
          case "continuity-fact": {
            const input = row.querySelector(
              'input[data-da-role="edit-continuity-fact-text"]'
            );
            const text = input?.value.trim() ?? "";
            if (!text) return;
            upsertContinuityFact(state, { id, text, priority: 5 });
            break;
          }
          case "world-fact": {
            const input = row.querySelector(
              'input[data-da-role="edit-world-fact-text"]'
            );
            const text = input?.value.trim() ?? "";
            if (!text) return;
            upsertWorldFact(state, { id, text });
            break;
          }
          case "entity": {
            const input = row.querySelector(
              'input[data-da-role="edit-entity-name"]'
            );
            const name = input?.value.trim() ?? "";
            if (!name) return;
            upsertEntity(state, { id, name });
            break;
          }
          case "relation": {
            const sourceInput = row.querySelector(
              'input[data-da-role="edit-relation-source"]'
            );
            const labelInput = row.querySelector(
              'input[data-da-role="edit-relation-label"]'
            );
            const targetInput = row.querySelector(
              'input[data-da-role="edit-relation-target"]'
            );
            const sourceId = sourceInput?.value.trim() ?? "";
            const label = labelInput?.value.trim() ?? "";
            const targetId = targetInput?.value.trim() ?? "";
            if (!sourceId || !label || !targetId) return;
            upsertRelation(state, { id, sourceId, label, targetId });
            break;
          }
        }
      };
      if (this.store.writeCanonical) {
        const nextState = await this.store.writeCanonical((current) => {
          applyEdit(current);
          return current;
        });
        this.canonicalState = structuredClone(nextState);
      } else {
        const state = await readCanonicalState(this.store);
        applyEdit(state);
        await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state));
        this.canonicalState = state;
      }
      this.editingMemory = null;
      this.fullReRender();
    }
    async handleBulkDeleteMemory() {
      if (this.selectedMemoryKeys.size === 0) return;
      const applyDelete = (state) => {
        for (const itemKey of Array.from(this.selectedMemoryKeys)) {
          const [kind, id] = itemKey.split(":", 2);
          if (!kind || !id) continue;
          switch (kind) {
            case "summary":
              deleteSummary(state, id);
              break;
            case "continuity-fact":
              deleteContinuityFact(state, id);
              break;
            case "world-fact":
              deleteWorldFact(state, id);
              break;
            case "entity":
              deleteEntity(state, id);
              break;
            case "relation":
              deleteRelation(state, id);
              break;
          }
        }
      };
      if (this.store.writeCanonical) {
        const nextState = await this.store.writeCanonical((current) => {
          applyDelete(current);
          return current;
        });
        this.canonicalState = structuredClone(nextState);
      } else {
        const state = await readCanonicalState(this.store);
        applyDelete(state);
        await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state));
        this.canonicalState = state;
      }
      this.selectedMemoryKeys.clear();
      this.fullReRender();
    }
    // ── Memory filter ──────────────────────────────────────────────────────
    handleMemoryFilter(query) {
      if (!this.root) return;
      const needle = query.trim().toLowerCase();
      const items = this.root.querySelectorAll(".da-memory-item");
      for (const item of Array.from(items)) {
        const text = (item.textContent ?? "").toLowerCase();
        item.classList.toggle("da-hidden", needle !== "" && !text.includes(needle));
      }
    }
    // ── Memory delete ──────────────────────────────────────────────────────
    async handleDeleteMemoryItem(btn, kind) {
      const itemId = btn.getAttribute("data-da-item-id");
      if (!itemId) return;
      const applyDelete = (state2) => {
        switch (kind) {
          case "summary":
            deleteSummary(state2, itemId);
            break;
          case "continuity-fact":
            deleteContinuityFact(state2, itemId);
            break;
          case "world-fact":
            deleteWorldFact(state2, itemId);
            break;
          case "entity":
            deleteEntity(state2, itemId);
            break;
          case "relation":
            deleteRelation(state2, itemId);
            break;
        }
      };
      if (this.store.writeCanonical) {
        const nextState = await this.store.writeCanonical((current) => {
          applyDelete(current);
          return current;
        });
        this.canonicalState = structuredClone(nextState);
        this.fullReRender();
        return;
      }
      const state = await readCanonicalState(this.store);
      applyDelete(state);
      await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state));
      this.canonicalState = state;
      this.fullReRender();
    }
    // ── Memory add ──────────────────────────────────────────────────────
    async handleAddMemoryItem(kind) {
      if (!this.root) return;
      const inputRoleMap = {
        "summary": "add-summary-text",
        "continuity-fact": "add-fact-text",
        "world-fact": "add-world-fact-text",
        "entity": "add-entity-name"
      };
      const inputRole = inputRoleMap[kind];
      const inputEl = this.root.querySelector(
        `input[data-da-role="${inputRole}"]`
      );
      if (!inputEl) return;
      const text = inputEl.value.trim();
      if (!text) return;
      const applyAdd = (state2) => {
        switch (kind) {
          case "summary":
            upsertSummary(state2, { text, recencyWeight: 1 });
            break;
          case "continuity-fact":
            upsertContinuityFact(state2, { text, priority: 5 });
            break;
          case "world-fact":
            upsertWorldFact(state2, { text });
            break;
          case "entity":
            upsertEntity(state2, { name: text });
            break;
        }
      };
      if (this.store.writeCanonical) {
        const nextState = await this.store.writeCanonical((current) => {
          applyAdd(current);
          return current;
        });
        this.canonicalState = structuredClone(nextState);
        this.fullReRender();
        return;
      }
      const state = await readCanonicalState(this.store);
      applyAdd(state);
      await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state));
      this.canonicalState = state;
      this.fullReRender();
    }
    // ── Relation add (multi-field) ─────────────────────────────────────────
    async handleAddRelation() {
      if (!this.root) return;
      const srcEl = this.root.querySelector('input[data-da-role="add-relation-source"]');
      const labelEl = this.root.querySelector('input[data-da-role="add-relation-label"]');
      const tgtEl = this.root.querySelector('input[data-da-role="add-relation-target"]');
      if (!srcEl || !labelEl || !tgtEl) return;
      const sourceId = srcEl.value.trim();
      const label = labelEl.value.trim();
      const targetId = tgtEl.value.trim();
      if (!sourceId || !label || !targetId) return;
      if (this.store.writeCanonical) {
        const nextState = await this.store.writeCanonical((current) => {
          upsertRelation(current, { sourceId, label, targetId });
          return current;
        });
        this.canonicalState = structuredClone(nextState);
        this.fullReRender();
        return;
      }
      const state = await readCanonicalState(this.store);
      upsertRelation(state, { sourceId, label, targetId });
      await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state));
      this.canonicalState = state;
      this.fullReRender();
    }
    // ── Memory operations actions ──────────────────────────────────────
    async handleForceExtract() {
      if (!this.store.forceExtract) {
        this.showToast(t("toast.noCallback"));
        return;
      }
      try {
        await this.store.forceExtract();
      } catch (err) {
        this.showToast(t("toast.extractFailed", { error: String(err) }));
        return;
      }
      this.showToast(t("toast.extractStarted"));
      await this.refreshMemoryOpsStatus();
      this.fullReRender();
    }
    async handleForceDream() {
      if (!this.store.forceDream) {
        this.showToast(t("toast.noCallback"));
        return;
      }
      try {
        await this.store.forceDream();
      } catch (err) {
        this.showToast(t("toast.dreamFailed", { error: String(err) }));
        return;
      }
      this.showToast(t("toast.dreamStarted"));
      await this.refreshMemoryOpsStatus();
      this.fullReRender();
    }
    async handleInspectRecalled() {
      if (!this.store.getRecalledDocs) {
        this.showToast(t("toast.noCallback"));
        return;
      }
      const docs = await this.store.getRecalledDocs();
      this.memoryOpsStatus = {
        ...this.memoryOpsStatus,
        recalledDocs: docs.map((d) => ({
          id: d.id,
          title: d.title,
          freshness: d.freshness
        }))
      };
      this.fullReRender();
    }
    async handleToggleFallbackRetrieval() {
      const next = !this.memoryOpsStatus.fallbackRetrievalEnabled;
      this.memoryOpsStatus = {
        ...this.memoryOpsStatus,
        fallbackRetrievalEnabled: next
      };
      await saveMemoryOpsPrefs(this.store.storage, {
        fallbackRetrievalEnabled: next
      });
      this.showToast(t("toast.fallbackToggled"));
      this.fullReRender();
    }
    async refreshMemoryOpsStatus() {
      const dreamState = await loadDreamState(this.store.storage);
      const prefs = await loadMemoryOpsPrefs(this.store.storage);
      const canonicalState = await readCanonicalState(this.store);
      this.canonicalState = canonicalState;
      const isLocked = this.store.isMemoryLocked ? await this.store.isMemoryLocked() : false;
      const latestMemoryTs = computeLatestMemoryTs(canonicalState);
      this.memoryOpsStatus = {
        lastExtractTs: latestMemoryTs,
        lastDreamTs: dreamState.lastDreamTs,
        notebookFreshness: computeNotebookFreshness(latestMemoryTs, dreamState.lastDreamTs),
        documentCounts: computeDocumentCounts(canonicalState.memory),
        fallbackRetrievalEnabled: prefs.fallbackRetrievalEnabled,
        isMemoryLocked: isLocked,
        staleWarnings: buildStaleWarnings(latestMemoryTs, dreamState.lastDreamTs),
        recalledDocs: this.memoryOpsStatus.recalledDocs
      };
    }
    // ── Language switch ──────────────────────────────────────────────────
    async handleSwitchLang(btn) {
      const nextLocale = btn.getAttribute("data-da-lang") ?? "en";
      setLocale(nextLocale);
      await this.store.storage.setItem(DASHBOARD_LOCALE_KEY, nextLocale);
      this.connectionStatus = { kind: this.connectionStatus.kind, message: this.localizedConnectionMessage() };
      this.fullReRender();
    }
    // ── Toast ─────────────────────────────────────────────────────────────
    showToast(message) {
      const prev = this.doc.querySelector(".da-toast");
      if (prev) prev.remove();
      const toast = this.doc.createElement("div");
      toast.className = "da-toast";
      toast.textContent = message;
      this.doc.body.appendChild(toast);
      this.lifecycle.setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, TOAST_DURATION_MS);
    }
  };
  function isValidExportPayload(value) {
    if (value == null || typeof value !== "object") return false;
    const v = value;
    return v.schema === "director-actor-dashboard-profile" && typeof v.version === "number" && v.profile != null && typeof v.profile === "object" && typeof v.profile.id === "string" && typeof v.profile.name === "string";
  }
  async function openDashboard(api, store, doc) {
    if (activeInstance) {
      await activeInstance.close();
    }
    const targetDoc = doc ?? globalThis.document;
    for (const el of Array.from(targetDoc.querySelectorAll(`.${DASHBOARD_ROOT_CLASS}`))) {
      el.remove();
    }
    const rawLocale = await store.storage.getItem(DASHBOARD_LOCALE_KEY);
    if (rawLocale === "en" || rawLocale === "ko") {
      setLocale(rawLocale);
    }
    const rawSettings = await store.storage.getItem(
      DASHBOARD_SETTINGS_KEY
    );
    const settings = normalizePersistedSettings(rawSettings ?? {});
    const draft = createDashboardDraft(settings);
    const rawManifest = await store.storage.getItem(
      DASHBOARD_PROFILE_MANIFEST_KEY
    );
    const profiles = rawManifest ?? createDefaultProfileManifest();
    let modelOptions = [settings.directorModel];
    try {
      modelOptions = await loadProviderModels(api, settings);
      if (!modelOptions.includes(settings.directorModel)) {
        modelOptions.unshift(settings.directorModel);
      }
    } catch {
    }
    const canonicalState = await readCanonicalState(store);
    const memoryOpsStatus = await buildMemoryOpsStatus(store, canonicalState);
    const instance = new DashboardInstance(
      api,
      store,
      targetDoc,
      draft,
      profiles,
      modelOptions,
      canonicalState,
      memoryOpsStatus
    );
    activeInstance = instance;
    await instance.mount();
  }
  async function closeDashboard() {
    if (activeInstance) {
      await activeInstance.close();
    }
  }

  // src/ui/settings.ts
  var SETTING_NAME = "Director Settings";
  var BUTTON_NAME = "Director";
  var BUTTON_ICON = "\u{1F3AC}";
  var SETTING_ID = "director-dashboard-settings";
  var BUTTON_ID = "director-dashboard-button";
  function buildFallbackSummary(settings) {
    return [
      t("fallback.header"),
      `${t("fallback.enabled")}: ${String(settings.enabled)}`,
      `${t("fallback.assertiveness")}: ${settings.assertiveness}`,
      `${t("fallback.provider")}: ${settings.directorProvider}`,
      `${t("fallback.model")}: ${settings.directorModel}`,
      `${t("fallback.injection")}: ${settings.injectionMode}`,
      `${t("fallback.postReview")}: ${String(settings.postReviewEnabled)}`,
      `${t("fallback.briefCap")}: ${String(settings.briefTokenCap)} ${t("fallback.briefCapUnit")}`
    ].join("\n");
  }
  async function showSettingsOverlay(api, settings = DEFAULT_DIRECTOR_SETTINGS, dashboardStore) {
    if (typeof document === "undefined" || typeof window === "undefined") {
      await api.alert(buildFallbackSummary(settings));
      return;
    }
    const store = dashboardStore ?? { storage: api.pluginStorage };
    await openDashboard(api, store);
  }
  async function registerPluginUi(api, options) {
    await api.registerSetting(
      SETTING_NAME,
      async () => {
        await options.onOpen();
      },
      BUTTON_ICON,
      "html",
      SETTING_ID
    );
    await api.registerButton(
      {
        name: BUTTON_NAME,
        icon: BUTTON_ICON,
        iconType: "html",
        location: "chat",
        id: BUTTON_ID
      },
      async () => {
        await options.onOpen();
      }
    );
    await api.onUnload(async () => {
      await closeDashboard();
    });
  }

  // src/runtime/plugin.ts
  async function safeLog(api, message) {
    await api.log(message);
  }
  async function bootstrapPlugin(api, options) {
    const { director } = options;
    const includeTypes = options.includeTypes ?? [...DEFAULT_DIRECTOR_SETTINGS.includeTypes];
    const injectionMode = options.injectionMode ?? DEFAULT_DIRECTOR_SETTINGS.injectionMode;
    const outputDebounceMs = options.outputDebounceMs ?? DEFAULT_DIRECTOR_SETTINGS.outputDebounceMs;
    const circuitBreaker = options.circuitBreaker ?? null;
    const turnCache = options.turnCache ?? new TurnCache();
    const openSettings = options.openSettings ?? (async () => showSettingsOverlay(api));
    const onTurnFinalized = options.onTurnFinalized ?? null;
    const onShutdown = options.onShutdown ?? null;
    const sessionNotebook = options.sessionNotebook ?? null;
    let currentTurnId = null;
    let debounceTimer = null;
    let turnIndex = 0;
    function clearActiveTurn() {
      if (currentTurnId !== null) {
        turnCache.drop(currentTurnId);
        currentTurnId = null;
      }
    }
    function getCurrentTurn() {
      return currentTurnId ? turnCache.get(currentTurnId) ?? null : null;
    }
    async function finalizeTurn(content) {
      const activeTurn = getCurrentTurn();
      if (!activeTurn || activeTurn.finalized) return;
      turnIndex += 1;
      if (sessionNotebook) {
        const estimatedTokens = Math.ceil((content ?? "").length / 4);
        sessionNotebook.recordTurn(estimatedTokens);
      }
      try {
        const finalizePatch = {
          finalized: true
        };
        const finalOutput = content ?? activeTurn.lastOutputText;
        if (finalOutput !== void 0) {
          finalizePatch.lastOutputText = finalOutput;
        }
        turnCache.patch(activeTurn.turnId, finalizePatch);
        const finalizedTurn = turnCache.get(activeTurn.turnId);
        if (!finalizedTurn?.brief) {
          clearActiveTurn();
          return;
        }
        const postInput = {
          turnId: finalizedTurn.turnId,
          type: finalizedTurn.type,
          content: content ?? finalizedTurn.lastOutputText ?? "",
          brief: finalizedTurn.brief,
          messages: finalizedTurn.latestMessages ?? finalizedTurn.originalMessages,
          originalMessages: finalizedTurn.originalMessages
        };
        if (finalizedTurn.retrieval !== void 0) {
          postInput.retrieval = finalizedTurn.retrieval;
        }
        await director.postResponse(postInput);
        circuitBreaker?.recordSuccess();
        if (onTurnFinalized && finalizedTurn.brief) {
          try {
            await onTurnFinalized({
              turnId: finalizedTurn.turnId,
              turnIndex,
              type: finalizedTurn.type,
              content: postInput.content,
              messages: postInput.messages,
              brief: finalizedTurn.brief
            });
          } catch (hkErr) {
            await safeLog(api, `Housekeeping afterTurn failed: ${hkErr}`);
          }
        }
      } catch (err) {
        await safeLog(api, `Director postResponse failed: ${err}`);
        circuitBreaker?.recordFailure(String(err));
      } finally {
        clearActiveTurn();
      }
    }
    function clearDebounce() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
    await api.addRisuReplacer("beforeRequest", async (messages, type) => {
      if (!includeTypes.includes(type)) return messages;
      clearDebounce();
      clearActiveTurn();
      if (circuitBreaker?.isOpen()) return messages;
      const turn = turnCache.begin(type, messages);
      currentTurnId = turn.turnId;
      try {
        const brief = await director.preRequest({
          turnId: turn.turnId,
          type,
          messages
        });
        if (!brief) {
          clearActiveTurn();
          return messages;
        }
        const injected = injectDirectorBrief(messages, brief, injectionMode);
        turnCache.patch(turn.turnId, {
          brief,
          latestMessages: injected.messages
        });
        return injected.messages;
      } catch (err) {
        clearActiveTurn();
        await safeLog(api, `Director preRequest failed: ${err}`);
        circuitBreaker?.recordFailure(String(err));
        return messages;
      }
    });
    await api.addRisuReplacer("afterRequest", async (content, type) => {
      if (!includeTypes.includes(type)) return content;
      if (getCurrentTurn()) {
        clearDebounce();
        await finalizeTurn(content);
      }
      return content;
    });
    await api.addRisuScriptHandler("output", async (content) => {
      const turn = getCurrentTurn();
      if (!turn || turn.finalized) return null;
      turnCache.patch(turn.turnId, {
        lastOutputText: content
      });
      clearDebounce();
      debounceTimer = setTimeout(() => {
        void finalizeTurn();
      }, outputDebounceMs);
      return null;
    });
    await registerPluginUi(api, { onOpen: openSettings });
    await api.onUnload(async () => {
      clearDebounce();
      clearActiveTurn();
      if (onShutdown) {
        try {
          await onShutdown();
        } catch (err) {
          await safeLog(api, `Plugin shutdown hook failed: ${err}`);
        }
      }
    });
  }

  // src/index.ts
  function createId3(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  var LS_LAST_EXTRACTION_TS = "director:extraction:lastTs";
  var LS_LAST_PROCESSED_CURSOR = "director:extraction:cursor";
  var RECALL_TIMEOUT_MS = 3e3;
  function latestUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        return messages[index].content;
      }
    }
    return "";
  }
  function projectRetrievedMemory(state, retrieved) {
    const selectedTexts = /* @__PURE__ */ new Set([
      ...retrieved.mustInject,
      ...retrieved.highPriority,
      ...retrieved.opportunistic.slice(0, 5)
    ]);
    if (selectedTexts.size === 0) {
      return structuredClone(state.memory);
    }
    return {
      ...structuredClone(state.memory),
      summaries: state.memory.summaries.filter((entry) => selectedTexts.has(entry.text)),
      worldFacts: state.memory.worldFacts.filter((entry) => selectedTexts.has(entry.text))
    };
  }
  function recordDirectorFailure(state, reason) {
    const next = structuredClone(state);
    const now = Date.now();
    next.metrics.totalDirectorFailures += 1;
    next.director.cooldown.failures += 1;
    next.director.failureHistory.unshift({
      timestamp: now,
      reason,
      severity: "medium"
    });
    next.director.failureHistory = next.director.failureHistory.slice(0, 50);
    if (next.director.cooldown.failures >= next.settings.cooldownFailureThreshold) {
      next.director.cooldown.untilTs = now + next.settings.cooldownMs;
    }
    return next;
  }
  function recordDirectorSuccess(state) {
    const next = structuredClone(state);
    next.metrics.totalDirectorCalls += 1;
    next.director.cooldown.failures = 0;
    next.director.cooldown.untilTs = null;
    return next;
  }
  async function registerDirectorActorPlugin(api) {
    const scopeResolution = await resolveScopeStorageKey(api);
    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: scopeResolution.storageKey,
      migrateFromFlatKey: !scopeResolution.isFallback
    });
    const turnCache = new TurnCache();
    const initialState = await store.load();
    const circuitBreaker = new CircuitBreaker(
      initialState.settings.cooldownFailureThreshold,
      initialState.settings.cooldownMs
    );
    const memdirScopeKey = scopeResolution.isFallback ? "default" : scopeResolution.storageKey;
    const memdirStore = new MemdirStore(api.pluginStorage, memdirScopeKey);
    const recallCache = new RecallCache(initialState.settings.recallCooldownMs);
    const sessionNotebook = new SessionNotebook(memdirScopeKey);
    const seenHashes = /* @__PURE__ */ new Set();
    const extractionWorker = createExtractionWorker(
      {
        async runExtraction(ctx) {
          const state = await store.load();
          if (!state.settings.postReviewEnabled) {
            return { applied: false, memoryUpdate: null };
          }
          const promptPreset = resolvePromptPreset(state.settings);
          const service = createDirectorService(api, state.settings);
          const result = await service.postResponse({
            responseText: ctx.content,
            brief: ctx.brief,
            messages: ctx.messages,
            directorState: state.director,
            memory: state.memory,
            assertiveness: state.settings.assertiveness,
            promptPreset
          });
          if (!result.ok) {
            return { applied: false, memoryUpdate: null };
          }
          return { applied: true, memoryUpdate: result.update };
        },
        async persistDocuments(update, ctx) {
          const now = Date.now();
          const docs = [];
          for (const fact of update.durableFacts) {
            docs.push({
              id: `ext-fact-${createId3("f")}`,
              type: "plot",
              title: fact.slice(0, 60),
              description: fact,
              scopeKey: memdirScopeKey,
              updatedAt: now,
              source: "extraction",
              freshness: "current",
              tags: []
            });
          }
          for (const entityData of update.entityUpdates) {
            const name = typeof entityData.name === "string" ? entityData.name : "unknown";
            const facts = Array.isArray(entityData.facts) ? entityData.facts.join("; ") : "";
            docs.push({
              id: `ext-entity-${createId3("e")}`,
              type: "character",
              title: name,
              description: facts || name,
              scopeKey: memdirScopeKey,
              updatedAt: now,
              source: "extraction",
              freshness: "current",
              tags: []
            });
          }
          for (const doc of docs) {
            await memdirStore.putDocument(doc);
          }
        },
        log(message) {
          api.log(message);
        },
        async getLastExtractionTs() {
          const raw = await api.safeLocalStorage.getItem(LS_LAST_EXTRACTION_TS);
          return typeof raw === "number" ? raw : 0;
        },
        async setLastExtractionTs(ts) {
          await api.safeLocalStorage.setItem(LS_LAST_EXTRACTION_TS, ts);
        },
        async getLastProcessedCursor() {
          const raw = await api.safeLocalStorage.getItem(LS_LAST_PROCESSED_CURSOR);
          return typeof raw === "number" ? raw : 0;
        },
        async setLastProcessedCursor(cursor) {
          await api.safeLocalStorage.setItem(LS_LAST_PROCESSED_CURSOR, cursor);
        },
        hashRequest: hashExtractionContext
      },
      {
        extractionMinTurnInterval: initialState.settings.extractionMinTurnInterval,
        seenHashes
      }
    );
    const dreamState = await loadDreamState(api.pluginStorage);
    let lastUserInteractionTs = Date.now();
    const dreamWorker = createAutoDreamWorker({
      memdirStore,
      log(message) {
        api.log(message);
      },
      async runConsolidationModel(prompt) {
        const state = await store.load();
        const result = await api.runLLMModel({
          messages: [
            { role: "system", content: "You are a memory consolidation assistant." },
            { role: "user", content: prompt }
          ],
          staticModel: state.settings.directorModel,
          mode: state.settings.directorMode
        });
        if (result.type === "fail") {
          throw new Error(`Consolidation model call failed: ${result.result}`);
        }
        return result.result;
      }
    });
    const consolidationLock = new ConsolidationLock(
      api.pluginStorage,
      memdirScopeKey,
      `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const housekeeping = createBackgroundHousekeeping(
      {
        submitExtraction: (ctx) => extractionWorker.submit(ctx),
        flushExtraction: () => extractionWorker.flush(),
        getExtractionMinTurnInterval: () => initialState.settings.extractionMinTurnInterval,
        log(message) {
          api.log(message);
        }
      },
      {
        async buildCadenceGate() {
          const freshState = await store.load();
          return {
            enabled: freshState.settings.enabled && freshState.settings.postReviewEnabled,
            lastDreamTs: dreamState.lastDreamTs,
            dreamMinHoursElapsed: freshState.settings.dreamMinHoursElapsed,
            turnsSinceLastDream: dreamState.turnsSinceLastDream,
            dreamMinTurnsElapsed: freshState.settings.extractionMinTurnInterval * 3,
            sessionsSinceLastDream: dreamState.sessionsSinceLastDream,
            dreamMinSessionsElapsed: freshState.settings.dreamMinSessionsElapsed,
            userInteractionGuardMs: 1e4,
            lastUserInteractionTs
          };
        },
        dreamWorker,
        consolidationLock,
        async onDreamComplete(result) {
          dreamState.lastDreamTs = Date.now();
          dreamState.turnsSinceLastDream = 0;
          dreamState.sessionsSinceLastDream = 0;
          await saveDreamState(api.pluginStorage, dreamState);
        },
        log(message) {
          api.log(message);
        }
      }
    );
    const director = {
      async preRequest(input) {
        const state = await store.load();
        if (!state.settings.enabled) return null;
        const retrieved = retrieveMemory({
          state,
          messages: input.messages
        });
        turnCache.patch(input.turnId, { retrieval: retrieved });
        const recentText = input.messages.map((m) => m.content).join(" ");
        const memDocs = await memdirStore.listDocuments();
        const storedMd = await memdirStore.getMemoryMd();
        const memoryMdContent = storedMd ?? buildMemoryMd(memDocs, { tokenBudget: state.settings.briefTokenCap });
        const recallDeps = {
          runRecallModel: (manifest, text) => makeRecallRequest(api, manifest, text, {
            model: state.settings.directorModel,
            mode: state.settings.directorMode
          }),
          log: (msg) => api.log(msg)
        };
        const recallPromise = findRelevantMemories(
          recallDeps,
          { docs: memDocs, recentText, memoryMdContent },
          recallCache
        );
        let recalledDocsBlock = memoryMdContent;
        try {
          const recallResult = await Promise.race([
            recallPromise,
            new Promise((resolve) => setTimeout(() => resolve(null), RECALL_TIMEOUT_MS))
          ]);
          if (recallResult) {
            recalledDocsBlock = formatRecalledDocsBlock(recallResult);
          }
        } catch (err) {
          api.log(`Recall prefetch failed: ${err}`);
        }
        const promptPreset = resolvePromptPreset(state.settings);
        const notebookBlock = formatNotebookBlock(sessionNotebook.snapshot());
        const service = createDirectorService(api, state.settings);
        const result = await service.preRequest({
          messages: input.messages,
          directorState: state.director,
          memory: projectRetrievedMemory(state, retrieved),
          assertiveness: state.settings.assertiveness,
          briefTokenCap: state.settings.briefTokenCap,
          promptPreset,
          notebookBlock: notebookBlock || "",
          recalledDocsBlock
        });
        if (!result.ok) {
          await store.writeFirst((current) => recordDirectorFailure(current, result.error));
          throw new Error(result.error);
        }
        await store.writeFirst((current) => recordDirectorSuccess(current));
        return result.brief;
      },
      async postResponse(input) {
        const state = await store.load();
        if (!state.settings.postReviewEnabled) return null;
        const promptPreset = resolvePromptPreset(state.settings);
        const service = createDirectorService(api, state.settings);
        const result = await service.postResponse({
          responseText: input.content,
          brief: input.brief,
          messages: input.messages,
          directorState: state.director,
          memory: state.memory,
          assertiveness: state.settings.assertiveness,
          promptPreset
        });
        if (!result.ok) {
          await store.writeFirst((current) => recordDirectorFailure(current, result.error));
          throw new Error(result.error);
        }
        const userText = latestUserText(input.originalMessages);
        let warnings = [];
        const applied = await store.writeFirst((current) => {
          const appliedResult = applyMemoryUpdate(current, result.update, {
            turnId: input.turnId,
            userText,
            actorText: input.content,
            brief: input.brief
          });
          warnings = appliedResult.warnings;
          return appliedResult.state;
        });
        for (const warning of warnings) {
          await api.log(`Director memory warning: ${warning}`);
        }
        return result.update;
      }
    };
    await bootstrapPlugin(api, {
      director,
      includeTypes: initialState.settings.includeTypes,
      injectionMode: initialState.settings.injectionMode,
      outputDebounceMs: initialState.settings.outputDebounceMs,
      circuitBreaker,
      turnCache,
      sessionNotebook,
      onTurnFinalized: (ctx) => {
        lastUserInteractionTs = Date.now();
        dreamState.turnsSinceLastDream += 1;
        return housekeeping.afterTurn(ctx);
      },
      onShutdown: () => housekeeping.shutdown(),
      openSettings: async () => {
        const dashboardStore = createDashboardStore(
          api,
          (mutator) => store.writeFirst(mutator),
          store.stateStorageKey
        );
        await openDashboard(api, dashboardStore);
      }
    });
  }
  var index_default = registerDirectorActorPlugin;
  function isRisuaiApiLike(value) {
    if (value == null || typeof value !== "object") return false;
    const candidate = value;
    return typeof candidate.addRisuReplacer === "function" && typeof candidate.addRisuScriptHandler === "function" && typeof candidate.runLLMModel === "function" && candidate.pluginStorage != null;
  }
  var autoApiCandidates = [
    globalThis.risuai,
    globalThis.Risuai,
    globalThis.RisuAI
  ];
  for (const candidate of autoApiCandidates) {
    if (!isRisuaiApiLike(candidate)) continue;
    void registerDirectorActorPlugin(candidate).catch((error) => {
      console.error("RisuAI Director Actor Plugin bootstrap failed:", error);
    });
    break;
  }
})();
