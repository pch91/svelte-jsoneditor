import { describe, it, expect } from 'vitest'
import { applyModifier, setValueByPath, applyMappings, flattenJsonPaths } from './flowMapper.js'
import type { FlowNodeTransformMapping } from './flowTypes.js'

describe('flowMapper', () => {
  describe('applyModifier', () => {
    it('applies uppercase and lowercase modifiers', () => {
      expect(applyModifier('hello', 'uppercase')).toBe('HELLO')
      expect(applyModifier('WORLD', 'lowercase')).toBe('world')
    })

    it('applies trim modifier', () => {
      expect(applyModifier('   spaces   ', 'trim')).toBe('spaces')
    })

    it('casts to number', () => {
      expect(applyModifier('123.45', 'number')).toBe(123.45)
      expect(applyModifier('not-a-number', 'number')).toBe('not-a-number')
    })

    it('casts to boolean', () => {
      expect(applyModifier('true', 'boolean')).toBe(true)
      expect(applyModifier('false', 'boolean')).toBe(false)
      expect(applyModifier('1', 'boolean')).toBe(true)
      expect(applyModifier('0', 'boolean')).toBe(false)
      expect(applyModifier('', 'boolean')).toBe(false)
    })

    it('returns direct value when direct modifier or undefined', () => {
      expect(applyModifier({ a: 1 }, 'direct')).toEqual({ a: 1 })
      expect(applyModifier('test')).toBe('test')
    })
  })

  describe('setValueByPath', () => {
    it('sets flat property', () => {
      const obj: Record<string, unknown> = {}
      setValueByPath(obj, 'title', 'Hello')
      expect(obj).toEqual({ title: 'Hello' })
    })

    it('sets nested properties creating objects along the path', () => {
      const obj: Record<string, unknown> = {}
      setValueByPath(obj, 'customer.contact.email', 'test@example.com')
      expect(obj).toEqual({
        customer: {
          contact: {
            email: 'test@example.com'
          }
        }
      })
    })

    it('overwrites or appends sibling properties properly', () => {
      const obj: Record<string, unknown> = { customer: { id: 101 } }
      setValueByPath(obj, 'customer.name', 'Alice')
      expect(obj).toEqual({
        customer: {
          id: 101,
          name: 'Alice'
        }
      })
    })
  })

  describe('applyMappings', () => {
    const sampleInput = {
      user_id: 42,
      raw_name: '   Rick Sanchez   ',
      contact: {
        raw_email: 'RICK@CITADEL.COM',
        status: '1'
      },
      tags: ['scientist', 'portal-master']
    }

    it('transforms input according to specified mappings', () => {
      const mappings: FlowNodeTransformMapping[] = [
        { id: '1', sourcePath: 'user_id', targetPath: 'id', modifier: 'number' },
        { id: '2', sourcePath: 'raw_name', targetPath: 'profile.name', modifier: 'trim' },
        {
          id: '3',
          sourcePath: 'contact.raw_email',
          targetPath: 'profile.email',
          modifier: 'lowercase'
        },
        {
          id: '4',
          sourcePath: 'contact.status',
          targetPath: 'profile.isActive',
          modifier: 'boolean'
        }
      ]

      const result = applyMappings(sampleInput, mappings)
      expect(result).toEqual({
        id: 42,
        profile: {
          name: 'Rick Sanchez',
          email: 'rick@citadel.com',
          isActive: true
        }
      })
    })

    it('uses defaultValue when source property is missing or empty', () => {
      const mappings: FlowNodeTransformMapping[] = [
        { id: '1', sourcePath: 'missing_key', targetPath: 'role', defaultValue: 'GUEST' },
        { id: '2', sourcePath: 'user_id', targetPath: 'id' }
      ]

      const result = applyMappings(sampleInput, mappings)
      expect(result).toEqual({
        role: 'GUEST',
        id: 42
      })
    })

    it('returns original input when mappings array is empty', () => {
      const result = applyMappings({ foo: 'bar' }, [])
      expect(result).toEqual({ foo: 'bar' })
    })

    it('extracts from env as fallback when source property is absent from input', () => {
      const mappings: FlowNodeTransformMapping[] = [
        { id: '1', sourcePath: 'lastHeroName', targetPath: 'hero.name', modifier: 'uppercase' },
        { id: '2', sourcePath: 'lastHeroStatus', targetPath: 'hero.status', modifier: 'lowercase' }
      ]
      const input = { upstreamStatus: 200 } // does not contain lastHeroName
      const env = { lastHeroName: 'Summer Smith', lastHeroStatus: 'Alive' }

      const result = applyMappings(input, mappings, env)
      expect(result).toEqual({
        hero: {
          name: 'SUMMER SMITH',
          status: 'alive'
        }
      })
    })
  })

  describe('flattenJsonPaths', () => {
    it('returns dot paths for nested objects', () => {
      const paths = flattenJsonPaths({
        a: 1,
        b: {
          c: 2,
          d: { e: 'text' }
        }
      })
      expect(paths).toContain('a')
      expect(paths).toContain('b.c')
      expect(paths).toContain('b.d.e')
    })
  })
})
