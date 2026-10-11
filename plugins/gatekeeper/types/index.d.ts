export type Lane = 'you' | 'work' | 'waiting' | 'clear'

export type Gate = {
  repo: string
  number: number
  title: string
  url: string
  isDraft: boolean
  /** Unticked boxes that are yours to tick, by their text. */
  yourBoxes: string[]
  /** Unresolved CodeRabbit threads, and whether its latest review asks for changes. */
  rabbitOpen: number
  rabbitChanges: boolean
  /** Codecov's patch or project check: pass, fail, pending, or absent. */
  codecov?: 'pass' | 'fail' | 'pending'
  ci?: 'pass' | 'fail' | 'pending'
  /** Failing check names, a few. */
  failing: string[]
  hasConflicts: boolean
  reviewDecision?: string
  lane: Lane
  /** Why it's in its lane, in a few words. */
  why: string
}

export type Gates = {
  gates: Gate[]
  total: number
  at: number
  isBusy: boolean
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    gatekeeper: {
      gates: Gates
      now: number
    }
  }
}
