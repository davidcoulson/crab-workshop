// Pure logic for trailer-guard.

export type Rule = [pattern: string, policy: 'none' | 'allow']

export function parsePolicy(raw: readonly string[] | string | undefined): Rule[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : []
  return list
    .map(s => String(s).trim())
    .filter(s => s.includes('='))
    .map(s => [s.slice(0, s.lastIndexOf('=')).trim(), s.slice(s.lastIndexOf('=') + 1).trim().toLowerCase()] as [string, string])
    .filter((r): r is Rule => !!r[0] && (r[1] === 'none' || r[1] === 'allow'))
}

export const glob = (pattern: string, s: string): boolean =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(s)

/** owner/name from a git remote URL. */
export function slug(url: string): string | null {
  const m = url.trim().match(/[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  return m && m[1] && m[2] ? `${m[1]}/${m[2]}` : null
}

export const policyFor = (repo: string, rules: Rule[]): 'none' | 'allow' => rules.find(([p]) => glob(p, repo))?.[1] ?? 'allow'

/** The strictest policy among the repos a checkout's remotes name. */
export function checkoutPolicy(remoteUrls: string[], rules: Rule[]): { policy: 'none' | 'allow'; because?: string } {
  for (const u of remoteUrls) {
    const s = slug(u)
    if (s && policyFor(s, rules) === 'none') return { policy: 'none', because: s }
  }
  return { policy: 'allow' }
}

// Anywhere in a line, so a trailer passed as its own -m "..." argument counts too.
const LINES = [/Co-Authored-By:\s*Claude\b[^"'\n]*/gi, /Co-Authored-By:[^"'\n]*noreply@anthropic\.com[^"'\n]*/gi, /(?:🤖\s*)?Generated with \[?Claude Code\]?[^"'\n]*/gi]

/** The attribution lines in a text, as written, once each. */
export function attributionLines(text: string): string[] {
  const out = new Set<string>()
  for (const re of LINES) for (const m of text.matchAll(re)) out.add(m[0].trim())
  return [...out]
}

export type GitAction =
  | { kind: 'commit'; dir?: string; files: string[]; isAmendNoMessage: boolean }
  | { kind: 'pr'; dir?: string; files: string[]; repo?: string }
  | { kind: 'push'; dir?: string }

/** The git actions in a shell command (commits, PR creation or edits, pushes), with a leading cd or git -C. */
export function actionsIn(command: string): GitAction[] {
  const out: GitAction[] = []
  let dir: string | undefined
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)
  if (cd && cd[1]) dir = cd[1].replace(/^["']|["']$/g, '')
  const segments = command.split(/&&|;|\|\||\n(?=\s*(?:git|gh|cd)\b)/)
  for (const seg of segments) {
    const c = seg.trim()
    const gitC = c.match(/^git\s+-C\s+("[^"]+"|'[^']+'|\S+)/)
    const d = gitC && gitC[1] ? gitC[1].replace(/^["']|["']$/g, '') : dir
    const files = [...c.matchAll(/(?:\s-F|--file|--body-file)[=\s]+("[^"]+"|'[^']+'|[^\s"']+)/g)].map(m => (m[1] ?? '').replace(/^["']|["']$/g, '')).filter(f => f && f !== '-')
    if (/^git\b(\s+-C\s+\S+)?\s+commit\b/.test(c))
      out.push({ kind: 'commit', ...(d ? { dir: d } : {}), files, isAmendNoMessage: /--amend\b/.test(c) && !/(\s-m\b|\s-F\b|--message|--file|--no-edit)/.test(c) })
    else if (/^gh\s+pr\s+(create|edit)\b/.test(c)) {
      const repo = c.match(/(?:-R|--repo)[=\s]+(\S+)/)?.[1]
      out.push({ kind: 'pr', ...(d ? { dir: d } : {}), files, ...(repo ? { repo } : {}) })
    } else if (/^git\b(\s+-C\s+\S+)?\s+push\b/.test(c)) out.push({ kind: 'push', ...(d ? { dir: d } : {}) })
  }
  return out
}

export function denial(repo: string, lines: string[], where: string): string {
  return (
    `trailer-guard: ${repo} takes no AI attribution in commits or PRs, and ${where} carries:\n` +
    lines.map(l => `  ${l}`).join('\n') +
    `\nRemove ${lines.length === 1 ? 'that line' : 'those lines'} and run it again` +
    (where === 'an unpushed commit' ? ' (reword the commit with git commit --amend, or git rebase with --exec for older ones).' : '.')
  )
}
