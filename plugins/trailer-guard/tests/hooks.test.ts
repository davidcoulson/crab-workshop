import { describe, expect, mock, test } from 'claude-code/testing'

const REMOTES = 'origin\tgit@github.com:davidcoulson/ha-unraid-management-agent.git (fetch)\nupstream\thttps://github.com/tinkerologie/ha-unraid-management-agent (fetch)\n'
const UNPUSHED = 'fix: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'

const host = (on: Parameters<typeof mock.clock>[0], remotes: string, ran: string[]) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    return { value: { exitCode: 0, stdout: argv.includes('remote') ? remotes : argv.includes('--remotes') ? UNPUSHED : '', stderr: '' } } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => (ran.push(String((e as { command?: string }).command)), { result: { stdout: '', stderr: '', interrupted: false } }) as never)
}

describe('hooks', () => {
  test('refuses an attributed commit or push in an upstream fork, allows a clean commit', async ($, on) => {
    const ran: string[] = []
    host(on, REMOTES, ran)
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const bad = (await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"' } as never)) as { deny?: string }
    expect(bad.deny).toContain('tinkerologie/ha-unraid-management-agent takes no AI attribution')
    const ok = (await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x"' } as never)) as { deny?: string }
    expect(ok.deny).toBeUndefined()
    expect(ran).toEqual(['git commit -m "fix: x"'])
    const push = (await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/x' } as never)) as { deny?: string }
    expect(push.deny).toContain('an unpushed commit')
  })

  test('leaves your own repos alone', async ($, on) => {
    const ran: string[] = []
    host(on, 'origin\tgit@github.com:davidcoulson/crab-workshop.git (fetch)\n', ran)
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const r = (await $.tool.call({ tool: 'Bash', command: 'git commit -m "x" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"' } as never)) as { deny?: string }
    expect(r.deny).toBeUndefined()
    expect(ran.length).toBe(1)
  })
})
