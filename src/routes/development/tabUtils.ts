export interface ReorderResult {
  /** order[newIndex] = oldIndex */
  order: number[]
  /** newIndexOfOld[oldIndex] = newIndex */
  newIndexOfOld: number[]
}

/**
 * Compute the index remapping for moving the element at `from` to position
 * `to` (before the element currently at `to`) in an array of length `count`.
 * Pure helper used to reorder all parallel tab arrays consistently.
 */
export function moveBefore(count: number, from: number, to: number): ReorderResult {
  const order = Array.from({ length: count }, (_, i) => i)
  const newIndexOfOld = Array.from({ length: count }, (_, i) => i)

  if (from === to || from < 0 || from >= count) {
    return { order, newIndexOfOld }
  }

  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)

  order.forEach((oldIndex, newIndex) => {
    newIndexOfOld[oldIndex] = newIndex
  })

  return { order, newIndexOfOld }
}

export type SubTabKind = 'main' | 'extract' | 'nested' | 'preview' | 'response' | 'custom'

export interface PrimaryTabRequestContext {
  method: string
  url: string
  headers: string
  body: string
  bodyType: 'none' | 'json' | 'text'
  sendMode: 'same' | 'new'
  lastResponseTabId?: number
}

export interface PrimaryTabState {
  id: number
  title: string
  subTabIds: number[]
  activeSubTabId: number
  requestState: PrimaryTabRequestContext
}

export interface SubTabState {
  id: number
  primaryTabId: number
  title: string
  kind: SubTabKind
}

export function createDefaultRequestContext(): PrimaryTabRequestContext {
  return {
    method: 'GET',
    url: '',
    headers: '',
    body: '',
    bodyType: 'json',
    sendMode: 'same'
  }
}

export function createPrimaryTab(
  id: number,
  title: string,
  initialSubTabId: number
): {
  primary: PrimaryTabState
  initialSubTab: SubTabState
} {
  const primary: PrimaryTabState = {
    id,
    title,
    subTabIds: [initialSubTabId],
    activeSubTabId: initialSubTabId,
    requestState: createDefaultRequestContext()
  }
  const initialSubTab: SubTabState = {
    id: initialSubTabId,
    primaryTabId: id,
    title: 'Principal',
    kind: 'main'
  }
  return { primary, initialSubTab }
}

export function addSubTabToPrimary(
  primary: PrimaryTabState,
  subTabId: number,
  title: string,
  kind: SubTabKind = 'custom'
): { updatedPrimary: PrimaryTabState; subTab: SubTabState } {
  return {
    updatedPrimary: {
      ...primary,
      subTabIds: [...primary.subTabIds, subTabId],
      activeSubTabId: subTabId
    },
    subTab: {
      id: subTabId,
      primaryTabId: primary.id,
      title,
      kind
    }
  }
}

export function removeSubTabFromPrimary(
  primary: PrimaryTabState,
  subTabId: number,
  fallbackNewSubTabId?: number
): {
  updatedPrimary: PrimaryTabState
  fallbackCreated?: SubTabState
} {
  const newSubTabIds = primary.subTabIds.filter((id) => id !== subTabId)
  if (newSubTabIds.length === 0 && fallbackNewSubTabId !== undefined) {
    const fallback: SubTabState = {
      id: fallbackNewSubTabId,
      primaryTabId: primary.id,
      title: 'Principal',
      kind: 'main'
    }
    return {
      updatedPrimary: {
        ...primary,
        subTabIds: [fallbackNewSubTabId],
        activeSubTabId: fallbackNewSubTabId
      },
      fallbackCreated: fallback
    }
  }

  let nextActive = primary.activeSubTabId
  if (nextActive === subTabId) {
    const idx = primary.subTabIds.indexOf(subTabId)
    const newIdx = Math.max(0, Math.min(idx, newSubTabIds.length - 1))
    nextActive = newSubTabIds[newIdx] ?? primary.activeSubTabId
  }

  return {
    updatedPrimary: {
      ...primary,
      subTabIds: newSubTabIds,
      activeSubTabId: nextActive
    }
  }
}

export function promoteSubTabToPrimary(
  sourcePrimary: PrimaryTabState,
  subTabId: number,
  newPrimaryId: number,
  title: string,
  fallbackSubTabId?: number
): {
  updatedSource: PrimaryTabState
  newPrimary: PrimaryTabState
  updatedSubTab: SubTabState
  fallbackCreated?: SubTabState
} {
  const { updatedPrimary, fallbackCreated } = removeSubTabFromPrimary(
    sourcePrimary,
    subTabId,
    fallbackSubTabId
  )
  const newPrimary: PrimaryTabState = {
    id: newPrimaryId,
    title: title || `Editor ${newPrimaryId}`,
    subTabIds: [subTabId],
    activeSubTabId: subTabId,
    requestState: createDefaultRequestContext()
  }
  const updatedSubTab: SubTabState = {
    id: subTabId,
    primaryTabId: newPrimaryId,
    title,
    kind: 'main'
  }
  return {
    updatedSource: updatedPrimary,
    newPrimary,
    updatedSubTab,
    fallbackCreated
  }
}

/**
 * Only sub-tabs that are NOT the root/initial document of the Level 1 editor
 * can be promoted to a Level 1 editor. The root main tab stays with the editor.
 */
export function canPromoteSubTab(subTab: SubTabState | undefined): boolean {
  return Boolean(subTab && subTab.kind !== 'main')
}

export interface MovePrimaryTabResult {
  updatedMap: Map<number, number[]>
  emptySourceLeafId?: number
}

/**
 * Move a primary tab from its current pane to a target pane.
 * Returns the updated map and indicates if the source pane became empty.
 */
export function movePrimaryTabToPane(
  panePrimaryMap: Map<number, number[]>,
  primaryId: number,
  targetLeafId: number
): MovePrimaryTabResult {
  const nextMap = new Map<number, number[]>()
  let emptySourceLeafId: number | undefined

  for (const [leafId, ids] of panePrimaryMap.entries()) {
    if (leafId === targetLeafId) continue
    const filtered = ids.filter((id) => id !== primaryId)
    if (filtered.length === 0 && ids.includes(primaryId)) {
      emptySourceLeafId = leafId
    }
    nextMap.set(leafId, filtered)
  }

  const existingTarget = nextMap.get(targetLeafId) ?? panePrimaryMap.get(targetLeafId) ?? []
  if (!existingTarget.includes(primaryId)) {
    nextMap.set(targetLeafId, [...existingTarget, primaryId])
  } else {
    nextMap.set(targetLeafId, existingTarget)
  }

  return { updatedMap: nextMap, emptySourceLeafId }
}

/**
 * Reorder an array of tab IDs by inserting draggedId before or after targetId.
 */
export function reorderTabIds(
  ids: number[],
  draggedId: number,
  targetId: number | undefined,
  position: 'before' | 'after' = 'after'
): number[] {
  if (!ids.includes(draggedId)) return ids
  const filtered = ids.filter((id) => id !== draggedId)
  if (targetId !== undefined && targetId !== draggedId) {
    const toIdx = filtered.indexOf(targetId)
    if (toIdx !== -1) {
      const insertAt = position === 'before' ? toIdx : toIdx + 1
      filtered.splice(insertAt, 0, draggedId)
      return filtered
    }
  }
  filtered.push(draggedId)
  return filtered
}

/**
 * Move a primary tab between panes, inserting before or after targetPrimaryId if specified.
 */
export function movePrimaryTabBetweenPanes(
  panePrimaryMap: Map<number, number[]>,
  primaryId: number,
  sourceLeafId: number,
  targetLeafId: number,
  targetPrimaryId?: number,
  position: 'before' | 'after' = 'after'
): { updatedMap: Map<number, number[]>; emptySourceLeafId?: number } {
  const nextMap = new Map<number, number[]>()
  let emptySourceLeafId: number | undefined

  const sourceList = (panePrimaryMap.get(sourceLeafId) ?? []).filter((id) => id !== primaryId)
  if (sourceList.length === 0) {
    emptySourceLeafId = sourceLeafId
  }
  nextMap.set(sourceLeafId, sourceList)

  for (const [leafId, ids] of panePrimaryMap.entries()) {
    if (leafId === sourceLeafId || leafId === targetLeafId) continue
    nextMap.set(leafId, [...ids])
  }

  const existingTarget = (panePrimaryMap.get(targetLeafId) ?? []).filter((id) => id !== primaryId)
  if (targetPrimaryId !== undefined && existingTarget.includes(targetPrimaryId)) {
    const toIdx = existingTarget.indexOf(targetPrimaryId)
    const insertAt = position === 'before' ? toIdx : toIdx + 1
    existingTarget.splice(insertAt, 0, primaryId)
    nextMap.set(targetLeafId, existingTarget)
  } else {
    nextMap.set(targetLeafId, [...existingTarget, primaryId])
  }

  return { updatedMap: nextMap, emptySourceLeafId }
}

