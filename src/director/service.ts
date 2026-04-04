import type {
  DirectorSettings,
  MemoryUpdate,
  SceneBrief,
} from '../contracts/types.js'
import type { RisuaiApi, RunLLMModelResult } from '../contracts/risuai.js'
import type { DirectorContext, PostReviewContext } from './prompt.js'
import { buildPreRequestPrompt, buildPostResponsePrompt } from './prompt.js'
import { parseSceneBrief, parseMemoryUpdate, ModelPayloadError } from './validator.js'
import { createCopilotClient, type CopilotClient } from '../provider/copilotClient.js'

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
  const copilotClient: CopilotClient | null =
    settings.directorProvider === 'copilot'
      ? createCopilotClient((url, init) => api.nativeFetch(url, init))
      : null

  async function callLlm(
    messages: Array<{ role: string; content: string }>,
  ): Promise<RunLLMModelResult> {
    if (copilotClient) {
      try {
        const text = await copilotClient.complete(
          settings.directorCopilotToken,
          settings.directorModel,
          messages,
        )
        return { type: 'success', result: text }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { type: 'fail', result: msg }
      }
    }

    return api.runLLMModel({
      messages: messages as Parameters<typeof api.runLLMModel>[0]['messages'],
      staticModel: settings.directorModel,
      mode: settings.directorMode,
    })
  }

  return {
    async preRequest(ctx: DirectorContext): Promise<PreRequestResult> {
      const messages = buildPreRequestPrompt(ctx)
      const llmResult = await callLlm(messages)

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
      const llmResult = await callLlm(messages)

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
