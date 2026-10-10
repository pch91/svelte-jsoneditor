import { describe, expect, it } from 'vitest'
import { parseWorkspaceFile, serializeWorkspaceFile } from './workspaceFile.js'
import type { WorkspaceBundle } from './workspaceFile.js'

const bundle: WorkspaceBundle = {
  workspace: {
    version: 3,
    tabs: [{ id: 1, title: 'Main', text: '{"a":1}', mode: 'tree' }],
    primaryTabs: [{ id: 1, title: 'Main', subTabIds: [1], activeSubTabId: 1 }],
    nextTabId: 2
  },
  flowGraph: {
    nodes: [{ id: 'n1', type: 'js', title: 'JS', x: 1, y: 2, status: 'success' }],
    connections: []
  },
  environments: { dev: { baseUrl: 'http://x' } },
  globalEnvironment: { token: 't' },
  activeEnvName: 'dev'
}

describe('workspace file', () => {
  it('round-trips tabs, flow and environments', () => {
    const back = parseWorkspaceFile(serializeWorkspaceFile(bundle))
    expect(back.workspace.tabs[0].text).toBe('{"a":1}')
    expect(back.flowGraph?.nodes[0].id).toBe('n1')
    expect(back.flowGraph?.nodes[0].status).toBe('idle')
    expect(back.environments).toEqual({ dev: { baseUrl: 'http://x' } })
    expect(back.globalEnvironment).toEqual({ token: 't' })
    expect(back.activeEnvName).toBe('dev')
  })

  it('rejects files that are not workspace files', () => {
    expect(() => parseWorkspaceFile('nope')).toThrow()
    expect(() => parseWorkspaceFile('{"nodes":[]}')).toThrow(/workspace file/)
    expect(() =>
      parseWorkspaceFile('{"format":"svelte-jsoneditor-workspace","workspace":{"tabs":[]}}')
    ).toThrow(/no tabs/)
  })
})
