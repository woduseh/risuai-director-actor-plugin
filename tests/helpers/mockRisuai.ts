import type {
  AfterRequestHandler,
  AsyncJsonValue,
  AsyncKeyValueStore,
  BeforeRequestHandler,
  BodyIntercepter,
  RegisterButtonOptions,
  RegisterUiResponse,
  RisuaiApi,
  RunLLMModelInput,
  RunLLMModelResult,
  ScriptHandler
} from '../../src/contracts/risuai.js'
import type { HookRequestType, OpenAIChat, ScriptMode } from '../../src/contracts/types.js'

export class InMemoryAsyncStore implements AsyncKeyValueStore {
  private readonly data = new Map<string, unknown>()

  async getItem<T = unknown>(key: string): Promise<T | null> {
    return (this.data.has(key) ? (this.data.get(key) as T) : null)
  }

  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value))
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key)
  }

  async clear(): Promise<void> {
    this.data.clear()
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys())
  }

  async length(): Promise<number> {
    return this.data.size
  }
}

export interface MockRisuaiApi extends RisuaiApi {
  __beforeRequestHandlers: BeforeRequestHandler[]
  __afterRequestHandlers: AfterRequestHandler[]
  __scriptHandlers: Record<ScriptMode, ScriptHandler[]>
  __bodyIntercepters: BodyIntercepter[]
  __logs: string[]
  __alerts: string[]
  __llmQueue: RunLLMModelResult[]
  __nativeFetchQueue: Array<Response>
  __containerVisible: boolean
  __arguments: Record<string, string | number>
  __registerCalls: Array<{
    kind: 'setting' | 'button'
    name: string
    id: string
    callback: () => Promise<void> | void
  }>
  enqueueLlmResult(result: RunLLMModelResult): void
  enqueueNativeFetchJson(
    payload: unknown,
    init?: { status?: number; ok?: boolean; headers?: HeadersInit }
  ): void
  runBeforeRequest(messages: OpenAIChat[], type?: HookRequestType): Promise<OpenAIChat[]>
  runAfterRequest(content: string, type?: HookRequestType): Promise<string>
  runOutput(content: string): Promise<string>
  runBodyIntercepters(body: AsyncJsonValue, type?: HookRequestType): Promise<AsyncJsonValue>
  runRegistered(kind: 'setting' | 'button', name?: string): Promise<void>
  runUnload(): Promise<void>
}

export function createMockRisuaiApi(): MockRisuaiApi {
  const beforeRequestHandlers: BeforeRequestHandler[] = []
  const afterRequestHandlers: AfterRequestHandler[] = []
  const bodyIntercepters: BodyIntercepter[] = []
  const unloadHandlers: Array<() => Promise<void> | void> = []
  const scriptHandlers: Record<ScriptMode, ScriptHandler[]> = {
    display: [],
    input: [],
    output: [],
    process: []
  }
  const llmQueue: RunLLMModelResult[] = []
  const nativeFetchQueue: Response[] = []
  const logs: string[] = []
  const alerts: string[] = []
  const registerCalls: Array<{
    kind: 'setting' | 'button'
    name: string
    id: string
    callback: () => Promise<void> | void
  }> = []
  const args: Record<string, string | number> = {}

  const makeUiResponse = (id: string): RegisterUiResponse => ({ id })

  const api: MockRisuaiApi = {
    apiVersion: '3.0',
    apiVersionCompatibleWith: ['3.0'],
    pluginStorage: new InMemoryAsyncStore(),
    safeLocalStorage: new InMemoryAsyncStore(),
    __beforeRequestHandlers: beforeRequestHandlers,
    __afterRequestHandlers: afterRequestHandlers,
    __scriptHandlers: scriptHandlers,
    __bodyIntercepters: bodyIntercepters,
    __logs: logs,
    __alerts: alerts,
    __llmQueue: llmQueue,
    __nativeFetchQueue: nativeFetchQueue,
    __containerVisible: false,
    __arguments: args,
    __registerCalls: registerCalls,
    enqueueLlmResult(result: RunLLMModelResult): void {
      llmQueue.push(result)
    },
    enqueueNativeFetchJson(
      payload: unknown,
      init?: { status?: number; ok?: boolean; headers?: HeadersInit }
    ): void {
      const status = init?.status ?? (init?.ok === false ? 500 : 200)
      const headers = new Headers(init?.headers)
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
      nativeFetchQueue.push(
        new Response(JSON.stringify(payload), {
          status,
          headers
        })
      )
    },
    async showContainer(): Promise<void> {
      api.__containerVisible = true
    },
    async hideContainer(): Promise<void> {
      api.__containerVisible = false
    },
    async addRisuReplacer(type: 'beforeRequest' | 'afterRequest', fn: BeforeRequestHandler | AfterRequestHandler): Promise<void> {
      if (type === 'beforeRequest') {
        beforeRequestHandlers.push(fn as BeforeRequestHandler)
        return
      }
      afterRequestHandlers.push(fn as AfterRequestHandler)
    },
    async addRisuScriptHandler(mode: ScriptMode, fn: ScriptHandler): Promise<void> {
      scriptHandlers[mode].push(fn)
    },
    async registerBodyIntercepter(fn: BodyIntercepter): Promise<void> {
      bodyIntercepters.push(fn)
    },
    async runLLMModel(_input: RunLLMModelInput): Promise<RunLLMModelResult> {
      return llmQueue.shift() ?? { type: 'fail', result: 'Mock LLM queue exhausted' }
    },
    async nativeFetch(): Promise<Response> {
      return nativeFetchQueue.shift() ?? new Response('Mock fetch queue exhausted', {
        status: 500
      })
    },
    async getArgument(key: string): Promise<string | number | undefined> {
      return args[key]
    },
    async setArgument(key: string, value: string | number): Promise<void> {
      args[key] = value
    },
    async registerSetting(name: string, _callback: () => Promise<void> | void, _icon?: string, _iconType?: 'html' | 'img' | 'none', id?: string): Promise<RegisterUiResponse> {
      const resolvedId = id ?? `setting:${name}`
      registerCalls.push({ kind: 'setting', name, id: resolvedId, callback: _callback })
      return makeUiResponse(resolvedId)
    },
    async registerButton(options: RegisterButtonOptions, _callback: () => Promise<void> | void): Promise<RegisterUiResponse> {
      const resolvedId = options.id ?? `button:${options.name}`
      registerCalls.push({
        kind: 'button',
        name: options.name,
        id: resolvedId,
        callback: _callback
      })
      return makeUiResponse(resolvedId)
    },
    async unregisterUIPart(id: string): Promise<void> {
      const index = registerCalls.findIndex((entry) => entry.id === id)
      if (index >= 0) {
        registerCalls.splice(index, 1)
      }
    },
    async onUnload(fn: () => Promise<void> | void): Promise<void> {
      unloadHandlers.push(fn)
    },
    log(message: string): void {
      logs.push(message)
    },
    async alertError(message: string): Promise<void> {
      alerts.push(message)
    },
    async alert(message: string): Promise<void> {
      alerts.push(message)
    },
    async getRuntimeInfo() {
      return {
        apiVersion: '3.0',
        platform: 'mock',
        saveMethod: 'mock-storage'
      }
    },
    async runBeforeRequest(messages: OpenAIChat[], type: HookRequestType = 'model'): Promise<OpenAIChat[]> {
      let current = structuredClone(messages)
      for (const handler of beforeRequestHandlers) {
        current = await handler(current, type)
      }
      return current
    },
    async runAfterRequest(content: string, type: HookRequestType = 'model'): Promise<string> {
      let current = content
      for (const handler of afterRequestHandlers) {
        current = await handler(current, type)
      }
      return current
    },
    async runOutput(content: string): Promise<string> {
      let current = content
      for (const handler of scriptHandlers.output) {
        const next = await handler(current)
        current = next ?? current
      }
      return current
    },
    async runBodyIntercepters(body: AsyncJsonValue, type: HookRequestType = 'model'): Promise<AsyncJsonValue> {
      let current = structuredClone(body)
      for (const handler of bodyIntercepters) {
        current = await handler(current, type)
      }
      return current
    },
    async runRegistered(kind: 'setting' | 'button', name?: string): Promise<void> {
      const entry = registerCalls.find((call) =>
        call.kind === kind && (name === undefined || call.name === name)
      )
      if (!entry) {
        throw new Error(`No registered ${kind}${name ? ` named "${name}"` : ''}`)
      }
      await entry.callback()
    },
    async runUnload(): Promise<void> {
      for (const handler of unloadHandlers) {
        await handler()
      }
    }
  }

  return api
}
