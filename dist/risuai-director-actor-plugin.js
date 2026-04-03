//@name risuai-director-actor-plugin
//@display-name RisuAI Director Actor
//@api 3.0
//@version 0.1.0
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
    directorModel: "gpt-4.1-mini",
    directorMode: "otherAx",
    briefTokenCap: 320,
    postReviewEnabled: true,
    embeddingsEnabled: false,
    injectionMode: "auto",
    includeTypes: ["model"],
    cooldownFailureThreshold: 3,
    cooldownMs: 6e4,
    outputDebounceMs: 400
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
        turnArchive: []
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
    async load() {
      const raw = await this.storage.getItem(DIRECTOR_STATE_STORAGE_KEY);
      if (isValidState(raw)) {
        this.current = structuredClone(raw);
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

  // src/memory/applyUpdate.ts
  var MAX_FAILURE_HISTORY = 50;
  var MAX_SCENE_LEDGER = 200;
  function createId(prefix) {
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
  function uniqueStrings(values) {
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
      existing.entityIds = uniqueStrings([
        ...existing.entityIds ?? [],
        ...readStringArray(partial?.entityIds)
      ]);
      existing.updatedAt = now;
      return;
    }
    const next = {
      id: partial?.id ?? createId("summary"),
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
      existing.tags = uniqueStrings([...existing.tags ?? [], ...readStringArray(partial?.tags)]);
      existing.updatedAt = now;
      return;
    }
    const next = {
      id: partial?.id ?? createId("world"),
      text,
      updatedAt: now
    };
    const tags = readStringArray(partial?.tags);
    if (tags.length > 0) {
      next.tags = tags;
    }
    worldFacts.push(next);
  }
  function upsertContinuityFact(state, text, now, partial) {
    const existing = state.director.continuityFacts.find(
      (entry) => entry.text === text || entry.id === partial?.id
    );
    if (existing) {
      existing.text = text;
      existing.priority = partial?.priority ?? existing.priority;
      if (partial?.sceneId !== void 0) {
        existing.sceneId = partial.sceneId;
      }
      existing.entityIds = uniqueStrings([
        ...existing.entityIds ?? [],
        ...partial?.entityIds ?? []
      ]);
      return;
    }
    const next = {
      id: partial?.id ?? createId("continuity"),
      text,
      priority: partial?.priority ?? 0.8
    };
    if (partial?.sceneId !== void 0) {
      next.sceneId = partial.sceneId;
    }
    if (partial?.entityIds && partial.entityIds.length > 0) {
      next.entityIds = partial.entityIds;
    }
    state.director.continuityFacts.push(next);
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
      id: id ?? createId("arc"),
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
            id: createId("archive"),
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
          if (!removeByIdentity(
            state.director.continuityFacts,
            payload,
            (entry) => entry.text === text
          )) {
            warnings.push(`Could not drop continuity fact "${text ?? payload.id ?? "unknown"}".`);
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
        upsertContinuityFact(state, text, now, {
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
      upsertContinuityFact(next, lock, now, { sceneId: next.director.currentSceneId });
    }
    if (isScenePhase(update.sceneDelta.scenePhase)) {
      next.director.scenePhase = update.sceneDelta.scenePhase;
    }
    for (const durableFact of uniqueStrings(update.durableFacts)) {
      upsertSummary(next.memory.summaries, durableFact, now, {
        sceneId: next.director.currentSceneId,
        recencyWeight: 1
      });
    }
    for (const worldChange of uniqueStrings(update.sceneDelta.worldStateChanges ?? [])) {
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
      next.actor.currentIntentHints = uniqueStrings([
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
    const textOverlap = itemTokens.length > 0 ? itemTokens.filter((t) => messageTokens.has(t)).length / itemTokens.length * TEXT_OVERLAP_WEIGHT : 0;
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

  // src/ui/settings.ts
  var SETTING_NAME = "Director Settings";
  var BUTTON_NAME = "Director";
  var BUTTON_ICON = "\u{1F3AC}";
  async function showSettingsOverlay(api, settings = DEFAULT_DIRECTOR_SETTINGS) {
    const lines = [
      `\u2500\u2500 Director Plugin Settings \u2500\u2500`,
      `Enabled: ${String(settings.enabled)}`,
      `Assertiveness: ${settings.assertiveness}`,
      `Model: ${settings.directorModel}`,
      `Injection: ${settings.injectionMode}`,
      `Post-review: ${String(settings.postReviewEnabled)}`,
      `Brief cap: ${String(settings.briefTokenCap)} tokens`
    ];
    await api.alert(lines.join("\n"));
  }
  async function registerPluginUi(api, options) {
    await api.registerSetting(
      SETTING_NAME,
      async () => {
        await options.onOpen();
      },
      BUTTON_ICON,
      "html"
    );
    await api.registerButton(
      {
        name: BUTTON_NAME,
        icon: BUTTON_ICON,
        iconType: "html",
        location: "chat"
      },
      async () => {
        await options.onOpen();
      }
    );
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
        const current = await store.load();
        await showSettingsOverlay(api, current.settings);
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
