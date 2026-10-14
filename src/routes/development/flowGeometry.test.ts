import { describe, it, expect } from 'vitest'
import {
  CARD_WIDTH,
  CIRCLE_SIZE,
  getNodeWidth,
  getNodeHeight,
  getOutputPortPoint,
  getInputPortPoint,
  getBezierPath,
  getBezierMidpoint
} from './flowGeometry.js'
import type { FlowNode } from './flowTypes.js'

describe('flowGeometry', () => {
  it('computes correct node widths and heights', () => {
    expect(getNodeWidth('rest')).toBe(CARD_WIDTH)
    expect(getNodeWidth('start')).toBe(CIRCLE_SIZE)

    const jsNode: FlowNode = { id: 'js_1', type: 'js', title: 'JS', x: 0, y: 0 }
    expect(getNodeHeight(jsNode)).toBe(140)

    const circleNode: FlowNode = { id: 'evt_1', type: 'start', title: 'Start', x: 0, y: 0 }
    expect(getNodeHeight(circleNode)).toBe(50)
  })

  it('places output ports on physical edges (Top, Right, Bottom) and respects the reserved zone', () => {
    const routerNode: FlowNode = {
      id: 'r_1',
      type: 'router',
      title: 'Gateway',
      x: 100,
      y: 200,
      routerData: {
        mode: 'first-match',
        ports: [
          { id: 'port_top', label: 'Success', slot: 'top' },
          { id: 'port_right', label: 'Default', slot: 'middle' },
          { id: 'port_bottom', label: 'Error', slot: 'bottom' }
        ],
        rules: []
      }
    }

    // Top port
    const topPt = getOutputPortPoint(routerNode, 'port_top')
    expect(topPt.y).toBe(routerNode.y)
    expect(topPt.direction).toBe('top')
    // Must be on the right half (x >= node.x + 150), completely outside the reserved zone (x <= node.x + 120)
    expect(topPt.x).toBeGreaterThanOrEqual(routerNode.x + 150)

    // Right / Middle port
    const rightPt = getOutputPortPoint(routerNode, 'port_right')
    expect(rightPt.x).toBe(routerNode.x + CARD_WIDTH)
    expect(rightPt.y).toBeGreaterThanOrEqual(routerNode.y + 48)
    expect(rightPt.direction).toBe('right')

    // Bottom port
    const botPt = getOutputPortPoint(routerNode, 'port_bottom')
    expect(botPt.y).toBe(routerNode.y + 140)
    expect(botPt.direction).toBe('bottom')
    expect(botPt.x).toBeGreaterThanOrEqual(routerNode.x + 150)
  })

  it('guarantees input ports never collide with the top-left switcher reserved zone', () => {
    const cardNode: FlowNode = { id: 'c_1', type: 'rest', title: 'REST', x: 50, y: 80 }
    const inputPt = getInputPortPoint(cardNode)
    expect(inputPt.x).toBe(cardNode.x)
    // Strictly below header y = 36px (at y = 70px)
    expect(inputPt.y).toBe(cardNode.y + 70)
    expect(inputPt.direction).toBe('left')

    // Merge node with multiple inputs
    const mergeNode: FlowNode = {
      id: 'm_1',
      type: 'merge',
      title: 'Merge',
      x: 50,
      y: 80,
      mergeData: {
        strategy: 'wait-all',
        inputs: [
          { id: 'in_1', label: 'In 1', slot: 'middle' },
          { id: 'in_2', label: 'In 2', slot: 'middle' },
          { id: 'in_3', label: 'In 3', slot: 'middle' }
        ]
      }
    }
    const in1 = getInputPortPoint(mergeNode, 'in_1')
    const in2 = getInputPortPoint(mergeNode, 'in_2')
    const in3 = getInputPortPoint(mergeNode, 'in_3')
    // All inputs strictly at y >= 48px relative to node
    expect(in1.y).toBeGreaterThanOrEqual(mergeNode.y + 48)
    expect(in2.y).toBeGreaterThanOrEqual(mergeNode.y + 48)
    expect(in3.y).toBeGreaterThanOrEqual(mergeNode.y + 48)
  })

  it('calculates smooth directional Bezier curves for Top, Right, Bottom wires', () => {
    const p1 = { x: 200, y: 100, direction: 'top' as const }
    const p2 = { x: 400, y: 300, direction: 'left' as const }

    const path = getBezierPath(p1, 'top', p2, 'left')
    expect(path).toContain('M 200.0 100.0 C')

    const mid = getBezierMidpoint(p1, 'top', p2, 'left')
    expect(mid.x).toBeGreaterThan(200)
    expect(mid.x).toBeLessThan(400)
  })
})
