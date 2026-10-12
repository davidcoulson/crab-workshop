import { describe, expect, mock, test } from 'claude-code/testing'

import { dayTime, dueWarnings, paceOf, paceShort, paceText, parseUsage, shortName, statusText, until } from '../hooks/logic'

// get_usage as the desktop app answers it (2026-10-11).
const USAGE = JSON.stringify({
  plan: {
    status: 'ok',
    plan: 'Max',
    windows: [
      { label: '5-hour limit', percentUsed: 26, resetsAt: '2026-10-11T17:29:59.604Z', resetsIn: '34m' },
      { label: 'Weekly · all models', percentUsed: 36, resetsAt: '2026-10-17T06:59:59.604Z', resetsIn: '5d 14h' },
      { label: 'Weekly · Fable', percentUsed: 13, resetsAt: '2026-10-17T06:59:59.604Z', resetsIn: '5d 14h' },
    ],
    extraUsage: { enabled: false, percentUsed: 23, spent: '47.15', monthlyLimit: '200.00', currency: 'USD' },
  },
  context: { session: 'self', status: 'ok', tokensUsed: 137570, contextWindow: 1000000, percentUsed: 14 },
})
const NOW = Date.parse('2026-10-11T16:55:59.604Z')

describe('logic', () => {
  test('get_usage', () => {
    const u = parseUsage(USAGE)
    expect(u?.windows.map(w => shortName(w.kind))).toEqual(['5h', 'wk', 'wk fable'])
    expect(u?.extra).toEqual({ spent: 47.15, limit: 200, currency: 'USD', isEnabled: false })
    expect(u?.context).toEqual({ percent: 14, tokens: 137570, window: 1000000 })
    expect(parseUsage('{"context":{"status":"unavailable"}}')?.context).toEqual({ note: 'unavailable' })
  })
  test('the status line', () => {
    const u = parseUsage(USAGE)
    // 36% used 34h into the week is 1.8× an even burn: out about 61h in.
    expect(statusText({ contextPercent: 14, windows: u?.windows ?? [], at: NOW }, NOW)).toMatch(
      /^⛽ ctx 14% · 5h 26% \(34m\) · wk 36% \(1\.8× · out \w{3} \d\d:\d\d\) · wk fable 13% \(0\.6×\)$/,
    )
    expect(statusText({ windows: [{ kind: 'five_hour', percentUsed: 81.5 }], costUsd: 3.2, at: 0 }, 0)).toBe('⛽ 5h 82% · $3.20')
    expect(until('2026-10-17T06:59:59.604Z', NOW)).toBe('5d 14h')
  })
  test('warnings once per window and threshold', () => {
    const w = [{ kind: 'five_hour', percentUsed: 96, resetsAt: 'R1' }, { kind: 'seven_day', percentUsed: 50, resetsAt: 'R2' }]
    const due = dueWarnings(w, [80, 95], new Set())
    expect(due.map(d => d.key)).toEqual(['five_hour@R1:95'])
    expect(dueWarnings(w, [80, 95], new Set(['five_hour@R1:95']))).toEqual([])
    expect(dueWarnings([{ kind: 'five_hour', percentUsed: 96, resetsAt: 'R3' }], [80, 95], new Set(['five_hour@R1:95'])).length).toBe(1)
  })
})

// The week of USAGE: starts 2026-10-10T07:00Z, resets 2026-10-17T07:00Z.
const RESET = '2026-10-17T07:00:00.000Z'
const START = Date.parse(RESET) - 7 * 86_400_000
const H = 3_600_000
const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-4 * Math.max(1, Math.abs(b))
const wk = (percentUsed: number) => ({ kind: 'seven_day', percentUsed, resetsAt: RESET })

describe('pace', () => {
  test('start of the week: nothing to say yet', () => {
    expect(paceOf(wk(0), START)).toBeUndefined()
    expect(paceOf(wk(2), START + 30 * 60_000)).toBeUndefined()
    const p = paceOf(wk(0), START + 2 * H)
    expect(p?.pace).toBe(0)
    expect(p?.runsOutAt).toBeUndefined()
    expect(near(p?.perDay, 100 / (7 - 2 / 24))).toBe(true)
    expect(paceOf({ kind: 'five_hour', percentUsed: 90, resetsAt: RESET }, START + 2 * H)).toBeUndefined()
  })
  test('mid-week, over pace: runs out early', () => {
    // 60% after 2.3 days: burn 26.09%/day, out after 3.83 days, 1.5 days before the reset.
    const now = START + 2.3 * 24 * H
    const p = paceOf(wk(60), now)
    expect(near(p?.pace, 60 / ((2.3 / 7) * 100))).toBe(true)
    expect(near(p?.runsOutAt, START + (100 / 60) * 2.3 * 24 * H)).toBe(true)
    expect(near(p?.daysLeft, 4.7)).toBe(true)
    expect(near(p?.perDay, 40 / 4.7)).toBe(true)
    expect(paceText(wk(60), now)).toMatch(/^1\.8× pace · runs out (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d at this pace · 8\.5%\/day budget$/)
  })
  test('mid-week, under pace: no run-out', () => {
    const p = paceOf(wk(30), START + 3.5 * 24 * H)
    expect(near(p?.pace, 0.6)).toBe(true)
    expect(p?.runsOutAt).toBeUndefined()
    expect(paceText(wk(30), START + 3.5 * 24 * H)).toBe('0.6× pace · 20%/day budget')
  })
  test('already over', () => {
    const now = START + 5 * 24 * H
    const p = paceOf(wk(100), now)
    expect(near(p?.pace, 1.4)).toBe(true)
    expect(p?.runsOutAt).toBe(now)
    expect(p?.perDay).toBe(0)
    expect(paceText(wk(100), now)).toBe('1.4× pace · limit reached')
    expect(paceOf(wk(50), Date.parse(RESET) + 1)).toBeUndefined()
  })
  test('the short form fits a narrow pane', () => {
    const now = START + 2.3 * 24 * H
    expect(paceShort(wk(60), now)).toMatch(/^1\.8× · out \w{3} \d\d:\d\d$/)
    expect(paceShort(wk(60), now)?.length).toBeLessThanOrEqual(24)
    expect(paceShort(wk(30), START + 3.5 * 24 * H)).toBe('0.6× · 20%/day')
    expect(paceShort(wk(100), START + 5 * 24 * H)).toBe('1.4× · limit reached')
    expect(paceShort({ kind: 'five_hour', percentUsed: 90, resetsAt: RESET }, now)).toBeUndefined()
  })
  test('one warning per window when pace crosses 1.2', () => {
    const now = START + 2.3 * 24 * H
    const due = dueWarnings([wk(60)], [80, 95], new Set(), now)
    expect(due.map(d => d.key)).toEqual([`seven_day@${RESET}:pace`])
    expect(due[0]?.text).toContain('Weekly pace 1.8×')
    expect(dueWarnings([wk(60)], [80, 95], new Set([due[0]?.key ?? '']), now)).toEqual([])
    expect(dueWarnings([wk(35)], [80, 95], new Set(), now)).toEqual([]) // 1.07×
  })
})

describe('hooks', () => {
  test('a measurement sets the status line, toasts past the threshold, and draws', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    const toasts: string[] = []
    const statuses: (string | undefined)[] = []
    on('session.start', () => ({ cwd: '/tmp' }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }))
    on('session.id', () => ({ value: 'abc' }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
    on('ui.toast', (_$, e) => (toasts.push(String((e as { text?: string }).text)), { value: undefined }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('mcp.call', () => ({ value: { content: [{ type: 'text', text: USAGE }], isError: false } }))
    await $.session.start({ cwd: '/tmp', surface: 'desktop' } as never)
    await $.session.measure({
      context: { tokens: 900000, window: 1000000, percent: 90 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 82, resetsAt: '2026-10-11T17:29:59Z' }],
      changed: ['context', 'rateLimits'],
    } as never)
    expect(statuses.at(-1)).toContain('ctx 90%')
    expect(statuses.at(-1)).toContain('5h 82%')
    expect(toasts.some(t => t.includes('5-hour limit at 82%'))).toBe(true)
    expect(toasts.some(t => t.includes('Context at 90%'))).toBe(true)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'fuel-gauge', surface, component: 'Pane', requestId: 'fuel-gauge', props: { title: 'Fuel gauge', isFocused: false, bodyColumns: 70, placement: 'dock' } } as never)
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /ctx 90%/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
      const band = await $.ui.mount({ plugin: 'fuel-gauge', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 70 } } as never)
      expect(await band.find({ type: 'Text', text: /Running hot/ })).toBeDefined()
      await band.unmount()
    }
  })
})
