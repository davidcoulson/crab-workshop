import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Finding } from '../types'
import { findSecrets, glob, redactDeep, riskyCommand, tag } from './scan'

const findings = atom({ plugin: 'keymaster', key: 'findings' } as const, [])

const STORE_ALLOW = 'keymaster.allow'
let skip: string[] = []
let warnCommands = true
let allowed = new Set<string>()

async function record($: EngineInterface, tool: string, hits: { kind: string; where: string; value: string; tag: string }[]): Promise<number> {
  const at = await $.clock.now()
  const list = await update($, findings, l => [...l, ...hits.map(h => ({ kind: h.kind, tool, where: h.where, length: h.value.length, tag: h.tag, at }))].slice(-200))
  $.ui.status(`🔒 ${list.length} masked`)
  const kinds = [...new Set(hits.map(h => h.kind))].join(', ')
  $.ui.toast(`🔒 Keymaster masked ${hits.length} secret${hits.length === 1 ? '' : 's'} (${kinds}) from ${tool.replace(/^mcp__([^_]+(?:_[^_]+)*)__/, '$1 ')} output`)
  return list.length
}

async function loadAllowed($: EngineInterface): Promise<void> {
  const v = (await $.store.get(STORE_ALLOW)) as string[] | undefined
  allowed = new Set(Array.isArray(v) ? v : [])
}

export const register: Register = (on, options) => {
  skip = ((options.skipTools as readonly string[] | undefined) ?? []).map(String)
  warnCommands = options.warnCommands !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadAllowed($)
    await $.command.register({ name: 'keymaster', description: 'What Keymaster masked this session (kind and place, never the value); allow a false positive by its tag', argumentHint: '[allow <tag> | disallow <tag>]' })
    return started
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (skip.some(p => glob(p, tool))) return next(e)
    const r = await next(e)
    if (r.deny !== undefined) return r
    const notes: string[] = []
    if (warnCommands && tool === 'Bash') {
      const note = riskyCommand(String((e as { command?: unknown }).command ?? ''))
      if (note) notes.push(`keymaster: ${note}`)
    }
    const { value: result, hits } = redactDeep(r.result, tag, allowed)
    if (!hits.length) {
      // The text core made from the result should match it; if it alone holds a secret, withhold rather than pass it on.
      if (typeof r.text === 'string' && findSecrets(r.text).some(h => !allowed.has(tag(h.value))))
        return { deny: 'Keymaster withheld this output: it holds a key-like value it could not mask in place. Re-run the command so it prints only the fields you need.' }
      return notes.length ? { ...r, context: [...(r.context ?? []), ...notes] } : r
    }
    await record($, tool, hits)
    const kinds = [...new Set(hits.map(h => h.kind))].join(', ')
    notes.push(
      `keymaster: ${hits.length} value${hits.length === 1 ? '' : 's'} (${kinds}) in this output ${hits.length === 1 ? 'is' : 'are'} masked as ‹masked kind tag›. ` +
        `They are hidden on purpose: don't print them another way (no cat, grep, base64 or env tricks). If one is clearly not a secret, ask David to run /keymaster allow <tag>.`,
    )
    return { result: result as typeof r.result, ...(r.isError ? { isError: true as const } : {}), context: [...(r.context ?? []), ...notes] }
  }).catch(($, e, next) => (next.called ? { deny: 'Keymaster could not scan this output, so it withheld it.' } : next(e)))

  on('command.run', { command: 'keymaster' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'allow' || verb === 'disallow') {
      if (!/^[0-9a-f]{8}$/.test(arg)) return { text: 'Usage: /keymaster allow <tag> (the 8 hex digits in ‹masked kind tag›).' }
      await loadAllowed($)
      if (verb === 'allow') allowed.add(arg)
      else allowed.delete(arg)
      await $.store.set(STORE_ALLOW, [...allowed])
      return { text: verb === 'allow' ? `Values tagged ${arg} pass through from now on.` : `Values tagged ${arg} are masked again.` }
    }
    const list: Finding[] = await read($, findings)
    if (!list.length) return { text: `Nothing masked this session.${allowed.size ? ` Allowed tags: ${[...allowed].join(', ')}.` : ''}` }
    const lines = list.slice(-30).map(f => `${f.tag}  ${f.kind.padEnd(16)} ${String(f.length).padStart(4)} chars  ${f.tool} → ${f.where}`)
    return { text: [`Masked this session (${list.length}; the newest 30, values never kept):`, ...lines, allowed.size ? `Allowed tags: ${[...allowed].join(', ')}` : ''].filter(Boolean).join('\n') }
  })
}

