import { describe, expect, it } from 'vitest'
import {
  collectLeaves,
  computeRects,
  createLeaf,
  createSplit,
  findLeaf,
  findLeafByTab,
  leafCount,
  mapLeaves,
  parseLayout,
  removeLeaf,
  replaceLeaf,
  serializeLayout,
  setSplitRatio,
  splitLeaf
} from './splitLayout.js'

describe('splitLayout', () => {
  describe('tree basics', () => {
    it('collects leaves in visual order', () => {
      const root = createSplit(10, 'vertical', 0.5, createLeaf(1, 0), createLeaf(2, 1))
      const leaves = collectLeaves(root)
      expect(leaves.map((l) => [l.id, l.tabIdx])).toEqual([
        [1, 0],
        [2, 1]
      ])
      expect(leafCount(root)).toBe(2)
    })

    it('finds leaves by id and by tab', () => {
      const root = createSplit(10, 'horizontal', 0.4, createLeaf(1, 0), createLeaf(2, 1))
      expect(findLeaf(root, 2)?.tabIdx).toBe(1)
      expect(findLeaf(root, 99)).toBeUndefined()
      expect(findLeafByTab(root, 0)?.id).toBe(1)
    })

    it('maps and replaces leaves immutably', () => {
      const root = createSplit(10, 'vertical', 0.5, createLeaf(1, 0), createLeaf(2, 1))
      const mapped = mapLeaves(root, (l) => ({ ...l, tabIdx: l.tabIdx + 10 }))
      expect(collectLeaves(mapped).map((l) => l.tabIdx)).toEqual([10, 11])
      const replaced = replaceLeaf(root, 2, createLeaf(3, 7))
      expect(findLeaf(replaced, 3)?.tabIdx).toBe(7)
      expect(findLeaf(replaced, 2)).toBeUndefined()
    })
  })

  describe('splitLeaf', () => {
    it('duplicates the document into a new leaf with ratio 0.5', () => {
      const root = createLeaf(1, 0)
      const splitted = splitLeaf(root, 1, 'vertical', 10, 2)
      const leaves = collectLeaves(splitted)
      expect(leaves.map((l) => l.tabIdx)).toEqual([0, 0])
      expect(splitted.type).toBe('split')
      if (splitted.type === 'split') {
        expect(splitted.ratio).toBe(0.5)
        expect(splitted.direction).toBe('vertical')
      }
    })
  })

  describe('removeLeaf', () => {
    it('collapses the parent split when one child remains', () => {
      const root = createSplit(10, 'vertical', 0.5, createLeaf(1, 0), createLeaf(2, 1))
      const after = removeLeaf(root, 1)
      expect(after).toEqual(createLeaf(2, 1))
    })

    it('keeps the sibling subtree when removing a nested leaf', () => {
      const root = createSplit(
        10,
        'vertical',
        0.5,
        createSplit(11, 'horizontal', 0.5, createLeaf(1, 0), createLeaf(2, 1)),
        createLeaf(3, 2)
      )
      const after = removeLeaf(root, 1)
      const leaves = collectLeaves(after as NonNullable<typeof after>)
      expect(leaves.map((l) => [l.id, l.tabIdx])).toEqual([
        [2, 1],
        [3, 2]
      ])
    })

    it('returns undefined when removing the root leaf', () => {
      expect(removeLeaf(createLeaf(1, 0), 1)).toBeUndefined()
    })
  })

  describe('setSplitRatio', () => {
    it('updates the ratio of the target split and clamps', () => {
      const root = createSplit(10, 'vertical', 0.5, createLeaf(1, 0), createLeaf(2, 1))
      const updated = setSplitRatio(root, 10, 0.3) as { ratio: number }
      expect(updated.ratio).toBeCloseTo(0.3)
      const clamped = setSplitRatio(root, 10, 1.5) as { ratio: number }
      expect(clamped.ratio).toBeCloseTo(0.95)
    })
  })

  describe('computeRects', () => {
    it('fills the full container for a single leaf', () => {
      const { leaves, splits, dividers } = computeRects(createLeaf(1, 0))
      expect(leaves).toEqual([{ leafId: 1, x: 0, y: 0, width: 100, height: 100 }])
      expect(splits.length).toBe(0)
      expect(dividers.length).toBe(0)
    })

    it('divides side by side for a vertical split', () => {
      const root = createSplit(10, 'vertical', 0.3, createLeaf(1, 0), createLeaf(2, 1))
      const { leaves, dividers } = computeRects(root)
      expect(leaves[0]).toMatchObject({ leafId: 1, x: 0, width: 30, height: 100 })
      expect(leaves[1]).toMatchObject({ leafId: 2, x: 30, width: 70, height: 100 })
      expect(dividers[0]).toMatchObject({ splitId: 10, direction: 'vertical' })
    })

    it('stacks top/bottom for a horizontal split', () => {
      const root = createSplit(10, 'horizontal', 0.4, createLeaf(1, 0), createLeaf(2, 1))
      const { leaves } = computeRects(root)
      expect(leaves[0]).toMatchObject({ leafId: 1, y: 0, height: 40, width: 100 })
      expect(leaves[1]).toMatchObject({ leafId: 2, y: 40, height: 60, width: 100 })
    })

    it('handles nested splits', () => {
      const root = createSplit(
        10,
        'vertical',
        0.5,
        createSplit(11, 'horizontal', 0.5, createLeaf(1, 0), createLeaf(2, 1)),
        createLeaf(3, 2)
      )
      const { leaves, splits } = computeRects(root)
      expect(leaves.length).toBe(3)
      expect(splits.length).toBe(2)
      expect(leaves[0]).toMatchObject({ leafId: 1, x: 0, y: 0, width: 50, height: 50 })
      expect(leaves[2]).toMatchObject({ leafId: 3, x: 50, width: 50, height: 100 })
    })
  })

  describe('serialization', () => {
    it('round-trips a nested layout', () => {
      const root = createSplit(
        10,
        'vertical',
        0.4,
        createSplit(11, 'horizontal', 0.6, createLeaf(1, 0), createLeaf(2, 1)),
        createLeaf(3, 2)
      )
      const parsed = parseLayout(serializeLayout(root))
      expect(parsed).toEqual(root)
    })
  })
})
