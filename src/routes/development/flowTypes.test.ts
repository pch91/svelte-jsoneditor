import { describe, expect, it } from 'vitest'
import { createDefaultFlowGraph, executeJsSandbox, migrateChainToFlowGraph } from './flowTypes.js'

describe('executeJsSandbox', () => {
  it('reads and writes environment variables using pm.environment', () => {
    const initialEnv = { token: 'abc', counter: '10' }
    const code = `
      const t = pm.environment.get('token');
      const c = Number(pm.environment.get('counter')) + 5;
      pm.environment.set('tokenCopy', t + '_suffix');
      pm.environment.set('counter', c);
      console.log('Finished updating');
    `
    const result = executeJsSandbox(code, initialEnv)
    expect(result.success).toBe(true)
    expect(result.updatedEnv.token).toBe('abc')
    expect(result.updatedEnv.tokenCopy).toBe('abc_suffix')
    expect(result.updatedEnv.counter).toBe('15')
    expect(result.logs).toContain('Finished updating')
  })

  it('supports direct env.get / env.set as well', () => {
    const initialEnv = { baseUrl: 'https://api.example.com' }
    const code = `
      const base = env.get('baseUrl');
      env.set('fullUrl', base + '/items');
    `
    const result = executeJsSandbox(code, initialEnv)
    expect(result.success).toBe(true)
    expect(result.updatedEnv.fullUrl).toBe('https://api.example.com/items')
  })

  it('safely catches script errors and logs them', () => {
    const initialEnv = {}
    const code = `
      nonExistentFunction();
    `
    const result = executeJsSandbox(code, initialEnv)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.logs.some((l) => l.includes('[ERRO]'))).toBe(true)
  })
})

describe('migrateChainToFlowGraph', () => {
  it('creates default graph when array is empty', () => {
    const graph = migrateChainToFlowGraph([])
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.connections.length).toBeGreaterThan(0)
  })

  it('converts chain items into connected flow nodes', () => {
    const chainItems = [
      { method: 'GET', url: 'https://api.test/1', captures: [{ path: 'id', name: 'myId' }] },
      { method: 'POST', url: 'https://api.test/items' }
    ]
    const graph = migrateChainToFlowGraph(chainItems)
    expect(graph.nodes.length).toBe(2)
    expect(graph.nodes[0].restData?.method).toBe('GET')
    expect(graph.nodes[0].restData?.captures[0].name).toBe('myId')
    expect(graph.nodes[1].restData?.method).toBe('POST')
    expect(graph.connections.length).toBe(1)
    expect(graph.connections[0].fromId).toBe('node_1')
    expect(graph.connections[0].toId).toBe('node_2')
    expect(graph.connections[0].kind).toBe('solid')
  })
})

describe('createDefaultFlowGraph', () => {
  it('returns a multi-node workflow with REST and JS nodes', () => {
    const graph = createDefaultFlowGraph()
    expect(graph.nodes.length).toBe(3)
    expect(graph.nodes.some((n) => n.type === 'rest')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'js')).toBe(true)
    expect(graph.connections.length).toBe(2)
  })
})

import { serializeFlowFile, parseFlowFile, remapFlowGraphIds } from './flowTypes.js'
import type { FlowGraph } from './flowTypes.js'

describe('flow file import/export', () => {
  const graph: FlowGraph = {
    nodes: [
      { id: 'a', type: 'rest', title: 'A', x: 1, y: 2, status: 'success', history: [] },
      { id: 'b', type: 'js', title: 'B', x: 5, y: 6 }
    ],
    connections: [{ id: 'c1', fromId: 'a', toId: 'b', kind: 'dotted' }]
  }

  it('round-trips a graph without runtime state', () => {
    const text = serializeFlowFile(graph)
    expect(text).not.toContain('"status"')
    const back = parseFlowFile(text)
    expect(back.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(back.connections[0].kind).toBe('dotted')
  })

  it('accepts a bare graph and drops dangling connections', () => {
    const back = parseFlowFile(
      JSON.stringify({
        nodes: graph.nodes,
        connections: [{ id: 'x', fromId: 'a', toId: 'zzz', kind: 'solid' }]
      })
    )
    expect(back.connections).toHaveLength(0)
  })

  it('rejects invalid files', () => {
    expect(() => parseFlowFile('nope')).toThrow()
    expect(() => parseFlowFile('{"foo":1}')).toThrow()
  })

  it('remaps ids consistently', () => {
    const r = remapFlowGraphIds(graph, 10, 20)
    expect(r.nodes[0].id).not.toBe('a')
    expect(r.nodes[0].x).toBe(11)
    expect(r.connections[0].fromId).toBe(r.nodes[0].id)
    expect(r.connections[0].toId).toBe(r.nodes[1].id)
  })
})
