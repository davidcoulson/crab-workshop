// Pure logic for vitals-strip: the unraid-mcp and HA-MCP answers into chips.

import type { Chip, ChipLevel } from '../types'

/** The `result` of a unraid-mcp answer (`{"result": {...}}`), or the object itself. */
export function resultOf(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>
    const r = (v && typeof v === 'object' && 'result' in v ? v.result : v) as Record<string, unknown>
    return r && typeof r === 'object' ? r : null
  } catch {
    return null
  }
}

type ArraySummary = { state?: string; overall_health?: string; num_cache_pools?: number; num_data_disks?: number; health_summary?: Record<string, Record<string, number>> }

export function arrayChip(r: Record<string, unknown>): Chip {
  const s = (r.summary ?? r) as ArraySummary
  const pools = s.num_cache_pools ?? 0
  const sums = Object.values(s.health_summary ?? {})
  const failed = sums.reduce((n, h) => n + (h.failed ?? 0) + (h.missing ?? 0), 0)
  const warned = sums.reduce((n, h) => n + (h.warning ?? 0) + (h.critical ?? 0), 0)
  const started = s.state === 'STARTED'
  const healthy = s.overall_health === 'HEALTHY'
  const level: ChipLevel = !started || failed ? 'bad' : !healthy || warned ? 'warn' : 'ok'
  const what = [s.num_data_disks ? `${s.num_data_disks} disks` : '', pools ? `${pools} pools` : ''].filter(Boolean).join(', ')
  const text = level === 'ok' ? `array ok${what ? ` · ${what}` : ''}` : `array ${(s.state ?? '?').toLowerCase()} · ${(s.overall_health ?? '?').toLowerCase()}${failed ? ` · ${failed} failed/missing` : ''}${warned ? ` · ${warned} warning` : ''}`
  return { key: 'array', level, text, detail: `Array ${s.state ?? '?'}, health ${s.overall_health ?? '?'}${what ? ` (${what})` : ''}` }
}

export function metricsChip(r: Record<string, unknown>): Chip {
  const cpu = Number((r.cpu as { percentTotal?: number } | undefined)?.percentTotal ?? NaN)
  const mem = Number((r.memory as { percentTotal?: number } | undefined)?.percentTotal ?? NaN)
  const level: ChipLevel = mem >= 95 || cpu >= 95 ? 'bad' : mem >= 90 || cpu >= 85 ? 'warn' : 'ok'
  const text = `cpu ${Number.isFinite(cpu) ? Math.round(cpu) : '?'}% · mem ${Number.isFinite(mem) ? Math.round(mem) : '?'}%`
  return { key: 'load', level, text, detail: text }
}

type Container = { names?: string[]; state?: string; status?: string; autoStart?: boolean }

export function dockerChip(r: Record<string, unknown>): Chip {
  const list = ((r.containers as Container[] | undefined) ?? []).filter(c => c && typeof c === 'object')
  const name = (c: Container) => (c.names?.[0] ?? '?').replace(/^\//, '')
  const running = list.filter(c => c.state === 'RUNNING')
  const unhealthy = running.filter(c => /\(unhealthy\)/i.test(c.status ?? ''))
  const starting = running.filter(c => /\(health: starting\)/i.test(c.status ?? ''))
  const down = list.filter(c => c.autoStart && c.state !== 'RUNNING')
  const restarting = list.filter(c => /restarting/i.test(`${c.state} ${c.status}`))
  const level: ChipLevel = unhealthy.length || down.length || restarting.length ? 'bad' : starting.length ? 'info' : 'ok'
  const parts = [`🐳 ${running.length}/${list.length}`]
  if (unhealthy.length) parts.push(`unhealthy: ${unhealthy.map(name).slice(0, 3).join(', ')}${unhealthy.length > 3 ? ` +${unhealthy.length - 3}` : ''}`)
  if (down.length) parts.push(`down: ${down.map(name).slice(0, 3).join(', ')}${down.length > 3 ? ` +${down.length - 3}` : ''}`)
  if (restarting.length) parts.push(`restarting: ${restarting.map(name).slice(0, 2).join(', ')}`)
  return {
    key: 'docker',
    level,
    text: parts.join(' · '),
    detail: `Containers: ${running.length} running of ${list.length}${unhealthy.length ? `; unhealthy: ${unhealthy.map(name).join(', ')}` : ''}${down.length ? `; set to autostart but not running: ${down.map(name).join(', ')}` : ''}${starting.length ? `; starting: ${starting.map(name).join(', ')}` : ''}`,
  }
}

export function notificationChip(r: Record<string, unknown>): Chip {
  const u = (r.unread ?? {}) as { info?: number; warning?: number; alert?: number; total?: number }
  const level: ChipLevel = (u.alert ?? 0) > 0 ? 'bad' : (u.warning ?? 0) > 0 ? 'warn' : (u.total ?? 0) > 0 ? 'info' : 'ok'
  const parts = [u.alert ? `${u.alert} alert` : '', u.warning ? `${u.warning} warning` : '', u.info ? `${u.info} info` : ''].filter(Boolean)
  return { key: 'notes', level, text: parts.length ? `🔔 ${parts.join(', ')}` : '🔔 none', detail: `Unraid unread notifications: ${parts.join(', ') || 'none'}` }
}

export function parityChip(r: Record<string, unknown>): Chip | null {
  const d = (r.data ?? r) as { status?: string; progress?: number; running?: boolean | null; errors?: number | null; speed?: string }
  if (!d.running && !(d.errors ?? 0)) return null
  const level: ChipLevel = (d.errors ?? 0) > 0 ? 'bad' : 'info'
  const text = d.running ? `parity ${Math.round(d.progress ?? 0)}%${d.errors ? ` · ${d.errors} errors` : ''}` : `parity: ${d.errors} errors`
  return { key: 'parity', level, text, detail: `Parity ${d.status ?? ''} ${text}` }
}

export function haChip(r: Record<string, unknown>): Chip {
  const sys = (r.system_info ?? {}) as { version?: string; state?: string }
  const repairs = Number(r.repair_count ?? 0)
  const notes = Number(r.notification_count ?? 0)
  const running = (sys.state ?? 'RUNNING') === 'RUNNING'
  const level: ChipLevel = !running ? 'bad' : repairs ? 'warn' : notes ? 'info' : 'ok'
  const parts = [running ? `🏠 HA ${sys.version ?? ''}`.trim() : `🏠 HA ${(sys.state ?? '?').toLowerCase()}`]
  if (repairs) parts.push(`${repairs} repair${repairs === 1 ? '' : 's'}`)
  if (notes) parts.push(`${notes} notification${notes === 1 ? '' : 's'}`)
  return { key: 'ha', level, text: parts.join(' · '), detail: `Home Assistant ${sys.version ?? '?'} ${sys.state ?? '?'}: ${repairs} repairs, ${notes} notifications` }
}

const RANK: Record<ChipLevel, number> = { bad: 0, warn: 1, info: 2, ok: 3 }
export const byLevel = (chips: Chip[]): Chip[] => [...chips].sort((a, b) => RANK[a.level] - RANK[b.level])
export const worst = (chips: Chip[]): ChipLevel => byLevel(chips)[0]?.level ?? 'ok'

/** The chips the band shows: all of them, or (quiet) only the ones that aren't green or plain info. */
export const shown = (chips: Chip[], quiet: boolean): Chip[] => byLevel(quiet ? chips.filter(c => c.level === 'warn' || c.level === 'bad') : chips)

export function statusLine(chips: Chip[], errors: string[]): string | undefined {
  if (!chips.length) return errors.length ? 'vitals: no data' : undefined
  const w = worst(chips)
  const n = chips.filter(c => c.level === 'warn' || c.level === 'bad').length
  return w === 'ok' || w === 'info' ? 'vitals: all green' : `vitals: ${n} need${n === 1 ? 's' : ''} a look`
}
