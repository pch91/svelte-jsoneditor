import type { FlowNode, FlowNodePort, PortSlot } from './flowTypes.js'
import { FLOW_NODE_REGISTRY } from './flowNodeRegistry.js'

export const CARD_WIDTH = 280
export const CARD_HEIGHT = 140
export const CIRCLE_SIZE = 50

export type Direction = 'top' | 'right' | 'bottom' | 'left'

export interface Point {
  x: number
  y: number
  direction?: Direction
}

export function isCircleNode(type: string): boolean {
  return type === 'start' || type === 'terminate' || type === 'event-throw' || type === 'event-catch'
}

export function getNodeWidth(type: string): number {
  return isCircleNode(type) ? CIRCLE_SIZE : CARD_WIDTH
}

export function getNodeHeight(node: FlowNode): number {
  if (isCircleNode(node.type)) return CIRCLE_SIZE
  return CARD_HEIGHT
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
 * Strictly respects physical slots and locks cleanly onto card borders:
 * - Top (x in [150, 225], y = node.y)
 * - Right (x = node.x + 280, y in [48, 120])
 * - Bottom (x in [150, 225], y = node.y + 140)
 * - Circle nodes (x = node.x + CIRCLE_SIZE, y = node.y + CIRCLE_SIZE / 2)
 */
export function getOutputPortPoint(node: FlowNode, portId?: string): Point {
  if (isCircleNode(node.type)) {
    return {
      x: node.x + CIRCLE_SIZE,
      y: node.y + CIRCLE_SIZE / 2,
      direction: 'right'
    }
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

  // If port specifies explicit slotIndex (1..10 from sketch)
  if (targetPort?.slotIndex && FIXED_PORT_SLOTS[targetPort.slotIndex]) {
    const s = FIXED_PORT_SLOTS[targetPort.slotIndex]
    return {
      x: node.x + s.relX,
      y: node.y + s.relY,
      direction: s.direction
    }
  }

  const slot: PortSlot = targetPort?.slot ?? 'middle'
  const slotPorts = ports.filter((p) => (p.slot ?? 'middle') === slot)
  const idx = Math.max(0, slotPorts.findIndex((p) => p.id === targetPort?.id))

  // Dynamically assign an unused slot so ports without slotIndex never collide
  const claimedSlots = new Set(
    slotPorts
      .filter((p) => p.id !== targetPort?.id && p.slotIndex && FIXED_PORT_SLOTS[p.slotIndex])
      .map((p) => p.slotIndex as number)
  )

  const candidateSlotIndices =
    slot === 'top' ? [2, 5, 9] : slot === 'middle' ? [1, 4, 7, 8] : [3, 6, 10]

  const availableSlots = candidateSlotIndices.filter((s) => !claimedSlots.has(s))
  const unassignedBefore = slotPorts
    .slice(0, idx)
    .filter((p) => !p.slotIndex || !FIXED_PORT_SLOTS[p.slotIndex]).length

  const assignedSlot = availableSlots[Math.min(unassignedBefore, availableSlots.length - 1)]
  if (assignedSlot && FIXED_PORT_SLOTS[assignedSlot]) {
    const s = FIXED_PORT_SLOTS[assignedSlot]
    return {
      x: node.x + s.relX,
      y: node.y + s.relY,
      direction: s.direction
    }
  }

  // Fallback defaults
  if (slot === 'top') {
    return { x: node.x + 225, y: node.y, direction: 'top' }
  }
  if (slot === 'bottom') {
    return { x: node.x + 225, y: node.y + CARD_HEIGHT, direction: 'bottom' }
  }
  return { x: node.x + CARD_WIDTH, y: node.y + 70, direction: 'right' }
}

/**
 * Calculate the exact canvas coordinate of an input port on a node.
 * - Standard cards: x = node.x, y = node.y + 70 (centered vertically on left border)
 * - Merge multi-input: x = node.x, y distributed in [50, 120], strictly y >= 48
 * - Circle nodes: x = node.x, y = node.y + CIRCLE_SIZE / 2
 */
export function getInputPortPoint(node: FlowNode, portId?: string): Point {
  if (isCircleNode(node.type)) {
    return {
      x: node.x,
      y: node.y + CIRCLE_SIZE / 2,
      direction: 'left'
    }
  }

  // Merge block with multi-inputs
  if (node.type === 'merge' && node.mergeData?.inputs && node.mergeData.inputs.length > 0) {
    const inputs = node.mergeData.inputs
    const idx = Math.max(0, inputs.findIndex((p) => p.id === portId))
    const ys =
      inputs.length === 2
        ? [54, 86]
        : inputs.length === 3
          ? [48, 72, 96]
          : [48, 70, 92, 114]
    return {
      x: node.x,
      y: node.y + (ys[Math.min(idx, ys.length - 1)] ?? 70),
      direction: 'left'
    }
  }

  // Standard input port on left edge, vertically centered
  return {
    x: node.x,
    y: node.y + 70,
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
