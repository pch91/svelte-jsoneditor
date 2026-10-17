import { describe, expect, it } from 'vitest'
import {
  createDefaultFlowGraph,
  createAdvancedFlowGraph,
  executeJsSandbox,
  migrateChainToFlowGraph,
  evaluateRouterRules
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
  it('returns a comprehensive 11-node Rick & Morty workflow with loop iteration, throttle, router, mapper, merge, and events', () => {
    const graph = createAdvancedFlowGraph()
    expect(graph.nodes.length).toBe(12)

    // All 11 distinct node types must be present
    const nodeTypes = new Set(graph.nodes.map((n) => n.type))
    expect(nodeTypes.size).toBe(11)
    expect(nodeTypes.has('start')).toBe(true)
    expect(nodeTypes.has('rest')).toBe(true)
    expect(nodeTypes.has('loop')).toBe(true)
    expect(nodeTypes.has('delay')).toBe(true)
    expect(nodeTypes.has('js')).toBe(true)
    expect(nodeTypes.has('router')).toBe(true)
    expect(nodeTypes.has('transform')).toBe(true)
    expect(nodeTypes.has('merge')).toBe(true)
    expect(nodeTypes.has('event-throw')).toBe(true)
    expect(nodeTypes.has('event-catch')).toBe(true)
    expect(nodeTypes.has('terminate')).toBe(true)

    // 1. Loop validation with per-iteration variable configuration
    const loopNode = graph.nodes.find((n) => n.type === 'loop')
    expect(loopNode?.loopData?.mode).toBe('for-each')
    expect(loopNode?.loopData?.arrayPath).toBe('results')
    expect(loopNode?.loopData?.itemVar).toBe('character')
    expect(loopNode?.loopData?.indexVar).toBe('charIdx')
    expect(loopNode?.loopData?.maxIterations).toBe(3)

    // Loop port routing: item goes to throttle delay, done goes to router
    const loopItemConn = graph.connections.find(
      (c) => c.fromId === 'node_loop' && c.fromPort === 'item'
    )
    const loopDoneConn = graph.connections.find(
      (c) => c.fromId === 'node_loop' && c.fromPort === 'done'
    )
    expect(loopItemConn?.toId).toBe('node_loop_delay')
    expect(loopDoneConn?.toId).toBe('node_router')

    // 2. Throttle Delay and Loop Process Script
    const delayNode = graph.nodes.find((n) => n.id === 'node_loop_delay')
    expect(delayNode?.delayData?.delayMs).toBe(300)

    const loopProcessNode = graph.nodes.find((n) => n.id === 'node_loop_process')
    expect(loopProcessNode?.jsData?.code).toContain("pm.environment.get('character')")
    expect(loopProcessNode?.jsData?.code).toContain("pm.environment.get('charIdx')")
    expect(loopProcessNode?.jsData?.code).toContain('processedHeroes')

    // 3. Router node validation
    const routerNode = graph.nodes.find((n) => n.type === 'router')
    expect(routerNode?.routerData?.ports.length).toBe(2)
    expect(routerNode?.routerData?.ports.map((p) => p.id)).toEqual(['port_alive', 'port_dead'])
    expect(routerNode?.routerData?.rules.length).toBe(2)
    expect(routerNode?.routerData?.rules[0].path).toBe('lastHeroStatus')
    expect(routerNode?.routerData?.rules[0].operator).toBe('==')
    expect(routerNode?.routerData?.rules[0].value).toBe('Alive')

    // 4. Transform node validation
    const transformNode = graph.nodes.find((n) => n.type === 'transform')
    expect(transformNode?.transformData?.mappings.length).toBe(3)
    expect(transformNode?.transformData?.saveToEnvVar).toBe('heroProfile')

    // 5. Merge node validation
    const mergeNode = graph.nodes.find((n) => n.type === 'merge')
    expect(mergeNode?.mergeData?.strategy).toBe('wait-all')
    expect(mergeNode?.mergeData?.inputs?.length).toBe(2)
    expect(mergeNode?.mergeData?.inputs?.map((i) => i.id)).toEqual(['in_1', 'in_2'])

    // Convergence into merge inputs
    const aliveMerge = graph.connections.find((c) => c.toId === 'node_merge' && c.toPort === 'in_1')
    const deadMerge = graph.connections.find((c) => c.toId === 'node_merge' && c.toPort === 'in_2')
    expect(aliveMerge?.fromId).toBe('node_transform')
    expect(deadMerge?.fromId).toBe('node_js_audit')

    // Merge output connects to Event Throw
    const mergeOutConn = graph.connections.find(
      (c) => c.fromId === 'node_merge' && c.fromPort === 'joined'
    )
    expect(mergeOutConn?.toId).toBe('node_throw')

    // 6. Event jump & receiver validation
    const throwNode = graph.nodes.find((n) => n.type === 'event-throw')
    expect(throwNode?.eventData?.eventName).toBe('pipeline_complete')

    const catchNode = graph.nodes.find((n) => n.type === 'event-catch')
    expect(catchNode?.eventData?.eventName).toBe('pipeline_complete')

    const termConn = graph.connections.find((c) => c.fromId === 'node_catch')
    expect(termConn?.toId).toBe('node_terminate')
  })

  it('evaluates router rules against environment variables when field is absent from payload', () => {
    const rules = [
      {
        id: 'r_alive',
        portId: 'port_alive',
        label: 'Status Alive',
        type: 'jsonpath' as const,
        path: 'lastHeroStatus',
        operator: '==' as const,
        value: 'Alive'
      },
      {
        id: 'r_fallback',
        portId: 'port_dead',
        label: 'Fallback',
        type: 'otherwise' as const
      }
    ]

    // 1. When payload has loop info without lastHeroStatus, fallback to env
    const loopPayload = { mode: 'for-each', processedCount: 3 }
    const env = { lastHeroStatus: 'Alive', lastHeroName: 'Summer Smith' }

    const res = evaluateRouterRules(rules, 'first-match', loopPayload, 200, env)
    expect(res.matchedPortIds).toEqual(['port_alive'])
    expect(res.matchedRules[0].id).toBe('r_alive')

    // 2. When env has Dead, matches fallback
    const envDead = { lastHeroStatus: 'Dead' }
    const resDead = evaluateRouterRules(rules, 'first-match', loopPayload, 200, envDead)
    expect(resDead.matchedPortIds).toEqual(['port_dead'])
    expect(resDead.matchedRules[0].id).toBe('r_fallback')
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
