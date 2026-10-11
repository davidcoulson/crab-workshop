// Pure logic for where-am-i: what kind of host this is, how to describe the
// repo, and when a command deserves a nudge.

export type HostKind = 'mac' | 'container' | 'linux'

export type Place = {
  kind: HostKind
  host: string
  label: string
  cwd: string
  repo?: RepoInfo
}

export type RepoInfo = {
  /** Repo name, from origin's URL or the folder. */
  name: string
  branch: string
  /** owner of origin (davidcoulson) and of upstream (tinkerologie), when present. */
  origin?: string
  upstream?: string
  isWorktree: boolean
}

/** `pattern=value` lines into pairs; `*` and `?` globs. */
export function parseRules(raw: readonly string[] | string | undefined): [string, string][] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : []
  return list
    .map(s => String(s).trim())
    .filter(s => s.includes('='))
    .map(s => [s.slice(0, s.indexOf('=')).trim(), s.slice(s.indexOf('=') + 1).trim()] as [string, string])
    .filter(([p, v]) => p && v)
}

export const glob = (pattern: string, s: string): boolean =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(s)

export function hostKind(uname: string, isDocker: boolean): HostKind {
  if (/darwin/i.test(uname)) return 'mac'
  return isDocker ? 'container' : 'linux'
}

export function hostLabel(kind: HostKind, host: string, rules: [string, string][]): string {
  const hit = rules.find(([p]) => glob(p, host))
  if (hit) return hit[1]
  const short = host.replace(/\.local$/, '')
  return kind === 'mac' ? '🍎 Mac' : kind === 'container' ? `🐳 ${short}` : `🐧 ${short}`
}

/** owner/name from a git remote URL (ssh or https); null when it isn't one. */
export function ownerRepo(url: string): { owner: string; name: string } | null {
  const m = url.trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/)
  return m && m[1] && m[2] ? { owner: m[1], name: m[2] } : null
}

/** `git remote -v` output into name → url (fetch lines). */
export function parseRemotes(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/)
    if (m && m[1] && m[2] && !out[m[1]]) out[m[1]] = m[2]
  }
  return out
}

export function describe(p: Place): string {
  const parts = [p.label]
  if (p.repo) {
    const r = p.repo
    let repo = `${r.name} · ${r.branch}`
    if (r.isWorktree) repo += ' (worktree)'
    parts.push(repo)
    if (r.upstream && r.origin && r.upstream !== r.origin) parts.push(`fork of ${r.upstream}`)
  } else {
    parts.push(shortPath(p.cwd))
  }
  return parts.join(' · ')
}

export const shortPath = (path: string): string =>
  path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^~\/Library\/Application Support\/Claude\/scratch-workspaces\/.*\/(scratch-[^/]+)/, 'scratch/$1')

const DEV = /(^|[\s;&|(])(make\s+(test|check|lint)|go\s+(test|vet|build)|pytest|\.venv\/bin\/pytest|script\/(test|setup|hassfest)|ruff\s|mypy\s|npm\s+(test|run)|pnpm\s|uv\s+run)/

export const isDevCommand = (command: string): boolean => DEV.test(command)

/** The container or Unraid word a remote command on the Mac names, or null. */
export function sshTarget(command: string, targets: readonly string[]): string | null {
  const m = command.match(/(^|[\s;&|(])(ssh|scp|rsync|sftp)\s+([^\n;&|]*)/)
  if (!m || !m[3]) return null
  const rest = m[3]
  return targets.find(t => t && new RegExp(`(^|[\\s@:/])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s:/])`, 'i').test(rest)) ?? null
}

export function homeFor(repo: string | undefined, rules: [string, string][]): HostKind | undefined {
  if (!repo) return undefined
  const v = rules.find(([p]) => glob(p, repo))?.[1]?.toLowerCase()
  return v === 'mac' || v === 'container' ? v : undefined
}

/** The note Claude reads after the command, or null when the command is fine here. */
export function nudge(p: Place, command: string, homes: [string, string][], targets: readonly string[]): { kind: string; note: string } | null {
  if (p.kind === 'mac') {
    const t = sshTarget(command, targets)
    if (t)
      return {
        kind: `ssh:${t}`,
        note:
          `where-am-i: this session runs on the Mac (${p.host}), and that command reaches ${t}. ` +
          `Work on the Unraid host or in the claude-code dev container belongs in a session on the "UnRAID" SSH connection (folder ~/dev), ` +
          `where the keys and host keys are set up. If it failed with "Host key verification failed" or a permission denial, ` +
          `stop and ask David to move the work there (or propose a side session there) instead of working around it.`,
      }
  }
  const home = homeFor(p.repo?.name, homes)
  if (home && home !== p.kind && p.kind !== 'linux' && isDevCommand(command))
    return {
      kind: `dev:${p.repo?.name}`,
      note:
        `where-am-i: ${p.repo?.name} is developed ${home === 'container' ? 'in the claude-code container (UnRAID SSH connection, ~/dev)' : 'on the Mac'}, ` +
        `but this session runs ${p.kind === 'mac' ? 'on the Mac' : 'in the container'} (${shortPath(p.cwd)}). ` +
        `This checkout may be stale or lack the environment (venv, CLAUDE.local.md, keys). Say so to David before relying on results from here.`,
    }
  return null
}

/** Whether a command may have moved the checkout (branch or folder). */
export const movesCheckout = (command: string): boolean => /\bgit\s+(checkout|switch|worktree|clone|rebase|merge|pull)\b|(^|[\s;&|])cd\s/.test(command)
