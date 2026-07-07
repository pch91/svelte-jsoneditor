import { describe, expect, it } from 'vitest'
import {
  computeDiffPaths,
  contentToValue,
  jsonPathToPointer,
  matchesDiffPath
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
})
