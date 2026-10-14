import { describe, expect, it } from 'vitest'
import {
  createDefaultFlowGraph,
  createAdvancedFlowGraph,
  executeJsSandbox,
  migrateChainToFlowGraph
} from './flowTypes.js'

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
    expect(result.logs.some((l) => l.includes('[ERROR]'))).toBe(true)
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
  it('returns a complete Rick & Morty workflow with start, rest, js, events, and terminate', () => {
    const graph = createDefaultFlowGraph()
    expect(graph.nodes.length).toBe(7)
    expect(graph.nodes.some((n) => n.type === 'start')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'rest')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'js')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'event-throw')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'event-catch')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'terminate')).toBe(true)
    expect(graph.connections.length).toBe(5)

    const jsNode = graph.nodes.find((n) => n.type === 'js')
    expect(jsNode?.jsData?.code).toContain('if (charStatus === "Alive"')
    expect(jsNode?.jsData?.code).toContain('pm.environment.set')

    const throwNode = graph.nodes.find((n) => n.type === 'event-throw')
    const catchNode = graph.nodes.find((n) => n.type === 'event-catch')
    expect(throwNode?.eventData?.eventName).toBe('valida total')
    expect(catchNode?.eventData?.eventName).toBe('valida total')
  })
})

describe('createAdvancedFlowGraph', () => {
  it('returns an advanced Rick & Morty workflow with router, transform, multi-port connectors, and branch jumps', () => {
    const graph = createAdvancedFlowGraph()
    expect(graph.nodes.length).toBe(14)
    expect(graph.nodes.some((n) => n.type === 'start')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'rest')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'router')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'transform')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'js')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'event-throw')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'event-catch')).toBe(true)
    expect(graph.nodes.some((n) => n.type === 'terminate')).toBe(true)

    // Router node validation
    const routerNode = graph.nodes.find((n) => n.type === 'router')
    expect(routerNode?.routerData?.ports.length).toBe(3)
    expect(routerNode?.routerData?.ports.map((p) => p.id)).toEqual(['port_alive', 'port_dead', 'port_unknown'])
    expect(routerNode?.routerData?.rules.length).toBe(3)
    expect(routerNode?.routerData?.rules[0].operator).toBe('==')
    expect(routerNode?.routerData?.rules[0].value).toBe('Alive')

    // Transform node validation
    const transformNode = graph.nodes.find((n) => n.type === 'transform')
    expect(transformNode?.transformData?.mappings.length).toBe(3)
    expect(transformNode?.transformData?.saveToEnvVar).toBe('heroProfile')

    // Chained URLs: later REST blocks use values captured by earlier blocks
    const fetchChar = graph.nodes.find((n) => n.id === 'node_fetch_char')
    expect(fetchChar?.restData?.captures?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['originUrl', 'firstEpisodeUrl'])
    )
    expect(graph.nodes.find((n) => n.id === 'node_fetch_origin')?.restData?.url).toBe('{{originUrl}}')
    expect(graph.nodes.find((n) => n.id === 'node_fetch_episode')?.restData?.url).toBe(
      '{{firstEpisodeUrl}}'
    )

    // fromPort multi-port connections validation
    const aliveConn = graph.connections.find((c) => c.fromPort === 'port_alive')
    const deadConn = graph.connections.find((c) => c.fromPort === 'port_dead')
    const unkConn = graph.connections.find((c) => c.fromPort === 'port_unknown')
    expect(aliveConn?.toId).toBe('node_transform_alive')
    expect(deadConn?.toId).toBe('node_fetch_episode')
    expect(unkConn?.toId).toBe('node_js_unknown')

    // Event jump & receiver validation
    const jumps = graph.nodes.filter((n) => n.type === 'event-throw')
    expect(jumps.length).toBe(3)
    expect(jumps.every((j) => j.eventData?.eventName === 'finish_telemetry')).toBe(true)

    const receiver = graph.nodes.find((n) => n.type === 'event-catch')
    expect(receiver?.eventData?.eventName).toBe('finish_telemetry')
  })
})

import { serializeFlowFile, parseFlowFile, remapFlowGraphIds } from './flowTypes.js'
import type { FlowGraph } from './flowTypes.js'

describe('flow file import/export', () => {
  const graph: FlowGraph = {
    nodes: [
      { id: 's', type: 'start', title: 'Start', x: 0, y: 0 },
      { id: 'a', type: 'rest', title: 'A', x: 1, y: 2, status: 'success', history: [] },
      { id: 'b', type: 'js', title: 'B', x: 5, y: 6 },
      {
        id: 't',
        type: 'event-throw',
        title: 'Throw',
        x: 10,
        y: 10,
        eventData: { eventName: 'valida total' }
      },
      {
        id: 'c',
        type: 'event-catch',
        title: 'Catch',
        x: 20,
        y: 20,
        eventData: { eventName: 'valida total' }
      },
      { id: 'term', type: 'terminate', title: 'End', x: 30, y: 30 }
    ],
    connections: [{ id: 'c1', fromId: 'a', toId: 'b', kind: 'dotted' }]
  }

  it('round-trips a graph with all node types without runtime state', () => {
    const text = serializeFlowFile(graph)
    expect(text).not.toContain('"status"')
    const back = parseFlowFile(text)
    expect(back.nodes.map((n) => n.id)).toEqual(['s', 'a', 'b', 't', 'c', 'term'])
    expect(back.nodes.find((n) => n.id === 't')?.eventData?.eventName).toBe('valida total')
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
    expect(r.nodes[0].id).not.toBe('s')
    expect(r.nodes[0].x).toBe(10)
    expect(r.nodes[1].x).toBe(11)
    expect(r.connections[0].fromId).toBe(r.nodes[1].id)
    expect(r.connections[0].toId).toBe(r.nodes[2].id)
  })
})
