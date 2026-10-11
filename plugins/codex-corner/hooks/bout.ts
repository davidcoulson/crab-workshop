// Pure logic for codex-corner: spotting a review run and reading its verdict.

import type { Bout, Round, Severity } from '../types'

/** The review kind a shell command runs through the Codex companion, or null. */
export function reviewKind(command: string): Round['kind'] | 'result' | null {
  const m = command.match(/codex-companion\.mjs["']?\s+(adversarial-review|review|result)\b/)
  return m ? (m[1] as Round['kind'] | 'result') : null
}

/** The folder a command runs in, when it starts with cd. */
export const dirOf = (command: string): string | undefined => command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)?.[1]?.replace(/^["']|["']$/g, '')

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

/** A rendered Codex review (render.mjs in codex plugin 1.0.6) into a round's verdict and findings. */
export function readReview(text: string): Pick<Round, 'verdict' | 'findings' | 'titles'> | null {
  const v = text.match(/^Verdict:\s*(approve|needs-attention)\s*$/m)
  const findings: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  const titles: string[] = []
  for (const m of text.matchAll(/^- \[(critical|high|medium|low)\] (.+?)(?: \(([^)]*)\))?$/gm)) {
    findings[m[1] as Severity]++
    if (titles.length < 4 && m[2]) titles.push(m[2])
  }
  if (!v && !/^# Codex /m.test(text)) return null
  return { verdict: v ? (v[1] as Round['verdict']) : 'unknown', findings, titles }
}

/** The rounds since the last approve before the newest round: the current bout. */
export function currentBout(rounds: Round[]): Round[] {
  let start = 0
  for (let i = 0; i < rounds.length - 1; i++) if (rounds[i]?.verdict === 'approve') start = i + 1
  return rounds.slice(start)
}

export const total = (r: Round): number => SEVERITIES.reduce((n, s) => n + r.findings[s], 0)

export const tally = (r: Round): string => {
  const parts = SEVERITIES.filter(s => r.findings[s]).map(s => `${r.findings[s]} ${s}`)
  return parts.length ? parts.join(' · ') : 'no findings'
}

export function card(b: Bout): string {
  const rounds = currentBout(b.rounds)
  if (!rounds.length) return `No Codex rounds for ${b.key} yet.`
  const last = rounds[rounds.length - 1]
  const head = last?.verdict === 'approve' ? `KO in round ${rounds.length}: Codex approved ${b.key}.` : `${b.key}: round ${rounds.length}, ${last?.verdict === 'needs-attention' ? 'Codex still has findings' : 'verdict unknown'}.`
  const lines = [head]
  rounds.forEach((r, i) => {
    const mins = Math.max(1, Math.round((r.endedAt - r.startedAt) / 60_000))
    lines.push(`  R${i + 1}  ${r.verdict.padEnd(15)} ${tally(r)}  (${mins} min)${r.titles[0] ? `  e.g. ${r.titles[0]}` : ''}`)
  })
  return lines.join('\n')
}

export function addRound(b: Bout | null, key: string, r: Round): Bout {
  const rounds = [...(b && b.key === key ? b.rounds : []), r].slice(-30)
  return { key, rounds }
}
