import { describe, expect, test } from 'claude-code/testing'

import { FETCH_STALE_MS, FORCE_MIN_GAP_MS, isRateLimited, parseShared, plan } from '../hooks/cache'

const MIN = 60_000
const POLL = 15 * MIN
const T = 1_800_000_000_000

describe('shared read', () => {
  test('one session reads GitHub; the rest reuse it until it is due', () => {
    expect(plan({}, T, POLL, false)).toEqual({ kind: 'fetch' })
    expect(plan({ at: T - 5 * MIN }, T, POLL, false)).toEqual({ kind: 'reuse', why: 'fresh' })
    expect(plan({ at: T - 14 * MIN }, T, POLL, false)).toEqual({ kind: 'fetch' })
  })
  test('a read in flight elsewhere is waited for, unless it looks dead', () => {
    expect(plan({ at: T - 20 * MIN, fetchingSince: T - 10_000 }, T, POLL, false)).toEqual({ kind: 'reuse', why: 'another session is reading' })
    expect(plan({ at: T - 20 * MIN, fetchingSince: T - FETCH_STALE_MS - 1 }, T, POLL, false)).toEqual({ kind: 'fetch' })
  })
  test('forced refreshes still reuse a read from the last minute', () => {
    expect(plan({ at: T - 30_000 }, T, POLL, true)).toEqual({ kind: 'reuse', why: 'fresh' })
    expect(plan({ at: T - FORCE_MIN_GAP_MS - 1 }, T, POLL, true)).toEqual({ kind: 'fetch' })
  })
  test('nobody reads while the rate limit is spent, forced or not', () => {
    expect(plan({ backoffUntil: T + MIN }, T, POLL, true)).toEqual({ kind: 'reuse', why: 'rate limited' })
    expect(plan({ backoffUntil: T - 1 }, T, POLL, true)).toEqual({ kind: 'fetch' })
  })
  test('parsing and rate-limit detection', () => {
    expect(parseShared('not json')).toEqual({})
    expect(parseShared('{"at":5}')).toEqual({ at: 5 })
    expect(isRateLimited('GraphQL: API rate limit already exceeded for user ID 1.')).toBe(true)
    expect(isRateLimited('HTTP 502')).toBe(false)
  })
})
