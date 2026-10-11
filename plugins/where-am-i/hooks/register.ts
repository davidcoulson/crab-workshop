import type { EngineInterface, Register } from 'claude-code'

import { describe, hostKind, hostLabel, movesCheckout, nudge, ownerRepo, parseRemotes, parseRules, shortPath } from './place'
import type { Place, RepoInfo } from './place'

const git = async ($: EngineInterface, cwd: string, args: string[]): Promise<string> => {
  try {
    const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function readRepo($: EngineInterface, cwd: string): Promise<RepoInfo | undefined> {
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (!top) return undefined
  const [branch, gitDir, common, remotesText] = await Promise.all([
    git($, cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git($, cwd, ['rev-parse', '--absolute-git-dir']),
    git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git($, cwd, ['remote', '-v']),
  ])
  const remotes = parseRemotes(remotesText)
  const origin = remotes.origin ? ownerRepo(remotes.origin) : null
  const upstream = remotes.upstream ? ownerRepo(remotes.upstream) : null
  return {
    name: origin?.name ?? upstream?.name ?? top.split('/').pop() ?? top,
    branch: branch === 'HEAD' ? 'detached' : branch || '?',
    ...(origin ? { origin: origin.owner } : {}),
    ...(upstream ? { upstream: upstream.owner } : {}),
    isWorktree: !!gitDir && !!common && gitDir !== common,
  }
}

// Kept per load: a reload re-reads the place at start.
let place: Place | null = null
let host = ''
let kind: Place['kind'] = 'linux'
let hostRules: [string, string][] = []
const said = new Set<string>()

async function refresh($: EngineInterface): Promise<Place> {
  const cwd = await $.session.cwd()
  const repo = await readRepo($, cwd)
  place = { kind, host, label: hostLabel(kind, host, hostRules), cwd, ...(repo ? { repo } : {}) }
  $.ui.status(describe(place))
  return place
}

export const register: Register = (on, options) => {
  hostRules = parseRules(options.hosts as readonly string[] | undefined)
  const homes = parseRules(options.homes as readonly string[] | undefined)
  const targets = ((options.containerTargets as readonly string[] | undefined) ?? []).map(String)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      const [uname, name, isDocker] = await Promise.all([
        $.process.run(['uname', '-s'], { timeoutMs: 3000 }).then(r => r.stdout.trim()).catch(() => ''),
        $.process.run(['hostname'], { timeoutMs: 3000 }).then(r => r.stdout.trim()).catch(() => ''),
        $.fs.exists('/.dockerenv').catch(() => false),
      ])
      host = name || 'unknown'
      kind = hostKind(uname, isDocker === true)
      await $.command.register({ name: 'where', description: 'Show which machine, folder, repo, branch and remotes this session runs in' })
      await refresh($)
    } catch {
      // The status line is a nicety; a failure here changes nothing else.
    }
    return started
  })

  on('command.run', { command: 'where' }, async $ => {
    const p = await refresh($)
    const cwd = p.cwd
    const remotes = parseRemotes(await git($, cwd, ['remote', '-v']))
    const lines = [
      `host     ${p.label} (${p.host}, ${p.kind})`,
      `folder   ${shortPath(cwd)}`,
      ...(p.repo
        ? [
            `repo     ${p.repo.name} on ${p.repo.branch}${p.repo.isWorktree ? ' (a worktree)' : ''}`,
            ...Object.entries(remotes).map(([n, u]) => `remote   ${n.padEnd(9)}${u}`),
          ]
        : ['repo     (not a git checkout)']),
    ]
    return { text: lines.join('\n') }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const command = String(e.command ?? '')
    if (movesCheckout(command)) await refresh($).catch(() => undefined)
    if (!place || r.deny !== undefined) return r
    const n = nudge(place, command, homes, targets)
    // Once per kind per load: a nudge, not a nag.
    if (!n || said.has(n.kind)) return r
    said.add(n.kind)
    $.ui.toast(n.note.replace(/^where-am-i: /, '').split('. ')[0] + '.')
    return { ...r, context: [...(r.context ?? []), n.note] }
  }).catch(($, e, next) => next(e))
}
