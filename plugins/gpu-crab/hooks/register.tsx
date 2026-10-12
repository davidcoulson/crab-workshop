import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GpuModel, GpuRun, LanTally } from '../types'
import { addToTally, clock, gb, gpuShare, isSpilling, line, parsePs, parseTrailer, subjectOf, tallyText, today, toolShort } from './logic'
import { crab } from './shared/crab'
import { FONT, fit, meter, svg, widthFor, xml } from './shared/draw'

const run = atom({ plugin: 'gpu-crab', key: 'run' } as const, null)
const reading = atom({ plugin: 'gpu-crab', key: 'reading' } as const, { models: [], at: 0 })
const tally = atom({ plugin: 'gpu-crab', key: 'tally' } as const, { day: '', calls: 0, chars: 0 })
const now = atom({ plugin: 'gpu-crab', key: 'now' } as const, 0)

const STORE_TALLY = 'gpu-crab.tally'
// How long the band stays after a call ends.
const LINGER_MS = 20_000

let ollamaUrl = 'http://localhost:11434'
let vramGb = 8
let prefix = 'mcp__local-llm__'
let poller: { cancel: () => void } | null = null

/** Rejects after `ms` (the host's fetch has no timeout of its own). */
function within<T>($: EngineInterface, p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = $.clock.after(ms, () => reject(new Error(`no answer in ${ms / 1000}s`)))
    p.then(
      v => (t.cancel(), resolve(v)),
      err => (t.cancel(), reject(err)),
    )
  })
}

async function poll($: EngineInterface): Promise<GpuModel[]> {
  const at = await $.clock.now()
  try {
    const r = await within($, $.http.fetch(`${ollamaUrl}/api/ps`), 3000)
    const models = r.ok ? parsePs(r.text) : null
    await update($, reading, () => (models ? { models, at } : { models: [], at, error: `Ollama answered ${r.status}` }))
    await update($, now, () => at)
    return models ?? []
  } catch (err) {
    await update($, reading, v => ({ ...v, at, error: `can't reach ${ollamaUrl} (${(err instanceof Error ? err.message : String(err)).slice(0, 80)})` }))
    await update($, now, () => at)
    return []
  }
}

async function addChars($: EngineInterface, chars: number): Promise<LanTally> {
  const at = await $.clock.now()
  const stored = ((await $.store.get(STORE_TALLY)) as LanTally | undefined) ?? { day: '', calls: 0, chars: 0 }
  const next = addToTally(stored, today(at), chars)
  await $.store.set(STORE_TALLY, next)
  await update($, tally, () => next)
  return next
}

async function sizeOf($: EngineInterface, path: unknown): Promise<number> {
  if (typeof path !== 'string' || !path) return 0
  try {
    const s = await $.fs.stat(path)
    return s && 'size' in s && typeof s.size === 'number' ? Math.min(s.size, 24_000) : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Drawing

const BELT_CSS = `<style>.belt{stroke:#7a7a76;stroke-width:2;stroke-dasharray:4 4;animation:belt .4s linear infinite}
@keyframes belt{to{stroke-dashoffset:8}}.frame{fill:none;stroke:#9a9a96;stroke-width:1.5}.spill .frame{stroke:#b07012}
.done .belt{animation:none}</style>`

function bandSvg(W: number, r: GpuRun, models: GpuModel[], at: number): string {
  const m = models[0]
  const spill = m ? isSpilling(m) : false
  const done = !!r.endedAt
  const x = 66
  const title = `${toolShort(r.tool)}${r.subject ? ` · ${r.subject}` : ''}`
  const right = done ? `done in ${clock((r.endedAt ?? at) - r.startedAt)}${r.parts ? ` · ${r.parts} parts` : ''}${r.isError ? ' · failed' : ''}` : clock(at - r.startedAt)
  const vramPct = m ? (m.sizeVram / (vramGb * 1024 ** 3)) * 100 : 0
  return svg(
    W,
    48,
    `<g class="${spill ? 'spill' : ''} ${done ? 'done' : ''}">
<rect class="frame" x="2" y="38" width="52" height="6" rx="3"/><line class="belt" x1="6" y1="41" x2="50" y2="41"/>
${crab(10, 4, 'light', done ? (r.isError ? 'idle' : 'done') : 'working', 1.1)}</g>
<text class="t" x="${x}" y="15" font-family="${FONT}" font-size="12" font-weight="600">${xml(fit(title, 12, W - x - right.length * 6.4 - 10))}</text>
<text class="s" x="${W}" y="15" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(right)}</text>
${
  m
    ? `${meter(x, 23, 90, 8, vramPct, 90, 99)}<text class="${spill ? 'warn' : 's'}" x="${x + 98}" y="31" font-family="${FONT}" font-size="11">${xml(
        `${m.name} · ${gb(m.sizeVram)}/${vramGb} GB · ${gpuShare(m)}% GPU${spill ? ' · spilling to CPU' : ''}`,
      )}</text>`
    : `<text class="s" x="${x}" y="31" font-family="${FONT}" font-size="11">no model loaded yet</text>`
}`,
    BELT_CSS,
  )
}

export const register: Register = (on, options) => {
  ollamaUrl = String(options.ollamaUrl ?? ollamaUrl).replace(/\/+$/, '')
  vramGb = Number(options.vramGb ?? 8) || 8
  prefix = String(options.toolPrefix ?? prefix)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'gpu', description: "What's loaded on the Ollama GPU now, and today's kept-on-the-LAN tally" })
    const stored = (await $.store.get(STORE_TALLY)) as LanTally | undefined
    if (stored) await update($, tally, () => stored)
    return started
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!tool.startsWith(prefix)) return next(e)
    const args = e as unknown as Record<string, unknown>
    const startedAt = await $.clock.now()
    const mine: GpuRun = { tool, subject: subjectOf(tool, args), startedAt }
    await update($, run, () => mine)
    poller?.cancel()
    poller = $.clock.every(1500, () => void poll($))
    void poll($)
    const r = await next(e)
    poller?.cancel()
    poller = null
    const text = typeof r.text === 'string' ? r.text : typeof r.result === 'string' ? r.result : ''
    const trailer = parseTrailer(text)
    const endedAt = await $.clock.now()
    await update($, run, v => (v && v.startedAt === startedAt ? { ...v, endedAt, ...trailer, isError: r.isError === true || r.deny !== undefined } : v))
    if (r.deny === undefined && !r.isError) await addChars($, trailer.chars ?? (await sizeOf($, args.path)))
    $.clock.after(LINGER_MS, () => void update($, run, v => (v && v.startedAt === startedAt ? null : v)))
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'gpu' }, async $ => {
    const models = await poll($)
    const v = await read($, reading)
    const t = (await $.store.get(STORE_TALLY)) as LanTally | undefined
    const lines = [
      v.error ? `Ollama: ${v.error}` : models.length ? 'Loaded on the GPU:' : `Ollama at ${ollamaUrl}: no model loaded.`,
      ...models.map(
        m => `  ${m.name}${m.parameterSize ? ` (${m.parameterSize}${m.quantization ? ` ${m.quantization}` : ''})` : ''}: ${gb(m.size)} GB, ${gb(m.sizeVram)} on the GPU (${gpuShare(m)}%)${isSpilling(m) ? ', spilling to CPU' : ''}${m.contextLength ? `, context ${m.contextLength}` : ''}`,
      ),
      t && t.day === today(await $.clock.now()) ? tallyText(t) : 'Nothing read by local models today.',
    ]
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, run)
    if (!r || e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const v = await read($, reading)
    const at = Math.max(await read($, now), r.startedAt)
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = widthFor(e.props.bodyColumns)
      return (
        <Box flexDirection="column">
          <Svg key="gpu" source={bandSvg(W, r, v.models, at)} alt={line(r, v.models, vramGb, at)} width={W} height={48} />
          {r.endedAt ? <Text dimColor>{tallyText(await read($, tally))}</Text> : null}
        </Box>
      )
    }
    const m = v.models[0]
    return (
      <Box flexDirection="column">
        <Text color={m && isSpilling(m) ? 'yellow' : undefined} wrap="truncate-end">
          {r.endedAt ? (r.isError ? '▣ ' : '▣\\o/ ') : '▣≈ '}
          {line(r, v.models, vramGb, at)}
        </Text>
        {v.error ? <Text dimColor>{v.error}</Text> : r.endedAt ? <Text dimColor>{tallyText(await read($, tally))}</Text> : null}
      </Box>
    )
  })
}
