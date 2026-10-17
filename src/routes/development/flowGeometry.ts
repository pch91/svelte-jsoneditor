import type { FlowNode, FlowNodePort, PortSlot } from './flowTypes.js'
import { FLOW_NODE_REGISTRY } from './flowNodeRegistry.js'

export const CARD_WIDTH = 270
export const CARD_HEIGHT = 124
export const CIRCLE_SIZE = 54

export type Direction = 'top' | 'right' | 'bottom' | 'left'

export interface Point {
  x: number
  y: number
  direction?: Direction
}

export function isCircleNode(type: string): boolean {
  return type === 'start' || type === 'terminate' || type === 'event-throw' || type === 'event-catch'
}

export function isCompactNode(type: string): boolean {
  return type === 'delay' || type === 'merge' || type === 'router' || type === 'loop' || type === 'transform'
}

export function getNodeWidth(type: string): number {
  if (isCircleNode(type)) return CIRCLE_SIZE
  if (type === 'delay') return 140
  if (type === 'merge') return 150
  if (type === 'transform') return 160
  if (type === 'router') return 130
  if (type === 'loop') return 150
  if (type === 'js') return 270
  return 270
}

export function getNodeHeight(node: FlowNode): number {
  if (isCircleNode(node.type)) return CIRCLE_SIZE
  if (node.type === 'delay') return 48
  if (node.type === 'merge') return 60
  if (node.type === 'router') return ROUTER_DIAMOND_SIZE
  if (node.type === 'loop') return 48
  if (node.type === 'js') return 124
  return 124
}

export const ROUTER_DIAMOND_SIZE = 130
export const ROUTER_DIAMOND_VERTICES = {
  top: { x: 65, y: 0 },
  right: { x: 130, y: 65 },
  bottom: { x: 65, y: 130 },
  left: { x: 0, y: 65 }
}
export const ROUTER_DIAMOND_POINTS = `${ROUTER_DIAMOND_VERTICES.top.x},${ROUTER_DIAMOND_VERTICES.top.y} ${ROUTER_DIAMOND_VERTICES.right.x},${ROUTER_DIAMOND_VERTICES.right.y} ${ROUTER_DIAMOND_VERTICES.bottom.x},${ROUTER_DIAMOND_VERTICES.bottom.y} ${ROUTER_DIAMOND_VERTICES.left.x},${ROUTER_DIAMOND_VERTICES.left.y}`

/**
 * Inviolable Geometric Rule: Projects a router port exactly onto the perimeter line
 * of the diamond polygon. The resulting (relX, relY) is mathematically guaranteed to lie
 * on the line equation connecting the 4 vertices, ensuring 50% of the port ball is inside
 * and 50% is outside the object.
 */
export function getRouterPortPointOnLine(
  slot: PortSlot | 'input',
  idx: number,
  total: number,
  step = 16
): { relX: number; relY: number; direction: Direction } {
  if (slot === 'input') {
    return { relX: 0, relY: 65, direction: 'left' }
  }

  const offset = (idx - (total - 1) / 2) * step

  if (slot === 'top') {
    return {
      relX: 65 + offset,
      relY: Math.abs(offset),
      direction: 'top'
    }
  }

  if (slot === 'bottom') {
    return {
      relX: 65 + offset,
      relY: 130 - Math.abs(offset),
      direction: 'bottom'
    }
  }

  // Middle / Right slot
  return {
    relX: 130 - Math.abs(offset),
    relY: 65 + offset,
    direction: 'right'
  }
}

/**
 * Exact physical slot coordinates from user sketch (media_1791882218707.png):
 * - Top (3 ports): 9 (x=150), 5 (x=200), 2 (x=250) -> y = 0
 * - Right (4 ports): 7 (y=48), 1 (y=72), 4 (y=96), 8 (y=120) -> x = 280
 * - Bottom (3 ports): 10 (x=150), 6 (x=200), 3 (x=250) -> y = 140
 */
export const FIXED_PORT_SLOTS: Record<
  number,
  { slot: PortSlot; relX: number; relY: number; direction: Direction }
> = {
  1: { slot: 'middle', relX: 280, relY: 70, direction: 'right' },
  2: { slot: 'top', relX: 225, relY: 0, direction: 'top' },
  3: { slot: 'bottom', relX: 225, relY: 140, direction: 'bottom' },
  4: { slot: 'middle', relX: 280, relY: 96, direction: 'right' },
  5: { slot: 'top', relX: 185, relY: 0, direction: 'top' },
  6: { slot: 'bottom', relX: 185, relY: 140, direction: 'bottom' },
  7: { slot: 'middle', relX: 280, relY: 48, direction: 'right' },
  8: { slot: 'middle', relX: 280, relY: 120, direction: 'right' },
  9: { slot: 'top', relX: 150, relY: 0, direction: 'top' },
  10: { slot: 'bottom', relX: 150, relY: 140, direction: 'bottom' }
}

/**
 * Calculate the exact canvas coordinate of an output port on a node.
 */
export function getOutputPortPoint(node: FlowNode, portId?: string): Point {
  if (isCircleNode(node.type)) {
    return {
      x: node.x + CIRCLE_SIZE,
      y: node.y + CIRCLE_SIZE / 2,
      direction: 'right'
    }
  }

  // Compact Delay node (140x48)
  if (node.type === 'delay') {
    if (portId === 'dropped') {
      return { x: node.x + 70, y: node.y + 48, direction: 'bottom' }
    }
    return {
      x: node.x + 140,
      y: node.y + 24,
      direction: 'right'
    }
  }

  // Compact Merge node (150x60)
  if (node.type === 'merge') {
    if (portId === 'timeout') {
      return { x: node.x + 75, y: node.y + 60, direction: 'bottom' }
    }
    return {
      x: node.x + 150,
      y: node.y + 30,
      direction: 'right'
    }
  }

  // Compact Transform / JSON Mapper node (160x60)
  if (node.type === 'transform') {
    return {
      x: node.x + 160,
      y: node.y + 30,
      direction: 'right'
    }
  }

  // Compact Loop node (150x48 - matching Delay style) with explicit Body and Done ports
  if (node.type === 'loop') {
    if (portId === 'done') {
      return { x: node.x + 150, y: node.y + 34, direction: 'right' }
    }
    return { x: node.x + 150, y: node.y + 14, direction: 'right' }
  }

  // Determine ports list
  let ports: FlowNodePort[] = []
  if (node.type === 'router' && node.routerData?.ports && node.routerData.ports.length > 0) {
    ports = node.routerData.ports
  } else if (node.type === 'js' && node.jsData?.ports && node.jsData.ports.length > 0) {
    ports = node.jsData.ports
  } else {
    const def = FLOW_NODE_REGISTRY[node.type]
    ports = def ? def.getOutputPorts(node) : [{ id: 'out', label: 'Out', slot: 'middle' }]
  }

  // Find targeted port
  const targetPort = (portId ? ports.find((p) => p.id === portId) : null) ?? ports[0]
  const slot: PortSlot = targetPort?.slot ?? 'middle'

  // Diamond Switch Router (130x130): Strictly bound to geometric diamond perimeter equation
  if (node.type === 'router') {
    const slotPorts = ports.filter((p) => (p.slot ?? 'middle') === slot)
    const idx = Math.max(0, slotPorts.findIndex((p) => p.id === targetPort?.id))
    const total = Math.max(1, slotPorts.length)
    const pt = getRouterPortPointOnLine(slot, idx, total)
    return {
      x: node.x + pt.relX,
      y: node.y + pt.relY,
      direction: pt.direction
    }
  }

  const w = getNodeWidth(node.type)
  const h = getNodeHeight(node)

  // If port specifies explicit slotIndex (1..10)
  if (targetPort?.slotIndex && FIXED_PORT_SLOTS[targetPort.slotIndex]) {
    const s = FIXED_PORT_SLOTS[targetPort.slotIndex]
    const relX = s.direction === 'right' ? w : Math.round((s.relX / 280) * w)
    const relY = s.direction === 'bottom' ? h : s.direction === 'top' ? 0 : Math.round((s.relY / 140) * h)
    return {
      x: node.x + relX,
      y: node.y + relY,
      direction: s.direction
    }
  }

  const slotPorts = ports.filter((p) => (p.slot ?? 'middle') === slot)
  const idx = Math.max(0, slotPorts.findIndex((p) => p.id === targetPort?.id))

  if (slot === 'top') {
    return { x: node.x + Math.round(w * 0.75), y: node.y, direction: 'top' }
  }
  if (slot === 'bottom') {
    return { x: node.x + Math.round(w * 0.75), y: node.y + h, direction: 'bottom' }
  }

  // Multiple ports on right border
  if (slotPorts.length > 1) {
    const step = Math.round(h / (slotPorts.length + 1))
    return { x: node.x + w, y: node.y + step * (idx + 1), direction: 'right' }
  }

  return { x: node.x + w, y: node.y + Math.round(h / 2), direction: 'right' }
}

/**
 * Calculate the exact canvas coordinate of an input port on a node.
 */
export function getInputPortPoint(node: FlowNode, portId?: string): Point {
  if (isCircleNode(node.type)) {
    return {
      x: node.x,
      y: node.y + CIRCLE_SIZE / 2,
      direction: 'left'
    }
  }

  if (node.type === 'delay') {
    return {
      x: node.x,
      y: node.y + 24,
      direction: 'left'
    }
  }

  if (node.type === 'merge') {
    const inputs = node.mergeData?.inputs && node.mergeData.inputs.length > 0
      ? node.mergeData.inputs
      : [{ id: 'in_1' }, { id: 'in_2' }]
    const idx = Math.max(0, inputs.findIndex((p) => p.id === portId))
    const yOffsets = inputs.length === 2 ? [20, 40] : [15, 30, 45]
    return {
      x: node.x,
      y: node.y + (yOffsets[Math.min(idx, yOffsets.length - 1)] ?? 30),
      direction: 'left'
    }
  }

  if (node.type === 'router') {
    const pt = getRouterPortPointOnLine('input', 0, 1)
    return {
      x: node.x + pt.relX,
      y: node.y + pt.relY,
      direction: pt.direction
    }
  }

  if (node.type === 'loop') {
    return {
      x: node.x,
      y: node.y + 24,
      direction: 'left'
    }
  }

  if (node.type === 'transform') {
    return {
      x: node.x,
      y: node.y + 30,
      direction: 'left'
    }
  }

  const h = getNodeHeight(node)
  return {
    x: node.x,
    y: node.y + Math.round(h / 2),
    direction: 'left'
  }
}

/**
 * Generates an SVG cubic bezier path respecting tangential vectors for each edge direction.
 * Top exits upwards, Right exits rightwards, Bottom exits downwards, Left enters from the left.
 */
export function getBezierPath(
  p1: Point,
  dir1: Direction = p1.direction ?? 'right',
  p2: Point,
  dir2: Direction = p2.direction ?? 'left'
): string {
  const dx = Math.abs(p2.x - p1.x)
  const dy = Math.abs(p2.y - p1.y)
  const dist = Math.sqrt(dx * dx + dy * dy)
  const k = Math.max(40, dist * 0.45)

  let cp1x = p1.x
  let cp1y = p1.y
  let cp2x = p2.x
  let cp2y = p2.y

  // Source control point
  if (dir1 === 'top') {
    cp1y -= k
  } else if (dir1 === 'bottom') {
    cp1y += k
  } else if (dir1 === 'left') {
    cp1x -= k
  } else {
    // 'right'
    cp1x += k
  }

  // Target control point
  if (dir2 === 'top') {
    cp2y -= k
  } else if (dir2 === 'bottom') {
    cp2y += k
  } else if (dir2 === 'right') {
    cp2x += k
  } else {
    // 'left'
    cp2x -= k
  }

  return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
}

/**
 * Get midpoint along the bezier curve for placing the interactive connection selector ball.
 */
export function getBezierMidpoint(
  p1: Point,
  dir1: Direction = p1.direction ?? 'right',
  p2: Point,
  dir2: Direction = p2.direction ?? 'left'
): Point {
  const dx = Math.abs(p2.x - p1.x)
  const dy = Math.abs(p2.y - p1.y)
  const dist = Math.sqrt(dx * dx + dy * dy)
  const k = Math.max(40, dist * 0.45)

  let cp1x = p1.x
  let cp1y = p1.y
  let cp2x = p2.x
  let cp2y = p2.y

  if (dir1 === 'top') cp1y -= k
  else if (dir1 === 'bottom') cp1y += k
  else if (dir1 === 'left') cp1x -= k
  else cp1x += k

  if (dir2 === 'top') cp2y -= k
  else if (dir2 === 'bottom') cp2y += k
  else if (dir2 === 'right') cp2x += k
  else cp2x -= k

  // Calculate B(0.5)
  const t = 0.5
  const mt = 1 - t
  const midX =
    mt * mt * mt * p1.x +
    3 * mt * mt * t * cp1x +
    3 * mt * t * t * cp2x +
    t * t * t * p2.x
  const midY =
    mt * mt * mt * p1.y +
    3 * mt * mt * t * cp1y +
    3 * mt * t * t * cp2y +
    t * t * t * p2.y

  return { x: midX, y: midY }
}
