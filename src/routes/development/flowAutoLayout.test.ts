import { describe, it, expect } from 'vitest'
import { layoutFlowGraph } from './flowAutoLayout.js'
import type { FlowGraph } from './flowTypes.js'
import { createAdvancedFlowGraph } from './flowTypes.js'
import { getNodeHeight, getNodeWidth } from './flowGeometry.js'

describe('flowAutoLayout', () => {
  it('arranges linear flow strictly from Left to Right', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'start', type: 'start', title: 'Start', x: 0, y: 0, status: 'idle' },
        { id: 'fetch', type: 'rest', title: 'Fetch', x: 0, y: 0, status: 'idle' },
        { id: 'end', type: 'terminate', title: 'End', x: 0, y: 0, status: 'idle' }
      ],
      connections: [
        { id: 'c1', fromId: 'start', toId: 'fetch', kind: 'solid' },
        { id: 'c2', fromId: 'fetch', toId: 'end', kind: 'solid' }
      ]
    }

    const result = layoutFlowGraph(graph, { baseX: 100, baseY: 100, gapX: 80 })
    const start = result.nodes.find((n) => n.id === 'start')!
    const fetch = result.nodes.find((n) => n.id === 'fetch')!
    const end = result.nodes.find((n) => n.id === 'end')!

    expect(start.x).toBe(100)
    expect(fetch.x).toBeGreaterThan(start.x + getNodeWidth(start.type))
    expect(end.x).toBeGreaterThan(fetch.x + getNodeWidth(fetch.type))
  })

  it('distributes router branches into separate Top, Middle, and Bottom vertical lanes without overlapping', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'router', type: 'router', title: 'Router', x: 0, y: 0, status: 'idle' },
        { id: 'top_node', type: 'rest', title: 'Top Branch', x: 0, y: 0, status: 'idle' },
        { id: 'mid_node', type: 'rest', title: 'Middle Branch', x: 0, y: 0, status: 'idle' },
        { id: 'bot_node', type: 'rest', title: 'Bottom Branch', x: 0, y: 0, status: 'idle' }
      ],
      connections: [
        { id: 'c_top', fromId: 'router', toId: 'top_node', fromPort: 'port_top', kind: 'solid' },
        { id: 'c_mid', fromId: 'router', toId: 'mid_node', fromPort: 'port_middle', kind: 'solid' },
        { id: 'c_bot', fromId: 'router', toId: 'bot_node', fromPort: 'port_bottom', kind: 'solid' }
      ]
    }

    const result = layoutFlowGraph(graph, { baseY: 300, gapY: 40 })
    const topNode = result.nodes.find((n) => n.id === 'top_node')!
    const midNode = result.nodes.find((n) => n.id === 'mid_node')!
    const botNode = result.nodes.find((n) => n.id === 'bot_node')!

    // Vertical order check
    expect(topNode.y).toBeLessThan(midNode.y)
    expect(midNode.y).toBeLessThan(botNode.y)

    // Bounding box collision clearance check
    expect(midNode.y).toBeGreaterThanOrEqual(topNode.y + getNodeHeight(topNode) + 40)
    expect(botNode.y).toBeGreaterThanOrEqual(midNode.y + getNodeHeight(midNode) + 40)
  })

  it('centers merge node between incoming branches', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'b1', type: 'rest', title: 'Branch 1', x: 0, y: 0, status: 'idle' },
        { id: 'b2', type: 'rest', title: 'Branch 2', x: 0, y: 0, status: 'idle' },
        { id: 'merge', type: 'merge', title: 'Sync', x: 0, y: 0, status: 'idle' }
      ],
      connections: [
        { id: 'c1', fromId: 'b1', toId: 'merge', kind: 'solid' },
        { id: 'c2', fromId: 'b2', toId: 'merge', kind: 'solid' }
      ]
    }

    const result = layoutFlowGraph(graph, { baseY: 100, gapY: 60 })
    const b1 = result.nodes.find((n) => n.id === 'b1')!
    const b2 = result.nodes.find((n) => n.id === 'b2')!
    const merge = result.nodes.find((n) => n.id === 'merge')!

    expect(merge.x).toBeGreaterThan(Math.max(b1.x, b2.x))
    // Merge should be positioned between b1 and b2
    const minY = Math.min(b1.y, b2.y)
    const maxY = Math.max(b1.y, b2.y)
    expect(merge.y).toBeGreaterThanOrEqual(minY)
    expect(merge.y).toBeLessThanOrEqual(maxY + 100)
  })

  it('places independent sub-flows (Event Catch) in a separate swimlane below', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'n1', type: 'start', title: 'Start', x: 0, y: 0, status: 'idle' },
        {
          id: 'n2',
          type: 'event-throw',
          title: 'Throw',
          x: 0,
          y: 0,
          status: 'idle',
          eventData: { eventName: 'done' }
        },
        {
          id: 'n3',
          type: 'event-catch',
          title: 'Catch',
          x: 0,
          y: 0,
          status: 'idle',
          eventData: { eventName: 'done' }
        },
        { id: 'n4', type: 'terminate', title: 'End', x: 0, y: 0, status: 'idle' }
      ],
      connections: [
        { id: 'c1', fromId: 'n1', toId: 'n2', kind: 'solid' },
        { id: 'c2', fromId: 'n3', toId: 'n4', kind: 'solid' }
      ]
    }

    const result = layoutFlowGraph(graph, { baseY: 50, flowGapY: 150 })
    const n2 = result.nodes.find((n) => n.id === 'n2')!
    const n3 = result.nodes.find((n) => n.id === 'n3')!

    // The sub-flow starting at n3 should be vertically separated below n2
    expect(n3.y).toBeGreaterThanOrEqual(n2.y + getNodeHeight(n2) + 150)
    // And n3 starts again from the left edge (column 0)
    expect(n3.x).toBe(result.nodes.find((n) => n.id === 'n1')!.x)
  })

  it('lays out createAdvancedFlowGraph without node collisions across all 11 types', () => {
    const advanced = createAdvancedFlowGraph()
    const result = layoutFlowGraph(advanced)

    expect(result.nodes.length).toBe(12)
    // No two nodes have identical (x, y) coordinates
    const coords = new Set(result.nodes.map((n) => `${n.x},${n.y}`))
    expect(coords.size).toBe(result.nodes.length)
  })
})
