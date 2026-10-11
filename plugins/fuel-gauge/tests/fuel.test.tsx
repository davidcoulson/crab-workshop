import { describe, expect, mock, test } from 'claude-code/testing'

import { dueWarnings, parseUsage, shortName, statusText, until } from '../hooks/logic'

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
    expect(statusText({ contextPercent: 14, windows: u?.windows ?? [], at: NOW }, NOW)).toBe('⛽ ctx 14% · 5h 26% (34m) · wk 36% · wk fable 13%')
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
