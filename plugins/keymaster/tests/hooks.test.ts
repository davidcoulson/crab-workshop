import { describe, expect, mock, test } from 'claude-code/testing'

const KEY = '0123456789abcdef0123456789abcdef'

describe('hooks', () => {
  test('a Bash result with a key reaches the model masked, with a note', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    const toasts: string[] = []
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', (_$, e) => (toasts.push(String((e as { text?: string }).text)), { value: undefined }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: `RADARR_API_KEY=${KEY}\n`, stderr: '', interrupted: false }, text: `RADARR_API_KEY=${KEY}\n` }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const r = (await $.tool.call({ tool: 'Bash', command: 'docker inspect radarr' } as never)) as { result?: { stdout?: string }; context?: string[] }
    expect(r.result?.stdout).not.toContain(KEY)
    expect(r.result?.stdout).toContain('‹masked assigned-secret')
    expect(r.context?.some(c => c.includes('hidden on purpose'))).toBe(true)
    expect(r.context?.some(c => c.includes('--format'))).toBe(true)
    expect(toasts[0]).toContain('masked 1 secret')
    const list = String(((await $.command.run({ command: 'keymaster', args: '' } as never)) as { text?: string }).text)
    expect(list).toContain('assigned-secret')
    expect(list).not.toContain(KEY)
  })

  test('clean output passes untouched', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    const clean = { result: { stdout: 'ok\n', stderr: '', interrupted: false }, text: 'ok\n' }
    on('tool.call', { tool: 'Bash' }, () => clean as never)
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const r = (await $.tool.call({ tool: 'Bash', command: 'echo ok' } as never)) as { result?: { stdout?: string }; context?: string[] }
    expect(r.result?.stdout).toBe('ok\n')
    expect(r.context ?? []).toEqual([])
  })
})
