import type { HookRequestType, MemoryUpdate, OpenAIChat, ReplacerType, SceneBrief, ScriptMode } from './types.js'

export type AsyncJsonValue =
  | null
  | boolean
  | number
  | string
  | AsyncJsonValue[]
  | { [key: string]: AsyncJsonValue }

export interface AsyncKeyValueStore {
  getItem<T = unknown>(key: string): Promise<T | null>
  setItem<T = unknown>(key: string, value: T): Promise<void>
  removeItem(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
  length(): Promise<number>
}

export interface RegisterUiResponse {
  id: string
}

export interface RegisterButtonOptions {
  name: string
  icon: string
  iconType?: 'html' | 'img' | 'none'
  location: 'action' | 'chat' | 'hamburger'
  id?: string
}

export interface RunLLMModelInput {
  messages: OpenAIChat[]
  staticModel?: string
  mode?: 'model' | 'otherAx' | string
}

export interface RunLLMModelSuccess {
  type: 'success'
  result: string
}

export interface RunLLMModelFailure {
  type: 'fail'
  result: string
}

export type RunLLMModelResult = RunLLMModelSuccess | RunLLMModelFailure

export type BeforeRequestHandler = (messages: OpenAIChat[], type: HookRequestType) => Promise<OpenAIChat[]>
export type AfterRequestHandler = (content: string, type: HookRequestType) => Promise<string>
export type ScriptHandler = (content: string) => Promise<string | null>
export type BodyIntercepter = (body: AsyncJsonValue, type: HookRequestType) => Promise<AsyncJsonValue>

export interface RuntimeInfo {
  apiVersion: string
  platform: string
  saveMethod: string
}

export interface RisuaiApi {
  apiVersion: string
  apiVersionCompatibleWith: string[]
  pluginStorage: AsyncKeyValueStore
  safeLocalStorage: AsyncKeyValueStore
  addRisuReplacer(type: 'beforeRequest', fn: BeforeRequestHandler): Promise<void>
  addRisuReplacer(type: 'afterRequest', fn: AfterRequestHandler): Promise<void>
  addRisuScriptHandler(mode: ScriptMode, fn: ScriptHandler): Promise<void>
  registerBodyIntercepter(fn: BodyIntercepter): Promise<void>
  runLLMModel(input: RunLLMModelInput): Promise<RunLLMModelResult>
  registerSetting(
    name: string,
    callback: () => Promise<void> | void,
    icon?: string,
    iconType?: 'html' | 'img' | 'none',
    id?: string
  ): Promise<RegisterUiResponse>
  registerButton(
    options: RegisterButtonOptions,
    callback: () => Promise<void> | void
  ): Promise<RegisterUiResponse>
  onUnload(fn: () => Promise<void> | void): Promise<void>
  log(message: string): Promise<void> | void
  alertError(message: string): Promise<void>
  alert(message: string): Promise<void>
  getRuntimeInfo(): Promise<RuntimeInfo>
}

export interface DirectorCallArtifacts {
  brief: SceneBrief
  raw: string
}

export interface PostReviewArtifacts {
  update: MemoryUpdate
  raw: string
}

