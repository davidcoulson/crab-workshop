import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bout, Ring, Round } from '../types'
import { addRound, card, currentBout, dirOf, readReview, reviewKind, tally } from './bout'
import { crab } from './shared/crab'
import { FONT, fit, svg, widthFor, xml } from './shared/draw'

const ring = atom({ plugin: 'codex-corner', key: 'ring' } as const, null)
const bout = atom({ plugin: 'codex-corner', key: 'bout' } as const, null)
const now = atom({ plugin: 'codex-corner', key: 'now' } as const, 0)

const STORE = 'codex-corner.bouts'
// How long the ring stays above the prompt after a round lands.
const SHOW_MS = 90_000

async function keyFor($: EngineInterface, dir: string | undefined): Promise<string> {
  const git = async (args: string[]) => {
    try {
      const r = await $.process.run(['git', ...args], { ...(dir ? { cwd: dir } : {}), timeoutMs: 5000 })
      return r.exitCode === 0 ? r.stdout.trim() : ''
    } catch {
      return ''
    }
  }
  const top = await git(['rev-parse', '--show-toplevel'])
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
  return `${top.split('/').pop() || 'here'}@${branch || '?'}`
}

async function loadBout($: EngineInterface, key: string): Promise<Bout> {
  const all = ((await $.store.get(STORE)) as Record<string, Bout> | undefined) ?? {}
  return all[key] ?? { key, rounds: [] }
}

async function saveBout($: EngineInterface, b: Bout): Promise<void> {
  const all = ((await $.store.get(STORE)) as Record<string, Bout> | undefined) ?? {}
  all[b.key] = b
  // The 60 most recently fought bouts.
  const keep = Object.values(all)
    .sort((x, y) => (y.rounds.at(-1)?.endedAt ?? 0) - (x.rounds.at(-1)?.endedAt ?? 0))
    .slice(0, 60)
  await $.store.set(STORE, Object.fromEntries(keep.map(k => [k.key, k])))
}

// ---------------------------------------------------------------------------
// Drawing: the ring, the crab in the red corner, the Codex bot in the blue.

const RING_CSS = `<style>.rope{stroke:#c2412d;stroke-width:2}.rope2{stroke:#f4f1ea;stroke-width:2}.post{fill:#6b6b68}
.bot .arm{animation:jab .6s steps(2) infinite;transform-box:fill-box}@keyframes jab{50%{transform:translateX(-4px)}}
.ko{transform-box:fill-box;transform-origin:50% 100%;transform:rotate(90deg) translate(6px,-4px)}
.stars{animation:spin 1.2s linear infinite;transform-box:fill-box;transform-origin:50% 50%}@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-color-scheme: dark){.rope2{stroke:#3a3a38}}</style>`

function bot(x: number, y: number, isKo: boolean): string {
  const eyes = isKo
    ? `<path d="M6 7 l3 3 m0 -3 l-3 3 M13 7 l3 3 m0 -3 l-3 3" stroke="#1f1f1f" stroke-width="1.2"/>`
    : `<rect x="6" y="7" width="3" height="3" fill="#7fe3ff"/><rect x="13" y="7" width="3" height="3" fill="#7fe3ff"/>`
  return `<g transform="translate(${x},${y})" shape-rendering="crispEdges"><g class="${isKo ? 'ko' : 'bot'}">
<rect x="10" y="0" width="2" height="3" fill="#9a9a96"/><rect x="3" y="3" width="16" height="11" fill="#5b6b7a"/>${eyes}
<rect x="5" y="15" width="12" height="11" fill="#46525e"/><g class="arm"><rect x="-3" y="16" width="6" height="5" fill="#2f6fd6"/></g>
<rect x="19" y="17" width="5" height="5" fill="#2f6fd6"/><rect x="6" y="26" width="3" height="5" fill="#46525e"/><rect x="13" y="26" width="3" height="5" fill="#46525e"/></g>
${isKo ? `<g class="stars"><text x="8" y="-2" font-size="9">✦</text><text x="16" y="2" font-size="7">✦</text></g>` : ''}</g>`
}

function ringSvg(W: number, b: Bout | null, r: Ring, at: number): string {
  const rounds = b ? currentBout(b.rounds) : []
  const last = rounds.at(-1)
  const isRunning = r.runningSince !== undefined
  const isKo = !isRunning && last?.verdict === 'approve'
  const roundNo = isRunning ? rounds.length + (last?.verdict === 'approve' ? 0 : 1) : rounds.length
  const title = isRunning ? `Round ${Math.max(1, roundNo)}: Codex is reviewing… ${Math.round((at - (r.runningSince ?? at)) / 1000)}s` : isKo ? `KO in round ${rounds.length}! Codex approves` : last ? `Round ${rounds.length}: ${tally(last)}` : 'Codex corner'
  const sub = isRunning ? r.key : last?.titles[0] ? `${r.key} · e.g. ${last.titles[0]}` : r.key
  const x = 112
  return svg(
    W,
    52,
    `<line class="post" x1="2" y1="8" x2="2" y2="48" stroke="#6b6b68" stroke-width="3"/><line class="post" x1="100" y1="8" x2="100" y2="48" stroke="#6b6b68" stroke-width="3"/>
<line class="rope" x1="2" y1="14" x2="100" y2="14"/><line class="rope2" x1="2" y1="24" x2="100" y2="24"/><line class="rope" x1="2" y1="34" x2="100" y2="34"/>
${crab(10, 16, 'heavy', isKo ? 'done' : isRunning ? 'working' : last?.verdict === 'needs-attention' ? 'working' : 'idle', 1)}${bot(64, isKo ? 22 : 14, isKo)}
<text class="t" x="${x}" y="22" font-family="${FONT}" font-size="13" font-weight="700">${xml(fit(title, 13, W - x))}</text>
<text class="s" x="${x}" y="40" font-family="${FONT}" font-size="11">${xml(fit(sub, 11, W - x))}</text>`,
    RING_CSS,
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'codex-card', description: 'The Codex review rounds for this repo and branch (codex-corner)' })
    $.clock.every(1000, () => {
      void (async () => {
        const r = await read($, ring)
        if (r?.runningSince !== undefined) await update($, now, () => Date.now())
      })()
    })
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.command ?? '')
    const kind = reviewKind(command)
    if (!kind) return next(e)
    const key = await keyFor($, dirOf(command))
    const startedAt = await $.clock.now()
    const b0 = await loadBout($, key)
    await update($, bout, () => b0)
    // A background start or a result fetch has no round to wait for.
    const isWaiting = kind !== 'result' && /--wait\b/.test(command)
    if (isWaiting) await update($, ring, () => ({ key, runningSince: startedAt }))
    const r = await next(e)
    const out = typeof r.text === 'string' ? r.text : JSON.stringify(r.result ?? '')
    const review = r.deny === undefined ? readReview(out.replace(/\\n/g, '\n')) : null
    const endedAt = await $.clock.now()
    if (review) {
      const round: Round = { ...review, startedAt, endedAt, kind: kind === 'result' ? 'adversarial-review' : kind }
      const b = addRound(await loadBout($, key), key, round)
      await saveBout($, b)
      await update($, bout, () => b)
      await update($, ring, () => ({ key, landedAt: endedAt }))
      const n = currentBout(b.rounds).length
      $.ui.toast(review.verdict === 'approve' ? `🥊 KO in round ${n}: Codex approves ${key}` : `🥊 Round ${n}: ${tally(round)}`)
      $.clock.after(SHOW_MS, () => void update($, ring, v => (v && v.landedAt === endedAt ? null : v)))
    } else if (isWaiting) await update($, ring, () => null)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'codex-card' }, async $ => {
    const key = await keyFor($, await $.session.cwd())
    return { text: card(await loadBout($, key)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, ring)
    if (!r || e.props.hasSurvey) return next(e)
    const b = await read($, bout)
    const at = Math.max(await read($, now), r.runningSince ?? 0, r.landedAt ?? 0)
    const ui = $.ui.resolve(e)
    const { Text } = ui
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const W = widthFor(e.props.bodyColumns)
      return <ui.Svg key="ring" source={ringSvg(W, b, r, at)} alt={b ? card(b).split('\n')[0] ?? '' : 'Codex is reviewing'} width={W} height={52} />
    }
    const rounds = b ? currentBout(b.rounds) : []
    const last = rounds.at(-1)
    const line =
      r.runningSince !== undefined
        ? `🥊 Codex is reviewing ${r.key}… ${Math.round((at - r.runningSince) / 1000)}s`
        : last?.verdict === 'approve'
          ? `🥊 KO in round ${rounds.length}: Codex approves ${r.key}`
          : `🥊 Round ${rounds.length} on ${r.key}: ${last ? tally(last) : ''}`
    return <Text color={last?.verdict === 'approve' && r.runningSince === undefined ? 'green' : 'yellow'}>{line}</Text>
  })
}
