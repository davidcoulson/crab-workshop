import type { EngineInterface, Register } from 'claude-code'

import { actionsIn, attributionLines, checkoutPolicy, denial, parsePolicy, policyFor } from './policy'
import type { Rule } from './policy'

let rules: Rule[] = []

async function git($: EngineInterface, dir: string | undefined, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', ...args], { ...(dir ? { cwd: dir } : {}), timeoutMs: 8000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

async function policyOf($: EngineInterface, dir: string | undefined): Promise<{ policy: 'none' | 'allow'; because?: string }> {
  const remotes = await git($, dir, ['remote', '-v'])
  const urls = [...new Set(remotes.split('\n').map(l => l.split(/\s+/)[1] ?? '').filter(Boolean))]
  return checkoutPolicy(urls, rules)
}

async function readFile($: EngineInterface, dir: string | undefined, file: string): Promise<string> {
  try {
    const t = await $.fs.read(file.startsWith('/') || !dir ? file : `${dir}/${file}`)
    return typeof t === 'string' ? t : ''
  } catch {
    return ''
  }
}

/** The refusal for a command, or null when it may run. */
async function judge($: EngineInterface, command: string): Promise<string | null> {
  const actions = actionsIn(command)
  if (!actions.length) return null
  const inline = attributionLines(command)
  for (const a of actions) {
    const p = a.kind === 'pr' && a.repo ? { policy: policyFor(a.repo, rules), because: a.repo } : await policyOf($, a.dir)
    if (p.policy !== 'none') continue
    const repo = p.because ?? 'this repo'
    if (a.kind === 'push') {
      // Commits on no remote yet: what this push would publish.
      const lines = attributionLines(await git($, a.dir, ['log', '--not', '--remotes', '--format=%B', '-n', '50']))
      if (lines.length) return denial(repo, lines, 'an unpushed commit')
      continue
    }
    const lines = [...inline]
    for (const f of a.files) lines.push(...attributionLines(await readFile($, a.dir, f)))
    if (a.kind === 'commit' && a.isAmendNoMessage) lines.push(...attributionLines(await git($, a.dir, ['log', '-1', '--format=%B'])))
    const unique = [...new Set(lines)]
    if (unique.length) return denial(repo, unique, a.kind === 'pr' ? 'this PR text' : 'this commit message')
  }
  return null
}

export const register: Register = (on, options) => {
  rules = parsePolicy(options.policy as readonly string[] | undefined)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'trailers', description: "This repo's commit attribution policy (trailer-guard)" })
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = await judge($, String(e.command ?? ''))
    return why ? { deny: why } : next(e)
  }).catch(($, e, next) => next(e))

  // The engine's own attribution text, where the session's repo says none.
  on('attribution.text', async ($, e, next) => {
    if (e.kind !== 'commit' && e.kind !== 'pr') return next(e)
    const p = await policyOf($, await $.session.cwd())
    return p.policy === 'none' ? { text: '' } : next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'trailers' }, async $ => {
    const p = await policyOf($, await $.session.cwd())
    return {
      text:
        p.policy === 'none'
          ? `No AI attribution here: a remote is ${p.because}. trailer-guard refuses commits, PR text and pushes that carry Co-Authored-By: Claude or the Claude Code footer.`
          : `Attribution allowed here (no remote matches a none rule). Rules: ${rules.map(r => r.join('=')).join(', ')}`,
    }
  })
}
