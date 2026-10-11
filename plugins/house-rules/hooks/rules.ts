// Pure logic for house-rules: the built-in rules and matching a call against them.

import type { HouseRule, RuleAction } from '../types'

export const BUILT_IN: HouseRule[] = [
  {
    id: 'appdata-path',
    tools: ['Write', 'Edit', 'MultiEdit', 'Bash'],
    // A container mapping or template that names the FUSE path for appdata.
    match: ['/mnt/user/appdata/[A-Za-z0-9]', '(docker[^"]*\\s(run|create)\\b|\\.xml"|compose|"Type":"Path"|<Config[^>]*Type=\\\\?"Path|\\s-v\\s)'],
    action: 'note',
    message:
      "This server's appdata share lives on the nvme8tb pool and is exclusive: new container paths go to /mnt/nvme8tb/appdata/<app> (no FUSE), as with Prismarr. " +
      'The Appdata Backup plugin only covers sources under /mnt/user/appdata, so check that whichever path you pick is backed up (zerobyte snapshots the ZFS dataset either way).',
    isBuiltIn: true,
  },
  {
    id: 'claude-local',
    tools: ['Bash'],
    match: ['\\bgit\\s+(add|commit)\\b[^;&|]*CLAUDE\\.local\\.md'],
    action: 'deny',
    message: 'CLAUDE.local.md holds environment notes and stays uncommitted in every repo. Leave it out of git add and commits.',
    isBuiltIn: true,
  },
  {
    id: 'upstream-force-push',
    tools: ['Bash'],
    match: ['\\bgit\\s+push\\b[^;&|]*(--force\\b|--force-with-lease|\\s-f\\b|\\s\\+)', '\\bgit\\s+push\\b[^;&|]*\\bupstream\\b'],
    action: 'deny',
    message: "Never force-push to an upstream remote (someone else's repo). Push to your fork (origin) and update the PR from there.",
    isBuiltIn: true,
  },
  {
    id: 'ha-restart',
    tools: ['mcp__*__ha_restart', 'mcp__*__ha_call_service', 'mcp__*__ha_reload_core'],
    match: ['(ha_restart|"domain":"homeassistant".*"service":"(restart|stop)"|"service":"homeassistant\\.(restart|stop)"|ha_reload_core)'],
    action: 'ask',
    message: 'Restarting Home Assistant interrupts the house (lights, automations, dashboards). David decides when.',
    isBuiltIn: true,
  },
]

export const glob = (pattern: string, s: string): boolean =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(s)

/** The rules a call breaks, strictest first. `input` is the call's arguments. */
export function broken(rules: HouseRule[], tool: string, input: Record<string, unknown>): HouseRule[] {
  const text = JSON.stringify(input) + (tool.includes('__') ? ` ${tool}` : '')
  const rank: Record<RuleAction, number> = { deny: 0, ask: 1, note: 2 }
  return rules
    .filter(r => r.tools.some(t => glob(t, tool)))
    .filter(r => r.match.every(m => safeTest(m, text)))
    .filter(r => !r.unless || !safeTest(r.unless, text))
    .sort((a, b) => rank[a.action] - rank[b.action])
}

function safeTest(source: string, text: string): boolean {
  try {
    return new RegExp(source, 'i').test(text)
  } catch {
    return false
  }
}

/** `/rules add <tools> <note|ask|deny> /regex/ message` into a rule, or why not. */
export function parseAdd(args: string, id: string): HouseRule | string {
  const m = args.match(/^\s*(\S+)\s+(note|ask|deny)\s+\/(.+?)\/\s+(.+)$/)
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return 'Usage: /rules add <tool-glob[,glob]> <note|ask|deny> /regex/ <message>'
  try {
    new RegExp(m[3], 'i')
  } catch (err) {
    return `That regex doesn't compile: ${err instanceof Error ? err.message : String(err)}`
  }
  return { id, tools: m[1].split(','), match: [m[3]], action: m[2] as RuleAction, message: m[4].trim() }
}

export const describe = (r: HouseRule, hits: number): string =>
  `${r.id.padEnd(20)} ${r.action.padEnd(5)} ${String(hits).padStart(3)} hits  ${r.tools.join(',')}  ${r.isBuiltIn ? '(built in)' : ''}\n    ${r.message.slice(0, 140)}`
