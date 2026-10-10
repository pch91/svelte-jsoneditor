import { describe, expect, it } from 'vitest'
import { moveBefore } from './tabUtils.js'

describe('moveBefore', () => {
  it('moves an element forward', () => {
    const { order, newIndexOfOld } = moveBefore(4, 1, 3)

    expect(order).toEqual([0, 2, 3, 1])
    expect(newIndexOfOld).toEqual([0, 3, 1, 2])
  })

  it('moves an element backward', () => {
    const { order, newIndexOfOld } = moveBefore(4, 3, 0)

    expect(order).toEqual([3, 0, 1, 2])
    expect(newIndexOfOld).toEqual([1, 2, 3, 0])
  })

  it('moves the last element to the first position', () => {
    expect(moveBefore(3, 2, 0).order).toEqual([2, 0, 1])
  })

  it('keeps the order when from equals to', () => {
    const result = moveBefore(3, 1, 1)
    expect(result.order).toEqual([0, 1, 2])
    expect(result.newIndexOfOld).toEqual([0, 1, 2])
  })

  it('keeps the order for invalid from indices', () => {
    expect(moveBefore(3, -1, 1).order).toEqual([0, 1, 2])
    expect(moveBefore(3, 5, 1).order).toEqual([0, 1, 2])
  })
})

describe('2-level tabs (Primary and Secondary)', () => {
  it('creates a primary tab with initial sub-tab and default request state', async () => {
    const { createPrimaryTab } = await import('./tabUtils.js')
    const { primary, initialSubTab } = createPrimaryTab(1, 'Editor 1', 101)
    expect(primary.id).toBe(1)
    expect(primary.title).toBe('Editor 1')
    expect(primary.subTabIds).toEqual([101])
    expect(primary.activeSubTabId).toBe(101)
    expect(primary.requestState.sendMode).toBe('same')
    expect(initialSubTab).toEqual({
      id: 101,
      primaryTabId: 1,
      title: 'Principal',
      kind: 'main'
    })
  })

  it('adds sub-tabs to a primary tab', async () => {
    const { createPrimaryTab, addSubTabToPrimary } = await import('./tabUtils.js')
    const { primary } = createPrimaryTab(1, 'Editor 1', 101)
    const { updatedPrimary, subTab } = addSubTabToPrimary(primary, 102, 'extract-items.json', 'extract')
    expect(updatedPrimary.subTabIds).toEqual([101, 102])
    expect(updatedPrimary.activeSubTabId).toBe(102)
    expect(subTab).toEqual({
      id: 102,
      primaryTabId: 1,
      title: 'extract-items.json',
      kind: 'extract'
    })
  })

  it('removes a sub-tab and keeps fallback if last one was removed', async () => {
    const { createPrimaryTab, removeSubTabFromPrimary } = await import('./tabUtils.js')
    const { primary } = createPrimaryTab(1, 'Editor 1', 101)
    const { updatedPrimary, fallbackCreated } = removeSubTabFromPrimary(primary, 101, 999)
    expect(updatedPrimary.subTabIds).toEqual([999])
    expect(updatedPrimary.activeSubTabId).toBe(999)
    expect(fallbackCreated).toBeDefined()
    expect(fallbackCreated?.id).toBe(999)
  })

  it('promotes a sub-tab into a new primary tab', async () => {
    const { createPrimaryTab, addSubTabToPrimary, promoteSubTabToPrimary } = await import(
      './tabUtils.js'
    )
    const { primary } = createPrimaryTab(1, 'Editor 1', 101)
    const { updatedPrimary } = addSubTabToPrimary(primary, 102, 'extract.json', 'extract')
    const { updatedSource, newPrimary, updatedSubTab } = promoteSubTabToPrimary(
      updatedPrimary,
      102,
      2,
      'Editor 2'
    )

    expect(updatedSource.subTabIds).toEqual([101])
    expect(newPrimary.id).toBe(2)
    expect(newPrimary.title).toBe('Editor 2')
    expect(newPrimary.subTabIds).toEqual([102])
    expect(updatedSubTab.primaryTabId).toBe(2)
  })

  it('allows promotion only for non-main subtabs', async () => {
    const { canPromoteSubTab } = await import('./tabUtils.js')
    expect(canPromoteSubTab({ id: 1, primaryTabId: 1, title: 'Principal', kind: 'main' })).toBe(false)
    expect(canPromoteSubTab({ id: 2, primaryTabId: 1, title: 'Extract', kind: 'extract' })).toBe(true)
    expect(canPromoteSubTab({ id: 3, primaryTabId: 1, title: 'Response', kind: 'response' })).toBe(true)
    expect(canPromoteSubTab(undefined)).toBe(false)
  })

  it('allows closing only for non-main subtabs (root Level 2 page cannot be closed)', async () => {
    const { canCloseSubTab } = await import('./tabUtils.js')
    expect(canCloseSubTab({ id: 1, primaryTabId: 1, title: 'Principal', kind: 'main' })).toBe(false)
    expect(canCloseSubTab({ id: 2, primaryTabId: 1, title: 'Extract', kind: 'extract' })).toBe(true)
    expect(canCloseSubTab({ id: 3, primaryTabId: 1, title: 'Response', kind: 'response' })).toBe(true)
    expect(canCloseSubTab({ id: 4, primaryTabId: 1, title: 'Nested', kind: 'nested' })).toBe(true)
    expect(canCloseSubTab({ id: 5, primaryTabId: 1, title: 'Preview', kind: 'preview' })).toBe(true)
    expect(canCloseSubTab(undefined)).toBe(false)
  })

  it('moves primary tab between panes and detects empty source pane', async () => {
    const { movePrimaryTabToPane } = await import('./tabUtils.js')
    const initialMap = new Map<number, number[]>([
      [1, [10, 20]],
      [2, [30]]
    ])

    // Move 20 to pane 2
    const res1 = movePrimaryTabToPane(initialMap, 20, 2)
    expect(res1.updatedMap.get(1)).toEqual([10])
    expect(res1.updatedMap.get(2)).toEqual([30, 20])
    expect(res1.emptySourceLeafId).toBeUndefined()

    // Move 30 to pane 1 -> pane 2 becomes empty!
    const res2 = movePrimaryTabToPane(initialMap, 30, 1)
    expect(res2.updatedMap.get(1)).toEqual([10, 20, 30])
    expect(res2.updatedMap.get(2)).toEqual([])
    expect(res2.emptySourceLeafId).toBe(2)
  })

  it('reorders tab IDs before or after a target tab', async () => {
    const { reorderTabIds } = await import('./tabUtils.js')
    const list = [1, 2, 3]

    // Move 3 before 1 -> [3, 1, 2]
    expect(reorderTabIds(list, 3, 1, 'before')).toEqual([3, 1, 2])

    // Move 1 after 3 -> [2, 3, 1]
    expect(reorderTabIds(list, 1, 3, 'after')).toEqual([2, 3, 1])

    // Move 2 before 1 -> [2, 1, 3]
    expect(reorderTabIds(list, 2, 1, 'before')).toEqual([2, 1, 3])

    // Drop on empty area (no targetId) -> pushes to end
    expect(reorderTabIds(list, 1, undefined)).toEqual([2, 3, 1])
  })

  it('moves primary tab between panes at specific position', async () => {
    const { movePrimaryTabBetweenPanes } = await import('./tabUtils.js')
    const initialMap = new Map<number, number[]>([
      [1, [10, 20]],
      [2, [30, 40]]
    ])

    // Move 20 to pane 2 before 30 -> [20, 30, 40]
    const res = movePrimaryTabBetweenPanes(initialMap, 20, 1, 2, 30, 'before')
    expect(res.updatedMap.get(1)).toEqual([10])
    expect(res.updatedMap.get(2)).toEqual([20, 30, 40])
    expect(res.emptySourceLeafId).toBeUndefined()
  })
})

