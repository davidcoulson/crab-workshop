// Pure logic for gatekeeper: the GraphQL query, and its answer into gates.

import type { Gate, Lane } from '../types'

export const QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url isDraft body mergeable reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 60) { nodes {
          __typename
          ... on CheckRun { name conclusion status }
          ... on StatusContext { context state }
        } } } } } }
        reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { author { login } } } } }
        latestReviews(first: 20) { nodes { author { login } state } }
      }
    }
  }
}`

type Check = { __typename?: string; name?: string; conclusion?: string | null; status?: string; context?: string; state?: string }
type Node = {
  number?: number
  title?: string
  url?: string
  isDraft?: boolean
  body?: string | null
  mergeable?: string
  reviewDecision?: string | null
  repository?: { nameWithOwner?: string }
  commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string; contexts?: { nodes?: Check[] } } | null } }[] }
  reviewThreads?: { nodes?: { isResolved?: boolean; comments?: { nodes?: { author?: { login?: string } | null }[] } }[] }
  latestReviews?: { nodes?: { author?: { login?: string } | null; state?: string }[] }
}

const RABBIT = /coderabbit/i

/** Unticked checkboxes whose text matches one of `yours`. */
export function yourUnticked(body: string, yours: readonly string[]): string[] {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[ \]\s+(.*)$/)
    if (!m || !m[1]) continue
    const text = m[1].replace(/<!--.*?-->/g, '').trim()
    const low = text.toLowerCase()
    if (yours.some(y => y && low.includes(y.toLowerCase()))) out.push(text.replace(/\*\*/g, '').slice(0, 90))
  }
  return out
}

const outcome = (c: Check): 'pass' | 'fail' | 'pending' | 'skip' => {
  if (c.__typename === 'StatusContext' || c.context) {
    const s = (c.state ?? '').toUpperCase()
    return s === 'SUCCESS' ? 'pass' : s === 'PENDING' || s === 'EXPECTED' ? 'pending' : 'fail'
  }
  if ((c.status ?? '').toUpperCase() !== 'COMPLETED') return 'pending'
  const k = (c.conclusion ?? '').toUpperCase()
  return k === 'SUCCESS' || k === 'NEUTRAL' ? 'pass' : k === 'SKIPPED' || k === 'CANCELLED' ? 'skip' : 'fail'
}

const nameOf = (c: Check): string => c.name ?? c.context ?? '?'

/** Several runs of one check (re-runs, matrix): the newest outcome per name wins, so a cancelled earlier run doesn't count as failing. */
function settle(checks: Check[]): Map<string, 'pass' | 'fail' | 'pending' | 'skip'> {
  const by = new Map<string, 'pass' | 'fail' | 'pending' | 'skip'>()
  for (const c of checks) {
    const o = outcome(c)
    const prev = by.get(nameOf(c))
    // pass beats skip; pending beats a finished fail of the same name (a re-run in flight).
    if (!prev || o === 'pass' || o === 'pending' || (o === 'fail' && prev === 'skip')) by.set(nameOf(c), o)
  }
  return by
}

export function toGate(n: Node, yours: readonly string[]): Gate | null {
  if (typeof n.number !== 'number' || !n.repository?.nameWithOwner) return null
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null
  const checks = settle(rollup?.contexts?.nodes ?? [])
  const cov = [...checks.entries()].filter(([k]) => /codecov/i.test(k)).map(([, v]) => v)
  const codecov = cov.length ? (cov.includes('fail') ? 'fail' : cov.includes('pending') ? 'pending' : 'pass') : undefined
  const failing = [...checks.entries()].filter(([, v]) => v === 'fail').map(([k]) => k)
  const pending = [...checks.values()].some(v => v === 'pending')
  const ci: Gate['ci'] = checks.size ? (failing.length ? 'fail' : pending ? 'pending' : 'pass') : undefined
  const threads = n.reviewThreads?.nodes ?? []
  const rabbitOpen = threads.filter(t => !t.isResolved && RABBIT.test(t.comments?.nodes?.[0]?.author?.login ?? '')).length
  const rabbitChanges = (n.latestReviews?.nodes ?? []).some(r => RABBIT.test(r.author?.login ?? '') && r.state === 'CHANGES_REQUESTED')
  const g: Omit<Gate, 'lane' | 'why'> = {
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title ?? '',
    url: n.url ?? '',
    isDraft: n.isDraft === true,
    yourBoxes: yourUnticked(n.body ?? '', yours),
    rabbitOpen,
    rabbitChanges,
    ...(codecov ? { codecov } : {}),
    ...(ci ? { ci } : {}),
    failing: failing.slice(0, 4),
    hasConflicts: n.mergeable === 'CONFLICTING',
    ...(n.reviewDecision ? { reviewDecision: n.reviewDecision } : {}),
  }
  return { ...g, ...laneOf(g) }
}

/** Which lane: work for Claude first (red checks, open threads, conflicts), else what only you can do, else waiting. */
export function laneOf(g: Omit<Gate, 'lane' | 'why'>): { lane: Lane; why: string } {
  const work: string[] = []
  if (g.hasConflicts) work.push('merge conflicts')
  if (g.ci === 'fail') work.push(`failing: ${g.failing.slice(0, 2).join(', ')}`)
  if (g.codecov === 'fail' && !g.failing.some(f => /codecov/i.test(f))) work.push('codecov')
  if (g.rabbitOpen) work.push(`${g.rabbitOpen} CodeRabbit thread${g.rabbitOpen === 1 ? '' : 's'}`)
  else if (g.rabbitChanges) work.push('CodeRabbit asks for changes')
  if (work.length) return { lane: 'work', why: work.join(' · ') }
  if (g.yourBoxes.length) return { lane: 'you', why: `${g.yourBoxes.length} box${g.yourBoxes.length === 1 ? '' : 'es'} only you tick` }
  if (g.isDraft && g.ci !== 'pending') return { lane: 'you', why: 'draft, checks green: review and mark ready' }
  if (g.ci === 'pending' || g.codecov === 'pending') return { lane: 'waiting', why: 'checks running' }
  if (g.reviewDecision === 'APPROVED') return { lane: 'clear', why: 'approved' }
  return { lane: 'waiting', why: g.reviewDecision === 'CHANGES_REQUESTED' ? 'maintainer asked for changes' : 'waiting on maintainers' }
}

export function parseGates(text: string, yours: readonly string[]): { gates: Gate[]; total: number } | null {
  try {
    const v = JSON.parse(text) as { data?: { search?: { issueCount?: number; nodes?: Node[] } }; errors?: { message?: string }[] }
    const s = v.data?.search
    if (!s) return null
    const gates = (s.nodes ?? []).map(n => toGate(n, yours)).filter((g): g is Gate => g !== null)
    return { gates: order(gates), total: s.issueCount ?? gates.length }
  } catch {
    return null
  }
}

const LANE_ORDER: Lane[] = ['you', 'work', 'waiting', 'clear']
export const order = (gates: Gate[]): Gate[] => [...gates].sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || a.repo.localeCompare(b.repo) || b.number - a.number)

export function counts(gates: Gate[]): Record<Lane, number> {
  const c: Record<Lane, number> = { you: 0, work: 0, waiting: 0, clear: 0 }
  for (const g of gates) c[g.lane]++
  return c
}

export function bandText(gates: Gate[]): string | undefined {
  const c = counts(gates)
  const parts = [c.you && `${c.you} need you`, c.work && `${c.work} need work`, c.waiting && `${c.waiting} waiting`].filter(Boolean)
  return parts.length ? `gates: ${parts.join(' · ')}` : undefined
}

export function chips(g: Gate): string[] {
  const out: string[] = []
  if (g.yourBoxes.length) out.push(`☐ ${g.yourBoxes.length} yours`)
  if (g.rabbitOpen) out.push(`🐇 ${g.rabbitOpen} open`)
  else if (g.rabbitChanges) out.push('🐇 changes')
  if (g.codecov) out.push(`codecov ${g.codecov === 'pass' ? '✓' : g.codecov === 'fail' ? '✗' : '…'}`)
  if (g.ci) out.push(`CI ${g.ci === 'pass' ? '✓' : g.ci === 'fail' ? '✗' : '…'}`)
  if (g.hasConflicts) out.push('conflicts')
  if (g.isDraft) out.push('draft')
  return out
}

export function asText(gates: Gate[], total: number): string {
  if (!gates.length) return 'No open PRs.'
  const lines = [`${bandText(gates) ?? 'gates: all clear'} (${gates.length}${total > gates.length ? ` of ${total}` : ''} open PRs)`]
  const title: Record<Lane, string> = { you: 'Needs you', work: 'Needs work', waiting: 'Waiting', clear: 'Clear' }
  for (const lane of ['you', 'work', 'waiting', 'clear'] as Lane[]) {
    const list = gates.filter(g => g.lane === lane)
    if (!list.length) continue
    lines.push(`${title[lane]}:`)
    for (const g of list) {
      lines.push(`- ${g.repo}#${g.number} ${g.title}: ${g.why} [${chips(g).join(', ')}]`)
      if (lane === 'you') for (const b of g.yourBoxes.slice(0, 3)) lines.push(`    ☐ ${b}`)
    }
  }
  return lines.join('\n')
}
