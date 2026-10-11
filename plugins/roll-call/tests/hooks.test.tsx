import { describe, expect, mock, test } from 'claude-code/testing'

const LIST = JSON.stringify([
  { sessionId: 'local_a', title: 'Report share exclusive state', name: 'share-exclusive', isRunning: false, lastActivityAt: '2026-10-11T14:58:00Z', prNumber: 224, prState: 'OPEN' },
  { sessionId: 'local_b', title: 'Patched Prismarr build', name: 'prismarr-patch', isRunning: true, lastActivityAt: '2026-10-11T16:55:00Z' },
  { sessionId: 'local_c', title: 'Old one', name: 'old', isArchived: true, lastActivityAt: '2026-10-01T00:00:00Z' },
])
const EVENTS: Record<string, string> = {
  local_a: '[assistant] I opened both draft PRs. You\'ll need to open the issues yourself.\n[result] done (success), 197 turns',
  local_b: '[assistant] Building the patched image now.',
}

const host = (on: Parameters<typeof mock.clock>[0]) => {
  mock.clock(on)
  mock.store(on, {})
  on('session.start', () => ({ cwd: '/tmp' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__roll-call__${e.name}` } }))
  on('mcp.call', (_$, e) => {
    const text = e.tool === 'list_sessions' ? LIST : EVENTS[String(e.args.session_id)] ?? ''
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })
  on('model.complete', (_$, e) => ({
    value: {
      isAnswered: true,
      text: e.prompt.includes('share-exclusive')
        ? '{"status": "Draft PRs #224 and #202 open; Codex approved", "needsYou": "Open upstream issues and link them"}'
        : '{"status": "Building the patched Prismarr image", "needsYou": ""}',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
}

describe('roll call', () => {
  test('the report tool reads each open session and puts needs-you first', async ($, on) => {
    host(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop' } as never)
    const r = await $.tool.call({ tool: 'mcp__roll-call__report' } as never)
    const text = String((r as { result?: unknown }).result)
    expect(text).toContain('2 sessions')
    expect(text).toContain('1 need you')
    expect(text.indexOf('share-exclusive')).toBeLessThan(text.indexOf('prismarr-patch'))
    expect(text).toContain('→ needs you: Open upstream issues and link them')
    expect(text).not.toContain('old')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'roll-call',
        surface,
        component: 'Pane',
        requestId: 'roll-call',
        props: { title: 'Roll call', isFocused: false, bodyColumns: 70, placement: 'dock' },
      } as never)
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: 'share-exclusive' })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('without a summarizer it reads the last message', { options: { summarizer: 'none' } }, async ($, on) => {
    host(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
    const text = String((await $.tool.call({ tool: 'mcp__roll-call__report' } as never) as { result?: unknown }).result)
    expect(text).toContain('I opened both draft PRs.')
    expect(text).toContain("needs you: You'll need to open the issues yourself.")
  })
})
