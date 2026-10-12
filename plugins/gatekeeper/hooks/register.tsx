import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Gate, Gates, Lane } from '../types'
import { QUERY, asText, bandText, chips, counts, parseGates, parseReadyLimits } from './gates'
import type { ReadyLimits } from './gates'
import { isRateLimited, parseShared, plan } from './cache'
import type { SharedRead } from './cache'
import { crab } from './shared/crab'
import { FONT, ago, svg, widthFor, xml } from './shared/draw'

const gates = atom({ plugin: 'gatekeeper', key: 'gates' } as const, { gates: [], total: 0, at: 0, isBusy: false })
const now = atom({ plugin: 'gatekeeper', key: 'now' } as const, 0)

const PANE = 'gatekeeper'
const TITLE = 'Gates'

let query = 'is:pr is:open author:@me archived:false sort:updated-desc'
let readyLimits: ReadyLimits = { tinkerologie: 2 }
let yours: string[] = []
let pollMs = 900_000
let fetching: Promise<string> | null = null
let sharedPath: string | null = null
let soon: { cancel: () => void } | null = null

function refresh($: EngineInterface, force = false): Promise<string> {
  if (!fetching)
    fetching = refreshNow($, force).finally(() => {
      fetching = null
    })
  return fetching
}

/** ~/.cache/crab-workshop/gatekeeper.json: the read every session shares. */
async function pathOfShared($: EngineInterface): Promise<string | null> {
  if (sharedPath) return sharedPath
  const r = await $.process.run(['sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 5_000 })
  const home = r.exitCode === 0 ? r.stdout.trim() : ''
  sharedPath = home ? `${home}/.cache/crab-workshop/gatekeeper.json` : null
  return sharedPath
}

async function readShared($: EngineInterface, path: string | null): Promise<SharedRead> {
  if (!path) return {}
  try {
    return (await $.fs.exists(path)) ? parseShared(await $.fs.read(path)) : {}
  } catch {
    return {}
  }
}

async function writeShared($: EngineInterface, path: string | null, v: SharedRead): Promise<void> {
  if (!path) return
  try {
    await $.fs.write(path, JSON.stringify(v))
  } catch {
    // A session that can't write just doesn't share; it still works.
  }
}

async function show($: EngineInterface, v: SharedRead, error?: string): Promise<string> {
  const list = v.gates ?? []
  await update($, gates, g => ({ gates: list, total: v.total ?? list.length, at: v.at ?? g.at, isBusy: false, ...(error ? { error } : {}) }))
  if (v.at) await update($, now, () => Math.max(v.at ?? 0, Date.now()))
  $.ui.status(bandText(list))
  return error ? `${error}${list.length ? `\n\n${asText(list, v.total ?? list.length)}` : ''}` : asText(list, v.total ?? list.length)
}

async function refreshNow($: EngineInterface, force: boolean): Promise<string> {
  const path = await pathOfShared($)
  const shared = await readShared($, path)
  const at0 = await $.clock.now()
  const p = plan(shared, at0, pollMs, force)
  if (p.kind === 'reuse') {
    const error = p.why === 'rate limited' ? `GitHub rate limit spent; next read after ${new Date(shared.backoffUntil ?? 0).toLocaleTimeString()}` : undefined
    if (shared.at || error) return show($, shared, error)
    // Nothing shared yet and another session is reading: wait for it next time.
    return show($, shared)
  }
  await update($, gates, g => ({ ...g, isBusy: true }))
  await writeShared($, path, { ...shared, fetchingSince: at0 })
  try {
    const r = await $.process.run(['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${query}`], { timeoutMs: 60_000 })
    const parsed = r.exitCode === 0 ? parseGates(r.stdout, yours, readyLimits) : null
    if (!parsed) {
      const why = (r.stderr || r.stdout).trim()
      if (isRateLimited(why)) {
        // The rate_limit endpoint itself doesn't count against the limit.
        const reset = await $.process.run(['gh', 'api', 'rate_limit', '--jq', '.resources.graphql.reset'], { timeoutMs: 15_000 })
        const until = Number(reset.stdout.trim()) * 1000
        const backoffUntil = Number.isFinite(until) && until > at0 ? until : at0 + 15 * 60_000
        const next: SharedRead = { ...shared, backoffUntil }
        delete next.fetchingSince
        await writeShared($, path, next)
        return show($, next, `GitHub rate limit spent; next read after ${new Date(backoffUntil).toLocaleTimeString()}`)
      }
      throw new Error(why.slice(0, 160) || `gh exited ${r.exitCode}`)
    }
    const at = await $.clock.now()
    const next: SharedRead = { at, gates: parsed.gates, total: parsed.total }
    await writeShared($, path, next)
    return show($, next)
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 200)
    const next: SharedRead = { ...shared }
    delete next.fetchingSince
    await writeShared($, path, next)
    await update($, gates, g => ({ ...g, isBusy: false, error }))
    return `Couldn't read your PRs: ${error}`
  }
}

/** A refresh a little after a push or a gh pr command, once CI and CodeRabbit have had a moment. */
function refreshSoon($: EngineInterface): void {
  soon?.cancel()
  soon = $.clock.after(20_000, () => void refresh($, true))
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

const LANE_TITLE: Record<Lane, string> = { you: 'Needs you', work: 'Needs work', waiting: 'Waiting', clear: 'Clear' }
const LANE_COLOR: Record<Lane, string> = { you: 'red', work: 'yellow', waiting: 'gray', clear: 'green' }

// The bouncer: holds the rope while anything needs you, cheers when the line is clear.
function headSvg(W: number, g: Gate[]): string {
  const c = counts(g)
  const words = [`${c.you} need you`, `${c.work} need work`, `${c.waiting} waiting`, `${c.clear} clear`].join('  ·  ')
  const status = c.you ? 'working' : c.work ? 'idle' : 'done'
  return svg(
    W,
    40,
    `${crab(0, 4, 'heavy', status, 1)}
<rect x="36" y="22" width="${c.you ? 30 : 6}" height="3" rx="1.5" fill="#b3261e"/><circle cx="36" cy="23.5" r="3" fill="#c9a227"/>
<text class="t" x="76" y="25" font-family="${FONT}" font-size="12" font-weight="600">${xml(words)}</text>`,
  )
}

export const register: Register = (on, options) => {
  query = String(options.query ?? query)
  if (typeof options.readyLimits === 'string') readyLimits = parseReadyLimits(options.readyLimits)
  yours = ((options.yourBoxes as readonly string[] | undefined) ?? []).map(String)
  pollMs = Math.max(0, Number(options.pollMinutes ?? 15)) * 60_000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'gates', description: 'Your open PRs and what each waits on: your checkboxes, CodeRabbit, Codecov, CI', argumentHint: '[text]' })
    await $.tool.register({
      name: 'gates',
      description:
        "David's open PRs and what each waits on: template boxes only he can tick, unresolved CodeRabbit threads, Codecov, CI, conflicts, drafts ready for review. " +
        'Use it to answer "what\'s blocking my PRs" instead of calling gh for each. Never tick boxes or mark PRs ready yourself.',
      inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'Only PRs in repos whose owner/name contains this.' } } },
    })
    $.clock.after(4000, () => void refresh($))
    if (pollMs > 0) $.clock.every(Math.max(60_000, pollMs), () => void refresh($))
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && /\b(git\s+push|gh\s+pr\s+(create|edit|ready|comment|review|merge|close))\b/.test(String(e.command ?? ''))) refreshSoon($)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__gatekeeper__gates' }, async ($, e) => {
    const repo = String((e as unknown as { repo?: unknown }).repo ?? '').toLowerCase()
    await refresh($)
    const v = await read($, gates)
    if (v.error && !v.at) return { result: `Couldn't read PRs: ${v.error}` }
    const list = repo ? v.gates.filter(g => g.repo.toLowerCase().includes(repo)) : v.gates
    return { result: asText(list, repo ? list.length : v.total) }
  })

  on('command.run', { command: 'gates' }, async ($, e) => {
    if (/\btext\b/.test(e.args)) return { text: await refresh($, true) }
    const isOpen = await togglePane($)
    if (isOpen) $.clock.after(0, () => void refresh($))
    return { text: isOpen ? 'Gates opened.' : 'Gates closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const v: Gates = await read($, gates)
    const at = Math.max(await read($, now), v.at)
    const lanes = (['you', 'work', 'waiting', 'clear'] as Lane[]).map(l => [l, v.gates.filter(g => g.lane === l)] as const).filter(([, l]) => l.length)
    const head =
      e.surface === 'desktop' && 'Svg' in ui ? (
        <ui.Svg key="head" source={headSvg(widthFor(e.props.bodyColumns), v.gates)} alt={bandText(v.gates) ?? 'No open PRs need anything.'} width={widthFor(e.props.bodyColumns)} height={40} />
      ) : (
        <Text key="head" bold>
          {bandText(v.gates) ?? 'gates: all clear'}
        </Text>
      )
    return (
      <Box flexDirection="column">
        {head}
        <Box key="meta" flexDirection="row" gap={2}>
          <Text dimColor>
            {v.isBusy ? 'Reading GitHub…' : v.at ? `${v.gates.length}${v.total > v.gates.length ? ` of ${v.total}` : ''} open PRs · as of ${ago(at - v.at)}` : 'Not read yet.'}
          </Text>
          <Button key="refresh" label="Refresh" plain onPress={() => void refresh($, true)} />
        </Box>
        {v.error ? <Text color="red">{v.error}</Text> : null}
        {lanes.map(([lane, list]) => (
          <Box key={`lane-${lane}`} flexDirection="column" marginTop={1}>
            <Text bold color={LANE_COLOR[lane]}>
              {LANE_TITLE[lane]} · {list.length}
            </Text>
            {list.map(g => (
              <Box key={`${g.repo}#${g.number}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  {'Link' in ui ? <ui.Link href={g.url}>{`${g.repo.split('/')[1]}#${g.number}`}</ui.Link> : <Text>{`${g.repo.split('/')[1]}#${g.number}`}</Text>}
                  <Text wrap="truncate-end">{g.title}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {g.why} · {chips(g).join(' · ')}
                </Text>
                {lane === 'you'
                  ? g.yourBoxes.slice(0, 3).map((b, i) => (
                      <Text key={`b${i}`} color="red" wrap="truncate-end">
                        {'  ☐ '}
                        {b}
                      </Text>
                    ))
                  : null}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, gates)
    const c = counts(v.gates)
    if (e.props.hasSurvey || !c.you) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="red">🚧 {bandText(v.gates)}</Text>
        <Text dimColor> · /gates</Text>
      </Box>
    )
  })
}
