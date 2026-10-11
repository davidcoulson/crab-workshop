export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type Round = {
  /** approve, needs-attention, or unknown when the output had no verdict. */
  verdict: 'approve' | 'needs-attention' | 'unknown'
  findings: Record<Severity, number>
  /** The first finding titles, a few. */
  titles: string[]
  startedAt: number
  endedAt: number
  kind: 'adversarial-review' | 'review'
}

export type Bout = {
  /** repo@branch */
  key: string
  rounds: Round[]
}

export type Ring = {
  /** The bout on screen. */
  key: string
  /** A review is running now (since). */
  runningSince?: number
  /** When the last round landed; the band shows for a minute after. */
  landedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'codex-corner': {
      ring: Ring | null
      bout: Bout | null
      now: number
    }
  }
}
