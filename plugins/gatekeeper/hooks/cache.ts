// The read of your PRs that every session shares, so that one session asks
// GitHub and the rest reuse its answer (each session polling on its own ran
// the GraphQL rate limit dry with a few dozen sessions open).

import type { Gate } from '../types'

export type SharedRead = {
  /** When GitHub was last read successfully (ms). */
  at?: number
  gates?: Gate[]
  total?: number
  /** A session started reading GitHub at this time and hasn't finished. */
  fetchingSince?: number
  /** GitHub said the rate limit is spent: nobody reads until then (ms). */
  backoffUntil?: number
}

export type Plan = { kind: 'fetch' } | { kind: 'reuse'; why: 'fresh' | 'another session is reading' | 'rate limited' }

/** A session already reading GitHub for longer than this has probably died. */
export const FETCH_STALE_MS = 90_000
/** Even a forced refresh (Refresh, /gates text, after a push) reuses a read this recent. */
export const FORCE_MIN_GAP_MS = 60_000

/** Whether this session should ask GitHub now, or reuse the shared read. */
export function plan(shared: SharedRead, nowMs: number, pollMs: number, force: boolean): Plan {
  if (shared.backoffUntil && nowMs < shared.backoffUntil) return { kind: 'reuse', why: 'rate limited' }
  if (shared.fetchingSince && nowMs - shared.fetchingSince < FETCH_STALE_MS) return { kind: 'reuse', why: 'another session is reading' }
  const age = shared.at ? nowMs - shared.at : Infinity
  // A little slack, so a session whose timer fires just after another's read reuses it.
  if (age < (force ? FORCE_MIN_GAP_MS : pollMs * 0.9)) return { kind: 'reuse', why: 'fresh' }
  return { kind: 'fetch' }
}

export function parseShared(text: string): SharedRead {
  try {
    const v = JSON.parse(text) as SharedRead
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export const isRateLimited = (text: string): boolean => /rate limit/i.test(text)
