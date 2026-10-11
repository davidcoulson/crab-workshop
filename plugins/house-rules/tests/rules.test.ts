import { describe, expect, mock, test } from 'claude-code/testing'

import { BUILT_IN, broken, parseAdd } from '../hooks/rules'

const ids = (tool: string, input: Record<string, unknown>) => broken(BUILT_IN, tool, input).map(r => r.id)
const HA = 'mcp__9701d7dd-0c3d-4d64-8a88-8109a1430f1b__'

describe('rules', () => {
  test('built-ins catch what went wrong before', () => {
    expect(ids('Write', { file_path: '/boot/config/plugins/dockerMan/templates-user/my-Prismarr.xml', content: '<Config Name="Data" Target="/var/www/html/var/data" Type="Path">/mnt/user/appdata/prismarr</Config>' })).toEqual(['appdata-path'])
    expect(ids('Bash', { command: 'docker run -d -v /mnt/user/appdata/foo:/config foo' })).toEqual(['appdata-path'])
    expect(ids('Bash', { command: 'ls /mnt/user/appdata/prismarr' })).toEqual([])
    expect(ids('Bash', { command: 'git add CLAUDE.local.md' })).toEqual(['claude-local'])
    expect(ids('Bash', { command: 'git push --force upstream feat/x' })).toEqual(['upstream-force-push'])
    expect(ids('Bash', { command: 'git push --force-with-lease origin feat/x' })).toEqual([])
    expect(ids(`${HA}ha_restart`, {})).toEqual(['ha-restart'])
    expect(ids(`${HA}ha_call_service`, { domain: 'homeassistant', service: 'restart' })).toEqual(['ha-restart'])
    expect(ids(`${HA}ha_call_service`, { domain: 'light', service: 'turn_on' })).toEqual([])
  })
  test('your own rules', () => {
    const r = parseAdd('Bash deny /\\bzpool\\s+(destroy|offline)\\b/ Pools are changed by David only.', 'mine-1')
    expect(typeof r === 'string' ? r : broken([r], 'Bash', { command: 'zpool offline nvme8tb sda' }).map(x => x.id)).toEqual(['mine-1'])
    expect(parseAdd('Bash nope /x/ m', 'x')).toContain('Usage')
    expect(parseAdd('Bash deny /(/ m', 'x')).toContain("doesn't compile")
  })
})

describe('hooks', () => {
  test('a deny refuses, a note rides along', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    const ran: string[] = []
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.toast', () => ({ value: undefined }))
    on('tool.call', { tool: 'Bash' }, (_$, e) => (ran.push(String((e as { command?: string }).command)), { result: { stdout: '', stderr: '', interrupted: false } }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const d = (await $.tool.call({ tool: 'Bash', command: 'git add CLAUDE.local.md' } as never)) as { deny?: string }
    expect(d.deny).toContain('claude-local')
    const n = (await $.tool.call({ tool: 'Bash', command: 'docker run -v /mnt/user/appdata/x:/config x' } as never)) as { context?: string[] }
    expect(n.context?.[0]).toContain('nvme8tb')
    expect(ran).toEqual(['docker run -v /mnt/user/appdata/x:/config x'])
    const list = String(((await $.command.run({ command: 'rules', args: '' } as never)) as { text?: string }).text)
    expect(list).toMatch(/claude-local\s+deny\s+1 hits/)
  })
})
