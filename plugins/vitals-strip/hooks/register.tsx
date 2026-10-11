import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Chip, ChipLevel, Vitals } from '../types'
import { arrayChip, byLevel, dockerChip, haChip, metricsChip, notificationChip, parityChip, resultOf, shown, statusLine, worst } from './logic'
import { crab } from './shared/crab'
import { FONT, svg, widthFor, xml } from './shared/draw'

const vitals = atom({ plugin: 'vitals-strip', key: 'vitals' } as const, { chips: [], at: 0, errors: [], isAlwaysShown: false })

let unraidServer = 'plugin:unraid-mcp:unraid-mcp'
let haServer = '9701d7dd-0c3d-4d64-8a88-8109a1430f1b'
let pollMs = 120_000
let quiet = true
let reading: Promise<string> | null = null

const textOf = (r: { content: readonly unknown[] }): string =>
  r.content.map(b => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join('')

/** One read-only MCP call, its JSON result, or why not. */
async function ask($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | string> {
  try {
    const r = await $.mcp.call(server, tool, args)
    const text = textOf(r)
    if (r.isError) return text.slice(0, 120) || 'error'
    return resultOf(text) ?? 'not JSON'
  } catch (err) {
    return (err instanceof Error ? err.message : String(err)).slice(0, 120)
  }
}

function readVitals($: EngineInterface): Promise<string> {
  if (!reading)
    reading = readNow($).finally(() => {
      reading = null
    })
  return reading
}

async function readNow($: EngineInterface): Promise<string> {
  const u = (subaction: string, action = 'system', extra: Record<string, unknown> = {}) => ask($, unraidServer, 'unraid', { action, subaction, ...extra })
  const [arr, metrics, docker, notes, parity, ha] = await Promise.all([
    u('array'),
    u('metrics'),
    u('list', 'docker', { limit: 0 }),
    u('overview', 'notification'),
    u('parity_status', 'array'),
    haServer ? ask($, haServer, 'ha_get_overview', { fields: ['system_info', 'notification_count', 'repair_count'] }) : Promise.resolve(null),
  ])
  const chips: Chip[] = []
  const errors: string[] = []
  const add = (name: string, r: Record<string, unknown> | string | null, make: (r: Record<string, unknown>) => Chip | null) => {
    if (r === null) return
    if (typeof r === 'string') errors.push(`${name}: ${r}`)
    else {
      const c = make(r)
      if (c) chips.push(c)
    }
  }
  add('array', arr, arrayChip)
  add('load', metrics, metricsChip)
  add('docker', docker, dockerChip)
  add('notifications', notes, notificationChip)
  add('parity', parity, parityChip)
  add('home assistant', ha, haChip)
  const at = await $.clock.now()
  const prev = await read($, vitals)
  const v = await update($, vitals, x => ({ ...x, chips, errors, at }))
  $.ui.status(statusLine(chips, errors))
  // A toast when something turns red that wasn't.
  const wasBad = new Set(prev.chips.filter(c => c.level === 'bad').map(c => c.key))
  for (const c of chips) if (c.level === 'bad' && !wasBad.has(c.key) && prev.at) $.ui.toast(`Vitals: ${c.text}`)
  return asText(v)
}

function asText(v: Vitals): string {
  const lines = byLevel(v.chips).map(c => `${MARK[c.level]} ${c.detail ?? c.text}`)
  if (v.errors.length) lines.push(...v.errors.map(e => `? couldn't read ${e}`))
  return lines.join('\n') || 'No vitals yet.'
}

const MARK: Record<ChipLevel, string> = { ok: '✓', info: 'i', warn: '!', bad: '✗' }
const COLOR: Record<ChipLevel, string> = { ok: 'green', info: 'blue', warn: 'yellow', bad: 'red' }

// ---------------------------------------------------------------------------
// Drawing: pills in a row, a sysadmin crab at the left that sweats on red.

const PILL_CSS = `<style>.p-ok{fill:#e3f3e9}.p-info{fill:#e4eefb}.p-warn{fill:#fbefd6}.p-bad{fill:#fbe0da}
.pt-ok{fill:#1f6b43}.pt-info{fill:#1f4f8a}.pt-warn{fill:#7a5208}.pt-bad{fill:#9b2e1c}
@media (prefers-color-scheme: dark){.p-ok{fill:#17382a}.p-info{fill:#18304d}.p-warn{fill:#3d3014}.p-bad{fill:#47201a}
.pt-ok{fill:#8fe0b2}.pt-info{fill:#9cc6f5}.pt-warn{fill:#f3cf7e}.pt-bad{fill:#ffb3a3}}</style>`

function stripSvg(W: number, chips: Chip[]): { source: string; height: number } {
  let x = 44
  let y = 6
  const pills: string[] = []
  for (const c of chips) {
    const w = Math.round(c.text.length * 6.3 + 18)
    if (x + w > W && x > 44) {
      x = 44
      y += 24
    }
    pills.push(`<rect class="p-${c.level}" x="${x}" y="${y}" width="${w}" height="20" rx="10"/><text class="pt-${c.level}" x="${x + 9}" y="${y + 14}" font-family="${FONT}" font-size="11" font-weight="600">${xml(c.text)}</text>`)
    x += w + 6
  }
  const height = Math.max(36, y + 26)
  const level = worst(chips)
  return { source: svg(W, height, `${crab(0, 2, 'careful', level === 'bad' ? 'working' : 'idle', 1)}${pills.join('')}`, PILL_CSS), height }
}

export const register: Register = (on, options) => {
  unraidServer = String(options.unraidServer ?? unraidServer)
  haServer = String(options.haServer ?? haServer)
  pollMs = Math.max(0, Number(options.pollSeconds ?? 120)) * 1000
  quiet = options.quiet !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'vitals', description: 'Unraid and Home Assistant health: the full strip, read now', argumentHint: '[show|quiet|text]' })
    // The MCP servers may still be connecting at start.
    $.clock.after(8000, () => void readVitals($))
    if (pollMs > 0) $.clock.every(Math.max(30_000, pollMs), () => void readVitals($))
    return started
  })

  on('command.run', { command: 'vitals' }, async ($, e) => {
    const w = e.args.trim().toLowerCase()
    if (w === 'show' || w === 'quiet') {
      await update($, vitals, v => ({ ...v, isAlwaysShown: w === 'show' }))
      return { text: w === 'show' ? 'Vitals band: always shown.' : 'Vitals band: only when something needs a look.' }
    }
    return { text: await readVitals($) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, vitals)
    const chips = shown(v.chips, quiet && !v.isAlwaysShown)
    if (e.props.hasSurvey || !chips.length) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const d = stripSvg(widthFor(e.props.bodyColumns), chips)
      return <Svg key="vitals" source={d.source} alt={chips.map(c => c.text).join(' · ')} width={widthFor(e.props.bodyColumns)} height={d.height} />
    }
    return (
      <Box flexDirection="row" flexWrap="wrap" gap={2}>
        {chips.map(c => (
          <Text key={c.key} color={COLOR[c.level]}>
            {MARK[c.level]} {c.text}
          </Text>
        ))}
      </Box>
    )
  })
}
