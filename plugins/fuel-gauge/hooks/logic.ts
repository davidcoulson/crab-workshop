// Pure logic for fuel-gauge.

import type { FleetRow, FuelReading, FuelWindow } from '../types'

export const WINDOW_NAME: Record<string, string> = { five_hour: '5h', seven_day: 'wk', spend_limit: 'spend' }

export const shortName = (kind: string): string =>
  WINDOW_NAME[kind] ?? (/5-hour/i.test(kind) ? '5h' : /weekly · all/i.test(kind) ? 'wk' : /weekly · (\w+)/i.test(kind) ? `wk ${kind.match(/weekly · (\w+)/i)?.[1]?.toLowerCase()}` : kind)

/** "34m", "5d 14h", "2h 5m" until an ISO time. */
export function until(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
/** Pace warning threshold, as a multiple of an even burn. */
export const PACE_WARN = 1.2

export type Pace = { pace: number; runsOutAt?: number; perDay: number; daysLeft: number }

/**
 * How fast a weekly window is burning against an even spend. The window starts
 * 7 days before it resets. Undefined for other windows, or in the first hour
 * (too noisy), or when the reset has passed.
 */
export function paceOf(w: FuelWindow, now: number): Pace | undefined {
  if (!shortName(w.kind).startsWith('wk') || !w.resetsAt) return undefined
  const end = Date.parse(w.resetsAt)
  const elapsed = now - (end - WEEK_MS)
  if (!Number.isFinite(end) || elapsed < WEEK_MS / 168 || end <= now) return undefined
  const pace = w.percentUsed / ((elapsed / WEEK_MS) * 100)
  const left = Math.max(0, 100 - w.percentUsed)
  const daysLeft = (end - now) / DAY_MS
  const runsOutAt = pace > 1 && w.percentUsed > 0 ? now + (left * elapsed) / w.percentUsed : undefined
  return { pace, ...(runsOutAt !== undefined ? { runsOutAt } : {}), perDay: left / daysLeft, daysLeft }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Wed 05:00", local time. */
export function dayTime(ms: number): string {
  const d = new Date(ms)
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "1.4× pace · runs out Wed 05:00 at this pace · 9%/day left", or undefined for non-weekly windows. */
export function paceText(w: FuelWindow, now: number): string | undefined {
  const p = paceOf(w, now)
  if (!p) return undefined
  const parts = [`${p.pace.toFixed(1)}× pace`]
  if (w.percentUsed >= 100) parts.push('limit reached')
  else {
    if (p.runsOutAt !== undefined) parts.push(`runs out ${dayTime(p.runsOutAt)} at this pace`)
    parts.push(`${Math.round(p.perDay * 10) / 10}%/day budget`)
  }
  return parts.join(' · ')
}

/** The short form for narrow panes: "1.8× · out Wed 05:00", or "0.6× · 20%/day". */
export function paceShort(w: FuelWindow, now: number): string | undefined {
  const p = paceOf(w, now)
  if (!p) return undefined
  if (w.percentUsed >= 100) return `${p.pace.toFixed(1)}× · limit reached`
  return `${p.pace.toFixed(1)}× · ${p.runsOutAt !== undefined ? `out ${dayTime(p.runsOutAt)}` : `${Math.round(p.perDay * 10) / 10}%/day`}`
}

/** The status line: `ctx 14% · 5h 26% (34m) · wk 36% (1.8× · out Mon 12:00)`. */
export function statusText(r: FuelReading, now: number): string | undefined {
  const parts: string[] = []
  if (r.contextPercent !== undefined) parts.push(`ctx ${Math.round(r.contextPercent)}%`)
  for (const w of r.windows) {
    const name = shortName(w.kind)
    const left = name === '5h' ? until(w.resetsAt, now) : ''
    const p = paceOf(w, now)
    const pace = p ? `${p.pace.toFixed(1)}×${p.runsOutAt !== undefined ? ` · ${w.percentUsed >= 100 ? 'out' : `out ${dayTime(p.runsOutAt)}`}` : ''}` : ''
    const note = left || pace
    parts.push(`${name} ${Math.round(w.percentUsed)}%${note ? ` (${note})` : ''}`)
  }
  if (r.costUsd !== undefined && r.costUsd >= 0.01) parts.push(`$${r.costUsd.toFixed(2)}`)
  return parts.length ? `⛽ ${parts.join(' · ')}` : undefined
}

/**
 * Which threshold toasts are due: one per window and threshold, keyed by the
 * window's reset time so the next window warns afresh.
 */
export function dueWarnings(windows: FuelWindow[], thresholds: number[], said: ReadonlySet<string>, now?: number): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  for (const w of windows) {
    // Pace: once per window when a weekly window burns faster than PACE_WARN times an even spend.
    const p = now === undefined ? undefined : paceOf(w, now)
    const paceKey = `${w.kind}@${w.resetsAt ?? ''}:pace`
    if (p && p.pace >= PACE_WARN && w.percentUsed < 100 && !said.has(paceKey))
      out.push({ key: paceKey, text: `${shortName(w.kind) === 'wk' ? 'Weekly' : w.kind} pace ${p.pace.toFixed(1)}×${p.runsOutAt !== undefined ? `: runs out ${dayTime(p.runsOutAt)} at this pace` : ''}, budget ${Math.round(p.perDay * 10) / 10}%/day` })
    const crossed = thresholds.filter(t => w.percentUsed >= t).sort((a, b) => b - a)[0]
    if (crossed === undefined) continue
    const key = `${w.kind}@${w.resetsAt ?? ''}:${crossed}`
    if (said.has(key)) continue
    out.push({ key, text: `${shortName(w.kind) === '5h' ? '5-hour' : shortName(w.kind) === 'wk' ? 'Weekly' : w.kind} limit at ${Math.round(w.percentUsed)}%` })
  }
  return out
}

/** The app's get_usage answer, parsed loosely (its shape is the app's, not the mod API's). */
export function parseUsage(text: string): { windows: FuelWindow[]; extra?: FuelReading['extra']; context?: { percent?: number; tokens?: number; window?: number; note?: string } } | null {
  let v: unknown
  try {
    v = JSON.parse(text.slice(text.indexOf('{')))
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as {
    plan?: { windows?: { label?: string; percentUsed?: number; resetsAt?: string }[]; extraUsage?: { enabled?: boolean; spent?: string | number; monthlyLimit?: string | number; currency?: string } }
    context?: { status?: string; tokensUsed?: number; contextWindow?: number; percentUsed?: number; note?: string }
  }
  const windows = (o.plan?.windows ?? [])
    .filter(w => typeof w.label === 'string' && typeof w.percentUsed === 'number')
    .map(w => ({ kind: String(w.label), percentUsed: Number(w.percentUsed), ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) }))
  const x = o.plan?.extraUsage
  const extra = x && x.spent !== undefined ? { spent: Number(x.spent), limit: Number(x.monthlyLimit ?? 0), currency: x.currency ?? 'USD', isEnabled: x.enabled === true } : undefined
  const c = o.context
  const context = c
    ? c.status === 'ok'
      ? { percent: c.percentUsed, tokens: c.tokensUsed, window: c.contextWindow }
      : { note: c.status ?? 'unavailable' }
    : undefined
  return { windows, ...(extra ? { extra } : {}), ...(context ? { context } : {}) }
}

export const fleetOrder = (rows: FleetRow[]): FleetRow[] => [...rows].sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))

/** A text bar for the terminal: ████░░░░ 42%. */
export function bar(pct: number, width = 12): string {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export const compactTokens = (n: number | undefined): string =>
  n === undefined ? '' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
