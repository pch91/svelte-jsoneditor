import { describe, expect, it } from 'vitest'
import {
  computeDiffPaths,
  contentToValue,
  jsonPathToPointer,
  matchesDiffPath,
  detectIdentityKey,
  alignObjectProperties,
  alignArrayItems,
  computeSemanticDiffReport,
  applyMergeChunk
} from './diffUtils.js'
import type { Content } from '$lib/types.js'

describe('diffUtils', () => {
  describe('computeDiffPaths', () => {
    it('returns an empty set for equal values', () => {
      expect(computeDiffPaths({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }).size).toBe(0)
    })

    it('detects a changed value', () => {
      expect(computeDiffPaths({ a: 1 }, { a: 2 })).toEqual(new Set(['/a']))
    })

    it('detects added and removed keys', () => {
      expect(computeDiffPaths({ a: 1 }, { b: 2 })).toEqual(new Set(['/a', '/b']))
    })

    it('detects nested changes', () => {
      const paths = computeDiffPaths(
        { user: { name: 'Joe', age: 30 } },
        { user: { name: 'Joe', age: 31 } }
      )
      expect(paths).toEqual(new Set(['/user/age']))
    })

    it('detects array element changes', () => {
      expect(computeDiffPaths([1, 2, 3], [1, 9, 3])).toEqual(new Set(['/1']))
    })

    it('detects type changes and null vs object', () => {
      expect(computeDiffPaths({ a: null }, { a: { b: 1 } })).toEqual(new Set(['/a']))
      expect(computeDiffPaths(1, '1')).toEqual(new Set(['']))
    })
  })

  describe('jsonPathToPointer', () => {
    it('converts a path array to a pointer', () => {
      expect(jsonPathToPointer(['a', '1', 'b'])).toBe('/a/1/b')
    })

    it('escapes / and ~ characters', () => {
      expect(jsonPathToPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d')
    })
  })

  describe('matchesDiffPath', () => {
    const paths = new Set(['/a/b'])

    it('matches exact, child and parent paths', () => {
      expect(matchesDiffPath('/a/b', paths)).toBe(true)
      expect(matchesDiffPath('/a/b/c', paths)).toBe(true)
      expect(matchesDiffPath('/a', paths)).toBe(true)
    })

    it('does not match unrelated paths', () => {
      expect(matchesDiffPath('/x', paths)).toBe(false)
      expect(matchesDiffPath('/a/c', paths)).toBe(false)
    })
  })

  describe('contentToValue', () => {
    it('returns the json for JSON content', () => {
      const content: Content = { json: { a: 1 } }
      expect(contentToValue(content)).toEqual({ a: 1 })
    })

    it('parses valid JSON text', () => {
      expect(contentToValue({ text: '{"a":1}' })).toEqual({ a: 1 })
    })

    it('falls back to raw text for invalid JSON', () => {
      expect(contentToValue({ text: '[1,2' })).toBe('[1,2')
    })

    it('returns undefined for missing content', () => {
      expect(contentToValue(undefined)).toBeUndefined()
    })
  })

  describe('detectIdentityKey', () => {
    it('detects common identity keys in array of objects', () => {
      const items = [
        { id: '101', name: 'Alpha' },
        { id: '102', name: 'Beta' }
      ]
      expect(detectIdentityKey(items)).toBe('id')
    })

    it('detects _id or uuid or code', () => {
      expect(detectIdentityKey([{ uuid: 'abc' }, { uuid: 'def' }])).toBe('uuid')
      expect(detectIdentityKey([{ code: 'US' }, { code: 'BR' }])).toBe('code')
    })

    it('returns null for primitives or empty arrays', () => {
      expect(detectIdentityKey([1, 2, 3])).toBeNull()
      expect(detectIdentityKey([])).toBeNull()
    })
  })

  describe('alignObjectProperties', () => {
    it('aligns matching and missing properties sorted alphabetically', () => {
      const source = { a: 1, c: 3 }
      const target = { a: 1, b: 2, c: 99 }
      const aligned = alignObjectProperties(source, target)

      expect(aligned).toEqual([
        {
          key: 'a',
          hasSource: true,
          hasTarget: true,
          sourceValue: 1,
          targetValue: 1,
          status: 'same'
        },
        {
          key: 'b',
          hasSource: false,
          hasTarget: true,
          sourceValue: undefined,
          targetValue: 2,
          status: 'added'
        },
        {
          key: 'c',
          hasSource: true,
          hasTarget: true,
          sourceValue: 3,
          targetValue: 99,
          status: 'modified'
        }
      ])
    })
  })

  describe('alignArrayItems', () => {
    it('matches array objects by id and detects reordering', () => {
      const source = [
        { id: '1', val: 'one' },
        { id: '2', val: 'two' }
      ]
      const target = [
        { id: '2', val: 'two' },
        { id: '1', val: 'one' }
      ]
      const aligned = alignArrayItems(source, target, true)
      expect(aligned.length).toBe(2)
      expect(aligned[0].status).toBe('reordered')
      expect(aligned[1].status).toBe('reordered')
    })

    it('handles additions and removals in array items', () => {
      const source = [{ id: '1', val: 'one' }]
      const target = [{ id: '2', val: 'two' }]
      const aligned = alignArrayItems(source, target, true)
      expect(aligned.some((item) => item.status === 'added')).toBe(true)
      expect(aligned.some((item) => item.status === 'removed')).toBe(true)
    })
  })

  describe('computeSemanticDiffReport', () => {
    it('produces diff report with similarity percentage and categorized chunks', () => {
      const source = {
        title: 'App',
        version: 1,
        tags: ['editor', 'json']
      }
      const target = {
        title: 'App Pro',
        version: 1,
        tags: ['editor', 'json', 'diff'],
        author: 'John'
      }

      const report = computeSemanticDiffReport(source, target)
      expect(report.stats.added).toBeGreaterThan(0) // author, 'diff' tag
      expect(report.stats.modified).toBeGreaterThan(0) // title
      expect(report.stats.similarityPercent).toBeGreaterThan(0)
      expect(report.stats.similarityPercent).toBeLessThan(100)
      expect(report.chunkByPath['/title']).toBeDefined()
    })
  })

  describe('applyMergeChunk', () => {
    it('pulls source chunk into target to merge a modification', () => {
      const source = { title: 'App Original', count: 10 }
      const target = { title: 'App Modified', count: 10 }
      const report = computeSemanticDiffReport(source, target)
      const chunk = report.chunks.find((c) => c.path === '/title')!

      // Pull from source into target
      const mergedTarget = applyMergeChunk(target, chunk, 'sourceToTarget') as typeof target
      expect(mergedTarget.title).toBe('App Original')
    })

    it('pulls target chunk into source to merge an addition', () => {
      const source: Record<string, unknown> = { a: 1 }
      const target: Record<string, unknown> = { a: 1, b: 2 }
      const report = computeSemanticDiffReport(source, target)
      const chunk = report.chunks.find((c) => c.path === '/b')!

      // Pull target into source
      const mergedSource = applyMergeChunk(source, chunk, 'targetToSource') as Record<
        string,
        unknown
      >
      expect(mergedSource.b).toBe(2)
    })
  })
})
