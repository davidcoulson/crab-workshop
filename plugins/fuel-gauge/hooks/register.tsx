import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetRow, FuelReading, FuelWindow } from '../types'
import { bar, compactTokens, dueWarnings, fleetOrder, parseUsage, shortName, statusText, until } from './logic'
import { crab } from './shared/crab'
import { FONT, fit, meter, svg, widthFor, xml } from './shared/draw'

const reading = atom({ plugin: 'fuel-gauge', key: 'reading' } as const, { windows: [], at: 0 })
const fleet = atom({ plugin: 'fuel-gauge', key: 'fleet' } as const, { rows: [], at: 0, isBusy: false })
const now = atom({ plugin: 'fuel-gauge', key: 'now' } as const, 0)

const PANE = 'fuel-gauge'
const TITLE = 'Fuel gauge'
const MGMT = 'ccd_session_mgmt'
const SAID = 'fuel-gauge.said'

let warnAt = 80
let alarmAt = 95
let contextWarnAt = 85

const textOf = (r: { content: readonly unknown[] }): string =>
  r.content.map(b => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join('')

type Measured = { context?: { percent?: number; tokens?: number; window?: number }; rateLimits?: readonly FuelWindow[]; cost?: { usd: number } }

async function take($: EngineInterface, m: Measured): Promise<void> {
  const at = await $.clock.now()
  const r = await update($, reading, prev => ({
    ...prev,
    ...(m.context?.percent !== undefined ? { contextPercent: m.context.percent } : {}),
    ...(m.context?.tokens !== undefined ? { contextTokens: m.context.tokens } : {}),
    ...(m.context?.window !== undefined ? { contextWindow: m.context.window } : {}),
    // The engine's windows when it has some; else keep the app's (from get_usage).
    windows: m.rateLimits && m.rateLimits.length ? m.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) })) : prev.windows,
    ...(m.cost ? { costUsd: m.cost.usd } : {}),
    at,
  }))
  $.ui.status(statusText(r, at))
  await warn($, r)
}

async function warn($: EngineInterface, r: FuelReading): Promise<void> {
  const said = new Set(((await $.store.get(SAID)) as string[] | undefined) ?? [])
  const due = dueWarnings(r.windows, [warnAt, alarmAt], said)
  const id = await $.session.id()
  const ctxKey = `ctx:${id}`
  if (r.contextPercent !== undefined && r.contextPercent >= contextWarnAt && !said.has(ctxKey))
    due.push({ key: ctxKey, text: `Context at ${Math.round(r.contextPercent)}%: a good moment to wrap up, hand off or compact` })
  if (!due.length) return
  for (const d of due) {
    said.add(d.key)
    $.ui.toast(`⛽ ${d.text}`)
  }
  // Keep the newest few hundred keys; old windows' keys can go.
  await $.store.set(SAID, [...said].slice(-300))
}

/** Plan windows and extra usage from the app (richer than the engine's own), plus every running linked session's context. */
async function refreshFleet($: EngineInterface): Promise<string> {
  await update($, fleet, f => ({ ...f, isBusy: true, error: undefined }))
  try {
    const self = await $.mcp.call(MGMT, 'get_usage', {})
    const mine = parseUsage(textOf(self))
    if (mine) await update($, reading, r => ({ ...r, windows: mine.windows.length ? mine.windows : r.windows, ...(mine.extra ? { extra: mine.extra } : {}) }))
    const listed = await $.mcp.call(MGMT, 'list_sessions', { linked: true, limit: 60 })
    let rows: { sessionId: string; name?: string; title?: string; isRunning?: boolean }[] = []
    try {
      const t = textOf(listed)
      rows = JSON.parse(t.slice(t.indexOf('[')))
    } catch {
      rows = []
    }
    const running = rows.filter(r => r.isRunning && typeof r.sessionId === 'string')
    const out: FleetRow[] = await Promise.all(
      running.slice(0, 20).map(async r => {
        const name = r.name ?? r.title ?? r.sessionId
        try {
          const u = parseUsage(textOf(await $.mcp.call(MGMT, 'get_usage', { session_id: r.sessionId })))
          const c = u?.context
          return { id: r.sessionId, name, ...(c?.percent !== undefined ? { percent: c.percent } : {}), ...(c?.tokens !== undefined ? { tokens: c.tokens } : {}), ...(c?.window !== undefined ? { window: c.window } : {}), ...(c?.note ? { note: c.note } : {}) }
        } catch {
          return { id: r.sessionId, name, note: 'unavailable' }
        }
      }),
    )
    const at = await $.clock.now()
    await update($, fleet, () => ({ rows: fleetOrder(out), at, isBusy: false }))
    const r = await read($, reading)
    $.ui.status(statusText(r, at))
    await warn($, r)
    return fleetText(r, fleetOrder(out), at)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, fleet, f => ({ ...f, isBusy: false, error: error.slice(0, 200) }))
    return `Couldn't read usage from the app: ${error.slice(0, 200)}`
  }
}

function fleetText(r: FuelReading, rows: FleetRow[], at: number): string {
  const lines = [statusText(r, at) ?? 'No readings yet.']
  for (const w of r.windows) lines.push(`  ${shortName(w.kind).padEnd(10)} ${bar(w.percentUsed)} ${Math.round(w.percentUsed)}%${w.resetsAt ? `, resets in ${until(w.resetsAt, at)}` : ''}`)
  if (r.extra) lines.push(`  extra      ${r.extra.currency === 'USD' ? '$' : ''}${r.extra.spent.toFixed(2)} of ${r.extra.limit.toFixed(0)}${r.extra.isEnabled ? '' : ' (off)'}`)
  if (rows.length) {
    lines.push('Running sessions, by context:')
    for (const f of rows) lines.push(`  ${f.name.padEnd(26).slice(0, 26)} ${f.percent !== undefined ? `${bar(f.percent)} ${Math.round(f.percent)}% of ${compactTokens(f.window)}` : f.note ?? ''}`)
  } else lines.push('No linked session is running.')
  return lines.join('\n')
}

async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await update($, now, () => Date.now())
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

const isHot = (r: FuelReading): boolean => r.windows.some(w => w.percentUsed >= warnAt) || (r.contextPercent ?? 0) >= contextWarnAt

// ---------------------------------------------------------------------------
// Drawing

const SWEAT_CSS = `<style>.drop{fill:#5aa9e6;animation:drip 1.1s ease-in infinite}.drop2{animation-delay:-.55s}
@keyframes drip{0%{transform:translateY(0);opacity:1}100%{transform:translateY(9px);opacity:0}}</style>`

const sweat = (x: number, y: number): string =>
  `<path class="drop" d="M${x} ${y} q2 3 0 4 q-2 -1 0 -4z"/><path class="drop drop2" d="M${x + 7} ${y - 2} q2 3 0 4 q-2 -1 0 -4z"/>`

function paneSvg(W: number, r: FuelReading, rows: FleetRow[], at: number): { source: string; height: number } {
  const lines: string[] = []
  let y = 8
  const hot = isHot(r)
  // The crab sits by the gauges; it sweats when a window runs hot.
  lines.push(crab(4, 6, 'medium', hot ? 'working' : 'idle', 1.3))
  if (hot) lines.push(sweat(30, 6))
  const x = 56
  const mW = Math.max(80, W - x - 150)
  const row = (label: string, pct: number | undefined, right: string, warn = warnAt, bad = alarmAt) => {
    lines.push(`<text class="t" x="${x}" y="${y + 10}" font-family="${FONT}" font-size="12" font-weight="600">${xml(label)}</text>`)
    if (pct !== undefined) lines.push(meter(x + 70, y + 2, mW - 70, 9, pct, warn, bad))
    lines.push(`<text class="s" x="${W}" y="${y + 10}" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(right)}</text>`)
    y += 20
  }
  if (r.contextPercent !== undefined) row('Context', r.contextPercent, `${Math.round(r.contextPercent)}% of ${compactTokens(r.contextWindow)}`, contextWarnAt, 97)
  for (const w of r.windows) row(shortName(w.kind) === '5h' ? '5-hour' : shortName(w.kind) === 'wk' ? 'Weekly' : fit(w.kind, 12, 70), w.percentUsed, `${Math.round(w.percentUsed)}%${w.resetsAt ? ` · ${until(w.resetsAt, at)}` : ''}`)
  if (r.extra && r.extra.limit > 0) row('Extra', (r.extra.spent / r.extra.limit) * 100, `$${r.extra.spent.toFixed(0)} / $${r.extra.limit.toFixed(0)}${r.extra.isEnabled ? '' : ' off'}`)
  if (r.costUsd !== undefined) row('Session', undefined, `$${r.costUsd.toFixed(2)}`)
  y = Math.max(y, 48) + 6
  if (rows.length) {
    lines.push(`<text class="s" x="0" y="${y + 10}" font-family="${FONT}" font-size="11" font-weight="600">RUNNING SESSIONS · CONTEXT</text>`)
    y += 18
    for (const f of rows) {
      lines.push(`<text class="t" x="0" y="${y + 10}" font-family="${FONT}" font-size="12">${xml(fit(f.name, 12, 150))}</text>`)
      if (f.percent !== undefined) lines.push(meter(160, y + 2, Math.max(60, W - 160 - 90), 9, f.percent, contextWarnAt, 97))
      lines.push(`<text class="s" x="${W}" y="${y + 10}" text-anchor="end" font-family="${FONT}" font-size="11">${xml(f.percent !== undefined ? `${Math.round(f.percent)}% of ${compactTokens(f.window)}` : f.note ?? '')}</text>`)
      y += 18
    }
  }
  const height = y + 4
  return { source: svg(W, height, lines.join('\n'), SWEAT_CSS), height }
}

export const register: Register = (on, options) => {
  warnAt = Number(options.warnAt ?? 80) || 80
  alarmAt = Number(options.alarmAt ?? 95) || 95
  contextWarnAt = Number(options.contextWarnAt ?? 85) || 85

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'fuel', description: 'Context and plan-limit gauges, with every running side session\'s context', argumentHint: '[text]' })
    try {
      const u = await $.session.usage()
      await take($, { context: u.context, rateLimits: u.rateLimits, ...(u.cost ? { cost: u.cost } : {}) })
    } catch {
      // First reading comes with the first response instead.
    }
    // The app's plan windows (with extra usage) once the session server is up.
    $.clock.after(5000, () => void refreshFleet($))
    $.clock.every(60_000, () => {
      void (async () => {
        const at = Date.now()
        await update($, now, () => at)
        const r = await read($, reading)
        $.ui.status(statusText(r, at))
      })()
    })
    return started
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await take($, { context: e.context, rateLimits: e.rateLimits, ...(e.cost ? { cost: e.cost } : {}) })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'fuel' }, async ($, e) => {
    if (/\btext\b/.test(e.args)) return { text: await refreshFleet($) }
    const isOpen = await togglePane($)
    if (isOpen) $.clock.after(0, () => void refreshFleet($))
    return { text: isOpen ? 'Fuel gauge opened.' : 'Fuel gauge closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const r = await read($, reading)
    const f = await read($, fleet)
    const at = Math.max(await read($, now), r.at, f.at)
    const controls = (
      <Box key="controls" flexDirection="row" gap={2}>
        <Button key="refresh" label={f.isBusy ? 'Reading…' : 'Refresh'} plain onPress={() => void refreshFleet($)} />
        {f.error ? <Text color="red">{f.error.slice(0, 80)}</Text> : null}
      </Box>
    )
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = widthFor(e.props.bodyColumns)
      const d = paneSvg(W, r, f.rows, at)
      return (
        <Box flexDirection="column">
          <Svg key="gauges" source={d.source} alt={fleetText(r, f.rows, at)} width={W} height={d.height} />
          {controls}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {fleetText(r, f.rows, at)
          .split('\n')
          .map((line, i) => (
            <Text key={`l${i}`} wrap="truncate-end">
              {line}
            </Text>
          ))}
        {controls}
      </Box>
    )
  })

  // Above the prompt only while something runs hot.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, reading)
    if (e.props.hasSurvey || !isHot(r)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const at = await read($, now)
    const hot = [
      ...r.windows.filter(w => w.percentUsed >= warnAt).map(w => `${shortName(w.kind) === '5h' ? '5-hour' : shortName(w.kind) === 'wk' ? 'weekly' : w.kind} ${Math.round(w.percentUsed)}%${w.resetsAt ? ` (resets ${until(w.resetsAt, at || r.at)})` : ''}`),
      ...((r.contextPercent ?? 0) >= contextWarnAt ? [`context ${Math.round(r.contextPercent ?? 0)}%`] : []),
    ]
    return (
      <Box>
        <Text color="yellow">⛽ Running hot: {hot.join(' · ')}</Text>
      </Box>
    )
  })
}
