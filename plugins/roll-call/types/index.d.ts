export type RollRow = {
  id: string
  name: string
  title: string
  isRunning: boolean
  lastActivityAt: string
  prNumber?: number
  prState?: string
  /** One line on where the session stands. */
  status: string
  /** What the owner must do, or '' when nothing. */
  needsYou: string
  /** Who wrote the line. */
  via: 'haiku' | 'local' | 'last message' | 'cache'
}

export type RollCall = {
  rows: RollRow[]
  /** When the last roll call finished (ms). */
  at: number
  /** Sessions still being read in the roll call running now; 0 when none runs. */
  pending: number
  error?: string
  scope: 'linked' | 'open'
}

declare module 'claude-code' {
  interface PluginState {
    'roll-call': {
      roll: RollCall
      now: number
    }
  }
}
