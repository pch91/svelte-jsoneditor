/**
 * Tree-based split layout, following the model used by modern IDEs
 * (VS Code editor groups, GoldenLayout, react-mosaic):
 *
 * - The layout is a binary tree of leaves (panes) and split nodes.
 * - Each split node owns its divider, direction and ratio (size of the
 *   first child along the direction, in the 0..1 range).
 * - Every operation is pure (returns a new tree), so split/resize/close
 *   stay deterministic and easy to test.
 * - Serialization is a plain tree structure, ideal for persistence.
 */

export type SplitDirection = 'vertical' | 'horizontal'

export interface SplitLeaf {
  type: 'leaf'
  id: number
  tabIdx: number
}

export interface SplitNode {
  type: 'split'
  id: number
  direction: SplitDirection
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export type LayoutNode = SplitLeaf | SplitNode

export function createLeaf(id: number, tabIdx: number): SplitLeaf {
  return { type: 'leaf', id, tabIdx }
}

export function createSplit(
  id: number,
  direction: SplitDirection,
  ratio: number,
  first: LayoutNode,
  second: LayoutNode
): SplitNode {
  return {
    type: 'split',
    id,
    direction,
    ratio: clamp(ratio, 0.05, 0.95),
    children: [first, second]
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** All leaves in visual order (left-to-right / top-to-bottom). */
export function collectLeaves(root: LayoutNode): SplitLeaf[] {
  if (root.type === 'leaf') return [root]
  return [...collectLeaves(root.children[0]), ...collectLeaves(root.children[1])]
}

export function leafCount(root: LayoutNode): number {
  if (root.type === 'leaf') return 1
  return leafCount(root.children[0]) + leafCount(root.children[1])
}

/** All node ids in the tree (leaves and splits), used for id allocation. */
export function collectNodeIds(root: LayoutNode): number[] {
  if (root.type === 'leaf') return [root.id]
  return [root.id, ...collectNodeIds(root.children[0]), ...collectNodeIds(root.children[1])]
}

export function findLeaf(root: LayoutNode, leafId: number): SplitLeaf | undefined {
  if (root.type === 'leaf') return root.id === leafId ? root : undefined
  return findLeaf(root.children[0], leafId) ?? findLeaf(root.children[1], leafId)
}

export function findLeafByTab(root: LayoutNode, tabIdx: number): SplitLeaf | undefined {
  if (root.type === 'leaf') return root.tabIdx === tabIdx ? root : undefined
  return findLeafByTab(root.children[0], tabIdx) ?? findLeafByTab(root.children[1], tabIdx)
}

/** Apply `fn` to every leaf, returning a new tree. */
export function mapLeaves(root: LayoutNode, fn: (leaf: SplitLeaf) => SplitLeaf): LayoutNode {
  if (root.type === 'leaf') return fn(root)
  return { ...root, children: [mapLeaves(root.children[0], fn), mapLeaves(root.children[1], fn)] }
}

/** Replace a leaf with another node (pure). */
export function replaceLeaf(root: LayoutNode, leafId: number, replacement: LayoutNode): LayoutNode {
  if (root.type === 'leaf') return root.id === leafId ? replacement : root
  return {
    ...root,
    children: [
      replaceLeaf(root.children[0], leafId, replacement),
      replaceLeaf(root.children[1], leafId, replacement)
    ]
  }
}

/**
 * Remove a leaf. If its parent split ends up with a single child, the split
 * collapses into the remaining child. Returns undefined when the removed
 * leaf was the root itself.
 */
export function removeLeaf(root: LayoutNode, leafId: number): LayoutNode | undefined {
  if (root.type === 'leaf') return root.id === leafId ? undefined : root
  if (findLeaf(root.children[0], leafId)) {
    const left = removeLeaf(root.children[0], leafId)
    return left === undefined ? root.children[1] : { ...root, children: [left, root.children[1]] }
  }
  const right = removeLeaf(root.children[1], leafId)
  return right === undefined ? root.children[0] : { ...root, children: [root.children[0], right] }
}

/**
 * Split a leaf into two leaves sharing the same document (like VS Code's
 * "split editor"). The split node gets ratio 0.5.
 */
export function splitLeaf(
  root: LayoutNode,
  leafId: number,
  direction: SplitDirection,
  splitId: number,
  newLeafId: number
): LayoutNode {
  const leaf = findLeaf(root, leafId)
  if (!leaf) return root
  const split = createSplit(
    splitId,
    direction,
    0.5,
    { ...leaf },
    createLeaf(newLeafId, leaf.tabIdx)
  )
  return replaceLeaf(root, leafId, split)
}

export function setSplitRatio(root: LayoutNode, splitId: number, ratio: number): LayoutNode {
  if (root.type === 'leaf') return root
  if (root.id === splitId) return { ...root, ratio: clamp(ratio, 0.05, 0.95) }
  return {
    ...root,
    children: [
      setSplitRatio(root.children[0], splitId, ratio),
      setSplitRatio(root.children[1], splitId, ratio)
    ]
  }
}

// ---------------------------------------------------------------------------
// Rectangle computation (percentages of the container)
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LeafRect extends Rect {
  leafId: number
}

export interface SplitRect extends Rect {
  splitId: number
  direction: SplitDirection
}

export interface LayoutRects {
  leaves: LeafRect[]
  /** Full rectangle of each split node (used for divider drag math). */
  splits: SplitRect[]
  /** Thin strip of each divider (used for hit-testing/rendering). */
  dividers: SplitRect[]
}

const DIVIDER_SIZE = 0.6 // percentage of the container

export function computeRects(
  root: LayoutNode,
  rect: Rect = { x: 0, y: 0, width: 100, height: 100 }
): LayoutRects {
  if (root.type === 'leaf') {
    return { leaves: [{ leafId: root.id, ...rect }], splits: [], dividers: [] }
  }

  const sideBySide = root.direction === 'vertical'
  const first: Rect = sideBySide
    ? { x: rect.x, y: rect.y, width: rect.width * root.ratio, height: rect.height }
    : { x: rect.x, y: rect.y, width: rect.width, height: rect.height * root.ratio }
  const second: Rect = sideBySide
    ? {
        x: rect.x + rect.width * root.ratio,
        y: rect.y,
        width: rect.width * (1 - root.ratio),
        height: rect.height
      }
    : {
        x: rect.x,
        y: rect.y + rect.height * root.ratio,
        width: rect.width,
        height: rect.height * (1 - root.ratio)
      }

  const a = computeRects(root.children[0], first)
  const b = computeRects(root.children[1], second)

  const divider: SplitRect = sideBySide
    ? {
        splitId: root.id,
        direction: root.direction,
        x: rect.x + rect.width * root.ratio - DIVIDER_SIZE / 2,
        y: rect.y,
        width: DIVIDER_SIZE,
        height: rect.height
      }
    : {
        splitId: root.id,
        direction: root.direction,
        x: rect.x,
        y: rect.y + rect.height * root.ratio - DIVIDER_SIZE / 2,
        width: rect.width,
        height: DIVIDER_SIZE
      }

  return {
    leaves: [...a.leaves, ...b.leaves],
    splits: [{ splitId: root.id, direction: root.direction, ...rect }, ...a.splits, ...b.splits],
    dividers: [divider, ...a.dividers, ...b.dividers]
  }
}

// ---------------------------------------------------------------------------
// Serialization (persistence in IndexedDB)
// ---------------------------------------------------------------------------

export type SerializedLayoutNode =
  | { type: 'leaf'; id: number; tabIdx: number }
  | {
      type: 'split'
      id: number
      direction: SplitDirection
      ratio: number
      children: [SerializedLayoutNode, SerializedLayoutNode]
    }

export function serializeLayout(root: LayoutNode): SerializedLayoutNode {
  if (root.type === 'leaf') {
    return { type: 'leaf', id: root.id, tabIdx: root.tabIdx }
  }
  return {
    type: 'split',
    id: root.id,
    direction: root.direction,
    ratio: root.ratio,
    children: [serializeLayout(root.children[0]), serializeLayout(root.children[1])]
  }
}

export function parseLayout(node: SerializedLayoutNode): LayoutNode {
  if (node.type === 'leaf') {
    return createLeaf(node.id, node.tabIdx)
  }
  return createSplit(
    node.id,
    node.direction,
    node.ratio,
    parseLayout(node.children[0]),
    parseLayout(node.children[1])
  )
}
