import { describe, expect, mock, test } from 'claude-code/testing'

import { arrayChip, dockerChip, haChip, notificationChip, parityChip, resultOf, shown, statusLine } from '../hooks/logic'

// Answers as unraid-mcp and HA-MCP gave them (2026-10-11).
const ARRAY = '{"result":{"summary":{"state":"STARTED","num_parity_disks":0,"num_data_disks":0,"num_cache_pools":47,"overall_health":"HEALTHY","health_summary":{"cache_health":{"healthy":47,"failed":0,"missing":0,"new":0,"warning":0,"critical":0,"unknown":0}}}}}'
const METRICS = '{"result":{"cpu":{"percentTotal":3.5},"memory":{"percentTotal":57.9}}}'
const DOCKER = JSON.stringify({
  result: {
    containers: [
      { names: ['/theater-panel'], state: 'RUNNING', status: 'Up 7 minutes (healthy)', autoStart: true },
      { names: ['/Prismarr'], state: 'RUNNING', status: 'Up 21 minutes (unhealthy)', autoStart: true },
      { names: ['/zerobyte'], state: 'EXITED', status: 'Exited (1) 2 hours ago', autoStart: true },
      { names: ['/old-thing'], state: 'EXITED', status: 'Exited (0) 9 days ago', autoStart: false },
    ],
  },
})
const NOTES = '{"result":{"unread":{"info":1,"warning":0,"alert":1,"total":2}}}'
const PARITY = '{"result":{"success":true,"data":{"progress":0,"status":"NEVER_RUN","running":null,"errors":null}}}'
const HA = '{"success":true,"system_info":{"version":"2026.10.1","state":"RUNNING"},"notification_count":1,"repair_count":3}'

const r = (t: string) => resultOf(t) ?? {}

describe('chips', () => {
  test('from real answers', () => {
    expect(arrayChip(r(ARRAY))).toMatchObject({ level: 'ok', text: 'array ok · 47 pools' })
    expect(dockerChip(r(DOCKER))).toMatchObject({ level: 'bad', text: '🐳 2/4 · unhealthy: Prismarr · down: zerobyte' })
    expect(notificationChip(r(NOTES))).toMatchObject({ level: 'bad', text: '🔔 1 alert, 1 info' })
    expect(parityChip(r(PARITY))).toBe(null)
    expect(haChip(r(HA))).toMatchObject({ level: 'warn', text: '🏠 HA 2026.10.1 · 3 repairs · 1 notification' })
  })
  test('quiet shows only what needs a look', () => {
    const chips = [arrayChip(r(ARRAY)), dockerChip(r(DOCKER)), haChip(r(HA))]
    expect(shown(chips, true).map(c => c.key)).toEqual(['docker', 'ha'])
    expect(shown(chips, false).map(c => c.key)).toEqual(['docker', 'ha', 'array'])
    expect(statusLine(chips, [])).toBe('vitals: 2 need a look')
    expect(statusLine([arrayChip(r(ARRAY))], [])).toBe('vitals: all green')
  })
})

describe('hooks', () => {
  test('/vitals reads both servers; the band draws what is not green', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/tmp' }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    on('mcp.call', (_$, e) => {
      const a = e.args as { action?: string; subaction?: string }
      const text = e.tool === 'ha_get_overview' ? HA : a.action === 'docker' ? DOCKER : a.action === 'notification' ? NOTES : a.action === 'array' ? PARITY : a.subaction === 'metrics' ? METRICS : ARRAY
      return { value: { content: [{ type: 'text', text }], isError: false } }
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const out = String(((await $.command.run({ command: 'vitals', args: '' } as never)) as { text?: string }).text)
    expect(out.split('\n')[0]).toContain('✗')
    expect(out).toContain('set to autostart but not running: zerobyte')
    expect(out).toContain('Home Assistant 2026.10.1 RUNNING: 3 repairs')
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'vitals-strip', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 90 } } as never)
      if (surface === 'terminal') expect(await band.find({ type: 'Text', text: /unhealthy: Prismarr/ })).toBeDefined()
      else expect(await band.find({ type: 'Svg' })).toBeDefined()
      await band.unmount()
    }
  })
})
