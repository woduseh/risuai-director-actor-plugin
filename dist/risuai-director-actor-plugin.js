//@name risuai-director-actor-plugin
//@display-name RisuAI Director Actor
//@api 3.0
//@version 0.2.0
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
  function buildPreRequestPrompt(ctx) {
    const system = {
      role: "system",
      content: [
        "You are the Director \u2014 a collaborative-fiction scene analyst.",
        "Examine the conversation and context below, then produce a SceneBrief:",
        "a compact JSON plan that guides the next response.",
        "",
        `Assertiveness: ${ASSERTIVENESS_DIRECTIVE[ctx.assertiveness]}`,
        "",
        "Rules:",
        "- Maintain continuity with established facts.",
        "- Respect the current scene phase and pacing.",
        "- Identify beats that advance active arcs naturally.",
        "- Note forbidden moves (contradictions, spoilers, lore violations).",
        `- Keep output concise \u2014 aim for \u2264${ctx.briefTokenCap} tokens.`,
        "",
        `Respond ONLY with a JSON object matching this schema:
${SCENE_BRIEF_SCHEMA}`
      ].join("\n")
    };
    const user = {
      role: "user",
      content: [
        "## Current State",
        `Scene: ${ctx.directorState.currentSceneId}`,
        `Phase: ${ctx.directorState.scenePhase}`,
        `Pacing: ${ctx.directorState.pacingMode}`,
        "",
        "## Active Arcs",
        formatArcs(ctx.directorState),
        "",
        "## Continuity Locks",
        formatContinuityFacts(ctx.directorState),
        "",
        "## Memory Summaries",
        formatMemorySummaries(ctx.memory),
        "",
        "## Recent Conversation",
        formatConversationTail(ctx.messages, MAX_RECENT_MESSAGES)
      ].join("\n")
    };
    return [system, user];
  }
  function buildPostResponsePrompt(ctx) {
    const system = {
      role: "system",
      content: [
        "You are the Director \u2014 a post-response reviewer for collaborative fiction.",
        "Review the AI response against the SceneBrief below.",
        "Extract durable facts, detect violations, and produce a MemoryUpdate.",
        "",
        `Assertiveness: ${ASSERTIVENESS_DIRECTIVE[ctx.assertiveness]}`,
        "",
        "Rules:",
        "- Score turn quality (0\u20131) based on brief adherence, continuity, characterisation.",
        "- List violations (continuity breaks, forbidden moves used, OOC behaviour).",
        "- Extract durable facts worth remembering long-term.",
        "- Produce memory operations for the storage layer.",
        '- "pass" = acceptable, "soft-fail" = minor issues, "hard-fail" = severe violations.',
        "",
        `Respond ONLY with a JSON object matching this schema:
${MEMORY_UPDATE_SCHEMA}`
      ].join("\n")
    };
    const user = {
      role: "user",
      content: [
        "## SceneBrief Used",
        JSON.stringify(ctx.brief, null, 2),
        "",
        "## Current State",
        `Scene: ${ctx.directorState.currentSceneId}`,
        `Phase: ${ctx.directorState.scenePhase}`,
        "",
        "## AI Response",
        ctx.responseText,
        "",
        "## Recent Conversation Context",
        formatConversationTail(ctx.messages, MAX_RECENT_MESSAGES)
      ].join("\n")
    };
    return [system, user];
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
    embeddingDimensions: 1536
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

  // src/memory/canonicalStore.ts
  var DIRECTOR_STATE_STORAGE_KEY = "director-plugin-state";
  function patchLegacyMemory(state) {
    if (!Array.isArray(state.memory.continuityFacts)) {
      if (Array.isArray(state.director.continuityFacts) && state.director.continuityFacts.length > 0) {
        state.memory.continuityFacts = structuredClone(state.director.continuityFacts);
      } else {
        state.memory.continuityFacts = [];
      }
    }
  }
  function isValidState(value) {
    if (value == null || typeof value !== "object") return false;
    const v = value;
    return typeof v.schemaVersion === "number" && typeof v.projectKey === "string" && typeof v.characterKey === "string" && typeof v.sessionKey === "string" && typeof v.updatedAt === "number" && v.settings != null && typeof v.settings === "object" && v.director != null && typeof v.director === "object" && v.actor != null && typeof v.actor === "object" && v.memory != null && typeof v.memory === "object" && v.metrics != null && typeof v.metrics === "object";
  }
  var CanonicalStore = class {
    storage;
    current = null;
    constructor(storage) {
      this.storage = storage;
    }
    snapshot() {
      if (this.current == null) {
        throw new Error("CanonicalStore has not been loaded yet");
      }
      return structuredClone(this.current);
    }
    async load() {
      const raw = await this.storage.getItem(DIRECTOR_STATE_STORAGE_KEY);
      if (isValidState(raw)) {
        this.current = structuredClone(raw);
        patchLegacyMemory(this.current);
      } else {
        this.current = createEmptyState();
      }
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
      await this.storage.setItem(DIRECTOR_STATE_STORAGE_KEY, toStore);
      this.current = structuredClone(next);
      if (onAfterPersist) {
        await onAfterPersist();
      }
      return structuredClone(this.current);
    }
  };

  // src/memory/memoryMutations.ts
  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function uniqueStrings(values) {
    return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  }
  function deleteSummary(state, id) {
    const idx = state.memory.summaries.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    state.memory.summaries.splice(idx, 1);
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
  function upsertSummary(summaries, text, now, partial) {
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
  function upsertWorldFact(worldFacts, text, now, partial) {
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
  function upsertEntity(entities, payload, now, warnings) {
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
  function upsertRelation(relations, payload, now, warnings) {
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
        upsertSummary(state.memory.summaries, text, now, {
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
        upsertWorldFact(state.memory.worldFacts, text, now, {
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
        upsertEntity(state.memory.entities, payload, now, warnings);
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
        upsertRelation(state.memory.relations, payload, now, warnings);
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
      upsertSummary(next.memory.summaries, durableFact, now, {
        sceneId: next.director.currentSceneId,
        recencyWeight: 1
      });
    }
    for (const worldChange of uniqueStrings2(update.sceneDelta.worldStateChanges ?? [])) {
      upsertWorldFact(next.memory.worldFacts, worldChange, now);
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
      upsertEntity(next.memory.entities, payload, now, warnings);
    }
    for (const relationUpdate of update.relationUpdates) {
      const payload = asRecord(relationUpdate);
      if (!payload) {
        warnings.push("Ignored non-object relation update.");
        continue;
      }
      upsertRelation(next.memory.relations, payload, now, warnings);
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
      curatedModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-5.4-mini", "gpt-5.4"]
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
        "claude-sonnet-4-20250514",
        "claude-opus-4-6"
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
        "gemini-3.1-pro-preview"
      ]
    },
    {
      id: "copilot",
      label: "GitHub Copilot",
      baseUrl: "https://api.githubcopilot.com/v1",
      manualModelOnly: true,
      authMode: "oauth-device-flow",
      curatedModels: ["gpt-4.1", "claude-sonnet-4-20250514"]
    },
    {
      id: "vertex",
      label: "Google Vertex AI",
      baseUrl: "",
      manualModelOnly: true,
      authMode: "manual-advanced",
      curatedModels: [
        "gemini-2.5-pro-preview-05-06",
        "gemini-3.1-pro-preview"
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
    "btn.close": "Close",
    "btn.closeIcon": "\u2715 Close",
    "btn.reset": "Reset",
    "btn.exportSettings": "Export Settings",
    "btn.testConnection": "Test Connection",
    "btn.refreshModels": "Refresh Models",
    "btn.newProfile": "New Profile",
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
    "label.briefTokenCap": "Brief Token Cap",
    "label.postReview": "Enable Post-review",
    "label.embeddings": "Enable Embeddings",
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
    "memory.filterPlaceholder": "Filter memory\u2026",
    "memory.emptyHint": "No memory items yet. Summaries and continuity facts will appear here as the story progresses.",
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
    // Import alert
    "alert.importInstructions": 'To import a profile, save the JSON to plugin storage key "{{key}}" and click Import again.',
    // Placeholders
    "placeholder.customModelId": "type a model ID directly",
    // Profile names
    "profile.defaultName": "Profile {{n}}",
    "profile.balanced": "Balanced",
    "profile.gentle": "Gentle",
    "profile.strict": "Strict",
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
    "btn.close": "\uB2EB\uAE30",
    "btn.closeIcon": "\u2715 \uB2EB\uAE30",
    "btn.reset": "\uCD08\uAE30\uD654",
    "btn.exportSettings": "\uC124\uC815 \uB0B4\uBCF4\uB0B4\uAE30",
    "btn.testConnection": "\uC5F0\uACB0 \uD14C\uC2A4\uD2B8",
    "btn.refreshModels": "\uBAA8\uB378 \uC0C8\uB85C\uACE0\uCE68",
    "btn.newProfile": "\uC0C8 \uD504\uB85C\uD544",
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
    "label.briefTokenCap": "\uBE0C\uB9AC\uD504 \uD1A0\uD070 \uC0C1\uD55C",
    "label.postReview": "\uC0AC\uD6C4 \uB9AC\uBDF0 \uD65C\uC131\uD654",
    "label.embeddings": "\uC784\uBCA0\uB529 \uD65C\uC131\uD654",
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
    "memory.filterPlaceholder": "\uBA54\uBAA8\uB9AC \uD544\uD130\u2026",
    "memory.emptyHint": "\uC544\uC9C1 \uBA54\uBAA8\uB9AC \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC774\uC57C\uAE30\uAC00 \uC9C4\uD589\uB428\uC5D0 \uB530\uB77C \uC694\uC57D \uBC0F \uC5F0\uC18D\uC131 \uC0AC\uC2E4\uC774 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
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
    // Import alert
    "alert.importInstructions": '\uD504\uB85C\uD544\uC744 \uAC00\uC838\uC624\uB824\uBA74 JSON\uC744 \uD50C\uB7EC\uADF8\uC778 \uC800\uC7A5\uC18C \uD0A4 "{{key}}"\uC5D0 \uC800\uC7A5\uD55C \uD6C4 \uAC00\uC838\uC624\uAE30\uB97C \uB2E4\uC2DC \uD074\uB9AD\uD558\uC138\uC694.',
    // Placeholders
    "placeholder.customModelId": "\uBAA8\uB378 ID\uB97C \uC9C1\uC811 \uC785\uB825\uD558\uC138\uC694",
    // Profile names
    "profile.defaultName": "\uD504\uB85C\uD544 {{n}}",
    "profile.balanced": "\uADE0\uD615",
    "profile.gentle": "\uBD80\uB4DC\uB7EC\uC6C0",
    "profile.strict": "\uC5C4\uACA9",
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
    const modelOptionEls = modelOptions.map((m) => `<option value="${m}"${m === settings.directorModel ? " selected" : ""}>${m}</option>`).join("");
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
              <input type="text" class="da-input" data-da-field="embeddingBaseUrl" value="${settings.embeddingBaseUrl}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingApiKey")}</span>
              <input type="password" class="da-input" data-da-field="embeddingApiKey" value="${settings.embeddingApiKey}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.embeddingModel")}</span>
              <input type="text" class="da-input" data-da-field="embeddingModel" value="${settings.embeddingModel}" />
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
                <input type="text" class="da-input" data-da-field="directorBaseUrl" value="${settings.directorBaseUrl}" />
              </label>
              <label class="da-label">
                <span class="da-label-text">${t("label.apiKey")}</span>
                <input type="password" class="da-input" data-da-field="directorApiKey" value="${settings.directorApiKey}" />
              </label>
            </div>
            <label class="da-label">
              <span class="da-label-text">${t("label.model")}</span>
              <select class="da-select" data-da-field="directorModel">${modelOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t("label.customModelId")}</span>
              <input type="text" class="da-input" data-da-field="directorModel" value="${settings.directorModel}" placeholder="${t("placeholder.customModelId")}" />
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="test-connection">${t("btn.testConnection")}</button>
              <button class="da-btn" data-da-action="refresh-models">${t("btn.refreshModels")}</button>
            </div>
          </div>
        </section>${embeddingSection}
      </div>`;
  }
  function buildMemoryCachePage(input) {
    const { pluginState } = input;
    const summaries = pluginState.memory.summaries;
    const facts = pluginState.memory.continuityFacts;
    const isEmpty = summaries.length === 0 && facts.length === 0;
    const filterHtml = `<input type="text" class="da-input" data-da-role="memory-filter" placeholder="${t("memory.filterPlaceholder")}" />`;
    if (isEmpty) {
      return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.memoryCache.title")}</h3>
              <p class="da-card-copy">${t("card.memoryCache.copy")}</p>
            </div>
          </div>
          ${filterHtml}
          <p class="da-empty" data-da-role="memory-empty">${t("memory.emptyHint")}</p>
        </section>
      </div>`;
    }
    const summaryItems = summaries.map(
      (s) => `<li class="da-memory-item"><span>${s.text}</span><button class="da-btn da-btn--danger da-btn--sm" data-da-action="delete-summary" data-da-item-id="${s.id}">${t("btn.delete")}</button></li>`
    ).join("");
    const factItems = facts.map(
      (f) => `<li class="da-memory-item"><span>${f.text}</span><button class="da-btn da-btn--danger da-btn--sm" data-da-action="delete-continuity-fact" data-da-item-id="${f.id}">${t("btn.delete")}</button></li>`
    ).join("");
    return `
      ${filterHtml}
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.memorySummaries.title")}</h3>
            </div>
          </div>
          <ul class="da-memory-list">${summaryItems}</ul>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t("card.continuityFacts.title")}</h3>
            </div>
          </div>
          <ul class="da-memory-list">${factItems}</ul>
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

  // src/ui/dashboardState.ts
  var DASHBOARD_SETTINGS_KEY = "dashboard-settings-v1";
  var DASHBOARD_PROFILE_MANIFEST_KEY = "dashboard-profile-manifest-v1";
  var DASHBOARD_LOCALE_KEY = "dashboard-locale-v1";
  var DASHBOARD_SCHEMA_VERSION = 1;
  function normalizePersistedSettings(raw) {
    return { ...DEFAULT_DIRECTOR_SETTINGS, ...raw };
  }
  function createDashboardDraft(settings) {
    return {
      isDirty: false,
      settings: { ...settings }
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
  function mergeDashboardSettingsIntoPluginState(state, dashboardSettings) {
    return {
      ...state,
      settings: { ...state.settings, ...dashboardSettings }
    };
  }

  // src/ui/dashboardApp.ts
  var TOAST_DURATION_MS = 2500;
  var PROFILE_ID_PREFIX = "user-profile-";
  var IMPORT_STAGING_KEY = "dashboard-profile-import-staging";
  var activeInstance = null;
  function createDashboardStore(api, canonicalWriteFirst) {
    const store = {
      storage: api.pluginStorage
    };
    if (canonicalWriteFirst) {
      store.mirrorToCanonical = async (settings) => {
        await canonicalWriteFirst(
          (s) => mergeDashboardSettingsIntoPluginState(s, settings)
        );
      };
    }
    return store;
  }
  async function readCanonicalState(store) {
    if (store.readCanonical) {
      return structuredClone(await store.readCanonical());
    }
    const raw = await store.storage.getItem(DIRECTOR_STATE_STORAGE_KEY);
    return raw ? structuredClone(raw) : createEmptyState();
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
    constructor(api, store, doc, draft, profiles, modelOptions, canonicalState) {
      this.api = api;
      this.store = store;
      this.doc = doc;
      this.draft = draft;
      this.profiles = profiles;
      this.activeTab = DASHBOARD_TABS[0]?.id ?? "general";
      this.modelOptions = modelOptions;
      this.connectionStatus = { kind: "idle", message: t("connection.notTested") };
      this.canonicalState = canonicalState;
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
        connectionStatus: this.connectionStatus
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
        (m) => `<option value="${m}"${m === this.draft.settings.directorModel ? " selected" : ""}>${m}</option>`
      ).join("");
    }
    updateDirtyIndicator() {
      if (!this.root) return;
      const indicator = this.root.querySelector('[data-da-role="dirty"]');
      if (indicator) {
        indicator.classList.toggle("da-hidden", !this.draft.isDirty);
      }
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
        this.handleFieldChange(e.target);
      });
      this.lifecycle.listen(this.root, "input", (e) => {
        const el = e.target;
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
        case "create-profile":
          await this.handleCreateProfile();
          break;
        case "export-profile":
          await this.handleExportProfile();
          break;
        case "import-profile":
          await this.handleImportProfile();
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
        this.draft.isDirty = true;
        this.updateDirtyIndicator();
      }
      if (key === "directorProvider") {
        const providerDefaults = resolveProviderDefaults(
          value
        );
        this.draft.settings.directorBaseUrl = providerDefaults.baseUrl;
        this.draft.isDirty = true;
        const baseUrlInput = this.root?.querySelector(
          '[data-da-field="directorBaseUrl"]'
        );
        if (baseUrlInput) {
          baseUrlInput.value = providerDefaults.baseUrl;
        }
      }
      if (key === "embeddingProvider") {
        const providerDefaults = resolveEmbeddingDefaults(
          value
        );
        this.draft.settings.embeddingBaseUrl = providerDefaults.baseUrl;
        this.draft.isDirty = true;
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
    // ── Memory delete ──────────────────────────────────────────────────────
    async handleDeleteMemoryItem(btn, kind) {
      const itemId = btn.getAttribute("data-da-item-id");
      if (!itemId) return;
      const state = await readCanonicalState(this.store);
      if (kind === "summary") {
        deleteSummary(state, itemId);
      } else {
        deleteContinuityFact(state, itemId);
      }
      await this.store.storage.setItem(DIRECTOR_STATE_STORAGE_KEY, structuredClone(state));
      this.canonicalState = state;
      this.fullReRender();
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
      if (settings.directorApiKey) {
        modelOptions = await loadProviderModels(api, settings);
        if (!modelOptions.includes(settings.directorModel)) {
          modelOptions.unshift(settings.directorModel);
        }
      }
    } catch {
    }
    const canonicalState = await readCanonicalState(store);
    const instance = new DashboardInstance(
      api,
      store,
      targetDoc,
      draft,
      profiles,
      modelOptions,
      canonicalState
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
    let currentTurnId = null;
    let debounceTimer = null;
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
    await api.onUnload(() => {
      clearDebounce();
      clearActiveTurn();
    });
  }

  // src/index.ts
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
    const store = new CanonicalStore(api.pluginStorage);
    const turnCache = new TurnCache();
    const initialState = await store.load();
    const circuitBreaker = new CircuitBreaker(
      initialState.settings.cooldownFailureThreshold,
      initialState.settings.cooldownMs
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
        const service = createDirectorService(api, state.settings);
        const result = await service.preRequest({
          messages: input.messages,
          directorState: state.director,
          memory: projectRetrievedMemory(state, retrieved),
          assertiveness: state.settings.assertiveness,
          briefTokenCap: state.settings.briefTokenCap
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
        const service = createDirectorService(api, state.settings);
        const result = await service.postResponse({
          responseText: input.content,
          brief: input.brief,
          messages: input.messages,
          directorState: state.director,
          memory: state.memory,
          assertiveness: state.settings.assertiveness
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
      openSettings: async () => {
        const dashboardStore = createDashboardStore(api, (mutator) => store.writeFirst(mutator));
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
