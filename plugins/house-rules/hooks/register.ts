import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HouseRule } from '../types'
import { BUILT_IN, broken, describe, parseAdd } from './rules'

const hits = atom({ plugin: 'house-rules', key: 'hits' } as const, {})

const STORE_RULES = 'house-rules.rules'
const STORE_OFF = 'house-rules.off'
const STORE_HITS = 'house-rules.hits'

let disabled = new Set<string>()
let rules: HouseRule[] = BUILT_IN

async function load($: EngineInterface): Promise<HouseRule[]> {
  const mine = ((await $.store.get(STORE_RULES)) as HouseRule[] | undefined) ?? []
  const off = new Set([...disabled, ...(((await $.store.get(STORE_OFF)) as string[] | undefined) ?? [])])
  rules = [...BUILT_IN, ...mine].filter(r => !off.has(r.id))
  return rules
}

async function count($: EngineInterface, ids: string[]): Promise<void> {
  const next = await update($, hits, h => {
    const c = { ...h }
    for (const id of ids) c[id] = (c[id] ?? 0) + 1
    return c
  })
  await $.store.set(STORE_HITS, next)
}

export const register: Register = (on, options) => {
  disabled = new Set(((options.disabled as readonly string[] | undefined) ?? []).map(String))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await load($)
    const stored = (await $.store.get(STORE_HITS)) as Record<string, number> | undefined
    if (stored) await update($, hits, () => stored)
    await $.command.register({ name: 'rules', description: 'House rules on tool calls: list, add, turn off or on', argumentHint: '[add <tools> <note|ask|deny> /regex/ <message> | off <id> | on <id>]' })
    return started
  })

  // ask: put the call to the person (or the mode's decider) with the rule's reason.
  on('tool.check', async ($, e, next) => {
    const asks = broken(rules, String(e.tool), e as unknown as Record<string, unknown>).filter(r => r.action === 'ask')
    if (!asks.length) return next(e)
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    await count($, asks.map(r => r.id))
    return { decision: 'ask', reason: `House rule ${asks[0]?.id}: ${asks[0]?.message}` }
  }).catch(($, e, next) => next(e))

  // deny refuses before the call runs; note rides along after it.
  on('tool.call', async ($, e, next) => {
    const found = broken(rules, String(e.tool), e as unknown as Record<string, unknown>)
    const deny = found.find(r => r.action === 'deny')
    if (deny) {
      await count($, [deny.id])
      $.ui.toast(`House rule ${deny.id}: refused`)
      return { deny: `house-rules (${deny.id}): ${deny.message}` }
    }
    const notes = found.filter(r => r.action === 'note')
    if (!notes.length) return next(e)
    const r = await next(e)
    if (r.deny !== undefined) return r
    await count($, notes.map(n => n.id))
    return { ...r, context: [...(r.context ?? []), ...notes.map(n => `house-rules (${n.id}): ${n.message}`)] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'rules' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'add') {
      const mine = ((await $.store.get(STORE_RULES)) as HouseRule[] | undefined) ?? []
      const rule = parseAdd(rest.join(' '), `mine-${mine.length + 1}`)
      if (typeof rule === 'string') return { text: rule }
      await $.store.set(STORE_RULES, [...mine, rule])
      await load($)
      return { text: `Added ${rule.id}: ${rule.action} on ${rule.tools.join(',')} matching /${rule.match[0]}/.` }
    }
    if (verb === 'off' || verb === 'on') {
      const id = rest[0] ?? ''
      const off = new Set(((await $.store.get(STORE_OFF)) as string[] | undefined) ?? [])
      if (verb === 'off') off.add(id)
      else off.delete(id)
      await $.store.set(STORE_OFF, [...off])
      await load($)
      return { text: `${id} is ${verb}.` }
    }
    const h = await read($, hits)
    const all = await load($)
    return { text: ['House rules:', ...all.map(r => describe(r, h[r.id] ?? 0))].join('\n') }
  })
}
