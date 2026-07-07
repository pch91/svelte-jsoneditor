import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadWorkspace, saveWorkspace, type StoredWorkspace } from './workspaceStorage.js'

beforeEach(() => {
  // fresh in-memory IndexedDB for every test
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
})

const workspace: StoredWorkspace = {
  version: 1,
  tabs: [
    { id: 1, title: 'Editor 1', text: '{"a":1}', mode: 'tree' },
    { id: 2, title: 'resposta.json', text: '[1,2,3]', mode: 'text' }
  ],
  panes: [{ id: 1, tabIdx: 1 }],
  nextTabId: 3,
  nextPaneId: 2,
  splitDir: 'horizontal'
}

describe('workspaceStorage', () => {
  it('returns undefined when nothing is stored yet', async () => {
    expect(await loadWorkspace()).toBeUndefined()
  })

  it('saves and restores a workspace', async () => {
    await saveWorkspace(workspace)
    expect(await loadWorkspace()).toEqual(workspace)
  })

  it('overwrites a previously saved workspace', async () => {
    await saveWorkspace(workspace)
    await saveWorkspace({ ...workspace, splitDir: 'vertical', tabs: workspace.tabs.slice(0, 1) })

    const loaded = await loadWorkspace()

    expect(loaded?.splitDir).toBe('vertical')
    expect(loaded?.tabs.length).toBe(1)
    expect(loaded?.tabs[0].title).toBe('Editor 1')
  })
})
