import type {
  DirectorSettings,
  MemoryUpdate,
  SceneBrief,
} from '../contracts/types.js'
import type { RisuaiApi } from '../contracts/risuai.js'
import type { DirectorContext, PostReviewContext } from './prompt.js'
import { buildPreRequestPrompt, buildPostResponsePrompt } from './prompt.js'
import { parseSceneBrief, parseMemoryUpdate, ModelPayloadError } from './validator.js'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DirectorCallSuccess {
  ok: true
  brief: SceneBrief
  raw: string
}

export interface PostReviewSuccess {
  ok: true
  update: MemoryUpdate
  raw: string
}

export interface DirectorCallFailure {
  ok: false
  error: string
  raw?: string
}

export type PreRequestResult = DirectorCallSuccess | DirectorCallFailure
export type PostResponseResult = PostReviewSuccess | DirectorCallFailure

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface DirectorService {
  preRequest(ctx: DirectorContext): Promise<PreRequestResult>
  postResponse(ctx: PostReviewContext): Promise<PostResponseResult>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDirectorService(
  api: RisuaiApi,
  settings: DirectorSettings,
): DirectorService {
  return {
    async preRequest(ctx: DirectorContext): Promise<PreRequestResult> {
      const messages = buildPreRequestPrompt(ctx)

      const llmResult = await api.runLLMModel({
        messages,
        staticModel: settings.directorModel,
        mode: settings.directorMode,
      })

      if (llmResult.type === 'fail') {
        return { ok: false, error: `LLM call failed: ${llmResult.result}` }
      }

      const raw = llmResult.result
      try {
        const brief = parseSceneBrief(raw)
        return { ok: true, brief, raw }
      } catch (err) {
        const message =
          err instanceof ModelPayloadError
            ? err.message
            : `SceneBrief parse error: ${String(err)}`
        return { ok: false, error: message, raw }
      }
    },

    async postResponse(ctx: PostReviewContext): Promise<PostResponseResult> {
      const messages = buildPostResponsePrompt(ctx)

      const llmResult = await api.runLLMModel({
        messages,
        staticModel: settings.directorModel,
        mode: settings.directorMode,
      })

      if (llmResult.type === 'fail') {
        return { ok: false, error: `LLM call failed: ${llmResult.result}` }
      }

      const raw = llmResult.result
      try {
        const update = parseMemoryUpdate(raw)
        return { ok: true, update, raw }
      } catch (err) {
        const message =
          err instanceof ModelPayloadError
            ? err.message
            : `MemoryUpdate parse error: ${String(err)}`
        return { ok: false, error: message, raw }
      }
    },
  }
}
