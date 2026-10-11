import { describe, expect, test } from 'claude-code/testing'

import { actionsIn, attributionLines, checkoutPolicy, parsePolicy } from '../hooks/policy'

const RULES = parsePolicy(['tinkerologie/*=none', 'esphome/*=none', '*=allow'])

// The commit form Claude Code writes, with a heredoc.
const COMMIT = [
  'cd /home/dev/dev/ha-unraid-management-agent && git add -A && git commit -m "$(cat <<\'END\'',
  'feat: group containers under a Docker device',
  '',
  'Closes #177',
  '',
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  'END',
  ')"',
].join('\n')

describe('policy', () => {
  test('a fork of an upstream that forbids attribution', () => {
    expect(checkoutPolicy(['git@github.com:davidcoulson/ha-unraid-management-agent.git', 'https://github.com/tinkerologie/ha-unraid-management-agent'], RULES)).toEqual({
      policy: 'none',
      because: 'tinkerologie/ha-unraid-management-agent',
    })
    expect(checkoutPolicy(['git@github.com:davidcoulson/session-crew.git'], RULES).policy).toBe('allow')
  })
  test('the lines it looks for', () => {
    expect(attributionLines(COMMIT)).toEqual(['Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'])
    expect(attributionLines('Body\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')).toEqual(['🤖 Generated with [Claude Code](https://claude.com/claude-code)'])
    expect(attributionLines('Co-Authored-By: Jane <jane@example.com>')).toEqual([])
  })
  test('git actions in a command', () => {
    expect(actionsIn(COMMIT)).toEqual([{ kind: 'commit', dir: '/home/dev/dev/ha-unraid-management-agent', files: [], isAmendNoMessage: false }])
    expect(actionsIn('gh pr create --repo tinkerologie/unraid-management-agent --draft --body-file /tmp/body.md')).toEqual([
      { kind: 'pr', files: ['/tmp/body.md'], repo: 'tinkerologie/unraid-management-agent' },
    ])
    expect(actionsIn('git -C /tmp/wt push -u origin feat/x')).toEqual([{ kind: 'push', dir: '/tmp/wt' }])
    expect(actionsIn('git commit --amend')).toEqual([{ kind: 'commit', files: [], isAmendNoMessage: true }])
    expect(actionsIn('git status && git log -1')).toEqual([])
  })
})
