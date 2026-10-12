import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tank } from '../types'
import { STACKS, fishFrom, scene, summary } from './logic'
import { CRAB_CSS, ROTATION, crab } from './shared/crab'
import { THEME_CSS, widthFor } from './shared/draw'

const tank = atom({ plugin: 'reef', key: 'tank' } as const, { fish: [], models: [], ha: null, crabs: [], at: 0, errors: [] })

const PANE = 'reef'
const TITLE = 'Reef'

let unraidServer = 'plugin:unraid-mcp:unraid-mcp'
let haServer = ''
let ollamaUrl = 'http://localhost:11434'
let swimmers = 24
let filling: Promise<string> | null = null

const textOf = (r: { content: readonly unknown[] }): string =>
  r.content.map(b => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join('')

const parse = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text.slice(Math.max(0, Math.min(...['{', '['].map(c => (text.indexOf(c) < 0 ? Infinity : text.indexOf(c)))))))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

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

function fill($: EngineInterface): Promise<string> {
  if (!filling)
    filling = fillNow($).finally(() => {
      filling = null
    })
  return filling
}

async function fillNow($: EngineInterface): Promise<string> {
  const errors: string[] = []
  const grab = async <T,>(name: string, p: Promise<T>): Promise<T | null> => {
    try {
      return await p
    } catch (err) {
      errors.push(`${name}: ${(err instanceof Error ? err.message : String(err)).slice(0, 100)}`)
      return null
    }
  }
  const [docker, ha, ps, sessions] = await Promise.all([
    grab('unraid', $.mcp.call(unraidServer, 'unraid', { action: 'docker', subaction: 'list', limit: 0 })),
    haServer ? grab('home assistant', $.mcp.call(haServer, 'ha_get_overview', { fields: ['system_info', 'notification_count', 'repair_count'] })) : Promise.resolve(null),
    grab('ollama', within($, $.http.fetch(`${ollamaUrl}/api/ps`), 3000)),
    grab('sessions', $.mcp.call('ccd_session_mgmt', 'list_sessions', { linked: true, limit: 60 })),
  ])
  const prev = await read($, tank)
  const d = docker && !docker.isError ? parse(textOf(docker)) : null
  const containers = ((d?.result as { containers?: unknown[] } | undefined)?.containers ?? null) as Parameters<typeof fishFrom>[0] | null
  const h = ha && !ha.isError ? parse(textOf(ha)) : null
  const sys = (h?.system_info ?? {}) as { state?: string }
  const p = ps && ps.ok ? parse(ps.text) : null
  const s = sessions && !sessions.isError ? (JSON.parse(textOf(sessions).slice(textOf(sessions).indexOf('['))) as { sessionId?: string; name?: string; isRunning?: boolean }[]) : null
  const at = await $.clock.now()
  const next = await update($, tank, () => ({
    fish: containers ? fishFrom(containers) : prev.fish,
    models: p ? ((p.models as { name?: string }[] | undefined) ?? []).map(m => m.name ?? '?') : prev.models,
    ha: h ? { repairs: Number(h.repair_count ?? 0), notes: Number(h.notification_count ?? 0), isRunning: (sys.state ?? 'RUNNING') === 'RUNNING' } : prev.ha,
    crabs: s ? s.filter(x => x.isRunning).map(x => x.name ?? x.sessionId ?? '?') : prev.crabs,
    at,
    errors,
  }))
  return summary(next)
}

export const register: Register = (on, options) => {
  unraidServer = String(options.unraidServer ?? unraidServer)
  haServer = String(options.haServer ?? haServer)
  ollamaUrl = String(options.ollamaUrl ?? ollamaUrl).replace(/\/+$/, '')
  swimmers = Math.max(0, Number(options.swimmers ?? 24))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'reef', description: 'Your homelab as an aquarium: containers as fish, the GPU as a heater, HA as a lighthouse', argumentHint: '[text]' })
    $.clock.every(60_000, () => {
      void (async () => {
        if ((await $.ui.panes()).some(p => p.id === PANE)) await fill($)
      })()
    })
    return started
  })

  on('command.run', { command: 'reef' }, async ($, e) => {
    if (/\btext\b/.test(e.args)) return { text: await fill($) }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Reef closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    $.clock.after(0, () => void fill($))
    return { text: 'Reef opened; filling the tank.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const t = await read($, tank)
    const refresh = <Button key="refresh" label="Refresh" plain onPress={() => void fill($)} />
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = widthFor(e.props.bodyColumns, 280, 1000)
      const H = 260
      const body = scene(W, H, t, swimmers, (x, y, i) => crab(x, y, ROTATION[i % ROTATION.length] ?? 'other', 'working', 1))
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${THEME_CSS}${CRAB_CSS}${body}</svg>`
      return (
        <Box flexDirection="column">
          <Svg key="tank" source={source} alt={t.at ? summary(t) : 'The tank is filling.'} width={W} height={H} isInteractive />
          <Box flexDirection="row" gap={2}>
            <Text dimColor wrap="truncate-end">
              {t.at ? summary(t) : 'Filling the tank…'}
            </Text>
            {refresh}
          </Box>
          {t.errors.length ? <Text dimColor>{`couldn't read ${t.errors.join('; ')}`}</Text> : null}
        </Box>
      )
    }
    const byStack = STACKS.map(([name]) => [name, t.fish.filter(f => f.stack === name && f.mood === 'swim').length] as const).filter(([, n]) => n)
    return (
      <Box flexDirection="column">
        <Text>{t.at ? summary(t) : 'Filling the tank…'}</Text>
        {byStack.length ? <Text dimColor>{byStack.map(([n, c]) => `${n} ${c}`).join(' · ')}</Text> : null}
        {t.fish
          .filter(f => f.mood === 'bellyup' || f.mood === 'missing')
          .map(f => (
            <Text key={f.name} color="red">
              {'  '}✗ {f.name}: {f.status ?? f.mood}
            </Text>
          ))}
        {refresh}
      </Box>
    )
  })
}
