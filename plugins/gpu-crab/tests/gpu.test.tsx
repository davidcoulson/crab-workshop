import { describe, expect, mock, test } from 'claude-code/testing'

import { addToTally, line, parsePs, parseTrailer, subjectOf, tallyText } from '../hooks/logic'

// GET /api/ps from Ollama 0.40 with qwen3:30b partly on the CPU.
const PS = JSON.stringify({
  models: [{ name: 'qwen3:30b', model: 'qwen3:30b', size: 20_000_000_000, size_vram: 7_080_000_000, context_length: 8192, details: { parameter_size: '30.5B', quantization_level: 'Q4_K_M' } }],
})

describe('logic', () => {
  test('ps and the line', () => {
    const models = parsePs(PS) ?? []
    expect(models[0]?.name).toBe('qwen3:30b')
    const run = { tool: 'mcp__local-llm__local_summarize', subject: 'syslog.txt (log)', startedAt: 0 }
    expect(line(run, models, 8, 42_000)).toBe('local_summarize · syslog.txt (log) · qwen3:30b · 6.6/8 GB VRAM · 35.4% GPU (spilling to CPU) · 0:42')
    expect(parsePs('{"models":[]}')).toEqual([])
    expect(parsePs('nope')).toBe(null)
  })
  test('subjects and trailers', () => {
    expect(subjectOf('mcp__local-llm__local_summarize', { path: '/var/log/syslog', mode: 'log' })).toBe('syslog (log)')
    expect(subjectOf('mcp__local-llm__semantic_search', { query: 'parity check', root: '/home/dev/dev/agent' })).toBe('"parity check" in agent')
    expect(parseTrailer('…\n\n(/var/log/syslog: 412,345 characters in 17 parts, model qwen3:8b)')).toEqual({ chars: 412345, parts: 17 })
    expect(parseTrailer('plain answer')).toEqual({})
  })
  test('the LAN tally', () => {
    let t = addToTally({ day: '', calls: 0, chars: 0 }, '2026-10-11', 412_345)
    t = addToTally(t, '2026-10-11', 800_000)
    expect(tallyText(t)).toBe('local models read 1.2 MB today in 2 calls ≈ 303k tokens kept on the LAN')
    expect(addToTally(t, '2026-10-12', 10).calls).toBe(1)
  })
})

describe('hooks', () => {
  test('a local-llm call lights the band on both surfaces, then tallies', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/tmp' }))
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: PS } }))
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => (release = r))
    on('tool.call', { tool: 'mcp__local-llm__local_summarize' }, async () => {
      await gate
      return { result: 'Summary.\n\n(/var/log/syslog: 412,345 characters in 17 parts, model qwen3:8b)', text: 'Summary.\n\n(/var/log/syslog: 412,345 characters in 17 parts, model qwen3:8b)' }
    })
    await $.session.start({ cwd: '/tmp', surface: 'desktop' } as never)
    const call = $.tool.call({ tool: 'mcp__local-llm__local_summarize', path: '/var/log/syslog', mode: 'log' } as never)
    // Let the hook record the run before drawing.
    for (let i = 0; i < 50; i++) await Promise.resolve()
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'gpu-crab', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 80 } } as never)
      if (surface === 'terminal') expect(await band.find({ type: 'Text', text: /local_summarize · syslog \(log\)/ })).toBeDefined()
      else expect(await band.find({ type: 'Svg' })).toBeDefined()
      await band.unmount()
    }
    release()
    await call
    const out = await $.command.run({ command: 'gpu', args: '' } as never)
    expect(String((out as { text?: string }).text)).toContain('qwen3:30b')
    expect(String((out as { text?: string }).text)).toContain('412 KB today in 1 call')
  })
})
