import { describe, expect, mock, test } from 'claude-code/testing'

import { fishFrom, scene, stackOf, summary } from '../hooks/logic'
import type { Tank } from '../types'

const CONTAINERS = [
  { names: ['/Prismarr'], image: 'ghcr.io/davidcoulson/prismarr:1.2.0-dc1', state: 'RUNNING', status: 'Up 21 minutes (unhealthy)', autoStart: true },
  { names: ['/radarr'], image: 'lscr.io/linuxserver/radarr', state: 'RUNNING', status: 'Up 3 hours', autoStart: true },
  { names: ['/Nginx-Proxy-Manager'], image: 'jc21/nginx-proxy-manager:2.16.0', state: 'RUNNING', status: 'Up 3 hours', autoStart: true },
  { names: ['/zerobyte'], state: 'EXITED', status: 'Exited (1)', autoStart: true },
  { names: ['/old'], state: 'EXITED', status: 'Exited (0)', autoStart: false },
]

describe('logic', () => {
  test('fish', () => {
    const fish = fishFrom(CONTAINERS)
    expect(fish.map(f => [f.name, f.stack, f.mood])).toEqual([
      ['Nginx-Proxy-Manager', 'net', 'swim'],
      ['old', 'other', 'rest'],
      ['Prismarr', 'arr', 'bellyup'],
      ['radarr', 'arr', 'swim'],
      ['zerobyte', 'data', 'missing'],
    ])
    expect(stackOf('homeassistant').stack).toBe('home')
  })
  test('the scene and summary', () => {
    const t: Tank = { fish: fishFrom(CONTAINERS), models: ['qwen3:8b'], ha: { repairs: 3, notes: 1, isRunning: true }, crabs: ['nut-pr-review-fixes'], at: 1, errors: [] }
    expect(summary(t)).toBe('2 fish swimming · belly-up: Prismarr · missing: zerobyte · 1 resting · heater on (qwen3:8b) · lighthouse blinking: 3 HA repairs · 1 crab at work')
    const s = scene(600, 260, t, 24, () => '<g class="crab"/>')
    expect(s).toContain('<title>Prismarr')
    expect(s).toContain('class="heat"')
    expect(s).toContain('class="beam"')
    expect(s).toContain('<g class="crab"/>')
    expect(s.length).toBeLessThan(131072)
  })
  test('eighty-seven fish stay well under the SVG limit', () => {
    const many = Array.from({ length: 87 }, (_, i) => ({ names: [`/c${i}`], state: 'RUNNING', status: 'Up', autoStart: true }))
    const s = scene(900, 260, { fish: fishFrom(many), models: [], ha: null, crabs: [], at: 1, errors: [] }, 24, () => '')
    expect(s.length).toBeLessThan(60000)
  })
})

describe('hooks', () => {
  test('/reef fills the tank from the servers and draws it', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.panes', () => ({ value: [] }))
    on('mcp.call', (_$, e) => {
      const text =
        e.tool === 'unraid'
          ? JSON.stringify({ result: { containers: CONTAINERS } })
          : e.tool === 'ha_get_overview'
            ? '{"system_info":{"version":"2026.10.1","state":"RUNNING"},"notification_count":1,"repair_count":3}'
            : JSON.stringify([{ sessionId: 'local_a', name: 'prismarr-patch', isRunning: true }])
      return { value: { content: [{ type: 'text', text }], isError: false } }
    })
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"models":[{"name":"qwen3:8b","size":6,"size_vram":6}]}' } }))
    await $.session.start({ cwd: '/tmp', surface: 'desktop' } as never)
    const out = String(((await $.command.run({ command: 'reef', args: 'text' } as never)) as { text?: string }).text)
    expect(out).toContain('belly-up: Prismarr')
    expect(out).toContain('1 crab at work')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'reef', surface, component: 'Pane', requestId: 'reef', props: { title: 'Reef', isFocused: false, bodyColumns: 90, placement: 'dock' } } as never)
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /Prismarr/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
})
