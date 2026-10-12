import { describe, expect, mock, test } from 'claude-code/testing'

import { addRound, card, currentBout, readReview, reviewKind } from '../hooks/bout'
import type { Round } from '../types'

// As codex plugin 1.0.6 renders a review.
const NEEDS = `# Codex Adversarial Review

Target: branch diff against upstream/main
Verdict: needs-attention

Two issues remain in the share collector.

Findings:
- [high] lstat on /mnt/user is a FUSE lookup (daemon/collectors/shares.go:120-134)
  The check wakes disks.
  Recommendation: read shares.ini.
- [medium] Spun-down disks are reported as checked (daemon/collectors/shares.go:88)
  ...

Next steps:
- Fix both.`
const APPROVE = `# Codex Adversarial Review

Target: branch diff against upstream/main
Verdict: approve

The change is sound.

No material findings.`

const round = (verdict: Round['verdict']): Round => ({ verdict, findings: { critical: 0, high: 0, medium: 0, low: 0 }, titles: [], startedAt: 0, endedAt: 120_000, kind: 'adversarial-review' })

describe('bout', () => {
  test('spotting runs', () => {
    expect(reviewKind('node "/Users/me/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" adversarial-review --wait --base upstream/main "focus"')).toBe('adversarial-review')
    expect(reviewKind('node ~/x/codex-companion.mjs result')).toBe('result')
    expect(reviewKind('git status')).toBe(null)
  })
  test('reading reviews', () => {
    expect(readReview(NEEDS)).toEqual({ verdict: 'needs-attention', findings: { critical: 0, high: 1, medium: 1, low: 0 }, titles: ['lstat on /mnt/user is a FUSE lookup', 'Spun-down disks are reported as checked'] })
    expect(readReview(APPROVE)?.verdict).toBe('approve')
    expect(readReview('plain text')).toBe(null)
  })
  test('a bout runs from one approve to the next', () => {
    let b = addRound(null, 'agent@feat/x', round('approve'))
    b = addRound(b, 'agent@feat/x', round('needs-attention'))
    b = addRound(b, 'agent@feat/x', round('needs-attention'))
    b = addRound(b, 'agent@feat/x', round('approve'))
    expect(currentBout(b.rounds).length).toBe(3)
    expect(card(b).split('\n')[0]).toBe('KO in round 3: Codex approved agent@feat/x.')
  })
})

describe('hooks', () => {
  test('a waited review becomes a round in the ring, drawn on both surfaces', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    const toasts: string[] = []
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.toast', (_$, e) => (toasts.push(String((e as { text?: string }).text)), { value: undefined }))
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    on('session.cwd', () => ({ value: '/tmp/agent' }))
    on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: (e as unknown as { argv: string[] }).argv.includes('--show-toplevel') ? '/tmp/agent\n' : 'feat/x\n', stderr: '' } }) as never)
    let n = 0
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: n++ ? APPROVE : NEEDS, stderr: '', interrupted: false }, text: n > 1 ? APPROVE : NEEDS }) as never)
    await $.session.start({ cwd: '/tmp/agent', surface: 'desktop' } as never)
    const cmd = 'node /x/codex-companion.mjs adversarial-review --wait --base upstream/main'
    await $.tool.call({ tool: 'Bash', command: cmd } as never)
    expect(toasts.at(-1)).toBe('🥊 Round 1: 1 high · 1 medium')
    await $.tool.call({ tool: 'Bash', command: cmd } as never)
    expect(toasts.at(-1)).toBe('🥊 KO in round 2: Codex approves agent@feat/x')
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'codex-corner', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 80 } } as never)
      if (surface === 'terminal') expect(await band.find({ type: 'Text', text: /KO in round 2/ })).toBeDefined()
      else expect(await band.find({ type: 'Svg' })).toBeDefined()
      await band.unmount()
    }
    const out = String(((await $.command.run({ command: 'codex-card', args: '' } as never)) as { text?: string }).text)
    expect(out).toContain('R1  needs-attention')
  })
})
