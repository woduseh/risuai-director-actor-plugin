import type { HookRequestType, OpenAIChat, TurnContext } from '../contracts/types.js'

let nextId = 0
function generateTurnId(): string {
  return `turn-${Date.now()}-${++nextId}`
}

export class TurnCache {
  private readonly turns = new Map<string, TurnContext>()

  begin(type: HookRequestType, messages: OpenAIChat[]): TurnContext {
    const turn: TurnContext = {
      turnId: generateTurnId(),
      type,
      originalMessages: structuredClone(messages),
      finalized: false,
      createdAt: Date.now()
    }
    this.turns.set(turn.turnId, turn)
    return structuredClone(turn)
  }

  get(turnId: string): TurnContext | undefined {
    const turn = this.turns.get(turnId)
    return turn ? structuredClone(turn) : undefined
  }

  patch(turnId: string, updates: Partial<TurnContext>): TurnContext {
    const turn = this.turns.get(turnId)
    if (!turn) {
      throw new Error(`TurnCache: unknown turnId "${turnId}"`)
    }
    Object.assign(turn, updates)
    return structuredClone(turn)
  }

  finalize(turnId: string): void {
    const turn = this.turns.get(turnId)
    if (!turn) {
      throw new Error(`TurnCache: unknown turnId "${turnId}"`)
    }
    turn.finalized = true
  }

  drop(turnId: string): void {
    this.turns.delete(turnId)
  }
}
