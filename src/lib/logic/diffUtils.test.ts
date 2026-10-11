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
  applyMergeChunk,
  computeInlineDiff,
  computeValueDelta,
  formatValuePreview
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

    it('aligns collection envelope object vs raw array and produces granular item diffs', () => {
      const source = {
        clientes: [
          {
            id: 1,
            nome: 'João',
            endereco: {
              rua: 'Rua A',
              cidade: 'Porto'
            },
            configuracao: '{"tema":"escuro","idioma":"pt"}'
          },
          {
            id: 2,
            nome: 'Maria',
            endereco: {
              rua: 'Rua B',
              cidade: 'Lisboa'
            },
            configuracao: '{"tema":"claro","idioma":"en"}'
          }
        ]
      }

      const target = [
        {
          id: 1,
          nome: 'Mari2',
          endereco: {
            rua: 'Rua A',
            cidade: 'Porto'
          },
          configuracao: '{"tema":"escuro","idioma":"pt"}',
          configuracao2: '{"cema":"escuro","idioma":"pt"}'
        },
        {
          nome: 'Maria222',
          id: 2,
          endereco: {
            rua: 'Rua B',
            cidade: 'Lisboa'
          },
          configuracao: '{"tema":"claro","idioma":"en"}',
          configuracao2: '{"cema":"escuro","idioma":"pt"}'
        }
      ]

      const report = computeSemanticDiffReport(source, target, {
        ignoreKeyOrder: true,
        matchById: true
      })

      // Must NOT report the entire document as modified
      expect(report.chunks.find((c) => c.path === '/' && c.type === 'modified')).toBeUndefined()

      // Similarity percentage > 40%, NOT 0%
      expect(report.stats.similarityPercent).toBeGreaterThan(40)

      // Exactly 4 field-level diffs (2 modified nome, 2 added configuracao2)
      expect(report.stats.modified).toBe(2)
      expect(report.stats.added).toBe(2)
      expect(report.stats.removed).toBe(0)

      // Chunks must preserve separate sourcePath and targetPath
      const nomeChunk1 = report.chunks.find(
        (c) => c.sourcePath === '/clientes/0/nome' || c.targetPath === '/0/nome'
      )!
      expect(nomeChunk1).toBeDefined()
      expect(nomeChunk1.sourcePath).toBe('/clientes/0/nome')
      expect(nomeChunk1.targetPath).toBe('/0/nome')
      expect(nomeChunk1.sourceValue).toBe('João')
      expect(nomeChunk1.targetValue).toBe('Mari2')

      const conf2Chunk = report.chunks.find(
        (c) => c.sourcePath === '/clientes/0/configuracao2' || c.targetPath === '/0/configuracao2'
      )!
      expect(conf2Chunk).toBeDefined()
      expect(conf2Chunk.type).toBe('added')
      expect(conf2Chunk.sourcePath).toBe('/clientes/0/configuracao2')
      expect(conf2Chunk.targetPath).toBe('/0/configuracao2')

      // Structural info must be detected and documented
      expect(report.structuralInfo).toBeDefined()
      expect(report.structuralInfo?.type).toBe('envelope')
      expect(report.structuralInfo?.envelopeSide).toBe('source')
      expect(report.structuralInfo?.envelopeKey).toBe('clientes')
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

    it('merges asymmetrical envelope collection chunks in both directions', () => {
      const source = {
        clientes: [
          {
            id: 1,
            nome: 'João',
            configuracao: '{"tema":"escuro","idioma":"pt"}'
          }
        ]
      }
      const target = [
        {
          id: 1,
          nome: 'Mari2',
          configuracao: '{"tema":"escuro","idioma":"pt"}',
          configuracao2: '{"cema":"escuro","idioma":"pt"}'
        }
      ]

      const report = computeSemanticDiffReport(source, target, {
        ignoreKeyOrder: true,
        matchById: true
      })

      const nomeChunk = report.chunks.find((c) => c.keyOrIndex === 'nome')!
      const conf2Chunk = report.chunks.find((c) => c.keyOrIndex === 'configuracao2')!

      // Push source modification (João) into target array
      const mergedTarget = applyMergeChunk(target, nomeChunk, 'sourceToTarget') as Array<{
        id: number
        nome: string
      }>
      expect(mergedTarget[0].nome).toBe('João')

      // Pull target addition (configuracao2) into source envelope
      const mergedSource = applyMergeChunk(source, conf2Chunk, 'targetToSource') as {
        clientes: Array<{ id: number; configuracao2?: string }>
      }
      expect(mergedSource.clientes[0].configuracao2).toBe('{"cema":"escuro","idioma":"pt"}')
    })
  })

  describe('computeInlineDiff', () => {
    it('detects character additions within words (e.g. Maria -> Maria222)', () => {
      const diff = computeInlineDiff('"Maria"', '"Maria222"')
      expect(diff.sourceParts).toEqual([{ type: 'same', value: '"Maria"' }])
      expect(diff.targetParts).toEqual([
        { type: 'same', value: '"Maria' },
        { type: 'added', value: '222' },
        { type: 'same', value: '"' }
      ])
    })

    it('detects precise token modification inside stringified JSON', () => {
      const strA = '{"tema":"escuro","idioma":"pt"}'
      const strB = '{"tema":"claro","idioma":"pt"}'
      const diff = computeInlineDiff(strA, strB)

      const removedPart = diff.sourceParts.find((p) => p.type === 'removed')
      const addedPart = diff.targetParts.find((p) => p.type === 'added')

      expect(removedPart?.value).toBe('escuro')
      expect(addedPart?.value).toBe('claro')
      expect(diff.sourceParts.filter((p) => p.type === 'same').length).toBeGreaterThan(0)
    })

    it('handles completely replaced values', () => {
      const diff = computeInlineDiff('"João"', '"Mari2"')
      expect(diff.sourceParts.some((p) => p.type === 'removed')).toBe(true)
      expect(diff.targetParts.some((p) => p.type === 'added')).toBe(true)
    })
  })

  describe('computeValueDelta', () => {
    it('summarizes character extensions cleanly', () => {
      const delta = computeValueDelta('Maria', 'Maria222')
      expect(delta.typeChanged).toBe(false)
      expect(delta.addedSummary).toBe('222')
      expect(delta.transitionText).toBe('+ 222')
    })

    it('summarizes token replacement inside stringified JSON', () => {
      const delta = computeValueDelta(
        '{"tema":"escuro","idioma":"pt"}',
        '{"tema":"claro","idioma":"pt"}'
      )
      expect(delta.typeChanged).toBe(false)
      expect(delta.removedSummary).toBe('escuro')
      expect(delta.addedSummary).toBe('claro')
      expect(delta.transitionText).toBe('escuro ➔ claro')
    })

    it('summarizes word replacements', () => {
      const delta = computeValueDelta('João', 'Mari2')
      expect(delta.typeChanged).toBe(false)
      expect(delta.removedSummary).toBe('João')
      expect(delta.addedSummary).toBe('Mari2')
      expect(delta.transitionText).toBe('João ➔ Mari2')
    })

    it('detects and summarizes type alterations', () => {
      const delta = computeValueDelta(42, '42')
      expect(delta.typeChanged).toBe(true)
      expect(delta.sourceType).toBe('number')
      expect(delta.targetType).toBe('string')
      expect(delta.transitionText).toBe('number ➔ string')
    })

    it('populates deltaSummary on modified chunks in computeSemanticDiffReport', () => {
      const source = { user: { name: 'João', meta: '{"active":true}' } }
      const target = { user: { name: 'Mari2', meta: '{"active":false}' } }
      const report = computeSemanticDiffReport(source, target)

      const nameChunk = report.chunks.find((c) => c.keyOrIndex === 'name')
      expect(nameChunk?.type).toBe('modified')
      expect(nameChunk?.deltaSummary?.transitionText).toBe('João ➔ Mari2')
      expect(nameChunk?.summary).toContain('João ➔ Mari2')

      const metaChunk = report.chunks.find((c) => c.keyOrIndex === 'meta')
      expect(metaChunk?.type).toBe('modified')
      expect(metaChunk?.deltaSummary?.transitionText).toBe('true ➔ false')
    })
  })

  describe('formatValuePreview', () => {
    it('formats stringified JSON with pretty indentation', () => {
      const formatted = formatValuePreview('{"a":1}')
      expect(formatted).toBe('{\n  "a": 1\n}')
    })

    it('formats plain strings wrapped in quotes', () => {
      expect(formatValuePreview('hello')).toBe('"hello"')
    })

    it('formats numbers and primitives', () => {
      expect(formatValuePreview(123)).toBe('123')
      expect(formatValuePreview(true)).toBe('true')
      expect(formatValuePreview(undefined)).toBe('')
    })
  })
})
