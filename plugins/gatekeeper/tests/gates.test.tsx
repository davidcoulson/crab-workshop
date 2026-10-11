import { describe, expect, mock, test } from 'claude-code/testing'

import { asText, parseGates, yourUnticked } from '../hooks/gates'

const YOURS = ['built and ran', 'human', 'pre-commit']

const BODY = `## Type of change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [x] New feature
## Checklist
- [x] Tests added
- [ ] I built and ran the project locally and verified this change actually works
- [ ] A human reviewed this change <!-- maintainers -->
- [ ] \`make pre-commit-run\` passes`

const check = (name: string, conclusion: string, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, conclusion, status })
const pr = (over: Record<string, unknown>) => ({
  number: 224,
  title: 'feat: report share exclusive state',
  url: 'https://github.com/tinkerologie/unraid-management-agent/pull/224',
  isDraft: true,
  body: BODY,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  repository: { nameWithOwner: 'tinkerologie/unraid-management-agent' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [check('CodeRabbit', 'SUCCESS'), check('codecov/patch', 'SUCCESS')] } } } }] },
  reviewThreads: { nodes: [] },
  latestReviews: { nodes: [] },
  ...over,
})
const ANSWER = JSON.stringify({
  data: {
    search: {
      issueCount: 3,
      nodes: [
        pr({}),
        pr({
          number: 202,
          repository: { nameWithOwner: 'tinkerologie/ha-unraid-management-agent' },
          body: '- [x] done',
          isDraft: false,
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [check('Validate PR Template', 'CANCELLED'), check('Validate PR Template', 'SUCCESS'), check('codecov/patch', 'FAILURE')] } } } }] },
          reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: 'coderabbitai' } }] } }, { isResolved: true, comments: { nodes: [{ author: { login: 'coderabbitai' } }] } }] },
        }),
        pr({ number: 122, repository: { nameWithOwner: 'Shoshuo/Prismarr' }, body: '', isDraft: false, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [check('build', '', 'IN_PROGRESS')] } } } }] } }),
      ],
    },
  },
})

describe('gates', () => {
  test('boxes only you tick', () => {
    expect(yourUnticked(BODY, YOURS)).toEqual(['I built and ran the project locally and verified this change actually works', 'A human reviewed this change', '`make pre-commit-run` passes'])
  })
  test('lanes from a real-shaped answer', () => {
    const g = parseGates(ANSWER, YOURS)
    expect(g?.gates.map(x => [x.number, x.lane, x.why])).toEqual([
      [224, 'you', '3 boxes only you tick'],
      [202, 'work', 'failing: codecov/patch · 1 CodeRabbit thread'],
      [122, 'waiting', 'checks running'],
    ])
    const text = asText(g?.gates ?? [], 3)
    expect(text).toContain('gates: 1 need you · 1 need work · 1 waiting')
    expect(text).toContain('☐ A human reviewed this change')
  })
})

describe('hooks', () => {
  test('/gates text, the band, and the pane', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/tmp' }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('tool.register', (_$, e) => ({ value: { tool: `mcp__gatekeeper__${e.name}` } }))
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    on('process.run', () => ({ value: { exitCode: 0, stdout: ANSWER, stderr: '' } }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop' } as never)
    const out = String(((await $.command.run({ command: 'gates', args: 'text' } as never)) as { text?: string }).text)
    expect(out).toContain('tinkerologie/unraid-management-agent#224')
    const tool = (await $.tool.call({ tool: 'mcp__gatekeeper__gates', repo: 'prismarr' } as never)) as { result?: string }
    expect(tool.result).toContain('Shoshuo/Prismarr#122')
    expect(tool.result).not.toContain('#224')
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'gatekeeper', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 80 } } as never)
      expect(await band.find({ type: 'Text', text: /1 need you/ })).toBeDefined()
      await band.unmount()
      const pane = await $.ui.mount({ plugin: 'gatekeeper', surface, component: 'Pane', requestId: 'gatekeeper', props: { title: 'Gates', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)
      expect(await pane.find({ type: 'Text', text: /☐ A human reviewed/ })).toBeDefined()
      await pane.unmount()
    }
  })
})
