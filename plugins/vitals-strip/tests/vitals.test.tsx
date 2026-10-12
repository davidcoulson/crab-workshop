import { describe, expect, mock, test } from 'claude-code/testing'

import { arrayChip, dockerChip, haChip, haVitalsOf, notificationChip, parityChip, problemsChip, resultOf, shown, statusLine } from '../hooks/logic'

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

// ha_eval_template's answer to HA_VITALS_TEMPLATE: the JSON arrives as a string in `result`.
const HA_VITALS = JSON.stringify({
  success: true,
  result: JSON.stringify({
    found: 340,
    array: { summary: { state: 'STARTED', overall_health: 'DEGRADED', num_cache_pools: 6, health_summary: { pools: { failed: 0, warning: 1 } } } },
    metrics: { cpu: { percentTotal: 3.3 }, memory: { percentTotal: 58.8 } },
    notes: { unread: { info: 1, warning: 0, alert: 1, total: 2 } },
    parity: { data: { running: false, progress: 0, errors: 0 } },
    docker: false,
    problems: ['NetApp DS424 E245 Cabling'],
  }),
})

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
  test('/vitals reads Unraid through one HA template call; the band draws what is not green', { options: { haServer: 'home-assistant' } }, async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/tmp' }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    const tools: string[] = []
    on('mcp.call', (_$, e) => {
      tools.push(`${e.server}:${e.tool}`)
      const text = e.tool === 'ha_get_overview' ? HA : e.tool === 'ha_eval_template' ? HA_VITALS : '{}'
      return { value: { content: [{ type: 'text', text }], isError: false } }
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const out = String(((await $.command.run({ command: 'vitals', args: '' } as never)) as { text?: string }).text)
    expect(tools.every(t => !t.includes('unraid'))).toBe(true)
    expect(tools.some(t => t.endsWith(':ha_eval_template'))).toBe(true)
    expect(out.split('\n')[0]).toContain('✗')
    expect(out).toContain('Docker service is not running')
    expect(out).toContain('NetApp DS424 E245 Cabling')
    expect(out).toContain('Home Assistant 2026.10.1 RUNNING: 3 repairs')
    expect(out).not.toContain("couldn't read")
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'vitals-strip', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 90 } } as never)
      if (surface === 'terminal') expect(await band.find({ type: 'Text', text: /docker down/ })).toBeDefined()
      else expect(await band.find({ type: 'Svg' })).toBeDefined()
      await band.unmount()
    }
  })

  test('the HA template answer parses, and a failed render is no data', () => {
    const v = haVitalsOf(HA_VITALS) ?? {}
    expect(arrayChip(v.array as Record<string, unknown>).level).toBe('warn')
    expect(problemsChip(v)?.text).toBe('🐳 docker down · ⚠ NetApp DS424 E245 Cabling')
    expect(problemsChip({ problems: [], docker: true })).toBeNull()
    expect(haVitalsOf('{"success":false,"error":"x"}')).toBeNull()
  })
})
