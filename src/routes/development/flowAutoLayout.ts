import type { FlowGraph, FlowNode, FlowConnection } from './flowTypes.js'
import { getNodeWidth, getNodeHeight } from './flowGeometry.js'

export interface AutoLayoutOptions {
  baseX?: number
  baseY?: number
  gapX?: number
  gapY?: number
  flowGapY?: number
}

/**
 * Intelligent Layered Graph Layout (Sugiyama adapted for Left-to-Right BPMN Flowcharts).
 *
 * Capabilities:
 * 1. Topology & Rank Assignment: Strict Left-to-Right column layering based on longest paths.
 * 2. Branch-Aware Vertical Lanes: Router/Multi-port branches distribute into distinct Top,
 *    Middle, and Bottom lanes without wire-crossings.
 * 3. Convergence Centering: Merge nodes align vertically to the barycenter (centroid) of their incoming branches.
 * 4. Collision Avoidance: Absolute bounding-box clearance with customizable vertical and horizontal gaps.
 * 5. Disconnected Sub-flow Swimlanes: Wireless/telemetry jumps (event-throw -> event-catch) layout cleanly
 *    in dedicated parallel swimlanes below the main flow.
 */
export function layoutFlowGraph(graph: FlowGraph, options: AutoLayoutOptions = {}): FlowGraph {
  if (!graph.nodes || graph.nodes.length === 0) {
    return { ...graph }
  }

  const baseX = options.baseX ?? 60
  const baseY = options.baseY ?? 80
  const gapX = options.gapX ?? 80
  const gapY = options.gapY ?? 40
  const flowGapY = options.flowGapY ?? 120

  // Clone nodes to preserve immutability
  const nodes: FlowNode[] = graph.nodes.map((n) => ({ ...n }))
  const connections: FlowConnection[] = graph.connections.map((c) => ({ ...c }))
  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]))

  // 1. Build Adjacency & Find Independent Components (Swimlanes)
  // Include explicit connections and implicit event-throw -> event-catch matches
  const adj = new Map<string, string[]>()
  const revAdj = new Map<string, string[]>()
  const connMap = new Map<string, FlowConnection[]>()

  nodes.forEach((n) => {
    adj.set(n.id, [])
    revAdj.set(n.id, [])
    connMap.set(n.id, [])
  })

  connections.forEach((c) => {
    if (adj.has(c.fromId) && adj.has(c.toId)) {
      adj.get(c.fromId)!.push(c.toId)
      revAdj.get(c.toId)!.push(c.fromId)
      connMap.get(c.fromId)!.push(c)
    }
  })

  // Match wireless event-throw -> event-catch
  nodes.forEach((catchNode) => {
    if (catchNode.type === 'event-catch' && catchNode.eventData?.eventName) {
      const evt = catchNode.eventData.eventName.trim().toLowerCase()
      const matchingThrow = nodes.find(
        (t) => t.type === 'event-throw' && t.eventData?.eventName?.trim().toLowerCase() === evt
      )
      if (matchingThrow && !adj.get(matchingThrow.id)!.includes(catchNode.id)) {
        // We track relation for grouping, but catchNode will form its own sub-swimlane
      }
    }
  })

  // Group nodes into connected components (sub-graphs)
  const visited = new Set<string>()
  const components: FlowNode[][] = []

  // Ensure Start node component is evaluated first
  const startNodes = nodes.filter((n) => n.type === 'start')
  const orderedRoots = [
    ...startNodes,
    ...nodes.filter((n) => n.type === 'event-catch'),
    ...nodes.filter(
      (n) => (revAdj.get(n.id)?.length ?? 0) === 0 && n.type !== 'start' && n.type !== 'event-catch'
    ),
    ...nodes
  ]

  for (const root of orderedRoots) {
    if (visited.has(root.id)) continue

    const comp: FlowNode[] = []
    const queue = [root.id]
    visited.add(root.id)

    while (queue.length > 0) {
      const u = queue.shift()!
      comp.push(nodeMap.get(u)!)

      // Explore downstream and upstream (undirected connectivity for component isolation)
      const neighbors = [...(adj.get(u) || []), ...(revAdj.get(u) || [])]
      for (const v of neighbors) {
        if (!visited.has(v)) {
          // If neighbor is an event-catch, keep it as a separate swimlane unless explicitly wired
          const isCatch = nodeMap.get(v)?.type === 'event-catch'
          const isDirectlyWired = connections.some(
            (c) => (c.fromId === u && c.toId === v) || (c.fromId === v && c.toId === u)
          )
          if (!isCatch || isDirectlyWired) {
            visited.add(v)
            queue.push(v)
          }
        }
      }
    }

    if (comp.length > 0) {
      components.push(comp)
    }
  }

  // 2. Layout Each Component as a Layered Flow
  let currentFlowY = baseY

  for (const comp of components) {
    const compNodeIds = new Set(comp.map((n) => n.id))
    const compConns = connections.filter(
      (c) => compNodeIds.has(c.fromId) && compNodeIds.has(c.toId)
    )

    // A. Detect Back-Edges (Cycles / Loops) using DFS to create a clean DAG
    const compAdj = new Map<string, string[]>()
    comp.forEach((n) => compAdj.set(n.id, []))
    compConns.forEach((c) => {
      // Don't treat loop-done as cycle; treat loop-item back-edges as feedback
      compAdj.get(c.fromId)?.push(c.toId)
    })

    const dfsState = new Map<string, number>() // 0: unvisited, 1: visiting, 2: done
    const backEdges = new Set<string>()

    function dfs(u: string) {
      dfsState.set(u, 1)
      for (const v of compAdj.get(u) || []) {
        if (dfsState.get(v) === 1) {
          // Cycle back-edge detected
          backEdges.add(`${u}->${v}`)
        } else if (!dfsState.has(v) || dfsState.get(v) === 0) {
          dfs(v)
        }
      }
      dfsState.set(u, 2)
    }

    comp.forEach((n) => {
      if (!dfsState.has(n.id)) dfs(n.id)
    })

    // B. Longest-Path Layering (Ranks / Columns) on the DAG
    const dagAdj = new Map<string, string[]>()
    const dagInDegree = new Map<string, number>()
    comp.forEach((n) => {
      dagAdj.set(n.id, [])
      dagInDegree.set(n.id, 0)
    })

    compConns.forEach((c) => {
      if (!backEdges.has(`${c.fromId}->${c.toId}`)) {
        dagAdj.get(c.fromId)?.push(c.toId)
        dagInDegree.set(c.toId, (dagInDegree.get(c.toId) ?? 0) + 1)
      }
    })

    const rank = new Map<string, number>()
    const topoQueue = comp.filter((n) => (dagInDegree.get(n.id) ?? 0) === 0).map((n) => n.id)
    topoQueue.forEach((id) => rank.set(id, 0))

    const visitedCount = new Set<string>()
    while (topoQueue.length > 0) {
      const u = topoQueue.shift()!
      visitedCount.add(u)
      const currentRank = rank.get(u) ?? 0

      for (const v of dagAdj.get(u) || []) {
        rank.set(v, Math.max(rank.get(v) ?? 0, currentRank + 1))
        const remaining = (dagInDegree.get(v) ?? 1) - 1
        dagInDegree.set(v, remaining)
        if (remaining <= 0 && !visitedCount.has(v)) {
          topoQueue.push(v)
        }
      }
    }

    // Default any remaining unranked node
    comp.forEach((n) => {
      if (!rank.has(n.id)) rank.set(n.id, 0)
    })

    // C. Group Nodes by Rank Column
    const maxRank = Math.max(...Array.from(rank.values()), 0)
    const rankColumns: FlowNode[][] = Array.from({ length: maxRank + 1 }, () => [])
    comp.forEach((n) => {
      const r = rank.get(n.id) ?? 0
      rankColumns[r].push(n)
    })

    // D. Compute Column X Coordinates
    const columnWidths = rankColumns.map((col) =>
      Math.max(...col.map((n) => getNodeWidth(n.type)), 120)
    )

    const columnX: number[] = []
    let currX = baseX
    for (let r = 0; r <= maxRank; r++) {
      columnX[r] = currX
      currX += (columnWidths[r] || 120) + gapX
    }

    // E. Branch-Aware Y Coordinate Assignment
    // We estimate target Y based on parent's port direction:
    // - top slot -> upward lane offset
    // - bottom slot -> downward lane offset
    // - middle slot -> straight lane
    const targetY = new Map<string, number>()

    // Initialize root nodes with base Y
    const rootNodes = rankColumns[0] || []
    rootNodes.forEach((n, idx) => {
      targetY.set(n.id, currentFlowY + idx * 160)
    })

    for (let r = 0; r <= maxRank; r++) {
      const col = rankColumns[r]

      for (const node of col) {
        const incomingConns = compConns.filter(
          (c) => c.toId === node.id && !backEdges.has(`${c.fromId}->${c.toId}`)
        )

        if (incomingConns.length > 0) {
          // Barycentric calculation from parents with branch offsets
          let sumY = 0
          for (const c of incomingConns) {
            const parent = nodeMap.get(c.fromId)
            const parentY = targetY.get(c.fromId) ?? currentFlowY

            let slotOffset = 0
            if (c.fromPort) {
              const portLower = c.fromPort.toLowerCase()
              if (
                portLower.includes('top') ||
                c.fromPort === '2' ||
                c.fromPort === '5' ||
                c.fromPort === '9'
              ) {
                slotOffset = -140
              } else if (
                portLower.includes('bottom') ||
                portLower.includes('timeout') ||
                portLower.includes('dropped') ||
                c.fromPort === '3' ||
                c.fromPort === '6' ||
                c.fromPort === '10'
              ) {
                slotOffset = 140
              }
            } else if (parent && (parent.type === 'router' || parent.type === 'js')) {
              // If fromPort not set, default straight
              slotOffset = 0
            }

            sumY += parentY + slotOffset
          }

          const avgY = Math.round(sumY / incomingConns.length)
          targetY.set(node.id, avgY)
        }
      }

      // Order nodes in this column by targetY to minimize line crossings
      col.sort((a, b) => (targetY.get(a.id) ?? 0) - (targetY.get(b.id) ?? 0))

      // Collision avoidance & vertical packing
      let currentY = targetY.get(col[0]?.id) ?? currentFlowY
      for (let i = 0; i < col.length; i++) {
        const node = col[i]
        const desiredY = targetY.get(node.id) ?? currentY

        if (i === 0) {
          currentY = desiredY
        } else {
          const prevNode = col[i - 1]
          const prevH = getNodeHeight(prevNode)
          const minY = prevNode.y + prevH + gapY
          currentY = Math.max(desiredY, minY)
        }

        node.x = columnX[r]
        node.y = Math.round(currentY)
      }
    }

    // Determine vertical boundary of this component to position the next swimlane
    const compBottom = Math.max(...comp.map((n) => n.y + getNodeHeight(n)), currentFlowY + 100)
    currentFlowY = compBottom + flowGapY
  }

  return {
    ...graph,
    nodes
  }
}
