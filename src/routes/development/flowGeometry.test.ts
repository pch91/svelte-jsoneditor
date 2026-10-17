import { describe, it, expect } from 'vitest'
import {
  CARD_WIDTH,
  CARD_HEIGHT,
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
    expect(getNodeWidth('rest')).toBe(270)
    expect(getNodeWidth('start')).toBe(CIRCLE_SIZE)
    expect(getNodeWidth('delay')).toBe(140)
    expect(getNodeWidth('merge')).toBe(150)
    expect(getNodeWidth('router')).toBe(130)
    expect(getNodeWidth('loop')).toBe(150)

    const jsNode: FlowNode = { id: 'js_1', type: 'js', title: 'JS', x: 0, y: 0 }
    expect(getNodeHeight(jsNode)).toBe(124)
    expect(getNodeWidth('js')).toBe(270)

    const delayNode: FlowNode = { id: 'd_1', type: 'delay', title: 'Delay', x: 0, y: 0 }
    expect(getNodeHeight(delayNode)).toBe(48)

    const circleNode: FlowNode = { id: 'evt_1', type: 'start', title: 'Start', x: 0, y: 0 }
    expect(getNodeHeight(circleNode)).toBe(CIRCLE_SIZE)
  })

  it('places output ports on physical edges (Top, Right, Bottom) for compact router', () => {
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

    // Top port (vertex top)
    const topPt = getOutputPortPoint(routerNode, 'port_top')
    expect(topPt.y).toBe(routerNode.y)
    expect(topPt.direction).toBe('top')
    expect(topPt.x).toBe(routerNode.x + 65)

    // Right / Middle port (vertex right)
    const rightPt = getOutputPortPoint(routerNode, 'port_right')
    expect(rightPt.x).toBe(routerNode.x + 130)
    expect(rightPt.y).toBe(routerNode.y + 65)
    expect(rightPt.direction).toBe('right')

    // Bottom port (vertex bottom)
    const botPt = getOutputPortPoint(routerNode, 'port_bottom')
    expect(botPt.y).toBe(routerNode.y + 130)
    expect(botPt.direction).toBe('bottom')
    expect(botPt.x).toBe(routerNode.x + 65)
  })

  it('guarantees input ports are placed cleanly on left edge', () => {
    const cardNode: FlowNode = { id: 'c_1', type: 'rest', title: 'REST', x: 50, y: 80 }
    const inputPt = getInputPortPoint(cardNode)
    expect(inputPt.x).toBe(cardNode.x)
    expect(inputPt.y).toBe(cardNode.y + 62)
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
    expect(in1.x).toBe(mergeNode.x)
    expect(in2.x).toBe(mergeNode.x)
    expect(in3.x).toBe(mergeNode.x)
    expect(in1.y).toBe(mergeNode.y + 15)
    expect(in2.y).toBe(mergeNode.y + 30)
    expect(in3.y).toBe(mergeNode.y + 45)
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

  it('strictly verifies every router port center lies exactly on the diamond perimeter equation (|x-65| + |y-65| = 65)', () => {
    // Test input port
    const routerNode: FlowNode = {
      id: 'r_test',
      type: 'router',
      title: 'Gateway',
      x: 200,
      y: 300,
      routerData: {
        mode: 'first-match',
        ports: [
          // 3 top ports
          { id: 't_0', label: 'T0', slot: 'top' },
          { id: 't_1', label: 'T1', slot: 'top' },
          { id: 't_2', label: 'T2', slot: 'top' },
          // 4 right ports
          { id: 'r_0', label: 'R0', slot: 'middle' },
          { id: 'r_1', label: 'R1', slot: 'middle' },
          { id: 'r_2', label: 'R2', slot: 'middle' },
          { id: 'r_3', label: 'R3', slot: 'middle' },
          // 3 bottom ports
          { id: 'b_0', label: 'B0', slot: 'bottom' },
          { id: 'b_1', label: 'B1', slot: 'bottom' },
          { id: 'b_2', label: 'B2', slot: 'bottom' }
        ],
        rules: []
      }
    }

    // Input port check
    const inPt = getInputPortPoint(routerNode)
    const relInX = inPt.x - routerNode.x
    const relInY = inPt.y - routerNode.y
    expect(Math.abs(relInX - 65) + Math.abs(relInY - 65)).toBe(65)

    // Output ports check for all 10 ports
    for (const port of routerNode.routerData!.ports!) {
      const pt = getOutputPortPoint(routerNode, port.id)
      const relX = pt.x - routerNode.x
      const relY = pt.y - routerNode.y
      // Mathematical proof: point (relX, relY) lies exactly on diamond perimeter
      const perimeterDist = Math.abs(relX - 65) + Math.abs(relY - 65)
      expect(perimeterDist).toBe(65)
    }
  })

  it('guarantees Delay, Loop, Transform, and Merge ports are locked precisely onto their node boundaries', () => {
    // Delay (140x48)
    const delayNode: FlowNode = { id: 'd1', type: 'delay', title: 'Delay', x: 100, y: 100 }
    const delayOut = getOutputPortPoint(delayNode, 'out')
    const delayDropped = getOutputPortPoint(delayNode, 'dropped')
    const delayIn = getInputPortPoint(delayNode)
    expect(delayOut).toEqual({ x: 240, y: 124, direction: 'right' })
    expect(delayDropped).toEqual({ x: 170, y: 148, direction: 'bottom' })
    expect(delayIn).toEqual({ x: 100, y: 124, direction: 'left' })

    // Loop (150x48)
    const loopNode: FlowNode = { id: 'l1', type: 'loop', title: 'Loop', x: 200, y: 200 }
    const loopItem = getOutputPortPoint(loopNode, 'item')
    const loopDone = getOutputPortPoint(loopNode, 'done')
    const loopIn = getInputPortPoint(loopNode)
    expect(loopItem).toEqual({ x: 350, y: 214, direction: 'right' })
    expect(loopDone).toEqual({ x: 350, y: 234, direction: 'right' })
    expect(loopIn).toEqual({ x: 200, y: 224, direction: 'left' })

    // Transform (160x60)
    const transformNode: FlowNode = { id: 't1', type: 'transform', title: 'Transform', x: 50, y: 50 }
    const transformOut = getOutputPortPoint(transformNode, 'out')
    const transformIn = getInputPortPoint(transformNode)
    expect(transformOut).toEqual({ x: 210, y: 80, direction: 'right' })
    expect(transformIn).toEqual({ x: 50, y: 80, direction: 'left' })

    // Merge (150x60)
    const mergeNode: FlowNode = { id: 'm1', type: 'merge', title: 'Merge', x: 0, y: 0 }
    const mergeJoined = getOutputPortPoint(mergeNode, 'joined')
    const mergeTimeout = getOutputPortPoint(mergeNode, 'timeout')
    expect(mergeJoined).toEqual({ x: 150, y: 30, direction: 'right' })
    expect(mergeTimeout).toEqual({ x: 75, y: 60, direction: 'bottom' })
  })
})

