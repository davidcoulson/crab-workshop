import { describe as group, expect, test } from 'claude-code/testing'

import { describe, homeFor, hostKind, hostLabel, isDevCommand, movesCheckout, nudge, ownerRepo, parseRemotes, parseRules, sshTarget } from '../hooks/place'
import type { Place } from '../hooks/place'

const HOMES = parseRules(['ha-unraid-management-agent=container', 'unraid-*=container', 'kiosk-*=mac'])
const TARGETS = ['unraid', 'claude-code', '192.0.2.4', '192.0.2.51']
const MAC: Place = {
  kind: 'mac',
  host: 'Davids-MacBook-Pro.local',
  label: '🍎 Mac',
  cwd: '/Users/me/dev/ha-unraid-management-agent',
  repo: { name: 'ha-unraid-management-agent', branch: 'main', origin: 'davidcoulson', upstream: 'tinkerologie', isWorktree: false },
}

group('host', () => {
  test('kind and label', () => {
    expect(hostKind('Darwin', false)).toBe('mac')
    expect(hostKind('Linux', true)).toBe('container')
    expect(hostKind('Linux', false)).toBe('linux')
    expect(hostLabel('mac', 'Davids-MacBook-Pro.local', [])).toBe('🍎 Mac')
    expect(hostLabel('container', 'claude-code', [])).toBe('🐳 claude-code')
    expect(hostLabel('container', 'claude-code', parseRules(['claude-*=🐧 dev box']))).toBe('🐧 dev box')
  })
})

group('repo', () => {
  test('remotes and owners', () => {
    const r = parseRemotes('origin\tgit@github.com:davidcoulson/ha-unraid-management-agent.git (fetch)\norigin\tgit@github.com:davidcoulson/ha-unraid-management-agent.git (push)\nupstream\thttps://github.com/tinkerologie/ha-unraid-management-agent (fetch)\n')
    expect(Object.keys(r)).toEqual(['origin', 'upstream'])
    expect(ownerRepo(r.origin ?? '')).toEqual({ owner: 'davidcoulson', name: 'ha-unraid-management-agent' })
    expect(ownerRepo(r.upstream ?? '')).toEqual({ owner: 'tinkerologie', name: 'ha-unraid-management-agent' })
  })
  test('the status line', () => {
    expect(describe(MAC)).toBe('🍎 Mac · ha-unraid-management-agent · main · fork of tinkerologie')
    expect(describe({ kind: 'container', host: 'cc', label: '🐳 cc', cwd: '/home/dev/notes' })).toBe('🐳 cc · ~/notes')
  })
})

group('nudges', () => {
  test('ssh to the container from the Mac', () => {
    expect(sshTarget('ssh unraid "zpool status"', TARGETS)).toBe('unraid')
    expect(sshTarget('ssh -i k dev@192.0.2.51 ls', TARGETS)).toBe('192.0.2.51')
    expect(sshTarget('rsync -a x root@192.0.2.4:/tmp/', TARGETS)).toBe('192.0.2.4')
    expect(sshTarget('ssh pvebox.example.net', TARGETS)).toBe(null)
    expect(sshTarget('echo unraid', TARGETS)).toBe(null)
    expect(nudge(MAC, 'ssh unraid docker ps', HOMES, TARGETS)?.kind).toBe('ssh:unraid')
    expect(nudge({ ...MAC, kind: 'container' }, 'ssh unraid docker ps', HOMES, TARGETS)).toBe(null)
  })
  test('tests of a container repo run on the Mac', () => {
    expect(isDevCommand('.venv/bin/pytest -n auto')).toBe(true)
    expect(isDevCommand('git status')).toBe(false)
    expect(homeFor('unraid-management-agent', HOMES)).toBe('container')
    expect(nudge(MAC, 'cd x && .venv/bin/pytest tests', HOMES, TARGETS)?.kind).toBe('dev:ha-unraid-management-agent')
    expect(nudge(MAC, 'git log', HOMES, TARGETS)).toBe(null)
    const kiosk: Place = { ...MAC, repo: { name: 'kiosk-satellite', branch: 'main', isWorktree: false } }
    expect(nudge(kiosk, 'npm test', HOMES, TARGETS)).toBe(null)
  })
  test('commands that move the checkout', () => {
    expect(movesCheckout('git switch -c feat/x')).toBe(true)
    expect(movesCheckout('cd ../other && ls')).toBe(true)
    expect(movesCheckout('git status')).toBe(false)
  })
})
