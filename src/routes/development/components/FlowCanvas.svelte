<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getYjsWorkspace, type UserPresence } from '../p2p/yjsWorkspace.js'
  import type {
    FlowGraph,
    FlowNode,
    FlowConnection,
    FlowNodeType,
    FlowNodeExecutionHistoryEntry,
    FlowNodePort,
    FlowNodeRouterRule,
    FlowNodeRouterData,
    FlowNodeTransformMapping,
    PortSlot
  } from '../flowTypes.js'
  import {
    executeJsSandbox,
    createDefaultFlowGraph,
    createAdvancedFlowGraph,
    serializeFlowFile,
    parseFlowFile,
    remapFlowGraphIds,
    createDefaultRouterPorts,
    createDefaultRouterRules,
    evaluateRouterRules,
    matchStatusPattern
  } from '../flowTypes.js'
  import {
    getOutputPortPoint,
    getInputPortPoint,
    getBezierPath as computeBezierPath,
    getBezierMidpoint,
    getNodeHeight,
    getNodeWidth,
    CARD_WIDTH,
    CIRCLE_SIZE
  } from '../flowGeometry.js'
  import { FLOW_NODE_REGISTRY, variantsOf, categoryOf } from '../flowNodeRegistry.js'
  import { applyMappings, flattenJsonPaths } from '../flowMapper.js'
  import NodeTypeSwitcher from './NodeTypeSwitcher.svelte'
  import CapturePathsTable from './CapturePathsTable.svelte'
  import CurlImportModal from './CurlImportModal.svelte'
  import {
    resolveVariables,
    parseHeadersText,
    withContentType,
    extractValueByPath,
    fetchWithProxy,
    parseQueryParams,
    buildUrlWithQuery,
    headersToRows,
    rowsToHeadersText,
    parseCurlCommand,
    buildCurlCommand,
    formatBytes,
    relativeTime,
    type HeaderRow
  } from '../requestsUtils.js'

  export let flowGraph: FlowGraph = { nodes: [], connections: [] }
  $: if (!flowGraph) {
    flowGraph = { nodes: [], connections: [] }
  } else {
    if (!flowGraph.nodes) flowGraph.nodes = []
    if (!flowGraph.connections) flowGraph.connections = []
  }
  export let environments: Record<string, Record<string, string>> = {}
  export let globalEnvironment: Record<string, string> = {}
  export let activeEnvName = ''
  export let globalProxy = ''
  export let onSaveGraph: ((graph: FlowGraph) => void) | undefined = undefined
  export let onOpenInEditor: ((title: string, text: string) => void) | undefined = undefined
  export let onManageEnvironments: (() => void) | undefined = undefined
  export let activeFlowName = ''
  export let activeGroupName = ''
  export let availableFlows: { id: string; name: string; groupName: string; graph?: FlowGraph }[] =
    []
  export let onSaveFlowToWorkspace: ((asNew: boolean) => void) | undefined = undefined

  // Execution state
  let flowRunning = false
  let flowStatusMessage = ''
  let toastMessage = ''
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer)
    toastMessage = msg
    toastTimer = setTimeout(() => {
      toastMessage = ''
    }, 2500)
  }

  // Dragging node state
  let draggingNodeId: string | null = null
  let dragStartX = 0
  let dragStartY = 0
  let nodeStartX = 0
  let nodeStartY = 0

  // Connecting arrow state
  let connectingFromId: string | null = null
  let connectingFromPortId: string | null = null
  let mouseX = 0
  let mouseY = 0

  // Zoom state
  let zoomLevel = 1.0

  function zoomIn() {
    zoomLevel = Math.min(2.5, Math.round((zoomLevel + 0.15) * 100) / 100)
  }

  function zoomOut() {
    zoomLevel = Math.max(0.3, Math.round((zoomLevel - 0.15) * 100) / 100)
  }

  function resetZoom() {
    zoomLevel = 1.0
  }

  function handleCanvasWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 0.88
      const next = Math.min(2.5, Math.max(0.3, zoomLevel * factor))
      zoomLevel = Math.round(next * 100) / 100
    }
  }

  const p2pWorkspace = getYjsWorkspace()
  let remotePresences: UserPresence[] = []
  let unsubPresence: (() => void) | null = null

  onMount(() => {
    if (canvasEl) {
      canvasEl.addEventListener('wheel', handleCanvasWheel, { passive: false })
    }
    unsubPresence = p2pWorkspace.subscribePresence((list) => {
      remotePresences = list
    })
    return () => {
      if (canvasEl) {
        canvasEl.removeEventListener('wheel', handleCanvasWheel)
      }
      if (unsubPresence) unsubPresence()
    }
  })

  // Selection & Side Panel Inspector State
  let selectedNodeId: string | null = null
  let selectedConnection: FlowConnection | null = null
  let activeCircleSwitcherId: string | null = null
  let activeCardSwitcherId: string | null = null

  function toggleCircleSwitcher(nodeId: string) {
    activeCardSwitcherId = null
    activeCircleSwitcherId = activeCircleSwitcherId === nodeId ? null : nodeId
  }

  function toggleCardSwitcher(nodeId: string) {
    activeCircleSwitcherId = null
    activeCardSwitcherId = activeCardSwitcherId === nodeId ? null : nodeId
  }

  let sidePanelWidth = 520
  let isResizingSidePanel = false
  let sidePanelTab:
    | 'params'
    | 'headers'
    | 'body'
    | 'auth'
    | 'captures'
    | 'env'
    | 'response'
    | 'script'
    | 'config'
    | 'rules'
    | 'ports' = 'params'

  // Header editing mode (table vs raw)
  let headersRawMode = false

  // cURL import popover
  let showCurlImport = false

  // Auth validation feedback
  let authValidationStatus: { ok: boolean; message: string } | null = null

  // Canvas pan / offset
  let canvasEl: HTMLDivElement | null = null

  $: activeEnv = activeEnvName ? (environments[activeEnvName] ?? {}) : {}
  $: selectedNode = flowGraph.nodes.find((n) => n.id === selectedNodeId) ?? null

  // Ensure default structures on selected node
  $: if (selectedNode) {
    if (selectedNode.type === 'rest' && selectedNode.restData) {
      if (!selectedNode.restData.queryParams) {
        selectedNode.restData.queryParams = parseQueryParams(selectedNode.restData.url)
      }
      if (!selectedNode.restData.headerRows) {
        selectedNode.restData.headerRows = headersToRows(selectedNode.restData.headers || '')
      }
      if (sidePanelTab === 'script' || sidePanelTab === 'rules' || sidePanelTab === 'ports') {
        sidePanelTab = 'params'
      }
    } else if (selectedNode.type === 'js' && selectedNode.jsData) {
      if (
        sidePanelTab !== 'script' &&
        sidePanelTab !== 'env' &&
        sidePanelTab !== 'response' &&
        sidePanelTab !== 'ports'
      ) {
        sidePanelTab = 'script'
      }
    } else if (selectedNode.type === 'router') {
      if (!selectedNode.routerData) {
        selectedNode.routerData = {
          mode: 'first-match',
          ports: createDefaultRouterPorts(),
          rules: createDefaultRouterRules()
        }
      }
      if (
        sidePanelTab !== 'rules' &&
        sidePanelTab !== 'ports' &&
        sidePanelTab !== 'response'
      ) {
        sidePanelTab = 'rules'
      }
    } else if (selectedNode.type === 'transform') {
      if (!selectedNode.transformData) {
        selectedNode.transformData = {
          sampleInput: '{\n  "id": 1,\n  "name": "Sample"\n}',
          mappings: []
        }
      }
      if (sidePanelTab !== 'config' && sidePanelTab !== 'response') {
        sidePanelTab = 'config'
      }
    } else if (selectedNode.type === 'loop') {
      if (!selectedNode.loopData) {
        selectedNode.loopData = {
          mode: 'for-each',
          arrayPath: 'items',
          itemVar: 'item',
          indexVar: 'index',
          repeatCount: 5,
          maxIterations: 1000
        }
      }
      if (!selectedNode.loopData.mode) selectedNode.loopData.mode = 'for-each'
      if (!selectedNode.loopData.indexVar) selectedNode.loopData.indexVar = 'index'
      if (!selectedNode.loopData.repeatCount) selectedNode.loopData.repeatCount = 5
      if (sidePanelTab !== 'config' && sidePanelTab !== 'response') {
        sidePanelTab = 'config'
      }
    } else if (selectedNode.type === 'delay') {
      if (!selectedNode.delayData) {
        selectedNode.delayData = {
          mode: 'delay',
          delayMs: 1000,
          ratePerSecond: 10
        }
      }
      if (sidePanelTab !== 'config' && sidePanelTab !== 'response') {
        sidePanelTab = 'config'
      }
    } else if (selectedNode.type === 'merge') {
      if (!selectedNode.mergeData) {
        selectedNode.mergeData = {
          strategy: 'wait-all',
          inputs: [
            { id: 'in_1', label: 'Branch 1', slot: 'middle', color: '#8b5cf6' },
            { id: 'in_2', label: 'Branch 2', slot: 'middle', color: '#8b5cf6' }
          ]
        }
      }
      if (sidePanelTab !== 'config' && sidePanelTab !== 'response') {
        sidePanelTab = 'config'
      }
    }
  }

  function notifyChange() {
    flowGraph = { ...flowGraph }
    if (onSaveGraph) {
      onSaveGraph(flowGraph)
    }
  }

  function switchNodeType(node: FlowNode, newType: FlowNodeType) {
    if (node.type === newType) {
      activeCardSwitcherId = null
      return
    }
    node.type = newType
    const def = FLOW_NODE_REGISTRY[newType]
    if (def) {
      const data = def.createData()
      if (data.jsData && !node.jsData) node.jsData = data.jsData
      if (data.transformData && !node.transformData) node.transformData = data.transformData
      if (data.routerData && !node.routerData) node.routerData = data.routerData
      if (data.loopData && !node.loopData) node.loopData = data.loopData
      if (data.delayData && !node.delayData) node.delayData = data.delayData
      if (data.mergeData && !node.mergeData) node.mergeData = data.mergeData
      if (data.eventData && !node.eventData) node.eventData = data.eventData
      node.title = def.defaultTitle
    }
    activeCardSwitcherId = null
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  // --- MULTI-PORT & ROUTER HELPERS ---
  function getNodePorts(node: FlowNode): FlowNodePort[] {
    if (node.type === 'router' && node.routerData?.ports) {
      return node.routerData.ports
    }
    if (node.type === 'js' && node.jsData?.ports && node.jsData.ports.length > 0) {
      return node.jsData.ports
    }
    const def = FLOW_NODE_REGISTRY[node.type]
    if (def) {
      return def.getOutputPorts(node)
    }
    return []
  }

  function isMultiPortNode(node: FlowNode): boolean {
    if (node.type === 'router' || node.type === 'loop' || node.type === 'delay' || node.type === 'merge') {
      return true
    }
    return node.type === 'js' && (node.jsData?.ports?.length ?? 0) > 0
  }

  function getLoopBodyNodes(loopNode: FlowNode): FlowNode[] {
    if (!loopNode || loopNode.type !== 'loop') return []

    // Outgoing connections from loopNode on 'item' port (or 'body', or not 'done')
    const startConns = flowGraph.connections.filter(
      (c) =>
        c.fromId === loopNode.id &&
        (c.fromPort === 'item' || c.fromPort === 'body' || (c.fromPort !== 'done' && !c.fromPort))
    )
    const startNodeIds = startConns.map((c) => c.toId)

    // Nodes strictly connected from 'done'
    const doneConns = flowGraph.connections.filter(
      (c) => c.fromId === loopNode.id && c.fromPort === 'done'
    )
    const doneNodeIds = new Set<string>(doneConns.map((c) => c.toId))

    const visited = new Set<string>()
    const queue = [...startNodeIds]
    const bodyNodes: FlowNode[] = []

    while (queue.length > 0) {
      const curId = queue.shift()!
      if (curId === loopNode.id || visited.has(curId) || doneNodeIds.has(curId)) {
        continue
      }
      visited.add(curId)
      const targetNode = flowGraph.nodes.find((n) => n.id === curId)
      if (targetNode) {
        bodyNodes.push(targetNode)
        const outConns = flowGraph.connections.filter((c) => c.fromId === curId)
        for (const oc of outConns) {
          if (oc.toId !== loopNode.id && !visited.has(oc.toId) && !doneNodeIds.has(oc.toId)) {
            queue.push(oc.toId)
          }
        }
      }
    }

    // Topological sort so execution order respects internal connections between body nodes
    const nodeMap = new Map<string, FlowNode>()
    bodyNodes.forEach((n) => nodeMap.set(n.id, n))
    const inDegree = new Map<string, number>()
    bodyNodes.forEach((n) => inDegree.set(n.id, 0))

    for (const c of flowGraph.connections) {
      if (nodeMap.has(c.fromId) && nodeMap.has(c.toId)) {
        inDegree.set(c.toId, (inDegree.get(c.toId) || 0) + 1)
      }
    }

    const sortQueue: FlowNode[] = []
    for (const n of bodyNodes) {
      if ((inDegree.get(n.id) || 0) === 0) {
        sortQueue.push(n)
      }
    }

    const sorted: FlowNode[] = []
    while (sortQueue.length > 0) {
      const cur = sortQueue.shift()!
      sorted.push(cur)
      for (const c of flowGraph.connections) {
        if (c.fromId === cur.id && nodeMap.has(c.toId)) {
          const nextId = c.toId
          const deg = (inDegree.get(nextId) || 0) - 1
          inDegree.set(nextId, deg)
          if (deg === 0) {
            sortQueue.push(nodeMap.get(nextId)!)
          }
        }
      }
    }

    for (const n of bodyNodes) {
      if (!sorted.includes(n)) sorted.push(n)
    }

    return sorted
  }

  function isLoopFeedbackConnection(conn: FlowConnection): boolean {
    const toNode = flowGraph.nodes.find((n) => n.id === conn.toId)
    if (!toNode || toNode.type !== 'loop') return false
    const bodyNodes = getLoopBodyNodes(toNode)
    return bodyNodes.some((bn) => bn.id === conn.fromId)
  }


  function canAddPortToSlot(ports: FlowNodePort[], slot: PortSlot): boolean {
    if (ports.length >= 10) return false
    const count = ports.filter((p) => p.slot === slot).length
    if (slot === 'top') return count < 3
    if (slot === 'middle') return count < 4
    if (slot === 'bottom') return count < 3
    return false
  }

  function addPortToNode(node: FlowNode, slot: PortSlot, customLabel?: string) {
    const ports = getNodePorts(node)
    if (!canAddPortToSlot(ports, slot)) {
      showToast(`Limit reached for slot "${slot}" (Max: ${slot === 'middle' ? 4 : 3}, Total 10)`)
      return
    }

    const slotCount = ports.filter((p) => p.slot === slot).length + 1
    const defaultColor = slot === 'top' ? '#10b981' : slot === 'middle' ? '#f59e0b' : '#ef4444'

    const usedSlots = new Set(
      ports.map((p) => p.slotIndex).filter((idx): idx is number => typeof idx === 'number')
    )
    const slotCandidates =
      slot === 'top' ? [2, 5, 9] : slot === 'middle' ? [1, 4, 7, 8] : [3, 6, 10]
    const assignedSlotIndex = slotCandidates.find((s) => !usedSlots.has(s))

    const newPort: FlowNodePort = {
      id: `port_${slot}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      slot,
      slotIndex: assignedSlotIndex,
      label: customLabel || `${slot.toUpperCase()} ${slotCount}`,
      color: defaultColor
    }

    if (node.type === 'router') {
      if (!node.routerData) {
        node.routerData = {
          mode: 'first-match',
          ports: createDefaultRouterPorts(),
          rules: createDefaultRouterRules()
        }
      }
      node.routerData.ports = [...node.routerData.ports, newPort]
    } else if (node.type === 'js') {
      if (!node.jsData) node.jsData = { code: '' }
      node.jsData.ports = [...(node.jsData.ports || []), newPort]
    }

    flowGraph = { ...flowGraph }
    notifyChange()
    showToast(`Added port to slot ${slot} (${ports.length + 1}/10)`)
  }

  function removePortFromNode(node: FlowNode, portId: string) {
    if (node.type === 'router' && node.routerData) {
      node.routerData.ports = node.routerData.ports.filter((p) => p.id !== portId)
      const remainingPortId = node.routerData.ports[0]?.id || ''
      node.routerData.rules.forEach((r) => {
        if (r.portId === portId) {
          r.portId = remainingPortId
        }
      })
    } else if (node.type === 'js' && node.jsData?.ports) {
      node.jsData.ports = node.jsData.ports.filter((p) => p.id !== portId)
    }

    flowGraph.connections = flowGraph.connections.filter(
      (c) => !(c.fromId === node.id && c.fromPort === portId)
    )

    flowGraph = { ...flowGraph }
    notifyChange()
    showToast('Port removed')
  }

  function addRuleToRouter(node: FlowNode) {
    if (node.type !== 'router' || !node.routerData) return
    const defaultPort = node.routerData.ports[0]?.id || 'port_top_1'
    const newRule: FlowNodeRouterRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      portId: defaultPort,
      label: `Rule ${node.routerData.rules.length + 1}`,
      type: 'status',
      statusPattern: '200-299'
    }
    node.routerData.rules = [...node.routerData.rules, newRule]
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  function removeRuleFromRouter(node: FlowNode, ruleId: string) {
    if (node.type !== 'router' || !node.routerData) return
    node.routerData.rules = node.routerData.rules.filter((r) => r.id !== ruleId)
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  function addTransformMapping(node: FlowNode) {
    if (!node.transformData) {
      node.transformData = { mappings: [], sampleInput: '{\n  "id": 1,\n  "name": "Sample"\n}' }
    }
    if (!node.transformData.mappings) {
      node.transformData.mappings = []
    }
    const newMapping: FlowNodeTransformMapping = {
      id: `map_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sourcePath: '',
      targetPath: '',
      modifier: 'direct',
      defaultValue: ''
    }
    node.transformData.mappings = [...node.transformData.mappings, newMapping]
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  function removeTransformMapping(node: FlowNode, mappingId: string) {
    if (!node.transformData?.mappings) return
    node.transformData.mappings = node.transformData.mappings.filter((m) => m.id !== mappingId)
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  function copyUpstreamJsonToTransform(node: FlowNode) {
    if (!node.transformData) return
    const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
    if (upConns.length > 0) {
      const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
      if (upNode?.lastRun?.responseText) {
        node.transformData.sampleInput = upNode.lastRun.responseText
        flowGraph = { ...flowGraph }
        notifyChange()
        showToast(`JSON copied from "${upNode.title || upNode.type}"!`)
        return
      }
    }
    showToast('No upstream node with an executed response.')
  }

  function getTransformAvailablePaths(node: FlowNode): string[] {
    if (!node || node.type !== 'transform' || !node.transformData) return []
    let rawJson = node.transformData.sampleInput?.trim()

    if (!rawJson) {
      const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
      if (upConns.length > 0) {
        const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
        if (upNode?.lastRun?.responseText) {
          rawJson = upNode.lastRun.responseText.trim()
        }
      }
    }

    if (!rawJson) return []
    try {
      const parsed = JSON.parse(rawJson)
      const paths: string[] = []
      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
          paths.push(...flattenJsonPaths(parsed[0]))
        }
        paths.push(...flattenJsonPaths(parsed))
      } else {
        paths.push(...flattenJsonPaths(parsed))
      }
      return Array.from(new Set(paths.filter(Boolean)))
    } catch {
      return []
    }
  }

  function autoMapDetectedFields(node: FlowNode, paths: string[]) {
    if (!node.transformData || paths.length === 0) return
    const primary = paths.filter((p) => !p.includes('[0]'))
    const toAdd = (primary.length > 0 ? primary : paths).slice(0, 30)
    node.transformData.mappings = toAdd.map((p, idx) => ({
      id: `map_${Date.now()}_${idx}`,
      sourcePath: p,
      targetPath: p.split('.').pop() || p,
      modifier: 'direct'
    }))
    flowGraph = { ...flowGraph }
    notifyChange()
    showToast(`${toAdd.length} fields mapped automatically!`)
  }

  let activePathDropdownMappingId: string | null = null
  let highlightedPathIndex = 0

  function openPathDropdown(mappingId: string) {
    activePathDropdownMappingId = mappingId
    highlightedPathIndex = 0
  }

  function togglePathDropdown(mappingId: string) {
    if (activePathDropdownMappingId === mappingId) {
      activePathDropdownMappingId = null
    } else {
      activePathDropdownMappingId = mappingId
      highlightedPathIndex = 0
    }
  }

  function closePathDropdown() {
    activePathDropdownMappingId = null
    highlightedPathIndex = 0
  }

  function getFilteredTransformPaths(allPaths: string[], query: string): string[] {
    if (!query || !query.trim()) return allPaths
    const q = query.trim().toLowerCase()
    return allPaths.filter((p) => p.toLowerCase().includes(q))
  }

  function selectTransformPath(mapping: FlowNodeTransformMapping, selectedPath: string) {
    mapping.sourcePath = selectedPath
    if (!mapping.targetPath || !mapping.targetPath.trim()) {
      const suggestedTarget = selectedPath.split('.').pop()?.replace(/\[\d+\]/g, '') || selectedPath
      mapping.targetPath = suggestedTarget
    }
    closePathDropdown()
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  function handlePathKeydown(
    e: KeyboardEvent,
    mapping: FlowNodeTransformMapping,
    allPaths: string[]
  ) {
    const filtered = getFilteredTransformPaths(allPaths, mapping.sourcePath)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (activePathDropdownMappingId !== mapping.id) {
        openPathDropdown(mapping.id)
      } else if (filtered.length > 0) {
        highlightedPathIndex = (highlightedPathIndex + 1) % filtered.length
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (activePathDropdownMappingId === mapping.id && filtered.length > 0) {
        highlightedPathIndex = (highlightedPathIndex - 1 + filtered.length) % filtered.length
      }
    } else if (e.key === 'Enter') {
      if (activePathDropdownMappingId === mapping.id) {
        e.preventDefault()
        if (filtered.length > 0) {
          const target = filtered[highlightedPathIndex] || filtered[0]
          if (target) {
            selectTransformPath(mapping, target)
          }
        } else {
          closePathDropdown()
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePathDropdown()
    }
  }

  function getLiveTransformPreview(node: FlowNode): string {
    if (!node.transformData) return '{}'
    let sample: unknown = {}
    if (node.transformData.sampleInput?.trim()) {
      try {
        sample = JSON.parse(node.transformData.sampleInput)
      } catch {
        sample = { raw: node.transformData.sampleInput }
      }
    }
    const result = applyMappings(sample, node.transformData.mappings || [])
    return JSON.stringify(result, null, 2)
  }

  interface LoopDetectedArray {
    path: string
    label: string
    length: number
    sampleItem?: unknown
  }

  interface LoopUpstreamInfo {
    connected: boolean
    upNode?: FlowNode
    executed: boolean
    rawPayload?: unknown
    detectedArrays: LoopDetectedArray[]
    currentEvaluation?: {
      isValid: boolean
      length: number
      errorMsg?: string
      sampleItem?: unknown
    }
  }

  function getLoopUpstreamInfo(node: FlowNode): LoopUpstreamInfo {
    if (!node || node.type !== 'loop') {
      return { connected: false, executed: false, detectedArrays: [] }
    }
    const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
    if (upConns.length === 0) {
      return { connected: false, executed: false, detectedArrays: [] }
    }
    const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
    if (!upNode) {
      return { connected: false, executed: false, detectedArrays: [] }
    }
    if (!upNode.lastRun?.responseText) {
      return { connected: true, upNode, executed: false, detectedArrays: [] }
    }

    let rawPayload: unknown = null
    try {
      rawPayload = JSON.parse(upNode.lastRun.responseText)
    } catch {
      rawPayload = upNode.lastRun.responseText
    }

    const detected: LoopDetectedArray[] = []
    function scan(val: unknown, prefix = '', depth = 0) {
      if (!val || depth > 4) return
      if (Array.isArray(val)) {
        detected.push({
          path: prefix,
          label: prefix ? `${prefix} (${val.length} items)` : `[ ] Root (${val.length} items)`,
          length: val.length,
          sampleItem: val[0]
        })
      } else if (typeof val === 'object') {
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          const p = prefix ? `${prefix}.${k}` : k
          if (Array.isArray(v)) {
            detected.push({
              path: p,
              label: `${p} (${v.length} items)`,
              length: v.length,
              sampleItem: v[0]
            })
          } else if (typeof v === 'object' && v !== null) {
            scan(v, p, depth + 1)
          }
        }
      }
    }
    scan(rawPayload)

    const arrayPath = node.loopData?.arrayPath !== undefined ? node.loopData.arrayPath.trim() : 'items'
    let currentEvaluation: LoopUpstreamInfo['currentEvaluation']
    if (rawPayload !== null && rawPayload !== undefined) {
      const extracted = extractValueByPath(rawPayload, arrayPath)
      if (Array.isArray(extracted)) {
        currentEvaluation = {
          isValid: true,
          length: extracted.length,
          sampleItem: extracted[0]
        }
      } else if (extracted !== undefined && extracted !== null) {
        currentEvaluation = {
          isValid: false,
          length: 0,
          errorMsg: `Path "${arrayPath || '[ ] Root'}" resolved to ${typeof extracted}, not an array.`
        }
      } else {
        currentEvaluation = {
          isValid: false,
          length: 0,
          errorMsg: `Path "${arrayPath}" not found in the payload of "${upNode.title}".`
        }
      }
    }

    return {
      connected: true,
      upNode,
      executed: true,
      rawPayload,
      detectedArrays: detected,
      currentEvaluation
    }
  }

  // --- NODE SELECTION ---
  function selectNode(node: FlowNode) {
    if (selectedNodeId !== node.id) {
      activeCircleSwitcherId = null
    }
    selectedNodeId = node.id
    authValidationStatus = null
    showCurlImport = false
    if (node.type === 'rest') {
      if (
        sidePanelTab === 'script' ||
        sidePanelTab === 'config' ||
        sidePanelTab === 'rules' ||
        sidePanelTab === 'ports'
      ) {
        sidePanelTab = 'params'
      }
    } else if (node.type === 'js') {
      if (
        sidePanelTab !== 'script' &&
        sidePanelTab !== 'env' &&
        sidePanelTab !== 'response' &&
        sidePanelTab !== 'ports'
      ) {
        sidePanelTab = 'script'
      }
    } else if (node.type === 'router') {
      if (
        sidePanelTab !== 'rules' &&
        sidePanelTab !== 'ports' &&
        sidePanelTab !== 'response'
      ) {
        sidePanelTab = 'rules'
      }
    } else {
      sidePanelTab = 'config'
    }
  }

  function closeSidePanel() {
    selectedNodeId = null
    activeCircleSwitcherId = null
    showCurlImport = false
  }

  // --- RESIZE SIDE PANEL ---
  function startSideResize(e: MouseEvent) {
    e.preventDefault()
    isResizingSidePanel = true
    const startX = e.clientX
    const startWidth = sidePanelWidth

    const onMouseMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX
      sidePanelWidth = Math.max(360, Math.min(840, startWidth + dx))
    }

    const onMouseUp = () => {
      isResizingSidePanel = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  let newlyConnectedConnId: string | null = null

  // --- NODE DRAG & DROP ---
  function onNodePointerDown(e: PointerEvent | MouseEvent, node: FlowNode) {
    if (draggingNodeId === node.id) return
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button, input, select, textarea, .node-port, .node-quick-btn')) return

    if (!newlyConnectedConnId) {
      selectedConnection = null
    }
    selectNode(node)

    draggingNodeId = node.id
    dragStartX = e.clientX
    dragStartY = e.clientY
    nodeStartX = node.x
    nodeStartY = node.y

    const onPointerMove = (ev: PointerEvent | MouseEvent) => {
      if (!draggingNodeId) return
      const dx = (ev.clientX - dragStartX) / zoomLevel
      const dy = (ev.clientY - dragStartY) / zoomLevel
      const n = flowGraph.nodes.find((item) => item.id === draggingNodeId)
      if (n) {
        n.x = Math.max(20, Math.round(nodeStartX + dx))
        n.y = Math.max(20, Math.round(nodeStartY + dy))
        flowGraph = { ...flowGraph }
      }
    }

    const onPointerUp = () => {
      draggingNodeId = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
      notifyChange()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
  }

  // --- CONNECTING NODES ---
  function startConnect(e: MouseEvent, fromId: string, fromPortId?: string) {
    e.stopPropagation()
    connectingFromId = fromId
    connectingFromPortId = fromPortId || null
    updateMousePos(e)

    const onMouseMove = (ev: MouseEvent) => {
      updateMousePos(ev)
    }

    const onMouseUp = () => {
      setTimeout(() => {
        connectingFromId = null
        connectingFromPortId = null
      }, 60)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  let lastCursorBroadcast = 0
  function updateMousePos(e: MouseEvent) {
    if (!canvasEl) return
    const rect = canvasEl.getBoundingClientRect()
    mouseX = (e.clientX - rect.left + canvasEl.scrollLeft) / zoomLevel
    mouseY = (e.clientY - rect.top + canvasEl.scrollTop) / zoomLevel

    const now = Date.now()
    if (now - lastCursorBroadcast > 40) {
      lastCursorBroadcast = now
      p2pWorkspace.updateLocalAwareness({
        cursor: { x: Math.round(mouseX), y: Math.round(mouseY) },
        activeNodeId: selectedNodeId || undefined
      })
    }
  }

  function endConnect(toId: string, toPortId?: string) {
    if (!connectingFromId || connectingFromId === toId) {
      connectingFromId = null
      connectingFromPortId = null
      return
    }

    const fromId = connectingFromId
    const fromPort = connectingFromPortId || undefined
    const toPort = toPortId || undefined
    connectingFromId = null
    connectingFromPortId = null

    const toNode = flowGraph.nodes.find((n) => n.id === toId)
    if (toNode?.type === 'start') return
    const fromNode = flowGraph.nodes.find((n) => n.id === fromId)
    if (fromNode?.type === 'terminate') return

    const exists = flowGraph.connections.find(
      (c) =>
        c.fromId === fromId &&
        c.toId === toId &&
        c.fromPort === fromPort &&
        c.toPort === toPort
    )
    if (!exists) {
      const newConn: FlowConnection = {
        id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fromId,
        toId,
        fromPort,
        toPort,
        kind: 'solid'
      }
      flowGraph.connections = [...flowGraph.connections, newConn]
      selectedConnection = newConn
      newlyConnectedConnId = newConn.id
      setTimeout(() => {
        newlyConnectedConnId = null
      }, 500)
      notifyChange()
    } else {
      selectedConnection = exists
      newlyConnectedConnId = exists.id
      setTimeout(() => {
        newlyConnectedConnId = null
      }, 500)
    }
  }

  function selectConnection(conn: FlowConnection) {
    if (selectedConnection?.id === conn.id) {
      toggleConnectionKind(conn)
    } else {
      selectedConnection = conn
    }
  }

  function onCanvasClick(e: MouseEvent) {
    if (newlyConnectedConnId) return
    const target = e.target as HTMLElement
    if (
      target === canvasEl ||
      target.classList.contains('flow-zoom-container') ||
      target.classList.contains('flow-svg-layer')
    ) {
      selectedConnection = null
      activeCircleSwitcherId = null
      activeCardSwitcherId = null
    }
  }

  function setConnectionKind(conn: FlowConnection, kind: 'solid' | 'dotted') {
    conn.kind = kind
    flowGraph.connections = [...flowGraph.connections]
    if (selectedConnection?.id === conn.id) selectedConnection = conn
    notifyChange()
  }

  function toggleConnectionKind(conn: FlowConnection) {
    conn.kind = conn.kind === 'solid' ? 'dotted' : 'solid'
    flowGraph.connections = [...flowGraph.connections]
    if (selectedConnection?.id === conn.id) selectedConnection = conn
    notifyChange()
  }

  function removeConnection(connId: string) {
    flowGraph.connections = flowGraph.connections.filter((c) => c.id !== connId)
    selectedConnection = null
    notifyChange()
  }

  // --- ADD / REMOVE NODES ---
  function addNodeAt(type: FlowNodeType, x: number, y: number) {
    const def = FLOW_NODE_REGISTRY[type]
    const defaultTitle = def?.defaultTitle || 'New Block'

    const newNode: FlowNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      title: defaultTitle,
      x,
      y,
      status: 'idle',
      history: []
    }

    if (type === 'rest') {
      newNode.restData = {
        method: 'GET',
        url: 'https://rickandmortyapi.com/api/character',
        queryParams: parseQueryParams('https://rickandmortyapi.com/api/character'),
        headers: 'Accept: application/json',
        headerRows: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: '',
        bodyType: 'none',
        proxyMode: 'inherit',
        authType: 'inherit',
        captures: []
      }
    } else if (type === 'js') {
      newNode.jsData = {
        code: `// JavaScript script with dynamic multi-port routing\n// Use out('port_id', data) or route('port_id') to activate specific output ports\nconst charId = pm.environment.get('charId') || 1;\nif (Number(charId) > 0) {\n  pm.environment.set('isValid', 'true');\n  console.log('Successfully validated:', charId);\n}\n`,
        ports: []
      }
    } else if (type === 'transform') {
      newNode.transformData = {
        sampleInput: '{\n  "id": 1,\n  "name": "Sample"\n}',
        mappings: []
      }
    } else if (type === 'router') {
      newNode.routerData = {
        mode: 'first-match',
        ports: createDefaultRouterPorts(),
        rules: createDefaultRouterRules()
      }
    } else if (type === 'loop') {
      newNode.loopData = {
        mode: 'for-each',
        arrayPath: 'items',
        itemVar: 'item',
        indexVar: 'index',
        repeatCount: 5,
        maxIterations: 1000
      }
    } else if (type === 'delay') {
      newNode.delayData = {
        mode: 'delay',
        delayMs: 1500,
        ratePerSecond: 10
      }
    } else if (type === 'merge') {
      newNode.mergeData = {
        strategy: 'wait-all',
        inputs: [
          { id: 'in_1', label: 'Branch 1', slot: 'middle', color: '#8b5cf6' },
          { id: 'in_2', label: 'Branch 2', slot: 'middle', color: '#8b5cf6' }
        ]
      }
    } else if (type === 'event-throw' || type === 'event-catch') {
      newNode.eventData = {
        eventName: 'valida total'
      }
    }

    flowGraph.nodes = [...flowGraph.nodes, newNode]
    selectNode(newNode)
    if (isCircleNode(newNode.type)) {
      activeCircleSwitcherId = newNode.id
    }
    notifyChange()
    return newNode
  }

  function addNode(type: FlowNodeType) {
    const offset = flowGraph.nodes.length * 40
    return addNodeAt(type, 100 + (offset % 300), 100 + (offset % 200))
  }

  // Drag-and-drop of new blocks from toolbar onto spatial canvas
  let draggingNewBlockType: FlowNodeType | null = null

  function onNewBlockDragStart(e: DragEvent, type: FlowNodeType) {
    draggingNewBlockType = type
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/x-flow-node-type', type)
      e.dataTransfer.setData('text/plain', type)
      e.dataTransfer.effectAllowed = 'copy'
    }
  }

  function onNewBlockDragEnd() {
    draggingNewBlockType = null
  }

  function onCanvasDragOver(e: DragEvent) {
    if (
      draggingNewBlockType ||
      e.dataTransfer?.types.includes('application/x-flow-node-type') ||
      e.dataTransfer?.types.includes('text/plain')
    ) {
      e.preventDefault()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
    }
  }

  const VALID_NODE_TYPES: FlowNodeType[] = [
    'rest',
    'js',
    'transform',
    'router',
    'loop',
    'delay',
    'merge',
    'start',
    'terminate',
    'event-throw',
    'event-catch'
  ]

  function onCanvasDrop(e: DragEvent) {
    const rawType = (e.dataTransfer?.getData('application/x-flow-node-type') ||
      e.dataTransfer?.getData('text/plain') ||
      draggingNewBlockType) as FlowNodeType | undefined

    if (rawType && VALID_NODE_TYPES.includes(rawType)) {
      e.preventDefault()
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect()
        const dropX = Math.round((e.clientX - rect.left + canvasEl.scrollLeft) / zoomLevel)
        const dropY = Math.round((e.clientY - rect.top + canvasEl.scrollTop) / zoomLevel)
        const isCircle = isCircleNode(rawType)
        const finalX = Math.max(20, dropX - (isCircle ? 27 : 140))
        const finalY = Math.max(20, dropY - (isCircle ? 27 : rawType === 'router' ? 120 : 45))
        addNodeAt(rawType, finalX, finalY)
      } else {
        addNode(rawType)
      }
    }
    draggingNewBlockType = null
  }

  function deleteNode(nodeId: string) {
    flowGraph.nodes = flowGraph.nodes.filter((n) => n.id !== nodeId)
    flowGraph.connections = flowGraph.connections.filter(
      (c) => c.fromId !== nodeId && c.toId !== nodeId
    )
    if (selectedNodeId === nodeId) {
      selectedNodeId = null
    }
    if (activeCircleSwitcherId === nodeId) {
      activeCircleSwitcherId = null
    }
    notifyChange()
  }

  function setCircleNodeType(node: FlowNode, newType: FlowNodeType) {
    if (node.type === newType) {
      activeCircleSwitcherId = null
      return
    }
    node.type = newType
    if (newType === 'start') {
      node.title = 'Start'
    } else if (newType === 'terminate') {
      node.title = 'End of Flow'
    } else if (newType === 'event-throw') {
      if (!node.eventData) node.eventData = { eventName: 'valida total' }
      node.title = `Jump: ${node.eventData.eventName || 'valida total'}`
    } else if (newType === 'event-catch') {
      if (!node.eventData) node.eventData = { eventName: 'valida total' }
      node.title = `Receiver: ${node.eventData.eventName || 'valida total'}`
    }
    activeCircleSwitcherId = null
    flowGraph = { ...flowGraph }
    notifyChange()
  }

  function autoLayout() {
    if (!flowGraph.nodes.length) return

    const CARD_W = 280
    const CARD_H = 140
    const CIRCLE_SIZE = 54
    const GAP_CARD = 50
    const GAP_CIRCLE = 40
    const ROW_HEIGHT = 180
    const MAX_ROW_WIDTH = 960

    const inDegree: Record<string, number> = {}
    const adj: Record<string, string[]> = {}

    flowGraph.nodes.forEach((n) => {
      inDegree[n.id] = 0
      adj[n.id] = []
    })

    flowGraph.connections.forEach((c) => {
      if (inDegree[c.toId] !== undefined) inDegree[c.toId]++
      if (adj[c.fromId]) adj[c.fromId].push(c.toId)
    })

    // Implicit wireless connection between throw and catch with matching eventName
    flowGraph.nodes.forEach((n) => {
      if (n.type === 'event-catch' && n.eventData?.eventName) {
        const targetEvt = n.eventData.eventName.trim().toLowerCase()
        const matchingThrow = flowGraph.nodes.find(
          (t) =>
            t.type === 'event-throw' && t.eventData?.eventName?.trim().toLowerCase() === targetEvt
        )
        if (matchingThrow && !adj[matchingThrow.id].includes(n.id)) {
          adj[matchingThrow.id].push(n.id)
          inDegree[n.id]++
        }
      }
    })

    const levels: Record<string, number> = {}
    const queue = flowGraph.nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id)

    queue.forEach((id) => {
      levels[id] = 0
    })

    const visited = new Set<string>()
    while (queue.length > 0) {
      const u = queue.shift()!
      visited.add(u)
      const currentLevel = levels[u] ?? 0
      for (const v of adj[u] ?? []) {
        levels[v] = Math.max(levels[v] ?? 0, currentLevel + 1)
        inDegree[v]--
        if (inDegree[v] === 0) {
          queue.push(v)
        }
      }
    }

    flowGraph.nodes.forEach((n) => {
      if (!visited.has(n.id)) {
        levels[n.id] = 0
      }
    })

    // Sort nodes topologically by level
    const maxLevel = Math.max(...Object.values(levels), 0)
    const orderedNodes: FlowNode[] = []
    for (let l = 0; l <= maxLevel; l++) {
      const nodesAtL = flowGraph.nodes.filter((n) => (levels[n.id] ?? 0) === l)
      orderedNodes.push(...nodesAtL)
    }

    // Smart multi-row packing layout with centered vertical alignment
    let currentRow = 0
    let currentX = 60
    const startY = 80

    orderedNodes.forEach((node, index) => {
      const w = getNodeWidth(node.type)
      const gap = isCircleNode(node.type) ? GAP_CIRCLE : GAP_CARD

      // Break to next row if:
      // 1. It is an event-catch node and previous nodes exist (wireless jump starts next row)
      // 2. OR currentX + w > MAX_ROW_WIDTH and there is already content on this row
      const shouldBreakRow =
        index > 0 &&
        ((node.type === 'event-catch' && currentX > 200) ||
          (currentX + w > MAX_ROW_WIDTH && currentX > 300))

      if (shouldBreakRow) {
        currentRow++
        currentX = 60
      }

      const rowCenterY = startY + currentRow * ROW_HEIGHT + CARD_H / 2
      node.x = Math.round(currentX)
      node.y = Math.round(rowCenterY - getNodeHeight(node) / 2)

      currentX += w + gap
    })

    flowGraph = { ...flowGraph }
    notifyChange()
    showToast('Auto layout arranged successfully!')
  }

  function resetToExample(exampleIndex: 1 | 2 = 1) {
    const isAdvanced = exampleIndex === 2
    const flowTitle = isAdvanced
      ? 'Example 2: Advanced Flow (Router + Multi-Ports + JSON Mapper)'
      : 'Example 1: Linear Flow (REST + Script + Event Jump)'

    if (flowGraph.nodes.length > 0) {
      if (!confirm(`Replace the current canvas with ${flowTitle}?`)) {
        return
      }
    }
    if (!environments['Rick & Morty']) {
      environments['Rick & Morty'] = {
        baseUrl: 'https://rickandmortyapi.com/api',
        charId: '1',
        episodeName: 'Pilot',
        customHeader: 'RickMorty-Verified'
      }
      environments = { ...environments }
    }
    if (!activeEnvName) {
      activeEnvName = 'Rick & Morty'
    }
    flowGraph = isAdvanced ? createAdvancedFlowGraph() : createDefaultFlowGraph()
    selectedNodeId = flowGraph.nodes[0]?.id ?? null
    selectedConnection = null
    notifyChange()
    showToast(`${flowTitle} loaded successfully!`)
  }

  function clearAll() {
    if (flowGraph.nodes.length > 0) {
      if (!confirm('Clear all blocks from canvas? This cannot be undone.')) {
        return
      }
    }
    flowGraph = { nodes: [], connections: [] }
    selectedNodeId = null
    selectedConnection = null
    notifyChange()
    showToast('Flow cleared!')
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      if (onSaveFlowToWorkspace) {
        e.preventDefault()
        onSaveFlowToWorkspace(false)
      }
    }
  }

  // --- FLOW FILE: open / save / import / export ---
  type FilePickerWindow = Window & {
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>
  }
  const FLOW_PICKER_TYPES = [
    { description: 'Spatial Flow (JSON)', accept: { 'application/json': ['.json'] } }
  ]
  let flowFileName = ''
  let flowFileHandle: FileSystemFileHandle | null = null
  let flowFileInput: HTMLInputElement | undefined
  let flowFileInputMode: 'open' | 'import' = 'open'
  let fileMenuOpen = false
  let examplesMenuOpen = false

  function runFileAction(action: () => void | Promise<void>) {
    fileMenuOpen = false
    examplesMenuOpen = false
    void action()
  }

  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function applyLoadedFlow(text: string, mode: 'open' | 'import', name: string) {
    try {
      const parsed = parseFlowFile(text)
      if (mode === 'open') {
        flowGraph = parsed
        selectedNodeId = null
        selectedConnection = null
        flowFileName = name
        notifyChange()
        showToast(`Opened "${name}" (${parsed.nodes.length} blocks)`)
      } else {
        const maxY = flowGraph.nodes.reduce((m, n) => Math.max(m, n.y), 0)
        const minY = parsed.nodes.reduce((m, n) => Math.min(m, n.y), Infinity)
        const remapped = remapFlowGraphIds(
          parsed,
          0,
          flowGraph.nodes.length ? maxY + 160 - (Number.isFinite(minY) ? minY : 0) : 0
        )
        flowGraph = {
          nodes: [...flowGraph.nodes, ...remapped.nodes],
          connections: [...flowGraph.connections, ...remapped.connections]
        }
        notifyChange()
        showToast(`Imported ${remapped.nodes.length} blocks from "${name}"`)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read flow file')
    }
  }

  async function pickAndLoad(mode: 'open' | 'import') {
    const w = window as FilePickerWindow
    if (w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({ types: FLOW_PICKER_TYPES })
        const file = await handle.getFile()
        applyLoadedFlow(await file.text(), mode, file.name)
        if (mode === 'open') flowFileHandle = handle
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') showToast('Could not open file')
      }
      return
    }
    flowFileInputMode = mode
    flowFileInput?.click()
  }

  function openFlowFile() {
    void pickAndLoad('open')
  }

  function importFlowFile() {
    void pickAndLoad('import')
  }

  async function onFlowFileInputChange() {
    const file = flowFileInput?.files?.[0]
    if (!file) return
    applyLoadedFlow(await file.text(), flowFileInputMode, file.name)
    if (flowFileInput) flowFileInput.value = ''
  }

  function exportFlowFile() {
    const name = (flowFileName || 'spatial-flow.json').replace(/(\.json)?$/i, '.json')
    downloadText(name, serializeFlowFile(flowGraph))
    showToast(`Exported ${name}`)
  }

  async function saveFlowFile(saveAs: boolean) {
    const text = serializeFlowFile(flowGraph)
    const w = window as FilePickerWindow
    if (!w.showSaveFilePicker) {
      exportFlowFile()
      return
    }
    try {
      let handle = flowFileHandle
      if (!handle || saveAs) {
        handle = await w.showSaveFilePicker({
          suggestedName: flowFileName || 'spatial-flow.json',
          types: FLOW_PICKER_TYPES
        })
        flowFileHandle = handle
        flowFileName = handle.name
      }
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      showToast(`Saved ${handle.name}`)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') showToast('Could not save file')
    }
  }

  // --- QUERY PARAMS SYNC ---
  function onParamsChanged() {
    if (!selectedNode || !selectedNode.restData) return
    const params = selectedNode.restData.queryParams || []
    selectedNode.restData.url = buildUrlWithQuery(selectedNode.restData.url, params)
    notifyChange()
  }

  function onUrlInputChanged() {
    if (!selectedNode || !selectedNode.restData) return
    selectedNode.restData.queryParams = parseQueryParams(selectedNode.restData.url)
    notifyChange()
  }

  function addParam() {
    if (!selectedNode || !selectedNode.restData) return
    const params = selectedNode.restData.queryParams || []
    selectedNode.restData.queryParams = [...params, { key: '', value: '', enabled: true }]
    onParamsChanged()
  }

  function removeParam(index: number) {
    if (!selectedNode || !selectedNode.restData) return
    selectedNode.restData.queryParams = (selectedNode.restData.queryParams || []).filter(
      (_, i) => i !== index
    )
    onParamsChanged()
  }

  // --- HEADERS SYNC ---
  function onHeaderRowsChanged() {
    if (!selectedNode || !selectedNode.restData) return
    const rows = selectedNode.restData.headerRows || []
    selectedNode.restData.headers = rowsToHeadersText(rows)
    notifyChange()
  }

  function onRawHeadersChanged() {
    if (!selectedNode || !selectedNode.restData) return
    selectedNode.restData.headerRows = headersToRows(selectedNode.restData.headers || '')
    notifyChange()
  }

  function addHeaderRow() {
    if (!selectedNode || !selectedNode.restData) return
    const rows = selectedNode.restData.headerRows || []
    selectedNode.restData.headerRows = [...rows, { key: '', value: '', enabled: true }]
    onHeaderRowsChanged()
  }

  function removeHeaderRow(index: number) {
    if (!selectedNode || !selectedNode.restData) return
    selectedNode.restData.headerRows = (selectedNode.restData.headerRows || []).filter(
      (_, i) => i !== index
    )
    onHeaderRowsChanged()
  }

  function addHeaderPreset(key: string, value: string) {
    if (!selectedNode || !selectedNode.restData) return
    const rows = selectedNode.restData.headerRows || []
    const existing = rows.find((r) => r.key.toLowerCase() === key.toLowerCase())
    if (existing) {
      existing.value = value
      existing.enabled = true
    } else {
      selectedNode.restData.headerRows = [...rows, { key, value, enabled: true }]
    }
    onHeaderRowsChanged()
    showToast(`Header "${key}" added`)
  }

  // --- CURL IMPORT & EXPORT (Requirement 3) ---
  function copyNodeCurl(node: FlowNode) {
    if (!node.restData) return
    const rest = node.restData
    const headersList: HeaderRow[] = []

    if (rest.headerRows && rest.headerRows.length > 0) {
      for (const r of rest.headerRows) {
        if ((r.enabled ?? true) && r.key.trim()) {
          headersList.push({ key: r.key.trim(), value: r.value, enabled: true })
        }
      }
    }

    if (headersList.length === 0 && rest.headers && rest.headers.trim()) {
      for (const [k, v] of Object.entries(parseHeadersText(rest.headers))) {
        headersList.push({ key: k, value: v, enabled: true })
      }
    }

    const curl = buildCurlCommand({
      method: rest.method,
      url: rest.url,
      headers: headersList,
      body: rest.body,
      bodyType: rest.bodyType,
      auth:
        rest.authType && rest.authType !== 'inherit' && rest.authType !== 'none'
          ? {
              type: rest.authType,
              bearerToken: rest.authBearerToken,
              basicUser: rest.authBasicUser,
              basicPass: rest.authBasicPass,
              apiKeyName: rest.authApiKeyName,
              apiKeyValue: rest.authApiKeyValue
            }
          : undefined
    })

    navigator.clipboard.writeText(curl)
    showToast('cURL copied to clipboard! 📋')
  }

  function importCurlIntoNode(curlImportText: string) {
    if (!selectedNode || !selectedNode.restData || !curlImportText.trim()) return
    const parsed = parseCurlCommand(curlImportText)
    if (!parsed) {
      showToast('Invalid cURL command. Please check the text.')
      return
    }

    selectedNode.restData.method = parsed.method
    selectedNode.restData.url = parsed.url
    selectedNode.restData.queryParams = parsed.params
    selectedNode.restData.headerRows = parsed.headerRows
    selectedNode.restData.headers = rowsToHeadersText(parsed.headerRows)
    selectedNode.restData.body = parsed.body || ''
    selectedNode.restData.bodyType =
      parsed.bodyType === 'json' ? 'json' : parsed.bodyType === 'none' ? 'none' : 'text'

    if (parsed.auth) {
      if (parsed.auth.type === 'bearer') {
        selectedNode.restData.authType = 'bearer'
        selectedNode.restData.authBearerToken = parsed.auth.token ?? ''
      } else if (parsed.auth.type === 'basic') {
        selectedNode.restData.authType = 'basic'
        selectedNode.restData.authBasicUser = parsed.auth.username ?? ''
        selectedNode.restData.authBasicPass = parsed.auth.password ?? ''
      }
    }

    const segments = parsed.url.split('?')[0].split('/').filter(Boolean)
    const namePart = segments.pop() || 'Request'
    selectedNode.title = `${parsed.method} ${namePart}`

    showCurlImport = false
    notifyChange()
    showToast('cURL imported into block successfully! 🌐')
  }

  // --- JSON BODY ACTIONS (Requirement 7) ---
  function formatNodeJsonBody() {
    if (!selectedNode || !selectedNode.restData) return
    try {
      const parsed = JSON.parse(selectedNode.restData.body)
      selectedNode.restData.body = JSON.stringify(parsed, null, 2)
      notifyChange()
      showToast('JSON formatted!')
    } catch {
      showToast('Invalid JSON, cannot format.')
    }
  }

  function openBodyInEditor() {
    if (!selectedNode || !selectedNode.restData || !onOpenInEditor) return
    const title = `${selectedNode.title || 'request'} (Body)`
    onOpenInEditor(title, selectedNode.restData.body)
    showToast('JSON body opened in Editor!')
  }

  // --- OPEN RESPONSE IN EDITOR (Level 2 Tab Title = Block's Name) ---
  function openResponseInEditor(node: FlowNode, entry?: FlowNodeExecutionHistoryEntry) {
    if (!onOpenInEditor) return
    const responseText = entry?.responseText ?? node.lastRun?.responseText
    if (!responseText) {
      showToast('No response recorded to open.')
      return
    }

    const statusPart = entry?.status ?? node.lastRun?.status
    const title = statusPart
      ? `${node.title || 'Block'} (${statusPart})`
      : `${node.title || 'Block'} (Response)`

    onOpenInEditor(title, responseText)
    showToast(`Response from "${node.title}" opened in Editor! ⚡`)
  }

  // --- AUTH REVALIDATION ---
  function validateNodeAuth() {
    if (!selectedNode || !selectedNode.restData) return
    const rest = selectedNode.restData
    if (rest.authType === 'none') {
      authValidationStatus = { ok: true, message: 'Authentication disabled (None)' }
      return
    }
    if (rest.authType === 'inherit') {
      authValidationStatus = { ok: true, message: 'Inheriting global project authentication' }
      return
    }

    let authStr = ''
    if (rest.authType === 'bearer') authStr = rest.authBearerToken || ''
    else if (rest.authType === 'basic')
      authStr = `${rest.authBasicUser || ''} ${rest.authBasicPass || ''}`
    else if (rest.authType === 'apikey')
      authStr = `${rest.authApiKeyName || ''} ${rest.authApiKeyValue || ''}`

    const resolved = resolveVariables(authStr, activeEnv, globalEnvironment)
    if (resolved.missing.length > 0) {
      authValidationStatus = {
        ok: false,
        message: `Missing variables: ${resolved.missing.map((v) => `{{${v}}}`).join(', ')}`
      }
    } else {
      authValidationStatus = {
        ok: true,
        message: 'Authentication variables resolved successfully! ✓'
      }
    }
  }

  // --- JS SNIPPETS ---
  function insertJsSnippet(snippet: string) {
    if (!selectedNode || !selectedNode.jsData) return
    selectedNode.jsData.code = (selectedNode.jsData.code || '') + '\n' + snippet
    notifyChange()
    showToast('Snippet inserted!')
  }

  // --- SUB-FLOW RUNNER (Executes sub-flow nodes, captures logs and outputs) ---
  async function runSubFlow(
    targetFlowId: string,
    targetFlowName: string,
    eventName: string,
    initialEnv: Record<string, string>,
    initialPayload?: unknown
  ): Promise<{
    success: boolean
    durationMs: number
    logs: string[]
    responseText: string
    updatedEnv: Record<string, string>
  }> {
    const subStart = performance.now()
    let subSuccess = true
    const subLogs: string[] = [`Sub-flow started: ${targetFlowName}`]
    let subLastResp = ''
    let subEnv = { ...initialEnv }

    const targetInfo = availableFlows.find((f) => f.id === targetFlowId)
    if (!targetInfo || !targetInfo.graph?.nodes?.length) {
      subLogs.push(`Sub-flow "${targetFlowName}" (ID: ${targetFlowId}) not found or has no nodes.`)
      return {
        success: false,
        durationMs: Math.round(performance.now() - subStart),
        logs: subLogs,
        responseText: JSON.stringify({ error: 'Sub-flow graph not found' }, null, 2),
        updatedEnv: subEnv
      }
    }

    try {
      const graph = targetInfo.graph
      const evLower = (eventName || '').trim().toLowerCase()

      // Find receptor nodes (event-catch) matching this event name in target flow
      const matchingReceptors = evLower
        ? graph.nodes.filter(
            (sn) =>
              sn.type === 'event-catch' &&
              (sn.eventData?.eventName || '').trim().toLowerCase() === evLower
          )
        : []

      let nodesToExecute = graph.nodes
      if (matchingReceptors.length > 0) {
        subLogs.push(
          `Found ${matchingReceptors.length} receiver(s) (Catch) for event "${eventName}" in "${targetFlowName}".`
        )
        const reachable = new Set<string>()
        const queue = matchingReceptors.map((r) => r.id)
        while (queue.length > 0) {
          const curId = queue.shift()!
          const outConns = (graph.connections || []).filter((c) => c.fromId === curId)
          for (const c of outConns) {
            if (!reachable.has(c.toId)) {
              reachable.add(c.toId)
              queue.push(c.toId)
            }
          }
        }
        if (reachable.size > 0) {
          nodesToExecute = graph.nodes.filter((n) => reachable.has(n.id))
        }
      } else if (evLower) {
        subLogs.push(
          `No receiver with event "${eventName}" in "${targetFlowName}". Executing default flow.`
        )
      }

      for (const subNode of nodesToExecute) {
        if (subNode.type === 'rest' && subNode.restData) {
          const resUrl = resolveVariables(subNode.restData.url, subEnv, globalEnvironment).resolved
          if (resUrl) {
            try {
              let subProxyToUse = globalProxy
              if (subNode.restData.proxyMode === 'direct') subProxyToUse = ''
              else if (subNode.restData.proxyMode === 'corsproxy')
                subProxyToUse = 'https://corsproxy.io/?url={url}'
              else if (subNode.restData.proxyMode === 'allorigins')
                subProxyToUse = 'https://api.allorigins.win/raw?url={url}'
              else if (subNode.restData.proxyMode === 'custom' && subNode.restData.customProxyUrl)
                subProxyToUse = subNode.restData.customProxyUrl

              const rawHeaders = subNode.restData.headerRows
                ? rowsToHeadersText(subNode.restData.headerRows)
                : subNode.restData.headers || ''
              const resolvedHeaders = resolveVariables(rawHeaders, subEnv, globalEnvironment).resolved
              const resolvedBody = resolveVariables(subNode.restData.body || '', subEnv, globalEnvironment).resolved

              const hasBody =
                subNode.restData.bodyType !== 'none' &&
                !['GET', 'HEAD'].includes(subNode.restData.method)
              const bodyPayload = hasBody ? resolvedBody : undefined
              const contentType =
                subNode.restData.bodyType === 'text' ? 'text/plain' : 'application/json'

              const { res } = await fetchWithProxy(
                resUrl,
                {
                  method: subNode.restData.method || 'GET',
                  headers: withContentType(
                    parseHeadersText(resolvedHeaders),
                    bodyPayload,
                    contentType
                  ),
                  body: bodyPayload
                },
                subProxyToUse
              )
              subLastResp = await res.text()
              subLogs.push(`REST ${subNode.restData.method} ${resUrl}: HTTP ${res.status}`)

              if (subNode.restData.captures?.length) {
                try {
                  const jsonRes = JSON.parse(subLastResp)
                  for (const rule of subNode.restData.captures) {
                    if (!rule.enabled || !rule.path.trim()) continue
                    const val = extractValueByPath(jsonRes, rule.path.trim())
                    if (val !== undefined && rule.name.trim()) {
                      subEnv[rule.name.trim()] = String(val)
                      subLogs.push(`Captured: ${rule.name}=${String(val).slice(0, 20)}`)
                    }
                  }
                } catch {
                  // non-json
                }
              }
            } catch (e) {
              subLogs.push(`REST error: ${(e as Error).message}`)
            }
          }
        } else if (subNode.type === 'js' && subNode.jsData) {
          let jsInputPayload: unknown = null
          if (subLastResp) {
            try {
              jsInputPayload = JSON.parse(subLastResp)
            } catch {
              jsInputPayload = subLastResp
            }
          } else {
            jsInputPayload = initialPayload
          }
          const jsRes = executeJsSandbox(subNode.jsData.code, subEnv, globalEnvironment, {
            ports: subNode.jsData.ports,
            payload: jsInputPayload
          })
          if (jsRes.success) {
            subEnv = { ...subEnv, ...jsRes.updatedEnv }
            globalEnvironment = { ...globalEnvironment, ...jsRes.updatedGlobalEnv }
            if (jsRes.logs?.length) subLogs.push(...jsRes.logs)
            subLastResp = JSON.stringify(jsRes.updatedEnv, null, 2)
          } else {
            subSuccess = false
            if (jsRes.logs?.length) subLogs.push(...jsRes.logs)
            subLogs.push(`JS error: ${jsRes.error || 'Execution failed'}`)
          }
        } else if (subNode.type === 'transform' && subNode.transformData) {
          let transformInput: unknown = null
          if (subLastResp) {
            try {
              transformInput = JSON.parse(subLastResp)
            } catch {
              transformInput = subLastResp
            }
          } else {
            transformInput = initialPayload
          }
          const mapped = applyMappings(transformInput || {}, subNode.transformData.mappings || [])
          subLastResp = JSON.stringify(mapped, null, 2)
          if (subNode.transformData.saveToEnvVar) {
            subEnv[subNode.transformData.saveToEnvVar] = subLastResp
          }
          subLogs.push(
            `Transform: ${(subNode.transformData.mappings || []).length} fields mapped`
          )
        } else if (subNode.type === 'delay' && subNode.delayData) {
          const dMs = Math.min(subNode.delayData.delayMs || 1000, 3000)
          await new Promise((r) => setTimeout(r, dMs))
          subLogs.push(`Delay: paused for ${dMs}ms`)
        }
      }
    } catch (err) {
      subSuccess = false
      subLogs.push(`Error executing sub-flow: ${(err as Error).message}`)
    }

    const durationMs = Math.round(performance.now() - subStart)
    return {
      success: subSuccess,
      durationMs,
      logs: subLogs,
      responseText:
        subLastResp || JSON.stringify({ subFlow: targetFlowName, durationMs }, null, 2),
      updatedEnv: subEnv
    }
  }

  // --- LOOP ITERATOR ENGINE (Executes loop body N times, captures logs) ---
  async function executeLoopNode(
    node: FlowNode,
    currentEnv: Record<string, string>,
    isPartOfFlow: boolean = false,
    completedNodes?: Set<string>,
    activeNodePorts?: Map<string, Set<string>>
  ): Promise<Record<string, string>> {
    const started = performance.now()
    const upConns = flowGraph.connections.filter(
      (c) => c.toId === node.id && !isLoopFeedbackConnection(c)
    )
    let inputPayload: unknown = null
    if (upConns.length > 0) {
      const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
      if (upNode?.lastRun?.responseText) {
        try {
          inputPayload = JSON.parse(upNode.lastRun.responseText)
        } catch {
          inputPayload = upNode.lastRun.responseText
        }
      }
    }

    const mode = node.loopData?.mode || 'for-each'
    let items: unknown[] = []
    let arrayPath = node.loopData?.arrayPath !== undefined ? node.loopData.arrayPath.trim() : 'items'

    if (mode === 'count') {
      const count = Math.min(
        Math.max(1, Number(node.loopData?.repeatCount) || 5),
        node.loopData?.maxIterations || 1000
      )
      items = Array.from({ length: count }, (_, i) => ({ index: i, count: i + 1 }))
      arrayPath = `[Counter 0..${count - 1}]`
    } else {
      const arr = extractValueByPath(inputPayload || {}, arrayPath)
      items = Array.isArray(arr) ? arr : arr !== undefined ? [arr] : [inputPayload]
    }

    const max = node.loopData?.maxIterations || 1000
    const processed = items.slice(0, max)

    const itemVar = node.loopData?.itemVar || 'item'
    const indexVar = node.loopData?.indexVar || 'index'
    const delayMs = Math.min(Math.max(0, Number(node.loopData?.delayMs) || 0), 5000)

    const bodyNodes = getLoopBodyNodes(node)
    const bodyNodeLogs = new Map<string, string[]>()
    bodyNodes.forEach((bn) => bodyNodeLogs.set(bn.id, []))
    const loopLogs: string[] = []

    for (let iter = 0; iter < processed.length; iter++) {
      const currentItem = processed[iter]

      // 1. Injected iteration variables
      if (typeof currentItem === 'object' && currentItem !== null) {
        currentEnv[itemVar] = JSON.stringify(currentItem)
        for (const [prop, val] of Object.entries(currentItem)) {
          currentEnv[`${itemVar}.${prop}`] =
            typeof val === 'object' ? JSON.stringify(val) : String(val)
        }
      } else {
        currentEnv[itemVar] = String(currentItem)
      }

      currentEnv[indexVar] = String(iter)
      currentEnv['loop_index'] = String(iter)
      currentEnv['loop_total'] = String(processed.length)

      if (activeEnvName) {
        environments[activeEnvName] = { ...currentEnv }
        environments = { ...environments }
      }

      loopLogs.push(
        `[Iter #${iter + 1}/${processed.length}] ${indexVar}=${iter}, ${itemVar}=${typeof currentItem === 'object' ? JSON.stringify(currentItem).slice(0, 50) : currentItem}`
      )

      if (delayMs > 0 && iter > 0) {
        await new Promise((r) => setTimeout(r, delayMs))
      }

      // 2. Execute each body block
      for (const bNode of bodyNodes) {
        bNode.status = 'running'
        flowGraph = { ...flowGraph }
        const bStart = performance.now()

        try {
          if (bNode.type === 'js' && bNode.jsData) {
            const res = executeJsSandbox(bNode.jsData.code, currentEnv, globalEnvironment, {
              ports: bNode.jsData.ports,
              payload: currentItem
            })
            const bDuration = Math.round(performance.now() - bStart)
            if (res.success) {
              currentEnv = { ...currentEnv, ...res.updatedEnv }
              globalEnvironment = { ...globalEnvironment, ...res.updatedGlobalEnv }
              if (activeEnvName) {
                environments[activeEnvName] = { ...currentEnv }
                environments = { ...environments }
              }
              bNode.status = 'success'
              const iterLogs =
                res.logs.length > 0
                  ? res.logs.map((l) => `[Iter #${iter + 1}] ${l}`)
                  : [`[Iter #${iter + 1}] Executed successfully`]
              const cumLogs = bodyNodeLogs.get(bNode.id)!
              cumLogs.push(...iterLogs)

              bNode.lastRun = {
                durationMs: bDuration,
                status: 'OK',
                outputSummary: `Iter ${iter + 1}/${processed.length}: ${res.logs[res.logs.length - 1] || 'OK'}`,
                timestamp: Date.now(),
                logs: [...cumLogs],
                responseText: JSON.stringify(res.updatedEnv, null, 2)
              }
              const historyItem: FlowNodeExecutionHistoryEntry = {
                id: `${bNode.id}_iter_${iter}_${Date.now()}`,
                timestamp: Date.now(),
                status: 'OK',
                durationMs: bDuration,
                logs: iterLogs,
                responseText: bNode.lastRun.responseText
              }
              bNode.history = [historyItem, ...(bNode.history || []).slice(0, 4)]
            } else {
              bNode.status = 'error'
              const iterLogs =
                res.logs.length > 0
                  ? res.logs.map((l) => `[Iter #${iter + 1}] ${l}`)
                  : []
              iterLogs.push(`[Iter #${iter + 1}] [ERROR] ${res.error}`)
              const cumLogs = bodyNodeLogs.get(bNode.id)!
              cumLogs.push(...iterLogs)

              bNode.lastRun = {
                durationMs: bDuration,
                status: 'ERROR',
                error: res.error,
                outputSummary: `Iter ${iter + 1}/${processed.length} failed: ${res.error}`,
                timestamp: Date.now(),
                logs: [...cumLogs]
              }
              const historyItem: FlowNodeExecutionHistoryEntry = {
                id: `${bNode.id}_iter_${iter}_${Date.now()}`,
                timestamp: Date.now(),
                status: 'ERROR',
                durationMs: bDuration,
                error: res.error,
                logs: iterLogs
              }
              bNode.history = [historyItem, ...(bNode.history || []).slice(0, 4)]
            }
          } else if (bNode.type === 'rest' && bNode.restData) {
            const rest = bNode.restData
            const resolvedUrl = resolveVariables(rest.url, currentEnv, globalEnvironment).resolved
            const headersStr = rest.headerRows ? rowsToHeadersText(rest.headerRows) : rest.headers
            const resolvedHeaders = resolveVariables(headersStr, currentEnv, globalEnvironment).resolved
            const resolvedBody = resolveVariables(rest.body, currentEnv, globalEnvironment).resolved

            let proxyToUse = globalProxy
            if (rest.proxyMode === 'direct') proxyToUse = ''
            else if (rest.proxyMode === 'corsproxy') proxyToUse = 'https://corsproxy.io/?url={url}'
            else if (rest.proxyMode === 'allorigins')
              proxyToUse = 'https://api.allorigins.win/raw?url={url}'
            else if (rest.proxyMode === 'custom' && rest.customProxyUrl)
              proxyToUse = rest.customProxyUrl

            const hasBody = rest.bodyType !== 'none' && !['GET', 'HEAD'].includes(rest.method)
            const bodyPayload = hasBody ? resolvedBody : undefined
            const contentType = rest.bodyType === 'text' ? 'text/plain' : 'application/json'

            const headersObj = withContentType(
              parseHeadersText(resolvedHeaders),
              bodyPayload,
              contentType
            )

            const { res, viaProxy } = await fetchWithProxy(
              resolvedUrl,
              { method: rest.method, headers: headersObj, body: bodyPayload },
              proxyToUse
            )
            const text = await res.text()
            const bDuration = Math.round(performance.now() - bStart)
            const sizeBytes = new Blob([text]).size

            const capturedNames: string[] = []
            if (rest.captures && rest.captures.length > 0) {
              try {
                const jsonRes: unknown = JSON.parse(text)
                for (const rule of rest.captures) {
                  if (!rule.enabled || !rule.path.trim()) continue
                  const val = extractValueByPath(jsonRes, rule.path.trim())
                  if (val !== undefined && rule.name.trim()) {
                    currentEnv[rule.name.trim()] = String(val)
                    capturedNames.push(`${rule.name}=${String(val).slice(0, 15)}`)
                  }
                }
              } catch {
                // Non-JSON
              }
            }

            if (activeEnvName) {
              environments[activeEnvName] = { ...currentEnv }
              environments = { ...environments }
            }

            const iterLog = `[Iter #${iter + 1}] ${rest.method} ${resolvedUrl} -> HTTP ${res.status} (${bDuration}ms)`
            const cumLogs = bodyNodeLogs.get(bNode.id)!
            cumLogs.push(iterLog)
            if (capturedNames.length > 0) {
              cumLogs.push(`  Capturou: ${capturedNames.join(', ')}`)
            }

            bNode.status = res.status < 400 ? 'success' : 'error'
            bNode.lastRun = {
              durationMs: bDuration,
              status: res.status,
              outputSummary: `Iter ${iter + 1}/${processed.length}: HTTP ${res.status}`,
              timestamp: Date.now(),
              responseText: text,
              sizeBytes,
              viaProxy,
              logs: [...cumLogs]
            }

            const historyItem: FlowNodeExecutionHistoryEntry = {
              id: `${bNode.id}_iter_${iter}_${Date.now()}`,
              timestamp: Date.now(),
              status: res.status,
              durationMs: bDuration,
              responseText: text,
              sizeBytes,
              viaProxy,
              logs: [iterLog]
            }
            bNode.history = [historyItem, ...(bNode.history || []).slice(0, 4)]
          } else if (bNode.type === 'transform') {
            const mapped = applyMappings(currentItem || {}, bNode.transformData?.mappings || [])
            const responseText = JSON.stringify(mapped, null, 2)
            if (bNode.transformData?.saveToEnvVar) {
              currentEnv[bNode.transformData.saveToEnvVar] = responseText
              if (activeEnvName) {
                environments[activeEnvName] = { ...currentEnv }
                environments = { ...environments }
              }
            }
            const bDuration = Math.round(performance.now() - bStart)
            bNode.status = 'success'
            const iterLog = `[Iter #${iter + 1}] ${(bNode.transformData?.mappings || []).length} fields mapped`
            const cumLogs = bodyNodeLogs.get(bNode.id)!
            cumLogs.push(iterLog)

            bNode.lastRun = {
              durationMs: bDuration,
              status: 200,
              outputSummary: `Iter ${iter + 1}/${processed.length}: ${(bNode.transformData?.mappings || []).length} fields mapped`,
              timestamp: Date.now(),
              responseText,
              logs: [...cumLogs]
            }
            const historyItem: FlowNodeExecutionHistoryEntry = {
              id: `${bNode.id}_iter_${iter}_${Date.now()}`,
              timestamp: Date.now(),
              status: 200,
              durationMs: bDuration,
              responseText,
              logs: [iterLog]
            }
            bNode.history = [historyItem, ...(bNode.history || []).slice(0, 4)]
          } else if (bNode.type === 'delay') {
            const bDelay = Math.min(bNode.delayData?.delayMs || 1000, 3000)
            await new Promise((r) => setTimeout(r, bDelay))
            const bDuration = Math.round(performance.now() - bStart)
            bNode.status = 'success'
            const iterLog = `[Iter #${iter + 1}] Paused for ${bDelay}ms`
            const cumLogs = bodyNodeLogs.get(bNode.id)!
            cumLogs.push(iterLog)
            bNode.lastRun = {
              durationMs: bDuration,
              status: 'DELAY_DONE',
              outputSummary: `Iter ${iter + 1}/${processed.length}: Paused ${bDelay}ms`,
              timestamp: Date.now(),
              responseText: JSON.stringify({ delayedMs: bDelay }, null, 2),
              logs: [...cumLogs]
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          bNode.status = 'error'
          bNode.lastRun = {
            durationMs: Math.round(performance.now() - bStart),
            status: 'ERROR',
            error: msg,
            outputSummary: `Iter ${iter + 1}/${processed.length} failed: ${msg}`,
            timestamp: Date.now(),
            logs: [...(bodyNodeLogs.get(bNode.id) || []), `[Iter #${iter + 1}] Exception: ${msg}`]
          }
        }
      }

      await new Promise((r) => setTimeout(r, 10))
      flowGraph = { ...flowGraph }
    }

    // Set cumulative summaries on body nodes
    for (const bNode of bodyNodes) {
      const cumLogs = bodyNodeLogs.get(bNode.id) || []
      if (bNode.lastRun) {
        bNode.lastRun.outputSummary = `Loop finished: ${processed.length} iterations executed (${cumLogs.length} logs)`
        bNode.lastRun.logs = cumLogs
      }
      if (bNode.status !== 'error') {
        bNode.status = 'success'
      }
    }

    const durationMs = Math.round(performance.now() - started)
    const loopResult = {
      mode,
      arrayPath,
      totalItems: items.length,
      processedCount: processed.length,
      items: processed,
      bodyBlocks: bodyNodes.length
    }
    const responseText = JSON.stringify(loopResult, null, 2)
    node.status = 'success'
    node.lastRun = {
      durationMs,
      status: 'LOOP_DONE',
      outputSummary:
        mode === 'count'
          ? `Repeated ${processed.length} times (${bodyNodes.length} body block${bodyNodes.length === 1 ? '' : 's'})`
          : `Iterated ${processed.length} items of "${arrayPath || '[ ] Root'}" (${bodyNodes.length} body block${bodyNodes.length === 1 ? '' : 's'})`,
      timestamp: Date.now(),
      logs: loopLogs,
      responseText
    }
    const historyItem: FlowNodeExecutionHistoryEntry = {
      id: String(Date.now()),
      timestamp: Date.now(),
      status: 'LOOP_DONE',
      durationMs,
      logs: loopLogs,
      responseText
    }
    node.history = [historyItem, ...(node.history || []).slice(0, 4)]

    if (isPartOfFlow) {
      if (completedNodes) {
        completedNodes.add(node.id)
        bodyNodes.forEach((bn) => completedNodes.add(bn.id))
      }
      if (activeNodePorts) {
        activeNodePorts.set(node.id, new Set(['done']))
      }
    }

    flowGraph = { ...flowGraph }
    notifyChange()
    return currentEnv
  }

  // --- SINGLE NODE EXECUTION (Max 5 history items) ---
  async function executeSingleNode(node: FlowNode) {
    if (node.status === 'running') return
    node.status = 'running'
    flowGraph = { ...flowGraph }

    const started = performance.now()
    let currentEnv = { ...activeEnv }

    try {
      if (node.type === 'rest' && node.restData) {
        const rest = node.restData
        const resolvedUrl = resolveVariables(rest.url, currentEnv, globalEnvironment).resolved
        const headersStr = rest.headerRows ? rowsToHeadersText(rest.headerRows) : rest.headers
        const resolvedHeaders = resolveVariables(headersStr, currentEnv, globalEnvironment).resolved
        const resolvedBody = resolveVariables(rest.body, currentEnv, globalEnvironment).resolved

        let proxyToUse = globalProxy
        if (rest.proxyMode === 'direct') proxyToUse = ''
        else if (rest.proxyMode === 'corsproxy') proxyToUse = 'https://corsproxy.io/?url={url}'
        else if (rest.proxyMode === 'allorigins')
          proxyToUse = 'https://api.allorigins.win/raw?url={url}'
        else if (rest.proxyMode === 'custom' && rest.customProxyUrl)
          proxyToUse = rest.customProxyUrl

        const hasBody = rest.bodyType !== 'none' && !['GET', 'HEAD'].includes(rest.method)
        const bodyPayload = hasBody ? resolvedBody : undefined
        const contentType = rest.bodyType === 'text' ? 'text/plain' : 'application/json'

        const headersObj = withContentType(
          parseHeadersText(resolvedHeaders),
          bodyPayload,
          contentType
        )

        const { res, viaProxy } = await fetchWithProxy(
          resolvedUrl,
          { method: rest.method, headers: headersObj, body: bodyPayload },
          proxyToUse
        )
        const text = await res.text()
        const durationMs = Math.round(performance.now() - started)
        const sizeBytes = new Blob([text]).size

        // Captures
        const capturedNames: string[] = []
        if (rest.captures && rest.captures.length > 0) {
          try {
            const jsonRes: unknown = JSON.parse(text)
            for (const rule of rest.captures) {
              if (!rule.enabled || !rule.path.trim()) continue
              const val = extractValueByPath(jsonRes, rule.path.trim())
              if (val !== undefined && rule.name.trim()) {
                currentEnv[rule.name.trim()] = String(val)
                capturedNames.push(`${rule.name}=${String(val).slice(0, 15)}`)
              }
            }
          } catch {
            // Non-JSON
          }
        }

        node.status = res.status < 400 ? 'success' : 'error'
        node.lastRun = {
          durationMs,
          status: res.status,
          outputSummary:
            capturedNames.length > 0
              ? `Capturou: ${capturedNames.join(', ')}`
              : `Status ${res.status}`,
          timestamp: Date.now(),
          responseText: text,
          sizeBytes,
          viaProxy
        }

        const historyItem: FlowNodeExecutionHistoryEntry = {
          id: String(Date.now()),
          timestamp: Date.now(),
          status: res.status,
          durationMs,
          responseText: text,
          sizeBytes,
          viaProxy
        }
        // Strict limit of 5 history items
        node.history = [historyItem, ...(node.history || []).slice(0, 4)]

        if (activeEnvName) {
          environments[activeEnvName] = { ...currentEnv }
          environments = { ...environments }
        }

        showToast(`Block finished with status ${res.status} (${durationMs}ms)`)
      } else if (node.type === 'js' && node.jsData) {
        const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
        let upstreamPayload: unknown = null
        if (upConns.length > 0) {
          const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
          if (upNode?.lastRun?.responseText) {
            try {
              upstreamPayload = JSON.parse(upNode.lastRun.responseText)
            } catch {
              upstreamPayload = upNode.lastRun.responseText
            }
          }
        }
        const res = executeJsSandbox(node.jsData.code, currentEnv, globalEnvironment, {
          ports: node.jsData.ports,
          payload: upstreamPayload
        })
        const durationMs = Math.round(performance.now() - started)

        if (res.success) {
          currentEnv = { ...currentEnv, ...res.updatedEnv }
          globalEnvironment = { ...globalEnvironment, ...res.updatedGlobalEnv }
          node.status = 'success'
          node.lastRun = {
            durationMs,
            status: 'OK',
            outputSummary: res.logs.length > 0 ? res.logs[res.logs.length - 1] : 'Script completed',
            timestamp: Date.now(),
            logs: res.logs,
            responseText: JSON.stringify(res.updatedEnv, null, 2)
          }
          const historyItem: FlowNodeExecutionHistoryEntry = {
            id: String(Date.now()),
            timestamp: Date.now(),
            status: 'OK',
            durationMs,
            logs: res.logs,
            responseText: JSON.stringify(res.updatedEnv, null, 2)
          }
          // Strict limit of 5 history items
          node.history = [historyItem, ...(node.history || []).slice(0, 4)]

          if (activeEnvName) {
            environments[activeEnvName] = { ...currentEnv }
            environments = { ...environments }
          }
          showToast('JS script executed successfully!')
        } else {
          node.status = 'error'
          node.lastRun = {
            durationMs,
            status: 'ERROR',
            error: res.error,
            outputSummary: res.error ?? 'Execution failed',
            timestamp: Date.now(),
            logs: res.logs
          }
          showToast(`Script error: ${res.error}`)
        }
      } else if (node.type === 'router' && node.routerData) {
        // Collect upstream response/status if available
        const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
        let upstreamPayload: unknown = null
        let upstreamStatus = 200
        if (upConns.length > 0) {
          const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
          if (upNode?.lastRun) {
            if (typeof upNode.lastRun.status === 'number') {
              upstreamStatus = upNode.lastRun.status
            }
            if (upNode.lastRun.responseText) {
              try {
                upstreamPayload = JSON.parse(upNode.lastRun.responseText)
              } catch {
                upstreamPayload = upNode.lastRun.responseText
              }
            }
          }
        }

        const res = evaluateRouterRules(
          node.routerData.rules || [],
          node.routerData.mode || 'first-match',
          upstreamPayload,
          upstreamStatus
        )
        const durationMs = Math.round(performance.now() - started)
        const hasMatches = res.matchedPortIds.length > 0
        node.status = hasMatches ? 'success' : 'error'

        const portSummary = res.matchedRules
          .map((r) => {
            const port = node.routerData?.ports.find((p) => p.id === r.portId)
            return `${port?.label || r.portId} (${r.label})`
          })
          .join(', ')

        node.lastRun = {
          durationMs,
          status: hasMatches ? 'ROUTED' : 'NO_ROUTE',
          outputSummary: hasMatches ? `Routed: ${portSummary}` : 'No matching rule',
          timestamp: Date.now(),
          responseText: JSON.stringify(
            {
              upstreamStatus,
              matchedPorts: res.matchedPortIds,
              matchedRules: res.matchedRules
            },
            null,
            2
          )
        }

        const historyItem: FlowNodeExecutionHistoryEntry = {
          id: String(Date.now()),
          timestamp: Date.now(),
          status: hasMatches ? 200 : 404,
          durationMs,
          responseText: node.lastRun.responseText
        }
        node.history = [historyItem, ...(node.history || []).slice(0, 4)]
        showToast(hasMatches ? `Router evaluated: ${portSummary}` : 'Router: no rule matched')
      } else if (node.type === 'start') {
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'START',
          outputSummary: 'Start point ready',
          timestamp: Date.now()
        }
        showToast('Start point triggered!')
      } else if (node.type === 'terminate') {
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'TERMINATED',
          outputSummary: 'Execution finished',
          timestamp: Date.now()
        }
        showToast('Terminate block executed!')
      } else if (node.type === 'event-throw') {
        const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
        let upstreamPayload: unknown = null
        if (upConns.length > 0) {
          const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
          if (upNode?.lastRun?.responseText) {
            try {
              upstreamPayload = JSON.parse(upNode.lastRun.responseText)
            } catch {
              upstreamPayload = upNode.lastRun.responseText
            }
          }
        }

        const ev = node.eventData?.eventName || ''
        if (node.eventData?.targetFlowId) {
          const targetName = node.eventData.targetFlowName || 'Sub-Flow'
          showToast(`Executing sub-flow "${targetName}"...`)
          const subRes = await runSubFlow(
            node.eventData.targetFlowId,
            targetName,
            ev,
            currentEnv,
            upstreamPayload
          )
          currentEnv = { ...currentEnv, ...subRes.updatedEnv }
          if (activeEnvName) {
            environments[activeEnvName] = { ...currentEnv }
            environments = { ...environments }
          }
          node.status = subRes.success ? 'success' : 'error'
          node.lastRun = {
            durationMs: subRes.durationMs,
            status: subRes.success ? 'SUBFLOW_OK' : 'SUBFLOW_ERROR',
            outputSummary: `Sub-flow "${targetName}" executed (${subRes.durationMs}ms)`,
            responseText: subRes.responseText,
            logs: subRes.logs,
            timestamp: Date.now()
          }
          const historyItem: FlowNodeExecutionHistoryEntry = {
            id: `sub-${Date.now()}`,
            timestamp: Date.now(),
            status: subRes.success ? 200 : 500,
            durationMs: subRes.durationMs,
            responseText: subRes.responseText,
            logs: subRes.logs
          }
          node.history = [historyItem, ...(node.history || []).slice(0, 4)]
          showToast(`Sub-flow "${targetName}" finished (${subRes.durationMs}ms)`)
        } else {
          node.status = 'success'
          const respText = upstreamPayload
            ? typeof upstreamPayload === 'string'
              ? upstreamPayload
              : JSON.stringify(upstreamPayload, null, 2)
            : ''
          node.lastRun = {
            durationMs: 0,
            status: 'EVENT_THROWN',
            outputSummary: `Triggered: "${ev || 'event'}"`,
            timestamp: Date.now(),
            responseText: respText
          }
          const historyItem: FlowNodeExecutionHistoryEntry = {
            id: String(Date.now()),
            timestamp: Date.now(),
            status: 'EVENT_THROWN',
            durationMs: 0,
            responseText: respText
          }
          node.history = [historyItem, ...(node.history || []).slice(0, 4)]
          showToast(`Event triggered: "${ev || 'event'}"`)
        }
      } else if (node.type === 'event-catch') {
        const ev = node.eventData?.eventName || 'valida total'
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'EVENT_CAUGHT',
          outputSummary: `Received: "${ev}"`,
          timestamp: Date.now()
        }
        showToast(`Event received: "${ev}"`)
      } else if (node.type === 'transform') {
        const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
        let inputPayload: unknown = null
        if (upConns.length > 0) {
          const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
          if (upNode?.lastRun?.responseText) {
            try {
              inputPayload = JSON.parse(upNode.lastRun.responseText)
            } catch {
              inputPayload = upNode.lastRun.responseText
            }
          }
        }
        if (!inputPayload && node.transformData?.sampleInput) {
          try {
            inputPayload = JSON.parse(node.transformData.sampleInput)
          } catch {
            inputPayload = node.transformData.sampleInput
          }
        }
        const mapped = applyMappings(inputPayload || {}, node.transformData?.mappings || [])
        const responseText = JSON.stringify(mapped, null, 2)
        if (node.transformData?.saveToEnvVar) {
          currentEnv[node.transformData.saveToEnvVar] = responseText
          if (activeEnvName) {
            environments[activeEnvName] = { ...currentEnv }
            environments = { ...environments }
          }
        }
        const durationMs = Math.round(performance.now() - started)
        node.status = 'success'
        node.lastRun = {
          durationMs,
          status: 200,
          outputSummary: `${(node.transformData?.mappings || []).length} fields mapped`,
          timestamp: Date.now(),
          responseText
        }
        const historyItem: FlowNodeExecutionHistoryEntry = {
          id: String(Date.now()),
          timestamp: Date.now(),
          status: 200,
          durationMs,
          responseText
        }
        node.history = [historyItem, ...(node.history || []).slice(0, 4)]
        showToast(`Mapping completed (${(node.transformData?.mappings || []).length} fields)`)
      } else if (node.type === 'loop') {
        currentEnv = await executeLoopNode(node, currentEnv, false)
        showToast(`Loop: ${node.lastRun?.outputSummary || 'Completed'}`)
      } else if (node.type === 'delay') {
        const delayMs = Math.min(node.delayData?.delayMs || 1000, 3000)
        await new Promise((r) => setTimeout(r, delayMs))

        const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
        let upstreamText = ''
        if (upConns.length > 0) {
          const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
          if (upNode?.lastRun?.responseText) {
            upstreamText = upNode.lastRun.responseText
          }
        }
        const durationMs = Math.round(performance.now() - started)
        node.status = 'success'
        node.lastRun = {
          durationMs,
          status: 'DELAY_DONE',
          outputSummary: `Paused for ${delayMs}ms`,
          timestamp: Date.now(),
          responseText: upstreamText || JSON.stringify({ delayedMs: delayMs }, null, 2)
        }
        const historyItem: FlowNodeExecutionHistoryEntry = {
          id: String(Date.now()),
          timestamp: Date.now(),
          status: 'DELAY_DONE',
          durationMs,
          responseText: node.lastRun.responseText
        }
        node.history = [historyItem, ...(node.history || []).slice(0, 4)]
        showToast(`Delay of ${delayMs}ms finished`)
      } else if (node.type === 'merge') {
        const incomingConns = flowGraph.connections.filter((c) => c.toId === node.id)
        const branchResults: Record<string, unknown> = {}
        for (let idx = 0; idx < incomingConns.length; idx++) {
          const conn = incomingConns[idx]
          const fromNode = flowGraph.nodes.find((n) => n.id === conn.fromId)
          const branchKey = conn.toPort || fromNode?.title || `branch_${idx + 1}`
          if (fromNode?.lastRun?.responseText) {
            try {
              branchResults[branchKey] = JSON.parse(fromNode.lastRun.responseText)
            } catch {
              branchResults[branchKey] = fromNode.lastRun.responseText
            }
          } else {
            branchResults[branchKey] = null
          }
        }

        const mergedPayload = {
          mergedAt: Date.now(),
          strategy: node.mergeData?.strategy || 'wait-all',
          branchesCount: incomingConns.length,
          results: branchResults
        }
        const responseText = JSON.stringify(mergedPayload, null, 2)
        const durationMs = Math.round(performance.now() - started)
        node.status = 'success'
        node.lastRun = {
          durationMs,
          status: 'MERGED',
          outputSummary: `${incomingConns.length} branches merged`,
          timestamp: Date.now(),
          responseText
        }
        const historyItem: FlowNodeExecutionHistoryEntry = {
          id: String(Date.now()),
          timestamp: Date.now(),
          status: 'MERGED',
          durationMs,
          responseText
        }
        node.history = [historyItem, ...(node.history || []).slice(0, 4)]
        showToast(`${incomingConns.length} branches synchronized and merged`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      node.status = 'error'
      node.lastRun = {
        durationMs: Math.round(performance.now() - started),
        status: 'Failed',
        error: msg,
        outputSummary: msg,
        timestamp: Date.now()
      }
      showToast(`Execution failure: ${msg}`)
    } finally {
      flowGraph = { ...flowGraph }
      notifyChange()
    }
  }

  // --- FULL GRAPH EXECUTION ENGINE (Max 5 history items) ---
  async function executeFlow() {
    if (flowRunning || flowGraph.nodes.length === 0) return

    flowRunning = true
    flowStatusMessage = 'Starting flow execution...'

    flowGraph.nodes.forEach((n) => {
      n.status = 'waiting'
    })
    flowGraph = { ...flowGraph }

    let currentEnv = { ...activeEnv }
    const completedNodes = new Set<string>()
    const failedNodes = new Set<string>()
    const skippedNodes = new Set<string>()
    const activeEvents = new Set<string>()
    const activeEventPayloads = new Map<string, string>()
    const activeNodePorts = new Map<string, Set<string>>()
    let flowTerminated = false
    const hasStartNodes = flowGraph.nodes.some((n) => n.type === 'start')

    const isConnPermanentlyInactive = (c: FlowConnection): boolean => {
      if (isLoopFeedbackConnection(c)) return false
      if (skippedNodes.has(c.fromId) || failedNodes.has(c.fromId)) return true
      if (completedNodes.has(c.fromId)) {
        const fromNode = flowGraph.nodes.find((n) => n.id === c.fromId)
        if (fromNode && isMultiPortNode(fromNode) && c.fromPort) {
          const ports = activeNodePorts.get(c.fromId)
          return !ports || !ports.has(c.fromPort)
        }
      }
      return false
    }

    const isConnActive = (c: FlowConnection): boolean => {
      if (isLoopFeedbackConnection(c)) return false
      if (isConnPermanentlyInactive(c)) return false
      const fromNode = flowGraph.nodes.find((n) => n.id === c.fromId)
      if (!fromNode) return false
      if (isMultiPortNode(fromNode) && c.fromPort) {
        if (completedNodes.has(c.fromId)) {
          const ports = activeNodePorts.get(c.fromId)
          return !!ports && ports.has(c.fromPort)
        }
      }
      return true
    }

    const getSolidPrereqs = (nodeId: string): string[] => {
      return flowGraph.connections
        .filter((c) => c.toId === nodeId && c.kind === 'solid' && !isLoopFeedbackConnection(c))
        .filter((c) => !isConnPermanentlyInactive(c))
        .map((c) => c.fromId)
    }

    const getDottedPrereqs = (nodeId: string): string[] => {
      return flowGraph.connections
        .filter((c) => c.toId === nodeId && c.kind === 'dotted' && !isLoopFeedbackConnection(c))
        .filter((c) => !isConnPermanentlyInactive(c))
        .map((c) => c.fromId)
    }

    const updateSkippedNodes = () => {
      let changed = true
      while (changed) {
        changed = false
        for (const node of flowGraph.nodes) {
          if (
            completedNodes.has(node.id) ||
            failedNodes.has(node.id) ||
            skippedNodes.has(node.id) ||
            node.status === 'running'
          ) {
            continue
          }

          if (node.type === 'event-catch' || node.type === 'start') {
            continue
          }

          const incomingConns = flowGraph.connections.filter(
            (c) => c.toId === node.id && !isLoopFeedbackConnection(c)
          )

          if (incomingConns.length > 0 && incomingConns.every(isConnPermanentlyInactive)) {
            skippedNodes.add(node.id)
            node.status = 'skipped'
            node.lastRun = {
              durationMs: 0,
              status: 'SKIPPED',
              outputSummary: 'Branch skipped by router / condition',
              timestamp: Date.now()
            }
            changed = true
          }
        }
      }
    }

    const isReadyToRun = (node: FlowNode): boolean => {
      if (flowTerminated) return false
      if (
        completedNodes.has(node.id) ||
        failedNodes.has(node.id) ||
        skippedNodes.has(node.id) ||
        node.status === 'running'
      )
        return false

      if (node.type === 'event-catch') {
        const evName = (node.eventData?.eventName || '').trim().toLowerCase()
        if (!evName || !activeEvents.has(evName)) {
          return false
        }
      }

      const solidPre = getSolidPrereqs(node.id)
      const dottedPre = getDottedPrereqs(node.id)

      if (node.type !== 'event-catch' && solidPre.length === 0 && dottedPre.length === 0) {
        if (hasStartNodes && node.type !== 'start') {
          return false
        }
        return true
      }

      // Check merge node join strategies
      if (node.type === 'merge') {
        const strategy: string = (node.mergeData?.strategy as string) || 'wait-all'
        const isFirst =
          strategy === 'first-complete' ||
          strategy === 'first-completed' ||
          strategy === 'wait-any' ||
          strategy === 'first'

        if (isFirst) {
          const hasAnySolidDone = solidPre.some((p) => completedNodes.has(p))
          const hasAnyDottedDone = dottedPre.some((p) => completedNodes.has(p))
          if (hasAnySolidDone || hasAnyDottedDone) {
            return true
          }
          return false
        }
      }

      const allSolidDone = solidPre.length === 0 || solidPre.every((p) => completedNodes.has(p))
      if (!allSolidDone) return false

      if (solidPre.length > 0) return true
      if (node.type === 'event-catch') return true
      return dottedPre.some((p) => completedNodes.has(p))
    }

    try {
      while (
        !flowTerminated &&
        completedNodes.size + failedNodes.size + skippedNodes.size < flowGraph.nodes.length
      ) {
        updateSkippedNodes()
        const readyNodes = flowGraph.nodes.filter(isReadyToRun)
        if (readyNodes.length === 0) {
          updateSkippedNodes()
          break
        }

        await Promise.all(
          readyNodes.map(async (node) => {
            if (flowTerminated) return
            node.status = 'running'
            flowGraph = { ...flowGraph }

            const started = performance.now()

            try {
              if (node.type === 'start') {
                node.status = 'success'
                node.lastRun = {
                  durationMs: 0,
                  status: 'START',
                  outputSummary: 'Start executed',
                  timestamp: Date.now()
                }
                completedNodes.add(node.id)
              } else if (node.type === 'terminate') {
                node.status = 'success'
                node.lastRun = {
                  durationMs: 0,
                  status: 'TERMINATED',
                  outputSummary: 'Execution stopped here',
                  timestamp: Date.now()
                }
                completedNodes.add(node.id)
                flowTerminated = true
                showToast('Flow terminated by Terminate block!')
              } else if (node.type === 'event-throw') {
                const upConns = flowGraph.connections.filter(
                  (c) => c.toId === node.id && !isLoopFeedbackConnection(c)
                )
                let upstreamPayload: unknown = null
                if (upConns.length > 0) {
                  const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
                  if (upNode?.lastRun?.responseText) {
                    try {
                      upstreamPayload = JSON.parse(upNode.lastRun.responseText)
                    } catch {
                      upstreamPayload = upNode.lastRun.responseText
                    }
                  }
                }

                const evName = (node.eventData?.eventName || '').trim().toLowerCase()
                if (evName) {
                  activeEvents.add(evName)
                  if (upstreamPayload) {
                    activeEventPayloads.set(
                      evName,
                      typeof upstreamPayload === 'string'
                        ? upstreamPayload
                        : JSON.stringify(upstreamPayload, null, 2)
                    )
                  }
                }

                if (node.eventData?.targetFlowId) {
                  const targetName = node.eventData.targetFlowName || 'Sub-Flow'
                  showToast(`⚡ [Sub-Flow] Executing "${targetName}"...`)
                  const subRes = await runSubFlow(
                    node.eventData.targetFlowId,
                    targetName,
                    evName,
                    currentEnv,
                    upstreamPayload
                  )
                  currentEnv = { ...currentEnv, ...subRes.updatedEnv }
                  node.status = subRes.success ? 'success' : 'error'
                  node.lastRun = {
                    durationMs: subRes.durationMs,
                    status: subRes.success ? 'SUBFLOW_OK' : 'SUBFLOW_ERROR',
                    outputSummary: `Sub-flow "${targetName}" executed in ${subRes.durationMs}ms.`,
                    responseText: subRes.responseText,
                    logs: subRes.logs,
                    timestamp: Date.now()
                  }
                  if (!node.history) node.history = []
                  node.history = [
                    {
                      id: `sub-${Date.now()}`,
                      timestamp: Date.now(),
                      status: subRes.success ? 200 : 500,
                      durationMs: subRes.durationMs,
                      responseText: node.lastRun.responseText,
                      logs: subRes.logs
                    },
                    ...node.history
                  ].slice(0, 5)

                  showToast(`Sub-flow "${targetName}" finished and released from memory!`)
                } else {
                  node.status = 'success'
                  const respText = upstreamPayload
                    ? typeof upstreamPayload === 'string'
                      ? upstreamPayload
                      : JSON.stringify(upstreamPayload, null, 2)
                    : ''
                  node.lastRun = {
                    durationMs: 0,
                    status: 'EVENT_THROWN',
                    outputSummary: `Triggered: "${node.eventData?.eventName || ''}"`,
                    timestamp: Date.now(),
                    responseText: respText
                  }
                  showToast(`Event triggered: "${node.eventData?.eventName || ''}"`)
                }
                completedNodes.add(node.id)
              } else if (node.type === 'event-catch') {
                const evName = (node.eventData?.eventName || '').trim().toLowerCase()
                const caughtPayload = activeEventPayloads.get(evName) || ''
                node.status = 'success'
                node.lastRun = {
                  durationMs: 0,
                  status: 'EVENT_CAUGHT',
                  outputSummary: `Received: "${node.eventData?.eventName || ''}"`,
                  timestamp: Date.now(),
                  responseText: caughtPayload
                }
                completedNodes.add(node.id)
                showToast(`Event received: "${node.eventData?.eventName || ''}"`)
              } else if (node.type === 'rest' && node.restData) {
                const rest = node.restData
                const resolvedUrl = resolveVariables(
                  rest.url,
                  currentEnv,
                  globalEnvironment
                ).resolved
                const headersStr = rest.headerRows
                  ? rowsToHeadersText(rest.headerRows)
                  : rest.headers
                const resolvedHeaders = resolveVariables(
                  headersStr,
                  currentEnv,
                  globalEnvironment
                ).resolved
                const resolvedBody = resolveVariables(
                  rest.body,
                  currentEnv,
                  globalEnvironment
                ).resolved

                let proxyToUse = globalProxy
                if (rest.proxyMode === 'direct') proxyToUse = ''
                else if (rest.proxyMode === 'corsproxy')
                  proxyToUse = 'https://corsproxy.io/?url={url}'
                else if (rest.proxyMode === 'allorigins')
                  proxyToUse = 'https://api.allorigins.win/raw?url={url}'
                else if (rest.proxyMode === 'custom' && rest.customProxyUrl)
                  proxyToUse = rest.customProxyUrl

                const hasBody = rest.bodyType !== 'none' && !['GET', 'HEAD'].includes(rest.method)
                const bodyPayload = hasBody ? resolvedBody : undefined
                const contentType = rest.bodyType === 'text' ? 'text/plain' : 'application/json'

                const headersObj = withContentType(
                  parseHeadersText(resolvedHeaders),
                  bodyPayload,
                  contentType
                )

                const { res, viaProxy } = await fetchWithProxy(
                  resolvedUrl,
                  { method: rest.method, headers: headersObj, body: bodyPayload },
                  proxyToUse
                )
                const text = await res.text()
                const durationMs = Math.round(performance.now() - started)
                const sizeBytes = new Blob([text]).size

                const capturedNames: string[] = []
                if (rest.captures && rest.captures.length > 0) {
                  try {
                    const jsonRes: unknown = JSON.parse(text)
                    for (const rule of rest.captures) {
                      if (!rule.enabled || !rule.path.trim()) continue
                      const val = extractValueByPath(jsonRes, rule.path.trim())
                      if (val !== undefined && rule.name.trim()) {
                        currentEnv[rule.name.trim()] = String(val)
                        capturedNames.push(`${rule.name}=${String(val).slice(0, 15)}`)
                      }
                    }
                  } catch {
                    // non-json
                  }
                }

                node.status = res.status < 400 ? 'success' : 'error'
                node.lastRun = {
                  durationMs,
                  status: res.status,
                  outputSummary:
                    capturedNames.length > 0
                      ? `Capturou: ${capturedNames.join(', ')}`
                      : `Status ${res.status}`,
                  timestamp: Date.now(),
                  responseText: text,
                  sizeBytes,
                  viaProxy
                }

                const historyItem: FlowNodeExecutionHistoryEntry = {
                  id: String(Date.now()),
                  timestamp: Date.now(),
                  status: res.status,
                  durationMs,
                  responseText: text,
                  sizeBytes,
                  viaProxy
                }
                // Strict limit of 5 history items
                node.history = [historyItem, ...(node.history || []).slice(0, 4)]

                if (res.status < 400) {
                  completedNodes.add(node.id)
                } else {
                  failedNodes.add(node.id)
                }
              } else if (node.type === 'js' && node.jsData) {
                const upConns = flowGraph.connections.filter(
                  (c) => c.toId === node.id && !isLoopFeedbackConnection(c)
                )
                let upstreamPayload: unknown = null
                if (upConns.length > 0) {
                  const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
                  if (upNode?.lastRun?.responseText) {
                    try {
                      upstreamPayload = JSON.parse(upNode.lastRun.responseText)
                    } catch {
                      upstreamPayload = upNode.lastRun.responseText
                    }
                  }
                }
                const res = executeJsSandbox(node.jsData.code, currentEnv, globalEnvironment, {
                  ports: node.jsData.ports,
                  payload: upstreamPayload
                })
                const durationMs = Math.round(performance.now() - started)

                if (res.success) {
                  currentEnv = { ...currentEnv, ...res.updatedEnv }
                  globalEnvironment = { ...globalEnvironment, ...res.updatedGlobalEnv }
                  node.status = 'success'
                  if (res.activePorts?.length > 0) {
                    activeNodePorts.set(node.id, new Set(res.activePorts))
                  }
                  node.lastRun = {
                    durationMs,
                    status: 'OK',
                    outputSummary:
                      res.logs.length > 0
                        ? res.logs[res.logs.length - 1]
                        : res.activePorts?.length > 0
                          ? `Script finished (Active ports: ${res.activePorts.join(', ')})`
                          : 'Script finished',
                    timestamp: Date.now(),
                    logs: res.logs,
                    responseText: JSON.stringify(res.updatedEnv, null, 2)
                  }
                  const historyItem: FlowNodeExecutionHistoryEntry = {
                    id: String(Date.now()),
                    timestamp: Date.now(),
                    status: 'OK',
                    durationMs,
                    logs: res.logs,
                    responseText: JSON.stringify(res.updatedEnv, null, 2)
                  }
                  // Strict limit of 5 history items
                  node.history = [historyItem, ...(node.history || []).slice(0, 4)]
                  completedNodes.add(node.id)
                } else {
                  node.status = 'error'
                  node.lastRun = {
                    durationMs,
                    status: 'ERRO',
                    error: res.error,
                    outputSummary: res.error ?? 'Script failure',
                    timestamp: Date.now(),
                    logs: res.logs
                  }
                  failedNodes.add(node.id)
                }
              } else if (node.type === 'router' && node.routerData) {
                const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
                let upstreamPayload: unknown = null
                let upstreamStatus = 200
                if (upConns.length > 0) {
                  const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
                  if (upNode?.lastRun) {
                    if (typeof upNode.lastRun.status === 'number') {
                      upstreamStatus = upNode.lastRun.status
                    }
                    if (upNode.lastRun.responseText) {
                      try {
                        upstreamPayload = JSON.parse(upNode.lastRun.responseText)
                      } catch {
                        upstreamPayload = upNode.lastRun.responseText
                      }
                    }
                  }
                }

                const res = evaluateRouterRules(
                  node.routerData.rules || [],
                  node.routerData.mode || 'first-match',
                  upstreamPayload,
                  upstreamStatus
                )
                const durationMs = Math.round(performance.now() - started)
                const hasMatches = res.matchedPortIds.length > 0
                node.status = hasMatches ? 'success' : 'error'

                activeNodePorts.set(node.id, new Set(res.matchedPortIds))

                const portSummary = res.matchedRules
                  .map((r) => {
                    const port = node.routerData?.ports.find((p) => p.id === r.portId)
                    return `${port?.label || r.portId} (${r.label})`
                  })
                  .join(', ')

                node.lastRun = {
                  durationMs,
                  status: hasMatches ? 'ROUTED' : 'NO_ROUTE',
                  outputSummary: hasMatches ? `Routed: ${portSummary}` : 'No matching rule',
                  timestamp: Date.now(),
                  responseText: JSON.stringify(
                    {
                      upstreamStatus,
                      matchedPorts: res.matchedPortIds,
                      matchedRules: res.matchedRules
                    },
                    null,
                    2
                  )
                }

                const historyItem: FlowNodeExecutionHistoryEntry = {
                  id: String(Date.now()),
                  timestamp: Date.now(),
                  status: hasMatches ? 200 : 404,
                  durationMs,
                  responseText: node.lastRun.responseText
                }
                node.history = [historyItem, ...(node.history || []).slice(0, 4)]
                if (hasMatches) {
                  completedNodes.add(node.id)
                } else {
                  failedNodes.add(node.id)
                }
              } else if (node.type === 'transform') {
                const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
                let inputPayload: unknown = null
                if (upConns.length > 0) {
                  const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
                  if (upNode?.lastRun?.responseText) {
                    try {
                      inputPayload = JSON.parse(upNode.lastRun.responseText)
                    } catch {
                      inputPayload = upNode.lastRun.responseText
                    }
                  }
                }
                if (!inputPayload && node.transformData?.sampleInput) {
                  try {
                    inputPayload = JSON.parse(node.transformData.sampleInput)
                  } catch {
                    inputPayload = node.transformData.sampleInput
                  }
                }
                const mapped = applyMappings(inputPayload || {}, node.transformData?.mappings || [])
                const responseText = JSON.stringify(mapped, null, 2)
                if (node.transformData?.saveToEnvVar) {
                  currentEnv[node.transformData.saveToEnvVar] = responseText
                  if (activeEnvName) {
                    environments[activeEnvName] = { ...currentEnv }
                    environments = { ...environments }
                  }
                }
                const durationMs = Math.round(performance.now() - started)
                node.status = 'success'
                node.lastRun = {
                  durationMs,
                  status: 200,
                  outputSummary: `${(node.transformData?.mappings || []).length} fields mapped`,
                  timestamp: Date.now(),
                  responseText
                }
                const historyItem: FlowNodeExecutionHistoryEntry = {
                  id: String(Date.now()),
                  timestamp: Date.now(),
                  status: 200,
                  durationMs,
                  responseText
                }
                node.history = [historyItem, ...(node.history || []).slice(0, 4)]
                completedNodes.add(node.id)
              } else if (node.type === 'loop') {
                currentEnv = await executeLoopNode(
                  node,
                  currentEnv,
                  true,
                  completedNodes,
                  activeNodePorts
                )
              } else if (node.type === 'delay') {
                const delayMs = Math.min(node.delayData?.delayMs || 1000, 4000)
                await new Promise((r) => setTimeout(r, delayMs))

                const upConns = flowGraph.connections.filter((c) => c.toId === node.id)
                let upstreamText = ''
                if (upConns.length > 0) {
                  const upNode = flowGraph.nodes.find((n) => n.id === upConns[upConns.length - 1].fromId)
                  if (upNode?.lastRun?.responseText) {
                    upstreamText = upNode.lastRun.responseText
                  }
                }
                const durationMs = Math.round(performance.now() - started)
                node.status = 'success'
                activeNodePorts.set(node.id, new Set(['out']))
                node.lastRun = {
                  durationMs,
                  status: 'DELAY_DONE',
                  outputSummary: `Paused for ${delayMs}ms`,
                  timestamp: Date.now(),
                  responseText: upstreamText || JSON.stringify({ delayedMs: delayMs }, null, 2)
                }
                const historyItem: FlowNodeExecutionHistoryEntry = {
                  id: String(Date.now()),
                  timestamp: Date.now(),
                  status: 'DELAY_DONE',
                  durationMs,
                  responseText: node.lastRun.responseText
                }
                node.history = [historyItem, ...(node.history || []).slice(0, 4)]
                completedNodes.add(node.id)
              } else if (node.type === 'merge') {
                const incomingConns = flowGraph.connections.filter((c) => c.toId === node.id)
                const branchResults: Record<string, unknown> = {}
                for (let idx = 0; idx < incomingConns.length; idx++) {
                  const conn = incomingConns[idx]
                  const fromNode = flowGraph.nodes.find((n) => n.id === conn.fromId)
                  const branchKey = conn.toPort || fromNode?.title || `branch_${idx + 1}`
                  if (fromNode?.lastRun?.responseText) {
                    try {
                      branchResults[branchKey] = JSON.parse(fromNode.lastRun.responseText)
                    } catch {
                      branchResults[branchKey] = fromNode.lastRun.responseText
                    }
                  } else {
                    branchResults[branchKey] = null
                  }
                }

                const mergedPayload = {
                  mergedAt: Date.now(),
                  strategy: node.mergeData?.strategy || 'wait-all',
                  branchesCount: incomingConns.length,
                  results: branchResults
                }
                const responseText = JSON.stringify(mergedPayload, null, 2)
                const durationMs = Math.round(performance.now() - started)
                node.status = 'success'
                activeNodePorts.set(node.id, new Set(['joined']))
                node.lastRun = {
                  durationMs,
                  status: 'MERGED',
                  outputSummary: `${incomingConns.length} branches merged`,
                  timestamp: Date.now(),
                  responseText
                }
                const historyItem: FlowNodeExecutionHistoryEntry = {
                  id: String(Date.now()),
                  timestamp: Date.now(),
                  status: 'MERGED',
                  durationMs,
                  responseText
                }
                node.history = [historyItem, ...(node.history || []).slice(0, 4)]
                completedNodes.add(node.id)
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              node.status = 'error'
              node.lastRun = {
                durationMs: Math.round(performance.now() - started),
                status: 'Failed',
                error: msg,
                outputSummary: msg,
                timestamp: Date.now()
              }
              failedNodes.add(node.id)
            }

            flowGraph = { ...flowGraph }
          })
        )

        if (activeEnvName) {
          environments[activeEnvName] = { ...currentEnv }
          environments = { ...environments }
        }

        await new Promise((r) => setTimeout(r, 200))
      }

      flowGraph.nodes.forEach((n) => {
        if (n.status === 'waiting') {
          n.status = 'idle'
        }
      })

      if (flowTerminated) {
        flowStatusMessage = `Flow finished: stopped at Terminate block.`
        showToast(flowStatusMessage)
      } else {
        flowStatusMessage = `Flow completed: ${completedNodes.size} passed, ${failedNodes.size} failed.`
        showToast(flowStatusMessage)
      }
    } finally {
      flowRunning = false
      flowGraph = { ...flowGraph }
      notifyChange()
    }
  }

  // --- SVG BEZIER PATH HELPERS ---
  const NODE_WIDTH = 280
  const CIRCLE_NODE_SIZE = 54

  function isCircleNode(type: FlowNodeType): boolean {
    return (
      type === 'start' || type === 'terminate' || type === 'event-throw' || type === 'event-catch'
    )
  }



  function getNodeOutputPort(
    node: FlowNode,
    portId?: string
  ): { x: number; y: number; direction?: 'top' | 'right' | 'bottom' | 'left' } {
    return getOutputPortPoint(node, portId)
  }

  function getNodeInputPort(
    node: FlowNode,
    portId?: string
  ): { x: number; y: number; direction?: 'top' | 'right' | 'bottom' | 'left' } {
    return getInputPortPoint(node, portId)
  }

  function getBezierPath(
    x1OrP1: number | { x: number; y: number; direction?: 'top' | 'right' | 'bottom' | 'left' },
    y1OrP2: number | { x: number; y: number; direction?: 'top' | 'right' | 'bottom' | 'left' },
    x2?: number,
    y2?: number
  ): string {
    if (typeof x1OrP1 === 'object' && typeof y1OrP2 === 'object') {
      return computeBezierPath(x1OrP1, x1OrP1.direction, y1OrP2, y1OrP2.direction)
    }
    const p1 = { x: Number(x1OrP1), y: Number(y1OrP2), direction: 'right' as const }
    const p2 = { x: Number(x2), y: Number(y2), direction: 'left' as const }
    return computeBezierPath(p1, 'right', p2, 'left')
  }

  function getPathMidpoint(
    x1OrP1: number | { x: number; y: number; direction?: 'top' | 'right' | 'bottom' | 'left' },
    y1OrP2: number | { x: number; y: number; direction?: 'top' | 'right' | 'bottom' | 'left' },
    x2?: number,
    y2?: number
  ): { x: number; y: number } {
    if (typeof x1OrP1 === 'object' && typeof y1OrP2 === 'object') {
      return getBezierMidpoint(x1OrP1, x1OrP1.direction, y1OrP2, y1OrP2.direction)
    }
    const p1 = { x: Number(x1OrP1), y: Number(y1OrP2), direction: 'right' as const }
    const p2 = { x: Number(x2), y: Number(y2), direction: 'left' as const }
    return getBezierMidpoint(p1, 'right', p2, 'left')
  }
</script>

<svelte:window on:click={() => { fileMenuOpen = false; examplesMenuOpen = false; }} on:keydown={handleKeydown} />

<div class="flow-container">
  <!-- Top Canvas Toolbar -->
  <div class="flow-toolbar">
    <!-- Group 1: Execution & Run -->
    <div class="flow-toolbar-group flow-toolbar-exec">
      <button
        type="button"
        class="flow-btn-primary flow-run-btn"
        disabled={flowRunning || flowGraph.nodes.length === 0}
        on:click={executeFlow}
      >
        {#if flowRunning}
          <span class="flow-spinner"></span>
          <span>Running...</span>
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>Run Flow</span>
        {/if}
      </button>
      {#if flowStatusMessage}
        <span class="flow-status-msg" title={flowStatusMessage}>{flowStatusMessage}</span>
      {/if}
    </div>

    <!-- Group 2: Palette / Add Blocks -->
    <div class="flow-toolbar-group flow-toolbar-palette">
      <span class="toolbar-group-label">Blocks:</span>
      <button
        type="button"
        class="flow-btn flow-btn-draggable"
        draggable="true"
        title="REST Block: HTTP Request (GET, POST, etc.)"
        on:click={() => addNode('rest')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'rest')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">🌐</span>
        <span>＋ REST Block</span>
        <span class="btn-drag-handle" title="Drag to drop into flow">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-draggable flow-btn-js"
        draggable="true"
        title="Logic & Code Block: JavaScript or JSON Schema Mapper (switch type directly on the node via ↻)"
        on:click={() => addNode('js')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'js')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">⚡</span>
        <span>＋ Logic & Code</span>
        <span class="btn-drag-handle" title="Drag to drop into flow">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-draggable flow-btn-router"
        draggable="true"
        title="Flow Control Block: Gateway Router, Loop, Delay or Merge (switch type directly on the node via ↻)"
        on:click={() => addNode('router')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'router')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">🔀</span>
        <span>＋ Flow Control</span>
        <span class="btn-drag-handle" title="Drag to drop into flow">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-draggable flow-btn-event"
        draggable="true"
        title="Event / BPMN Block: Start, Terminate, Jump or Receiver (change type directly on the node via ↻)"
        on:click={() => addNode('event-throw')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'event-throw')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">⭕</span>
        <span>＋ Event</span>
        <span class="btn-drag-handle" title="Drag to drop into flow">⋮⋮</span>
      </button>
    </div>

    <div class="flow-toolbar-divider"></div>

    <!-- Group 3: Canvas Layout -->
    <div class="flow-toolbar-group flow-toolbar-layout">
      <button
        type="button"
        class="flow-btn flow-btn-layout"
        title="Automatically organize blocks in smart diagram layout"
        on:click={autoLayout}
      >
        <span class="btn-icon">🪄</span>
        <span>Auto Layout</span>
      </button>
    </div>

    <!-- Group 3b: Preset Examples Menu -->
    <div class="flow-toolbar-group flow-examples-menu">
      <div class="flow-examples-wrap">
        <button
          type="button"
          class="flow-btn"
          class:is-open={examplesMenuOpen}
          title="Load ready-made example flows using the Rick & Morty API"
          aria-haspopup="menu"
          aria-expanded={examplesMenuOpen}
          on:click|stopPropagation={() => {
            examplesMenuOpen = !examplesMenuOpen
            fileMenuOpen = false
          }}
        >
          <span class="btn-icon">🧬</span>
          <span class="btn-text">Examples</span>
          <span class="btn-caret">▾</span>
        </button>
        {#if examplesMenuOpen}
          <div class="flow-menu flow-examples-dropdown" role="menu">
            <div class="flow-menu-header">RICK & MORTY EXAMPLES</div>
            <button
              type="button"
              role="menuitem"
              class="menu-item-rich"
              on:click={() => {
                examplesMenuOpen = false
                resetToExample(1)
              }}
            >
              <span class="menu-item-icon">🧬</span>
              <div class="menu-item-desc">
                <strong>Example 1: Linear (Basic)</strong>
                <small>REST + Script JS + Event Jump/Receiver</small>
              </div>
            </button>
            <button
              type="button"
              role="menuitem"
              class="menu-item-rich"
              on:click={() => {
                examplesMenuOpen = false
                resetToExample(2)
              }}
            >
              <span class="menu-item-icon">🔀</span>
              <div class="menu-item-desc">
                <strong>Example 2: Advanced (Router & Connectors)</strong>
                <small>Conditional Router + Multi-Ports + JSON Mapper</small>
              </div>
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Spacer pushes File & Actions to the right -->
    <div class="flow-toolbar-spacer"></div>

    {#if activeFlowName}
      <div class="flow-active-badge" title="Active Spatial Flow in this Workspace">
        <span class="active-group-label">{activeGroupName ? `📁 ${activeGroupName} /` : ''}</span>
        <span class="active-flow-label">🔀 {activeFlowName}</span>
      </div>
    {/if}

    {#if onSaveFlowToWorkspace}
      <button
        type="button"
        class="flow-btn flow-btn-primary"
        title="Save changes to Spatial Flow in this workspace (Ctrl+S)"
        on:click={() => onSaveFlowToWorkspace && onSaveFlowToWorkspace(false)}
      >
        <span class="btn-icon">💾</span>
        <span>Save</span>
      </button>
    {/if}

    <!-- Group 4: File & Flow Actions (Unified dropdown) -->
    <div class="flow-toolbar-group flow-toolbar-actions">
      <!-- File menu (Workspace / Files / Templates / Canvas) -->
      <div class="flow-file-menu">
        <button
          type="button"
          class="flow-btn"
          class:is-open={fileMenuOpen}
          title={flowFileName ? `Flow file: ${flowFileName}` : 'Flow actions, files and options'}
          aria-haspopup="menu"
          aria-expanded={fileMenuOpen}
          on:click|stopPropagation={() => {
            fileMenuOpen = !fileMenuOpen
            examplesMenuOpen = false
          }}
        >
          <span class="btn-icon">📁</span>
          <span class="btn-text file-name">{flowFileName || 'File'}</span>
          <span class="btn-caret">▾</span>
        </button>
        {#if fileMenuOpen}
          <div class="flow-menu" role="menu">
            <button type="button" role="menuitem" on:click={() => runFileAction(openFlowFile)}>
              <span>📂 Open…</span>
            </button>
            <button
              type="button"
              role="menuitem"
              on:click={() =>
                runFileAction(() =>
                  onSaveFlowToWorkspace
                    ? onSaveFlowToWorkspace(false)
                    : saveFlowFile(false)
                )}
            >
              <span>💾 Save</span>
              {#if flowFileName}<small>{flowFileName}</small>{/if}
            </button>
            <button
              type="button"
              role="menuitem"
              on:click={() =>
                runFileAction(() =>
                  onSaveFlowToWorkspace
                    ? onSaveFlowToWorkspace(true)
                    : saveFlowFile(true)
                )}
            >
              <span>📝 Save As…</span>
            </button>
            <div class="flow-menu-sep"></div>
            <button type="button" role="menuitem" on:click={() => runFileAction(importFlowFile)}>
              <span>📥 Import blocks…</span>
            </button>
            <button type="button" role="menuitem" on:click={() => runFileAction(exportFlowFile)}>
              <span>📤 Export (download)</span>
            </button>
            <div class="flow-menu-sep"></div>
            <div class="flow-menu-header">RICK & MORTY EXAMPLES</div>
            <button
              type="button"
              role="menuitem"
              on:click={() => runFileAction(() => resetToExample(1))}
            >
              <span>🧬 Example 1: Linear (Basic)</span>
            </button>
            <button
              type="button"
              role="menuitem"
              on:click={() => runFileAction(() => resetToExample(2))}
            >
              <span>🔀 Example 2: Advanced (Router & Connectors)</span>
            </button>
            <div class="flow-menu-sep"></div>
            <button
              type="button"
              role="menuitem"
              class="flow-menu-item-danger"
              on:click={() => runFileAction(clearAll)}
            >
              <span>🧹 Clear</span>
            </button>
          </div>
        {/if}
      </div>
    </div>

    <input
      bind:this={flowFileInput}
      type="file"
      accept=".json,.flow.json,application/json"
      class="flow-file-input"
      on:change={onFlowFileInputChange}
    />
  </div>

  <!-- Main Work Area: Canvas on Left, Resizable Inspector Panel on Right -->
  <div class="flow-work-area">
    <div class="flow-canvas-viewport">
      <!-- Spatial Canvas -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flow-canvas"
        bind:this={canvasEl}
        on:click={onCanvasClick}
        on:dragover={onCanvasDragOver}
        on:drop={onCanvasDrop}
        on:mousemove={updateMousePos}
      >
        <div
          class="flow-zoom-container"
          style="transform: scale({zoomLevel}); transform-origin: 0 0;"
        >
          <!-- Background SVG Connections Layer -->
          <svg class="flow-svg-layer">
            <defs>
              <marker
                id="arrow-solid"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
              </marker>
              <marker
                id="arrow-dotted"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
              </marker>
              <marker
                id="arrow-running"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#facc15" />
              </marker>
            </defs>

            <!-- Connections -->
            {#each flowGraph.connections as conn (conn.id)}
              {@const fromNode = flowGraph.nodes.find((n) => n.id === conn.fromId)}
              {@const toNode = flowGraph.nodes.find((n) => n.id === conn.toId)}
              {#if fromNode && toNode}
                {@const p1 = getNodeOutputPort(fromNode, conn.fromPort)}
                {@const p2 = getNodeInputPort(toNode, conn.toPort)}
                {@const pathD = computeBezierPath(p1, p1.direction, p2, p2.direction)}
                {@const isRunning = fromNode.status === 'running' || toNode.status === 'running'}
                {@const isSelected = selectedConnection?.id === conn.id}

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g
                  class="connection-group"
                  class:is-selected={isSelected}
                  on:click|stopPropagation={() => selectConnection(conn)}
                >
                  <path d={pathD} class="conn-hitbox" />
                  <path
                    d={pathD}
                    class="conn-line"
                    class:solid={conn.kind === 'solid'}
                    class:dotted={conn.kind === 'dotted'}
                    class:running={isRunning}
                    class:is-selected={isSelected}
                    marker-end={isRunning
                      ? 'url(#arrow-running)'
                      : conn.kind === 'solid'
                        ? 'url(#arrow-solid)'
                        : 'url(#arrow-dotted)'}
                  />
                </g>
              {/if}
            {/each}

            <!-- Line being drawn -->
            {#if connectingFromId}
              {@const sourceNode = flowGraph.nodes.find((n) => n.id === connectingFromId)}
              {#if sourceNode}
                {@const sp = getNodeOutputPort(sourceNode, connectingFromPortId || undefined)}
                <path
                  d={computeBezierPath(sp, sp.direction, { x: mouseX, y: mouseY, direction: 'left' }, 'left')}
                  class="conn-line-draft"
                  marker-end="url(#arrow-solid)"
                />
              {/if}
            {/if}
          </svg>

          <!-- Remote Collaborators Cursors Layer -->
          {#each remotePresences as presence (presence.peerId)}
            {#if presence.cursor}
              <div
                class="remote-collaborator-cursor"
                style="left: {presence.cursor.x}px; top: {presence.cursor.y}px;"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={presence.color}>
                  <path d="M3 3l7 18 3-7 7-3L3 3z" />
                </svg>
                <span class="remote-cursor-label" style="background: {presence.color};">
                  {presence.userName}
                </span>
              </div>
            {/if}
          {/each}

          <!-- HTML Nodes Layer -->
          {#each flowGraph.nodes as node (node.id)}
            {#if isCircleNode(node.type)}
              <!-- Circular BPMN Diagram Node -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="flow-node flow-node-circle flow-node-{node.type}"
                class:is-cross-flow={node.type === 'event-throw' && !!node.eventData?.targetFlowId}
                class:is-selected={node.id === selectedNodeId}
                class:is-dragging={node.id === draggingNodeId}
                class:has-switcher-open={activeCircleSwitcherId === node.id}
                class:status-idle={node.status === 'idle'}
                class:status-waiting={node.status === 'waiting'}
                class:status-running={node.status === 'running'}
                class:status-success={node.status === 'success'}
                class:status-error={node.status === 'error'}
                class:status-skipped={node.status === 'skipped'}
                style="left: {node.x}px; top: {node.y}px;"
                on:pointerdown={(e) => onNodePointerDown(e, node)}
                on:mousedown={(e) => onNodePointerDown(e, node)}
                on:mouseup={(e) => {
                  if (connectingFromId && connectingFromId !== node.id) {
                    e.stopPropagation()
                    endConnect(node.id)
                  }
                }}
                on:click={() => {
                  if (!newlyConnectedConnId) selectedConnection = null
                  selectNode(node)
                }}
              >
                <!-- Input Port (Start node has no incoming wire) -->
                {#if node.type !== 'start'}
                  <div
                    class="node-port port-input circle-port-input"
                    title="Drop connection here"
                    on:mouseup|stopPropagation={() => endConnect(node.id)}
                  ></div>
                {/if}

                <!-- Circle Symbol Inner -->
                <div class="circle-inner" title={node.title}>
                  {#if node.status === 'running'}
                    <span class="flow-spinner"></span>
                  {:else if node.type === 'event-throw' && node.eventData?.targetFlowId}
                    <span
                      class="circle-symbol jump-cross"
                      title={`Cross-flow jump: ${node.eventData?.targetFlowName || 'Outro Flow'}`}
                      >🔀</span
                    >
                  {:else if node.type === 'start'}
                    <span class="circle-symbol start">▶</span>
                  {:else if node.type === 'terminate'}
                    <span class="circle-symbol terminate">⏹</span>
                  {:else if node.type === 'event-throw'}
                    <span class="circle-symbol throw">📡</span>
                  {:else if node.type === 'event-catch'}
                    <span class="circle-symbol catch">🎯</span>
                  {/if}
                </div>

                <!-- Output Port (Terminate node has no outgoing wire) -->
                {#if node.type !== 'terminate'}
                  <div
                    class="node-port port-output circle-port-output"
                    title="Click and drag to connect to another block"
                    on:mousedown={(e) => startConnect(e, node.id)}
                  ></div>
                {/if}

                <!-- Switch Type Button on hover/selection (Circular arrow icon) -->
                <button
                  type="button"
                  class="circle-switch-btn"
                  class:active={activeCircleSwitcherId === node.id}
                  title="Change event type (Start, Terminate, Jump, Receiver)"
                  aria-label="Change event type"
                  on:click|stopPropagation={() => toggleCircleSwitcher(node.id)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="11"
                    height="11"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </button>

                <!-- Delete Action Button on hover/selection -->
                <button
                  type="button"
                  class="circle-delete-btn"
                  title="Delete block"
                  aria-label="Delete block"
                  on:click|stopPropagation={() => deleteNode(node.id)}>×</button
                >

                <!-- Label Badge below circle -->
                <div class="circle-label-badge" title={node.title}>
                  {#if node.type === 'event-throw' && node.eventData?.targetFlowId}
                    <span class="circle-badge-text cross-event"
                      >🔀 {node.eventData?.targetFlowName || 'Sub-Flow'}</span
                    >
                  {:else if node.type === 'event-throw' || node.type === 'event-catch'}
                    <span class="circle-badge-text event"
                      >{node.eventData?.eventName || 'valida total'}</span
                    >
                  {:else}
                    <span class="circle-badge-text">{node.title}</span>
                  {/if}
                </div>

                <!-- Node Floating Type Switcher (Like conn-ball-control on line) -->
                {#if activeCircleSwitcherId === node.id}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="circle-type-control"
                    class:align-left={node.x < 150}
                    class:align-bottom={node.y < 55}
                    on:click|stopPropagation
                  >
                    <button
                      type="button"
                      class="circle-type-btn green"
                      class:active={node.type === 'start'}
                      title="Start: Flow starting point"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'start')}
                    >
                      <span class="type-disc green"></span>
                      <span class="type-name">Start</span>
                    </button>
                    <button
                      type="button"
                      class="circle-type-btn red"
                      class:active={node.type === 'terminate'}
                      title="Terminate: Stop flow immediately"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'terminate')}
                    >
                      <span class="type-disc red"></span>
                      <span class="type-name">Terminate</span>
                    </button>
                    <button
                      type="button"
                      class="circle-type-btn blue"
                      class:active={node.type === 'event-throw'}
                      title="Jump: Transmit event wirelessly"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'event-throw')}
                    >
                      <span class="type-disc blue"></span>
                      <span class="type-name">Jump</span>
                    </button>
                    <button
                      type="button"
                      class="circle-type-btn blue-dashed"
                      class:active={node.type === 'event-catch'}
                      title="Receiver: Wait for wireless event"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'event-catch')}
                    >
                      <span class="type-disc blue-dashed"></span>
                      <span class="type-name">Receiver</span>
                    </button>
                  </div>
                {/if}
              </div>
            {:else}
              <!-- Standard rectangular card node (rest / js) -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="flow-node flow-node-{node.type}"
                class:is-selected={node.id === selectedNodeId}
                class:is-dragging={node.id === draggingNodeId}
                class:has-switcher-open={activeCardSwitcherId === node.id}
                class:status-idle={node.status === 'idle'}
                class:status-waiting={node.status === 'waiting'}
                class:status-running={node.status === 'running'}
                class:status-success={node.status === 'success'}
                class:status-error={node.status === 'error'}
                class:status-skipped={node.status === 'skipped'}
                style="left: {node.x}px; top: {node.y}px;"
                on:pointerdown={(e) => onNodePointerDown(e, node)}
                on:mousedown={(e) => onNodePointerDown(e, node)}
                on:mouseup={(e) => {
                  if (connectingFromId && connectingFromId !== node.id) {
                    e.stopPropagation()
                    endConnect(node.id)
                  }
                }}
              >
                <!-- Switch Type Button for Cards (top-left ↻) -->
                {#if node.type !== 'rest'}
                  <button
                    type="button"
                    class="card-switch-btn"
                    class:active={activeCardSwitcherId === node.id}
                    title="Change block type"
                    aria-label="Change block type"
                    on:click|stopPropagation={() => toggleCardSwitcher(node.id)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="11"
                      height="11"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
                      <path d="M21 3v5h-5" />
                    </svg>
                  </button>

                  {#if activeCardSwitcherId === node.id}
                    <NodeTypeSwitcher
                      {node}
                      alignLeft={node.x < 150}
                      alignBottom={node.y < 60}
                      on:select={(e) => switchNodeType(node, e.detail)}
                    />
                  {/if}
                {/if}

                <!-- Input Port(s) -->
                {#if node.type === 'merge' && node.mergeData?.inputs && node.mergeData.inputs.length > 0}
                  <div class="node-inputs-rack">
                    {#each node.mergeData.inputs as inp (inp.id)}
                      {@const inpPt = getInputPortPoint(node, inp.id)}
                      {@const relY = inpPt.y - node.y}
                      <div
                        class="node-port port-input port-multi-input"
                        style="top: {relY}px; left: 0;"
                        title="{inp.label} (Input)"
                        on:mouseup|stopPropagation={() => endConnect(node.id, inp.id)}
                      >
                        <span class="port-tooltip input-tip">{inp.label}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div
                    class="node-port port-input"
                    title="Drop connection here to connect"
                    on:mouseup|stopPropagation={() => endConnect(node.id)}
                  ></div>
                {/if}

                <!-- Node Header -->
                <div class="node-header">
                  <div class="node-title-wrap">
                    <span class="node-type-icon">{FLOW_NODE_REGISTRY[node.type]?.icon || '📦'}</span>
                    <input
                      class="node-title-input"
                      type="text"
                      bind:value={node.title}
                      on:input={notifyChange}
                    />
                  </div>
                  <div class="node-actions">
                    <button
                      type="button"
                      class="node-tool-btn"
                      title="Run this block only"
                      on:click|stopPropagation={() => executeSingleNode(node)}>▶</button
                    >
                    <button
                      type="button"
                      class="node-tool-btn"
                      title="Delete block"
                      on:click|stopPropagation={() => deleteNode(node.id)}>×</button
                    >
                  </div>
                </div>

                <!-- Node Body / Summary Preview (Slim 1-2 lines matching JS block) -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="node-body"
                  on:click={() => {
                    if (!newlyConnectedConnId) {
                      selectedConnection = null
                    }
                    selectNode(node)
                  }}
                >
                  {#if node.type === 'rest' && node.restData}
                    <div class="node-rest-preview">
                      <span class="method-tag method-{node.restData.method.toLowerCase()}">
                        {node.restData.method}
                      </span>
                      <span class="url-text" title={node.restData.url}>
                        {node.restData.url || 'https://...'}
                      </span>
                    </div>
                    {#if node.restData.captures && node.restData.captures.length > 0}
                      <div class="node-sub-meta">
                        🎯 {node.restData.captures.filter((c) => c.enabled).length} variable(s) captured
                      </div>
                    {/if}
                  {:else if node.type === 'router' && node.routerData}
                    <div class="node-router-preview-compact">
                      <div class="node-compact-summary" title={node.routerData.rules.map((r) => r.label).join(', ')}>
                        <span class="summary-label">routes:</span>
                        <span class="summary-val">
                          {node.routerData.rules.map((r) => r.statusPattern || r.path || 'otherwise').slice(0, 3).join(', ')}{node.routerData.rules.length > 3 ? '...' : ''}
                        </span>
                      </div>
                      <div class="node-sub-meta">
                        <span class="compact-chip">{node.routerData.mode === 'first-match' ? 'First Match' : 'All Matches'}</span>
                        <span>· {node.routerData.rules.length} rules</span>
                      </div>
                    </div>
                  {:else if node.type === 'js' && node.jsData}
                    <div class="node-js-preview">
                      <code>{node.jsData.code.split('\n').filter(Boolean)[0] || '// JS Code'}</code>
                    </div>
                    {#if node.jsData.ports && node.jsData.ports.length > 0}
                      <div class="node-sub-meta">
                        🔀 {node.jsData.ports.length} dynamic output port(s)
                      </div>
                    {/if}
                  {:else if node.type === 'transform'}
                    <div class="node-transform-preview-compact">
                      <div class="node-compact-summary">
                        <span class="summary-label">map:</span>
                        <span class="summary-val">{node.transformData?.mappings?.length ? `${node.transformData.mappings.length} fields mapped` : 'payload ➔ output'}</span>
                      </div>
                      <div class="node-sub-meta">
                        <span class="compact-chip">JSON Mapper</span>
                        <span>· Visual 2-Tree</span>
                      </div>
                    </div>
                  {:else if node.type === 'loop'}
                    <div class="node-loop-preview-compact">
                      <div class="node-compact-summary">
                        <span class="summary-label">{node.loopData?.mode === 'count' ? 'repeat:' : 'array:'}</span>
                        <span class="summary-val">
                          {node.loopData?.mode === 'count'
                            ? `${node.loopData?.repeatCount || 5}x [ ${node.loopData?.indexVar || 'index'} ]`
                            : `${node.loopData?.arrayPath || 'items'} [ ${node.loopData?.itemVar || 'item'} ]`}
                        </span>
                      </div>
                      <div class="node-sub-meta">
                        <span class="compact-chip">Max {node.loopData?.maxIterations || 1000}</span>
                        <span>· {node.loopData?.mode === 'count' ? 'contador' : 'for-each'}</span>
                      </div>
                    </div>
                  {:else if node.type === 'delay'}
                    <div class="node-delay-preview-compact">
                      <div class="node-compact-summary">
                        <span class="summary-label">pause:</span>
                        <span class="summary-val">{node.delayData?.delayMs || 1000}ms {node.delayData?.mode === 'throttle' ? '(rate limit)' : 'delay'}</span>
                      </div>
                      <div class="node-sub-meta">
                        <span class="compact-chip">{node.delayData?.mode === 'throttle' ? 'Throttle' : 'Fixed Delay'}</span>
                        <span>· Queue buffer</span>
                      </div>
                    </div>
                  {:else if node.type === 'merge'}
                    <div class="node-merge-preview-compact">
                      <div class="node-compact-summary">
                        <span class="summary-label">sync:</span>
                        <span class="summary-val">{node.mergeData?.strategy === 'wait-all' ? 'Wait All Branches' : 'First Complete'}</span>
                      </div>
                      <div class="node-sub-meta">
                        <span class="compact-chip">{node.mergeData?.inputs?.length || 2} entradas</span>
                        <span>· Barreira join</span>
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Node Footer: Execution Status & Action -->
                <div class="node-footer">
                  {#if node.status === 'running'}
                    <div class="status-running-label">
                      <span class="flow-spinner"></span>
                      <span>Running...</span>
                    </div>
                  {:else if node.lastRun}
                    <div
                      class="last-run-meta"
                      class:run-ok={node.status === 'success'}
                      class:run-bad={node.status === 'error'}
                      class:run-skipped={node.status === 'skipped'}
                    >
                      <span class="status-code">{node.lastRun.status}</span>
                      <span class="duration">{node.lastRun.durationMs}ms</span>
                      {#if node.lastRun.outputSummary}
                        <span class="summary-text" title={node.lastRun.outputSummary}>
                          {node.lastRun.outputSummary}
                        </span>
                      {/if}
                    </div>
                    {#if node.lastRun.responseText && onOpenInEditor}
                      <button
                        type="button"
                        class="node-quick-btn"
                        title="Open response in JSON Editor"
                        on:click|stopPropagation={() => openResponseInEditor(node)}
                      >
                        ↗ Editor
                      </button>
                    {/if}
                  {:else}
                    <span class="node-idle-text">Ready to run</span>
                  {/if}
                </div>

                <!-- Output Ports: Multi-port Rack or Standard Single Output -->
                {#if isMultiPortNode(node)}
                  <div class="node-ports-rack">
                    {#each getNodePorts(node) as port (port.id)}
                      {@const pt = getOutputPortPoint(node, port.id)}
                      {@const relX = pt.x - node.x}
                      {@const relY = pt.y - node.y}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="node-port port-output port-multi slot-{port.slot}"
                        style="left: {relX}px; top: {relY}px; {port.color ? `border-color: ${port.color};` : ''}"
                        title="{port.label} ({port.slot.toUpperCase()})"
                        on:mousedown={(e) => startConnect(e, node.id, port.id)}
                      >
                        <span class="port-tooltip slot-tip-{port.slot}">{port.label}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div
                    class="node-port port-output"
                    title="Click and drag to connect to another block"
                    on:mousedown={(e) => startConnect(e, node.id)}
                  ></div>
                {/if}
              </div>
            {/if}
          {/each}

          <!-- Active Connection Selection Ball Overlay (z-index: 25, always above boxes) -->
          {#if selectedConnection}
            {@const selConn = selectedConnection}
            {@const sFrom = flowGraph.nodes.find((n) => n.id === selConn.fromId)}
            {@const sTo = flowGraph.nodes.find((n) => n.id === selConn.toId)}
            {#if sFrom && sTo}
              {@const p1 = getNodeOutputPort(sFrom, selConn.fromPort)}
              {@const p2 = getNodeInputPort(sTo, selConn.toPort)}
              {@const mid = getBezierMidpoint(p1, p1.direction, p2, p2.direction)}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div
                class="conn-ball-overlay-wrap"
                class:align-below={mid.y < 45}
                style="left: {mid.x}px; top: {mid.y}px;"
                on:click|stopPropagation
              >
                <div
                  class="conn-ball-control"
                  class:is-solid={selConn.kind === 'solid'}
                  class:is-dotted={selConn.kind === 'dotted'}
                >
                  <button
                    type="button"
                    class="ball-dot-btn blue"
                    class:active={selConn.kind === 'solid'}
                    title="Blue (Solid arrow: Wait for completion)"
                    on:click|stopPropagation={() => setConnectionKind(selConn, 'solid')}
                  >
                    <span class="color-disc blue"></span>
                    <span class="color-name">Blue</span>
                  </button>

                  <span class="ball-divider"></span>

                  <button
                    type="button"
                    class="ball-dot-btn purple"
                    class:active={selConn.kind === 'dotted'}
                    title="Purple (Dotted arrow: Async / Don't wait)"
                    on:click|stopPropagation={() => setConnectionKind(selConn, 'dotted')}
                  >
                    <span class="color-disc purple"></span>
                    <span class="color-name">Purple</span>
                  </button>

                  <button
                    type="button"
                    class="ball-delete-btn"
                    title="Delete connection"
                    on:click|stopPropagation={() => removeConnection(selConn.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>

      <!-- Pinned Floating Controls Overlay (Stays fixed relative to viewport) -->
      <!-- Floating Diagram Legend at Bottom Left of Drawing Canvas -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flow-floating-legend" on:click|stopPropagation>
        <span class="legend-badge">Legend</span>
        <div class="legend-items">
          <span class="legend-item" title="Solid line: waits for previous node completion"
            ><span class="legend-line solid"></span> Wait</span
          >
          <span class="legend-item" title="Dotted line: asynchronous execution without blocking"
            ><span class="legend-line dotted"></span> Async</span
          >
          <span class="legend-item" title="Start Node: flow starting point"
            ><span class="legend-dot green"></span> Start</span
          >
          <span class="legend-item" title="End Node: terminates and stops the flow"
            ><span class="legend-dot red"></span> Terminate</span
          >
          <span class="legend-item" title="Wireless jump: emits event to receivers"
            ><span class="legend-dot blue"></span> Jump</span
          >
          <span class="legend-item" title="Wireless receiver: waits for event to continue"
            ><span class="legend-dot blue-dashed"></span> Receiver</span
          >
        </div>
      </div>

      <!-- Floating Zoom Controls at Bottom Right of Drawing Canvas -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flow-floating-zoom flow-zoom-control" on:click|stopPropagation>
        <button
          type="button"
          class="zoom-btn"
          title="Zoom out (Ctrl + scroll down)"
          on:click={zoomOut}
        >
          －
        </button>
        <button
          type="button"
          class="zoom-level-btn"
          title="Click to reset zoom to 100%"
          on:click={resetZoom}
        >
          {Math.round(zoomLevel * 100)}%
        </button>
        <button type="button" class="zoom-btn" title="Zoom in (Ctrl + scroll up)" on:click={zoomIn}>
          ＋
        </button>
        <button
          type="button"
          class="zoom-reset-btn"
          title="Reset zoom to 100%"
          on:click={resetZoom}
        >
          ⟲
        </button>
      </div>

      <!-- Floating Toast -->
      {#if toastMessage}
        <div class="flow-toast">
          <span>{toastMessage}</span>
        </div>
      {/if}
    </div>

    <!-- RESIZABLE RIGHT SIDE PANEL (INSPECTOR) -->
    {#if selectedNode}
      <!-- Resizer separator -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flow-side-resizer"
        class:is-active={isResizingSidePanel}
        title="Drag horizontally to resize panel"
        on:mousedown={startSideResize}
      ></div>

      <aside class="flow-side-panel" style="width: {sidePanelWidth}px;">
        <!-- Side Panel Header with Click-to-Edit Title -->
        <div class="side-panel-header">
          <div class="side-header-left">
            <span class="side-type-icon">
              {#if selectedNode.type === 'rest'}🌐
              {:else if selectedNode.type === 'js'}⚡
              {:else if selectedNode.type === 'start'}🟢
              {:else if selectedNode.type === 'terminate'}🛑
              {:else if selectedNode.type === 'event-throw'}🔵
              {:else if selectedNode.type === 'event-catch'}◌
              {/if}
            </span>
            <div class="side-title-edit-wrap">
              <input
                type="text"
                class="side-title-input"
                bind:value={selectedNode.title}
                on:input={notifyChange}
                placeholder="Block title..."
                title="Click to edit block title"
                on:mousedown|stopPropagation
                on:pointerdown|stopPropagation
                on:click|stopPropagation
              />
              <span class="side-title-pencil">✎</span>
            </div>
          </div>
          <div class="side-header-actions">
            <button
              type="button"
              class="side-action-btn side-run-btn"
              title="Run this block now"
              on:click={() => selectedNode && executeSingleNode(selectedNode)}
            >
              ▶ Run Block
            </button>
            {#if selectedNode.type === 'rest'}
              <button
                type="button"
                class="side-action-btn"
                title="Copy cURL command for this request"
                on:click={() => selectedNode && copyNodeCurl(selectedNode)}
              >
                📋 Copy cURL
              </button>
              <button
                type="button"
                class="side-action-btn"
                title="Import cURL command for this block"
                on:click={() => (showCurlImport = !showCurlImport)}
              >
                📥 Import cURL
              </button>
            {/if}
            <button
              type="button"
              class="side-close-btn"
              title="Close panel"
              on:click={closeSidePanel}
            >
              ×
            </button>
          </div>
        </div>

        <!-- REST Node URL Bar (when REST) -->
        {#if selectedNode.type === 'rest' && selectedNode.restData}
          <div class="side-url-bar">
            <select
              class="side-method-select side-method-{selectedNode.restData.method.toLowerCase()}"
              bind:value={selectedNode.restData.method}
              on:change={notifyChange}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="HEAD">HEAD</option>
              <option value="OPTIONS">OPTIONS</option>
            </select>
            <input
              type="text"
              class="side-url-input"
              placeholder="https://api.example.com/v1/resource"
              bind:value={selectedNode.restData.url}
              on:input={onUrlInputChanged}
            />
            <select
              class="side-proxy-select"
              bind:value={selectedNode.restData.proxyMode}
              on:change={notifyChange}
              title="Proxy configuration for this block"
            >
              <option value="inherit">Proxy: Global</option>
              <option value="direct">Proxy: Direct</option>
              <option value="corsproxy">Proxy: corsproxy.io</option>
              <option value="allorigins">Proxy: allorigins.win</option>
              <option value="custom">Proxy: Custom</option>
            </select>
          </div>
          {#if selectedNode.restData.proxyMode === 'custom'}
            <div class="side-custom-proxy-row">
              <span class="custom-proxy-label">Proxy URL:</span>
              <input
                type="text"
                class="side-custom-proxy-input"
                placeholder="https://my-proxy/?url=&#123;url&#125;"
                bind:value={selectedNode.restData.customProxyUrl}
                on:change={notifyChange}
              />
            </div>
          {/if}
        {/if}

        <!-- Side Panel Navigation Tabs -->
        <div class="side-panel-tabs">
          {#if selectedNode.type === 'rest'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'params'}
              on:click={() => (sidePanelTab = 'params')}
            >
              Params
              {#if selectedNode.restData?.queryParams && selectedNode.restData.queryParams.length > 0}
                <span class="side-tab-badge">{selectedNode.restData.queryParams.length}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'headers'}
              on:click={() => (sidePanelTab = 'headers')}
            >
              Headers
              {#if selectedNode.restData?.headerRows && selectedNode.restData.headerRows.length > 0}
                <span class="side-tab-badge">{selectedNode.restData.headerRows.length}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'body'}
              on:click={() => (sidePanelTab = 'body')}
            >
              Body
              {#if selectedNode.restData?.bodyType && selectedNode.restData.bodyType !== 'none'}
                <span class="side-tab-badge">{selectedNode.restData.bodyType}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'auth'}
              on:click={() => (sidePanelTab = 'auth')}
            >
              Auth
              {#if selectedNode.restData?.authType && selectedNode.restData.authType !== 'none' && selectedNode.restData.authType !== 'inherit'}
                <span class="side-tab-badge">{selectedNode.restData.authType}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'captures'}
              on:click={() => (sidePanelTab = 'captures')}
            >
              Captures
              {#if selectedNode.restData?.captures && selectedNode.restData.captures.length > 0}
                <span class="side-tab-badge">{selectedNode.restData.captures.length}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'env'}
              on:click={() => (sidePanelTab = 'env')}
            >
              Env
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              History
              {#if selectedNode.history && selectedNode.history.length > 0}
                <span class="side-tab-badge">{selectedNode.history.length}/5</span>
              {/if}
            </button>
          {:else if selectedNode.type === 'js'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'script'}
              on:click={() => (sidePanelTab = 'script')}
            >
              Script & Snippets
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'ports'}
              on:click={() => (sidePanelTab = 'ports')}
            >
              Ports ({(selectedNode.jsData?.ports || []).length}/10)
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Console & Output
              {#if selectedNode.lastRun?.logs && selectedNode.lastRun.logs.length > 0}
                <span class="side-tab-badge">{selectedNode.lastRun.logs.length}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'env'}
              on:click={() => (sidePanelTab = 'env')}
            >
              Env
            </button>
          {:else if selectedNode.type === 'router'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'rules'}
              on:click={() => (sidePanelTab = 'rules')}
            >
              Routing Rules
              {#if selectedNode.routerData?.rules && selectedNode.routerData.rules.length > 0}
                <span class="side-tab-badge">{selectedNode.routerData.rules.length}</span>
              {/if}
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'ports'}
              on:click={() => (sidePanelTab = 'ports')}
            >
              Output Ports ({(selectedNode.routerData?.ports || []).length}/10)
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              History & Routing
              {#if selectedNode.history && selectedNode.history.length > 0}
                <span class="side-tab-badge">{selectedNode.history.length}/5</span>
              {/if}
            </button>
          {:else if selectedNode.type === 'transform'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Schema Mapping
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Preview & Output
            </button>
          {:else if selectedNode.type === 'loop'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Iterator Settings
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execution
            </button>
          {:else if selectedNode.type === 'delay'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Delay & Throttle
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execution
            </button>
          {:else if selectedNode.type === 'merge'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Synchronization Barrier
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execution
            </button>
          {:else if selectedNode.type === 'event-throw' || selectedNode.type === 'event-catch'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Event
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execution
            </button>
          {:else if selectedNode.type === 'start' || selectedNode.type === 'terminate'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Properties
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execution
            </button>
          {/if}
        </div>

        <!-- Side Panel Content Area -->
        <div class="side-panel-content">
          {#if selectedNode.type === 'rest' && selectedNode.restData}
            <!-- 1. PARAMS TAB -->
            {#if sidePanelTab === 'params'}
              <div class="tab-pane-params">
                <div class="pane-action-bar">
                  <span class="pane-title">Query Parameters (URL)</span>
                  <button type="button" class="pane-action-mini-btn" on:click={addParam}>
                    ＋ Add Parameter
                  </button>
                </div>

                <div class="key-value-table">
                  <div class="kv-header-row">
                    <span class="kv-col-check">Active</span>
                    <span class="kv-col-key">Key</span>
                    <span class="kv-col-val">Value</span>
                    <span class="kv-col-del"></span>
                  </div>
                  {#if !selectedNode.restData.queryParams || selectedNode.restData.queryParams.length === 0}
                    <div class="kv-empty-msg">No parameters configured. Click above to add.</div>
                  {:else}
                    {#each selectedNode.restData.queryParams as param, pIdx}
                      <div class="kv-row">
                        <div class="kv-col-check">
                          <input
                            type="checkbox"
                            bind:checked={param.enabled}
                            on:change={onParamsChanged}
                          />
                        </div>
                        <div class="kv-col-key">
                          <input
                            type="text"
                            placeholder="Key (e.g. page)"
                            bind:value={param.key}
                            on:input={onParamsChanged}
                          />
                        </div>
                        <div class="kv-col-val">
                          <input
                            type="text"
                            placeholder="Value or {`{{var}}`}"
                            bind:value={param.value}
                            on:input={onParamsChanged}
                          />
                        </div>
                        <div class="kv-col-del">
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove parameter"
                            aria-label="Remove parameter"
                            on:click={() => removeParam(pIdx)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>

              <!-- 2. HEADERS TAB -->
            {:else if sidePanelTab === 'headers'}
              <div class="tab-pane-headers">
                <div class="pane-action-bar">
                  <span class="pane-title">HTTP Headers</span>
                  <div class="pane-right-tools">
                    <button
                      type="button"
                      class="pane-mode-toggle"
                      on:click={() => (headersRawMode = !headersRawMode)}
                    >
                      {headersRawMode ? 'View as Table' : 'View as Raw Text'}
                    </button>
                    {#if !headersRawMode}
                      <button type="button" class="pane-action-mini-btn" on:click={addHeaderRow}>
                        ＋ Add Header
                      </button>
                    {/if}
                  </div>
                </div>

                <!-- Presets chips -->
                <div class="headers-presets-bar">
                  <span class="presets-label">Quick presets:</span>
                  <button
                    type="button"
                    class="preset-chip"
                    on:click={() => addHeaderPreset('Content-Type', 'application/json')}
                  >
                    + application/json
                  </button>
                  <button
                    type="button"
                    class="preset-chip"
                    on:click={() => addHeaderPreset('Authorization', 'Bearer {{token}}')}
                  >
                    + Bearer Token
                  </button>
                  <button
                    type="button"
                    class="preset-chip"
                    on:click={() => addHeaderPreset('Accept', '*/*')}
                  >
                    + Accept */*
                  </button>
                </div>

                {#if headersRawMode}
                  <textarea
                    class="side-raw-textarea"
                    placeholder="Key: Value (one per line)"
                    bind:value={selectedNode.restData.headers}
                    on:input={onRawHeadersChanged}
                  ></textarea>
                {:else}
                  <div class="key-value-table">
                    <div class="kv-header-row">
                      <span class="kv-col-check">Active</span>
                      <span class="kv-col-key">Key</span>
                      <span class="kv-col-val">Value</span>
                      <span class="kv-col-del"></span>
                    </div>
                    {#if !selectedNode.restData.headerRows || selectedNode.restData.headerRows.length === 0}
                      <div class="kv-empty-msg">No headers configured.</div>
                    {:else}
                      {#each selectedNode.restData.headerRows as header, hIdx}
                        <div class="kv-row">
                          <div class="kv-col-check">
                            <input
                              type="checkbox"
                              bind:checked={header.enabled}
                              on:change={onHeaderRowsChanged}
                            />
                          </div>
                          <div class="kv-col-key">
                            <input
                              type="text"
                              placeholder="Header (e.g. User-Agent)"
                              bind:value={header.key}
                              on:input={onHeaderRowsChanged}
                            />
                          </div>
                          <div class="kv-col-val">
                            <input
                              type="text"
                              placeholder="Value or {`{{token}}`}"
                              bind:value={header.value}
                              on:input={onHeaderRowsChanged}
                            />
                          </div>
                          <div class="kv-col-del">
                            <button
                              type="button"
                              class="req-delete-btn"
                              title="Remove header"
                              aria-label="Remove header"
                              on:click={() => removeHeaderRow(hIdx)}
                            >
                              <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- 3. BODY TAB (Requirement 7) -->
            {:else if sidePanelTab === 'body'}
              <div class="tab-pane-body">
                <div class="body-type-selector">
                  <label class="body-radio-label">
                    <input
                      type="radio"
                      name="nodeBodyType"
                      value="none"
                      bind:group={selectedNode.restData.bodyType}
                      on:change={notifyChange}
                    />
                    <span>None</span>
                  </label>
                  <label class="body-radio-label">
                    <input
                      type="radio"
                      name="nodeBodyType"
                      value="json"
                      bind:group={selectedNode.restData.bodyType}
                      on:change={notifyChange}
                    />
                    <span>JSON (application/json)</span>
                  </label>
                  <label class="body-radio-label">
                    <input
                      type="radio"
                      name="nodeBodyType"
                      value="text"
                      bind:group={selectedNode.restData.bodyType}
                      on:change={notifyChange}
                    />
                    <span>Raw Text</span>
                  </label>
                </div>

                {#if selectedNode.restData.bodyType === 'none'}
                  <div class="body-none-msg">This request will send no body (Empty payload).</div>
                {:else}
                  <div class="body-editor-toolbar">
                    <span class="body-syntax-label">
                      {selectedNode.restData.bodyType === 'json' ? 'JSON Payload:' : 'Text:'}
                    </span>
                    <div class="body-toolbar-actions">
                      {#if selectedNode.restData.bodyType === 'json'}
                        <button
                          type="button"
                          class="body-tool-btn"
                          on:click={formatNodeJsonBody}
                          title="Format JSON indentation"
                        >
                          ✨ Format JSON
                        </button>
                        {#if onOpenInEditor}
                          <button
                            type="button"
                            class="body-tool-btn body-editor-launch-btn"
                            on:click={openBodyInEditor}
                            title="Open this JSON in editor for advanced editing"
                          >
                            ↗ Edit in JSON Editor
                          </button>
                        {/if}
                      {/if}
                    </div>
                  </div>

                  <textarea
                    class="body-code-textarea"
                    placeholder="&#123;&quot;field&quot;: &quot;value&quot;&#125;"
                    bind:value={selectedNode.restData.body}
                    on:input={notifyChange}
                  ></textarea>
                {/if}
              </div>

              <!-- 4. AUTH TAB -->
            {:else if sidePanelTab === 'auth'}
              <div class="tab-pane-auth">
                <div class="auth-type-row">
                  <span class="auth-field-label">Authentication Type:</span>
                  <select
                    class="auth-select"
                    bind:value={selectedNode.restData.authType}
                    on:change={() => {
                      authValidationStatus = null
                      notifyChange()
                    }}
                  >
                    <option value="inherit">Inherit from Global Project</option>
                    <option value="none">None (No auth)</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth (Username / Password)</option>
                    <option value="apikey">API Key (Header / Query)</option>
                  </select>
                </div>

                {#if selectedNode.restData.authType === 'inherit'}
                  <div class="auth-info-card">
                    This block will use the authentication configured globally in the requests tab.
                  </div>
                {:else if selectedNode.restData.authType === 'none'}
                  <div class="auth-info-card">
                    No authentication headers will be added to this request.
                  </div>
                {:else if selectedNode.restData.authType === 'bearer'}
                  <div class="auth-fields-card">
                    <label class="auth-input-label">
                      <span>Token:</span>
                      <input
                        type="text"
                        class="auth-text-input"
                        placeholder="eyJhbGciOi... or {`{{token}}`}"
                        bind:value={selectedNode.restData.authBearerToken}
                        on:input={notifyChange}
                      />
                    </label>
                    <div class="auth-hint">
                      Hint: you can use environment variables like <code>{`{{token}}`}</code> or capture
                      them from a previous block.
                    </div>
                  </div>
                {:else if selectedNode.restData.authType === 'basic'}
                  <div class="auth-fields-card">
                    <label class="auth-input-label">
                      <span>Username:</span>
                      <input
                        type="text"
                        class="auth-text-input"
                        placeholder="admin or {`{{user}}`}"
                        bind:value={selectedNode.restData.authBasicUser}
                        on:input={notifyChange}
                      />
                    </label>
                    <label class="auth-input-label">
                      <span>Password:</span>
                      <input
                        type="password"
                        class="auth-text-input"
                        placeholder="•••••• or {`{{password}}`}"
                        bind:value={selectedNode.restData.authBasicPass}
                        on:input={notifyChange}
                      />
                    </label>
                  </div>
                {:else if selectedNode.restData.authType === 'apikey'}
                  <div class="auth-fields-card">
                    <label class="auth-input-label">
                      <span>Header / Key Name:</span>
                      <input
                        type="text"
                        class="auth-text-input"
                        placeholder="X-API-Key"
                        bind:value={selectedNode.restData.authApiKeyName}
                        on:input={notifyChange}
                      />
                    </label>
                    <label class="auth-input-label">
                      <span>Key Value:</span>
                      <input
                        type="text"
                        class="auth-text-input"
                        placeholder="secret-key-123"
                        bind:value={selectedNode.restData.authApiKeyValue}
                        on:input={notifyChange}
                      />
                    </label>
                  </div>
                {/if}

                {#if selectedNode.restData.authType !== 'none' && selectedNode.restData.authType !== 'inherit'}
                  <div class="auth-validation-row">
                    <button type="button" class="auth-val-btn" on:click={validateNodeAuth}>
                      🛡 Test / Validate Auth
                    </button>
                    {#if authValidationStatus}
                      <span
                        class="auth-val-badge"
                        class:ok={authValidationStatus.ok}
                        class:bad={!authValidationStatus.ok}
                      >
                        {authValidationStatus.message}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- 5. CAPTURES TAB -->
            {:else if sidePanelTab === 'captures'}
              <div class="tab-pane-captures">
                <CapturePathsTable
                  bind:captures={selectedNode.restData.captures}
                  sampleJsonText={selectedNode.lastRun?.responseText ?? ''}
                  compact={false}
                />
              </div>

              <!-- 6. ENV TAB (Active Environment + Globals) -->
            {:else if sidePanelTab === 'env'}
              <div class="tab-pane-env">
                <div class="env-head-info">
                  <span class="env-active-title">
                    Active Environment: <strong>{activeEnvName || '(None)'}</strong>
                  </span>
                  {#if onManageEnvironments}
                    <button type="button" class="env-manage-btn" on:click={onManageEnvironments}>
                      ⚙️ Manage Environments
                    </button>
                  {/if}
                </div>

                <!-- Active Env Variables -->
                <div class="env-section-box">
                  <span class="env-section-title"
                    >Active Environment Variables ({Object.keys(activeEnv).length})</span
                  >
                  <div class="env-vars-grid">
                    {#if Object.keys(activeEnv).length === 0}
                      <div class="env-empty-box">No variables in the active environment.</div>
                    {:else}
                      {#each Object.entries(activeEnv) as [k, v]}
                        <div class="env-var-card">
                          <div class="env-var-key">
                            <span>{`{{${k}}}`}</span>
                            <button
                              type="button"
                              class="env-copy-chip"
                              title="Copy placeholder"
                              on:click={() => {
                                navigator.clipboard.writeText(`{{${k}}}`)
                                showToast(`Variable {{${k}}} copied!`)
                              }}
                            >
                              Copy
                            </button>
                          </div>
                          <div class="env-var-value" title={v}>{v}</div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <!-- Global Variables -->
                <div class="env-section-box">
                  <span class="env-section-title"
                    >🌐 General / Global Env ({Object.keys(globalEnvironment).length})</span
                  >
                  <div class="env-vars-grid">
                    {#if Object.keys(globalEnvironment).length === 0}
                      <div class="env-empty-box">No global variables defined.</div>
                    {:else}
                      {#each Object.entries(globalEnvironment) as [k, v]}
                        <div class="env-var-card global-card">
                          <div class="env-var-key">
                            <span>{`{{${k}}}`}</span>
                            <button
                              type="button"
                              class="env-copy-chip"
                              title="Copy placeholder"
                              on:click={() => {
                                navigator.clipboard.writeText(`{{${k}}}`)
                                showToast(`Global variable {{${k}}} copied!`)
                              }}
                            >
                              Copy
                            </button>
                          </div>
                          <div class="env-var-value" title={v}>{v}</div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              </div>

              <!-- 7. HISTORY TAB (Strict limit of 5, No redundant body preview) -->
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                {#if selectedNode.lastRun}
                  <div class="response-summary-card">
                    <div class="res-summary-head">
                      <span
                        class="res-status-pill"
                        class:ok={typeof selectedNode.lastRun.status === 'number' &&
                          selectedNode.lastRun.status < 400}
                        class:bad={typeof selectedNode.lastRun.status === 'number' &&
                          selectedNode.lastRun.status >= 400}
                      >
                        {selectedNode.lastRun.status}
                      </span>
                      <span class="res-duration">{selectedNode.lastRun.durationMs} ms</span>
                      {#if selectedNode.lastRun.sizeBytes}
                        <span class="res-size">{formatBytes(selectedNode.lastRun.sizeBytes)}</span>
                      {/if}
                      {#if selectedNode.lastRun.viaProxy}
                        <span class="res-proxy-badge">🛡 Proxy</span>
                      {/if}
                      <span class="res-time">{relativeTime(selectedNode.lastRun.timestamp)}</span>
                    </div>

                    {#if selectedNode.lastRun.outputSummary}
                      <div class="res-summary-text">{selectedNode.lastRun.outputSummary}</div>
                    {/if}

                    {#if selectedNode.lastRun.logs && selectedNode.lastRun.logs.length > 0}
                      <div class="res-summary-logs" style="margin-top: 10px;">
                        <div class="console-head" style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-bottom: 4px;">
                          Execution Logs ({selectedNode.lastRun.logs.length}):
                        </div>
                        <pre class="console-logs" style="max-height: 180px; overflow-y: auto;">{selectedNode.lastRun.logs.join('\n')}</pre>
                      </div>
                    {/if}

                    {#if selectedNode.lastRun.responseText && onOpenInEditor}
                      <button
                        type="button"
                        class="res-editor-btn"
                        on:click={() => selectedNode && openResponseInEditor(selectedNode)}
                      >
                        ↗ Open Last Response in JSON Editor
                      </button>
                    {/if}
                  </div>
                {:else}
                  <div class="res-no-runs-msg">
                    This block has not been run yet. Click <strong>▶ Run Block</strong> above or run the
                    flow.
                  </div>
                {/if}

                <!-- Historical Executions List (Max 5) -->
                <div class="node-history-section">
                  <div class="history-section-title">
                    <span>Execution History for this Block (Max 5)</span>
                    <span class="history-count">({selectedNode.history?.length ?? 0}/5)</span>
                  </div>

                  {#if !selectedNode.history || selectedNode.history.length === 0}
                    <div class="history-empty">No history recorded for this block yet.</div>
                  {:else}
                    <div class="history-list">
                      {#each selectedNode.history as entry (entry.id)}
                        <div class="history-item">
                          <span
                            class="hist-status"
                            class:ok={typeof entry.status === 'number' && entry.status < 400}
                            class:bad={typeof entry.status === 'number' && entry.status >= 400}
                          >
                            {entry.status}
                          </span>
                          <span class="hist-meta"
                            >{entry.durationMs}ms · {relativeTime(entry.timestamp)}</span
                          >
                          {#if entry.responseText && onOpenInEditor}
                            <button
                              type="button"
                              class="hist-open-btn"
                              title="Open this response in JSON editor"
                              on:click={() =>
                                selectedNode && openResponseInEditor(selectedNode, entry)}
                            >
                              ↗ Open in Editor
                            </button>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- JS SCRIPT CONFIGURATION (when JS node) -->
          {:else if selectedNode.type === 'js' && selectedNode.jsData}
            {#if sidePanelTab === 'script'}
              <div class="tab-pane-js">
                <div class="js-snippets-bar">
                  <span class="snippets-label">Quick Snippets:</span>
                  <button
                    type="button"
                    class="preset-chip"
                    on:click={() => insertJsSnippet("pm.environment.set('token', 'valor');")}
                  >
                    + pm.environment.set
                  </button>
                  <button
                    type="button"
                    class="preset-chip"
                    on:click={() => insertJsSnippet("const val = pm.environment.get('token');")}
                  >
                    + pm.environment.get
                  </button>
                  <button
                    type="button"
                    class="preset-chip"
                    on:click={() => insertJsSnippet("console.log('Debug:', val);")}
                  >
                    + console.log
                  </button>
                  <button
                    type="button"
                    class="preset-chip chip-port"
                    title="Route to a specific output port"
                    on:click={() => insertJsSnippet("// Route flow to specific output port\nroute('port_top_1');")}
                  >
                    + route('port')
                  </button>
                  <button
                    type="button"
                    class="preset-chip chip-port"
                    title="Emit data to a specific output port"
                    on:click={() => insertJsSnippet("// Output payload to port\nout('port_top_1', { status: 'approved' });")}
                  >
                    + out('port', data)
                  </button>
                </div>

                <div class="js-editor-wrap">
                  <textarea
                    class="js-code-textarea"
                    bind:value={selectedNode.jsData.code}
                    on:input={notifyChange}
                  ></textarea>
                </div>
              </div>
            {:else if sidePanelTab === 'ports'}
              <!-- JS Dynamic Multi-Port Output Rack -->
              {@const jsPorts = selectedNode.jsData.ports || []}
              {@const topPorts = jsPorts.filter((p) => p.slot === 'top')}
              {@const midPorts = jsPorts.filter((p) => p.slot === 'middle')}
              {@const botPorts = jsPorts.filter((p) => p.slot === 'bottom')}
              <div class="tab-pane-ports">
                <div class="ports-header-card">
                  <div class="ports-header-info">
                    <span class="ports-total-title">JS Dynamic Output Ports</span>
                    <span class="ports-total-count">{jsPorts.length}/10 configured</span>
                  </div>
                  <p class="ports-help-note">
                    Distribute up to <strong>10 ports</strong> on the right edge (max 3 Top, max 4 Middle, max 3 Bottom).
                    In your script, call <code>route('port_id')</code> or <code>out('port_id', data)</code> to activate specific pins!
                  </p>
                </div>

                <!-- Top Slot (Max 3) -->
                <div class="slot-section slot-section-top">
                  <div class="slot-section-header">
                    <div class="slot-badge-wrap">
                      <span class="slot-dot dot-top"></span>
                      <span class="slot-name">TOP Slot (Max 3)</span>
                      <span class="slot-count">{topPorts.length}/3</span>
                    </div>
                    <button
                      type="button"
                      class="slot-add-btn"
                      disabled={topPorts.length >= 3 || jsPorts.length >= 10}
                      on:click={() => addPortToNode(selectedNode, 'top')}
                    >
                      ＋ Add Top Port
                    </button>
                  </div>
                  <div class="slot-ports-list">
                    {#if topPorts.length === 0}
                      <div class="slot-empty-notice">No ports in Top slot.</div>
                    {:else}
                      {#each topPorts as port (port.id)}
                        <div class="port-item-card">
                          <span class="port-pin-preview dot-top"></span>
                          <input
                            type="text"
                            class="port-label-input"
                            placeholder="e.g. Success / High Priority"
                            bind:value={port.label}
                            on:input={notifyChange}
                          />
                          <span class="port-id-pill" title="Use in route('{port.id}')">{port.id}</span>
                          <input
                            type="color"
                            class="port-color-picker"
                            bind:value={port.color}
                            on:input={notifyChange}
                            title="Port Color"
                          />
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove port"
                            aria-label="Remove port"
                            on:click={() => removePortFromNode(selectedNode, port.id)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <!-- Middle Slot (Max 4) -->
                <div class="slot-section slot-section-mid">
                  <div class="slot-section-header">
                    <div class="slot-badge-wrap">
                      <span class="slot-dot dot-mid"></span>
                      <span class="slot-name">MIDDLE Slot (Max 4)</span>
                      <span class="slot-count">{midPorts.length}/4</span>
                    </div>
                    <button
                      type="button"
                      class="slot-add-btn"
                      disabled={midPorts.length >= 4 || jsPorts.length >= 10}
                      on:click={() => addPortToNode(selectedNode, 'middle')}
                    >
                      ＋ Add Middle Port
                    </button>
                  </div>
                  <div class="slot-ports-list">
                    {#if midPorts.length === 0}
                      <div class="slot-empty-notice">No ports in Middle slot.</div>
                    {:else}
                      {#each midPorts as port (port.id)}
                        <div class="port-item-card">
                          <span class="port-pin-preview dot-mid"></span>
                          <input
                            type="text"
                            class="port-label-input"
                            placeholder="e.g. Processing / Next Step"
                            bind:value={port.label}
                            on:input={notifyChange}
                          />
                          <span class="port-id-pill" title="Use in route('{port.id}')">{port.id}</span>
                          <input
                            type="color"
                            class="port-color-picker"
                            bind:value={port.color}
                            on:input={notifyChange}
                            title="Port Color"
                          />
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove port"
                            aria-label="Remove port"
                            on:click={() => removePortFromNode(selectedNode, port.id)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <!-- Bottom Slot (Max 3) -->
                <div class="slot-section slot-section-bot">
                  <div class="slot-section-header">
                    <div class="slot-badge-wrap">
                      <span class="slot-dot dot-bot"></span>
                      <span class="slot-name">BOTTOM Slot (Max 3)</span>
                      <span class="slot-count">{botPorts.length}/3</span>
                    </div>
                    <button
                      type="button"
                      class="slot-add-btn"
                      disabled={botPorts.length >= 3 || jsPorts.length >= 10}
                      on:click={() => addPortToNode(selectedNode, 'bottom')}
                    >
                      ＋ Add Bottom Port
                    </button>
                  </div>
                  <div class="slot-ports-list">
                    {#if botPorts.length === 0}
                      <div class="slot-empty-notice">No ports in Bottom slot.</div>
                    {:else}
                      {#each botPorts as port (port.id)}
                        <div class="port-item-card">
                          <span class="port-pin-preview dot-bot"></span>
                          <input
                            type="text"
                            class="port-label-input"
                            placeholder="e.g. Error / Rejected"
                            bind:value={port.label}
                            on:input={notifyChange}
                          />
                          <span class="port-id-pill" title="Use in route('{port.id}')">{port.id}</span>
                          <input
                            type="color"
                            class="port-color-picker"
                            bind:value={port.color}
                            on:input={notifyChange}
                            title="Port Color"
                          />
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove port"
                            aria-label="Remove port"
                            on:click={() => removePortFromNode(selectedNode, port.id)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head">Console Logs (console.log):</div>
                  {#if selectedNode.lastRun?.logs && selectedNode.lastRun.logs.length > 0}
                    <pre class="console-logs">{selectedNode.lastRun.logs.join('\n')}</pre>
                  {:else}
                    <div class="console-empty">No logs yet. Run the block to see output.</div>
                  {/if}
                </div>
              </div>
            {:else if sidePanelTab === 'env'}
              <div class="tab-pane-env">
                <div class="env-head-info">
                  <span class="env-active-title">
                    Active Environment: <strong>{activeEnvName || '(None)'}</strong>
                  </span>
                </div>
                <div class="env-vars-grid">
                  {#each Object.entries(activeEnv) as [k, v]}
                    <div class="env-var-card">
                      <div class="env-var-key">{`{{${k}}}`}</div>
                      <div class="env-var-value">{v}</div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- GATEWAY ROUTER BLOCK CONFIGURATION -->
          {:else if selectedNode.type === 'router' && selectedNode.routerData}
            {#if sidePanelTab === 'rules'}
              <!-- 1. Rules Tab -->
              <div class="tab-pane-router-rules">
                <div class="rules-toolbar-card">
                  <div class="mode-select-group">
                    <label class="field-label" for="router-mode-select">Evaluation Mode:</label>
                    <select
                      id="router-mode-select"
                      class="side-method-select router-mode-select"
                      bind:value={selectedNode.routerData.mode}
                      on:change={notifyChange}
                    >
                      <option value="first-match">First Match (Stop at 1st match - Switch)</option>
                      <option value="all-matches">All Matches (Branch to all matching ports)</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    class="flow-btn-primary add-rule-btn"
                    on:click={() => addRuleToRouter(selectedNode)}
                  >
                    ＋ Add Rule
                  </button>
                </div>

                <div class="rules-list">
                  {#if selectedNode.routerData.rules.length === 0}
                    <div class="rules-empty">No routing rules configured. Click "＋ Add Rule" to create one.</div>
                  {:else}
                    {#each selectedNode.routerData.rules as rule, rIndex (rule.id)}
                      {@const matchedPort = selectedNode.routerData.ports.find((p) => p.id === rule.portId)}
                      <div class="rule-edit-card">
                        <div class="rule-card-header">
                          <div class="rule-num-wrap">
                            <span class="rule-index">#{rIndex + 1}</span>
                            <input
                              type="text"
                              class="rule-label-input"
                              placeholder="Rule label (e.g. Success 2xx)"
                              bind:value={rule.label}
                              on:input={notifyChange}
                            />
                          </div>
                          <div class="rule-target-wrap">
                            <span class="rule-dest-label">Route to:</span>
                            <select
                              class="rule-port-select"
                              bind:value={rule.portId}
                              on:change={notifyChange}
                            >
                              {#each selectedNode.routerData.ports as p}
                                <option value={p.id}>[{p.slot.toUpperCase()}] {p.label}</option>
                              {/each}
                            </select>
                            <button
                              type="button"
                              class="req-delete-btn"
                              title="Delete rule"
                              aria-label="Delete rule"
                              on:click={() => removeRuleFromRouter(selectedNode, rule.id)}
                            >
                              <svg
                                class="req-del-icon"
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M3 6h18" />
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <!-- Rule condition controls -->
                        <div class="rule-condition-body">
                          <div class="rule-type-tabs">
                            <button
                              type="button"
                              class="rule-type-btn"
                              class:active={rule.type === 'status'}
                              on:click={() => {
                                rule.type = 'status'
                                if (!rule.statusPattern) rule.statusPattern = '200-299'
                                notifyChange()
                              }}
                            >
                              HTTP Status
                            </button>
                            <button
                              type="button"
                              class="rule-type-btn"
                              class:active={rule.type === 'jsonpath'}
                              on:click={() => {
                                rule.type = 'jsonpath'
                                if (!rule.path) rule.path = 'data.status'
                                if (!rule.operator) rule.operator = '=='
                                notifyChange()
                              }}
                            >
                              JSON Path
                            </button>
                            <button
                              type="button"
                              class="rule-type-btn"
                              class:active={rule.type === 'otherwise'}
                              on:click={() => {
                                rule.type = 'otherwise'
                                notifyChange()
                              }}
                            >
                              Otherwise (Fallback)
                            </button>
                          </div>

                          {#if rule.type === 'status'}
                            <div class="condition-fields status-fields">
                              <div class="field-row">
                                <span class="field-sublabel">Status Pattern (Ranges & Lists):</span>
                                <input
                                  type="text"
                                  class="side-text-input pattern-input"
                                  placeholder="e.g. 200-299 or 200, 201, 204 or 404"
                                  bind:value={rule.statusPattern}
                                  on:input={notifyChange}
                                />
                              </div>
                              <div class="status-preset-chips">
                                <button type="button" class="preset-chip" on:click={() => { rule.statusPattern = '200-299'; notifyChange(); }}>2xx (200-299)</button>
                                <button type="button" class="preset-chip" on:click={() => { rule.statusPattern = '200, 201, 204'; notifyChange(); }}>200, 201, 204</button>
                                <button type="button" class="preset-chip" on:click={() => { rule.statusPattern = '300-399'; notifyChange(); }}>3xx (Redirect)</button>
                                <button type="button" class="preset-chip" on:click={() => { rule.statusPattern = '400-499'; notifyChange(); }}>4xx (Client Err)</button>
                                <button type="button" class="preset-chip" on:click={() => { rule.statusPattern = '500-599'; notifyChange(); }}>5xx (Server Err)</button>
                                <button type="button" class="preset-chip" on:click={() => { rule.statusPattern = '404'; notifyChange(); }}>404 Not Found</button>
                              </div>
                            </div>
                          {:else if rule.type === 'jsonpath'}
                            <div class="condition-fields jsonpath-fields">
                              <div class="jsonpath-grid" class:has-val={rule.operator !== 'exists' && rule.operator !== 'is_empty'}>
                                <div class="path-col">
                                  <span class="field-sublabel">JSON Path:</span>
                                  <input
                                    type="text"
                                    class="side-text-input"
                                    placeholder="e.g. data.total or user.role"
                                    bind:value={rule.path}
                                    on:input={notifyChange}
                                  />
                                </div>
                                <div class="op-col">
                                  <span class="field-sublabel">Operator:</span>
                                  <select
                                    class="side-method-select"
                                    bind:value={rule.operator}
                                    on:change={notifyChange}
                                  >
                                    <option value="==">== (Equal)</option>
                                    <option value="!=">!= (Not Equal)</option>
                                    <option value=">">&gt; (Greater)</option>
                                    <option value="<">&lt; (Less)</option>
                                    <option value=">=">&gt;= (Greater or Equal)</option>
                                    <option value="<=">&lt;= (Less or Equal)</option>
                                    <option value="contains">contains (Substring/Item)</option>
                                    <option value="exists">exists (Key exists)</option>
                                    <option value="is_empty">is_empty (Empty string/null)</option>
                                    <option value="in">in (In comma list)</option>
                                    <option value="between">between (min-max)</option>
                                  </select>
                                </div>
                                {#if rule.operator !== 'exists' && rule.operator !== 'is_empty'}
                                  <div class="val-col">
                                    <span class="field-sublabel">Value:</span>
                                    <input
                                      type="text"
                                      class="side-text-input"
                                      placeholder="e.g. 100 or true or admin"
                                      bind:value={rule.value}
                                      on:input={notifyChange}
                                    />
                                  </div>
                                {/if}
                              </div>
                            </div>
                          {:else if rule.type === 'otherwise'}
                            <div class="condition-fields otherwise-fields">
                              <div class="otherwise-callout">
                                <span>⚓ Fallback Route: Matches whenever no preceding condition was satisfied.</span>
                              </div>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            {:else if sidePanelTab === 'ports'}
              <!-- 2. Router Output Ports Tab -->
              {@const rPorts = selectedNode.routerData.ports || []}
              {@const topPorts = rPorts.filter((p) => p.slot === 'top')}
              {@const midPorts = rPorts.filter((p) => p.slot === 'middle')}
              {@const botPorts = rPorts.filter((p) => p.slot === 'bottom')}
              <div class="tab-pane-ports">
                <div class="ports-header-card">
                  <div class="ports-header-info">
                    <span class="ports-total-title">Output Ports Rack (Limit: 10)</span>
                    <span class="ports-total-count">{rPorts.length}/10 configured</span>
                  </div>
                  <p class="ports-help-note">
                    Ports are physically distributed on the right edge: <strong>3 Top</strong>, <strong>4 Middle</strong>, and <strong>3 Bottom</strong>.
                    Connect downstream nodes by dragging from any port pin on the canvas.
                  </p>
                </div>

                <!-- Top Slot Section (Max 3) -->
                <div class="slot-section slot-section-top">
                  <div class="slot-section-header">
                    <div class="slot-badge-wrap">
                      <span class="slot-dot dot-top"></span>
                      <span class="slot-name">TOP Slot (Max 3)</span>
                      <span class="slot-count">{topPorts.length}/3</span>
                    </div>
                    <button
                      type="button"
                      class="slot-add-btn"
                      disabled={topPorts.length >= 3 || rPorts.length >= 10}
                      on:click={() => addPortToNode(selectedNode, 'top')}
                    >
                      ＋ Add Top Port
                    </button>
                  </div>
                  <div class="slot-ports-list">
                    {#if topPorts.length === 0}
                      <div class="slot-empty-notice">No ports in Top slot. Click "+ Add Top Port" above.</div>
                    {:else}
                      {#each topPorts as port (port.id)}
                        <div class="port-item-card">
                          <span class="port-pin-preview dot-top"></span>
                          <input
                            type="text"
                            class="port-label-input"
                            placeholder="e.g. 2xx Success"
                            bind:value={port.label}
                            on:input={notifyChange}
                          />
                          <input
                            type="color"
                            class="port-color-picker"
                            bind:value={port.color}
                            on:input={notifyChange}
                            title="Port Color"
                          />
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove port"
                            aria-label="Remove port"
                            on:click={() => removePortFromNode(selectedNode, port.id)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <!-- Middle Slot Section (Max 4) -->
                <div class="slot-section slot-section-mid">
                  <div class="slot-section-header">
                    <div class="slot-badge-wrap">
                      <span class="slot-dot dot-mid"></span>
                      <span class="slot-name">MIDDLE Slot (Max 4)</span>
                      <span class="slot-count">{midPorts.length}/4</span>
                    </div>
                    <button
                      type="button"
                      class="slot-add-btn"
                      disabled={midPorts.length >= 4 || rPorts.length >= 10}
                      on:click={() => addPortToNode(selectedNode, 'middle')}
                    >
                      ＋ Add Middle Port
                    </button>
                  </div>
                  <div class="slot-ports-list">
                    {#if midPorts.length === 0}
                      <div class="slot-empty-notice">No ports in Middle slot. Click "+ Add Middle Port" above.</div>
                    {:else}
                      {#each midPorts as port (port.id)}
                        <div class="port-item-card">
                          <span class="port-pin-preview dot-mid"></span>
                          <input
                            type="text"
                            class="port-label-input"
                            placeholder="e.g. 4xx Client Err"
                            bind:value={port.label}
                            on:input={notifyChange}
                          />
                          <input
                            type="color"
                            class="port-color-picker"
                            bind:value={port.color}
                            on:input={notifyChange}
                            title="Port Color"
                          />
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove port"
                            aria-label="Remove port"
                            on:click={() => removePortFromNode(selectedNode, port.id)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <!-- Bottom Slot Section (Max 3) -->
                <div class="slot-section slot-section-bot">
                  <div class="slot-section-header">
                    <div class="slot-badge-wrap">
                      <span class="slot-dot dot-bot"></span>
                      <span class="slot-name">BOTTOM Slot (Max 3)</span>
                      <span class="slot-count">{botPorts.length}/3</span>
                    </div>
                    <button
                      type="button"
                      class="slot-add-btn"
                      disabled={botPorts.length >= 3 || rPorts.length >= 10}
                      on:click={() => addPortToNode(selectedNode, 'bottom')}
                    >
                      ＋ Add Bottom Port
                    </button>
                  </div>
                  <div class="slot-ports-list">
                    {#if botPorts.length === 0}
                      <div class="slot-empty-notice">No ports in Bottom slot. Click "+ Add Bottom Port" above.</div>
                    {:else}
                      {#each botPorts as port (port.id)}
                        <div class="port-item-card">
                          <span class="port-pin-preview dot-bot"></span>
                          <input
                            type="text"
                            class="port-label-input"
                            placeholder="e.g. Otherwise / 5xx"
                            bind:value={port.label}
                            on:input={notifyChange}
                          />
                          <input
                            type="color"
                            class="port-color-picker"
                            bind:value={port.color}
                            on:input={notifyChange}
                            title="Port Color"
                          />
                          <button
                            type="button"
                            class="req-delete-btn"
                            title="Remove port"
                            aria-label="Remove port"
                            on:click={() => removePortFromNode(selectedNode, port.id)}
                          >
                            <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <!-- 3. Router History & Routing Output Tab -->
              <div class="tab-pane-response">
                <div class="router-eval-card">
                  <div class="eval-header">Last Evaluation Summary:</div>
                  {#if selectedNode.lastRun}
                    <div class="eval-meta-grid">
                      <div class="meta-item">
                        <span class="meta-label">Status:</span>
                        <span class="meta-val badge-{selectedNode.status}">{selectedNode.lastRun.status}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Routing:</span>
                        <span class="meta-val">{selectedNode.lastRun.outputSummary}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Time:</span>
                        <span class="meta-val">{relativeTime(selectedNode.lastRun.timestamp)}</span>
                      </div>
                    </div>
                    {#if selectedNode.lastRun.responseText}
                      <div class="eval-json-preview">
                        <span class="eval-preview-title">Evaluation Details:</span>
                        <pre class="console-logs">{selectedNode.lastRun.responseText}</pre>
                      </div>
                    {/if}
                  {:else}
                    <div class="console-empty">No runs yet. Execute the flow to evaluate routing rules.</div>
                  {/if}
                </div>
              </div>
            {/if}
          {:else if selectedNode.type === 'event-throw' || selectedNode.type === 'event-catch'}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-event">
                <div class="event-config-card">
                  <div class="event-type-badge {selectedNode.type}">
                    {selectedNode.type === 'event-throw'
                      ? '🔵 Flow Jump (Broadcast Event)'
                      : '◌ Flow Receiver (Catch Event)'}
                  </div>
                  <p class="event-help-text">
                    {#if selectedNode.type === 'event-throw'}
                      When executed, this jump node transmits the signal with the event name.
                      All receiver blocks (dotted circles) with the same name will be triggered wirelessly!
                    {:else}
                      This receiver node waits for the corresponding event transmission to continue
                      flow execution through its outputs.
                    {/if}
                  </p>
                  <div class="event-input-group">
                    <label class="event-field-label" for="event-name-input">Event Name:</label>
                    <div class="event-input-row">
                      <input
                        id="event-name-input"
                        type="text"
                        class="side-text-input event-input"
                        placeholder="e.g. validate total"
                        value={selectedNode.eventData?.eventName ?? ''}
                        on:input={(e) => {
                          if (selectedNode) {
                            selectedNode.eventData = { eventName: e.currentTarget.value }
                            notifyChange()
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="preset-chip"
                        title="Use example event 'valida total'"
                        on:click={() => {
                          if (selectedNode) {
                            selectedNode.eventData = { eventName: 'valida total' }
                            notifyChange()
                          }
                        }}
                      >
                        "valida total"
                      </button>
                    </div>
                    <span class="event-tip">
                      {selectedNode.type === 'event-throw'
                        ? 'Receiver nodes with this exact name will be triggered.'
                        : 'Must match the name triggered on the jump node (solid circle).'}
                    </span>
                  </div>

                  <!-- Cross-Flow Jump Configuration (Beta) - only for Throw emitter node -->
                  {#if selectedNode.type === 'event-throw'}
                    <div class="event-input-group cross-flow-config-card">
                      <div class="cross-flow-header">
                        <span class="cross-flow-title">🔀 Spatial Flow Jump</span>
                        <span class="beta-badge">BETA</span>
                      </div>
                      <p class="cross-flow-help">
                        Triggers this event in another Spatial Flow of your workspace, activating receiver
                        nodes (◌ Catch) that match this event name in the target flow.
                        <span class="cross-flow-warn">
                          ⚠️ Sub-flow execution can be resource intensive. Upon completion,
                          the sub-flow is unloaded from memory while keeping response history
                          in this block.
                        </span>
                      </p>
                      <label class="event-field-label" for="target-flow-select"
                        >Target Spatial Flow:</label
                      >
                      <select
                        id="target-flow-select"
                        class="side-method-select side-flow-select"
                        value={selectedNode.eventData?.targetFlowId ?? ''}
                        on:change={(e) => {
                          const targetId = e.currentTarget.value
                          const match = availableFlows.find((f) => f.id === targetId)
                          if (selectedNode) {
                            selectedNode.eventData = {
                              ...(selectedNode.eventData ?? { eventName: '' }),
                              targetFlowId: targetId || undefined,
                              targetFlowName: match ? match.name : undefined
                            }
                            notifyChange()
                          }
                        }}
                      >
                        <option value="">(None — Default jump in same flow)</option>
                        {#each availableFlows as af}
                          <option value={af.id}>📁 {af.groupName} / 🔀 {af.name}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head">Execution Status:</div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Details: {selectedNode.lastRun.outputSummary}</div>
                      <div>Time: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                  {:else}
                    <div class="console-empty">
                      Not executed yet. Run the flow to see the result.
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          {:else if selectedNode.type === 'start' || selectedNode.type === 'terminate'}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-event">
                <div class="event-config-card">
                  <div class="event-type-badge {selectedNode.type}">
                    {selectedNode.type === 'start'
                      ? '🟢 Start Point (Start Node)'
                      : '🛑 Terminate Block (Stop Flow)'}
                  </div>
                  <p class="event-help-text">
                    {#if selectedNode.type === 'start'}
                      Flow starting point. All general execution begins at this node and propagates
                      to outgoing connections.
                    {:else}
                      Terminating block: when flow execution reaches this node, the flow is
                      terminated immediately and any subsequent branch is stopped.
                    {/if}
                  </p>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head">Execution Status:</div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Details: {selectedNode.lastRun.outputSummary}</div>
                      <div>Time: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                  {:else}
                    <div class="console-empty">Not executed yet.</div>
                  {/if}
                </div>
              </div>
            {/if}
          {:else if selectedNode.type === 'transform' && selectedNode.transformData}
            {@const transformPaths = getTransformAvailablePaths(selectedNode)}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-transform">
                <div class="transform-card">
                  <div class="transform-card-header">
                    <span class="transform-badge">🔄 JSON Schema Mapper</span>
                    <span class="fields-count">{(selectedNode.transformData?.mappings || []).length} fields mapped</span>
                  </div>
                  <p class="transform-help-text">
                    Map fields from the JSON payload into a new output structure to test integrations.
                  </p>

                  <div class="transform-sample-section">
                    <div class="sample-label-row">
                      <label class="field-label" for="transform-sample">Input Payload (JSON):</label>
                      <button
                        type="button"
                        class="btn-copy-sample"
                        title="Pull the previous node response as a sample"
                        on:click={() => selectedNode && copyUpstreamJsonToTransform(selectedNode)}
                      >
                        📥 Use previous node JSON
                      </button>
                    </div>
                    <textarea
                      id="transform-sample"
                      class="side-code-textarea"
                      rows="5"
                      bind:value={selectedNode.transformData.sampleInput}
                      on:input={notifyChange}
                    ></textarea>
                  </div>

                  <!-- Mappings List -->
                  <div class="transform-mappings-section">
                    <div class="mappings-header-row">
                      <div class="mappings-title-wrap">
                        <span class="section-title">Mapping Rules:</span>
                        {#if transformPaths.length > 0}
                          <span class="detected-badge-count" title="Fields available in the Source autocomplete">
                            ⚡ {transformPaths.length} fields detected
                          </span>
                        {/if}
                      </div>
                      <div class="mappings-header-actions">
                        {#if transformPaths.length > 0 && (selectedNode.transformData.mappings || []).length === 0}
                          <button
                            type="button"
                            class="btn-auto-map"
                            title="Automatically create rules for the detected fields"
                            on:click={() => selectedNode && autoMapDetectedFields(selectedNode, transformPaths)}
                          >
                            ✨ Map All
                          </button>
                        {/if}
                        <button
                          type="button"
                          class="btn-add-mapping"
                          on:click={() => selectedNode && addTransformMapping(selectedNode)}
                        >
                          ＋ Add Field
                        </button>
                      </div>
                    </div>

                    {#if (selectedNode.transformData.mappings || []).length === 0}
                      <div class="mappings-empty-hint">
                        No fields mapped. Click <strong>＋ Add Field</strong> to select source and target keys.
                      </div>
                    {:else}
                      <div class="mappings-list">
                        {#each selectedNode.transformData.mappings as mapping (mapping.id)}
                          <div
                            class="mapping-item-card"
                            class:has-active-dropdown={activePathDropdownMappingId === mapping.id}
                          >
                            <div class="mapping-paths-row">
                              <div class="mapping-col path-autocomplete-col">
                                <label class="mini-label" for={`src-${mapping.id}`}>Source (Path):</label>
                                <div class="path-combo-wrapper">
                                  <input
                                    id={`src-${mapping.id}`}
                                    type="text"
                                    class="side-text-input mini-input path-combo-input"
                                    placeholder={transformPaths.length > 0 ? `e.g. ${transformPaths[0]} (or free value)` : 'e.g. user.id or email'}
                                    bind:value={mapping.sourcePath}
                                    on:focus={() => {
                                      if (transformPaths.length > 0) openPathDropdown(mapping.id)
                                    }}
                                    on:input={() => {
                                      if (transformPaths.length > 0) openPathDropdown(mapping.id)
                                      notifyChange()
                                    }}
                                    on:keydown={(e) => handlePathKeydown(e, mapping, transformPaths)}
                                    on:blur={() => {
                                      setTimeout(() => {
                                        if (activePathDropdownMappingId === mapping.id) {
                                          closePathDropdown()
                                        }
                                      }, 180)
                                    }}
                                    autocomplete="off"
                                    spellcheck="false"
                                  />
                                  {#if transformPaths.length > 0}
                                    <button
                                      type="button"
                                      class="path-combo-trigger"
                                      class:is-active={activePathDropdownMappingId === mapping.id}
                                      title={`Fields detected in JSON (${transformPaths.length})`}
                                      tabindex="-1"
                                      on:mousedown|preventDefault
                                      on:click|stopPropagation={() => togglePathDropdown(mapping.id)}
                                    >
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                      </svg>
                                    </button>
                                  {/if}

                                  {#if activePathDropdownMappingId === mapping.id && transformPaths.length > 0}
                                    {@const matchingPaths = getFilteredTransformPaths(transformPaths, mapping.sourcePath)}
                                    <div
                                      class="path-dropdown-menu"
                                      role="listbox"
                                      tabindex="-1"
                                      on:mousedown|preventDefault
                                    >
                                      <div class="path-dropdown-header">
                                        <span class="path-dropdown-header-title">Detected Fields ({matchingPaths.length})</span>
                                        <span class="path-dropdown-badge">JSON</span>
                                      </div>

                                      {#if matchingPaths.length === 0}
                                        <div class="path-dropdown-empty">
                                          <span class="empty-title">No field matching "{mapping.sourcePath}"</span>
                                          <span class="empty-subtitle">Press Enter or keep typing your custom value.</span>
                                        </div>
                                      {:else}
                                        <div class="path-dropdown-scroll">
                                          {#each matchingPaths as path, pIdx (path)}
                                            <button
                                              type="button"
                                              class="path-dropdown-option"
                                              class:is-highlighted={highlightedPathIndex === pIdx}
                                              class:is-exact={mapping.sourcePath === path}
                                              role="option"
                                              aria-selected={mapping.sourcePath === path}
                                              on:click={() => selectTransformPath(mapping, path)}
                                              on:mouseenter={() => (highlightedPathIndex = pIdx)}
                                            >
                                              <span class="path-option-key">
                                                <span class="path-icon-bracket">&#123;&#125;</span>
                                                <span class="path-text">{path}</span>
                                              </span>
                                              {#if mapping.sourcePath === path}
                                                <span class="path-selected-check">✓</span>
                                              {/if}
                                            </button>
                                          {/each}
                                        </div>
                                      {/if}

                                      <div class="path-dropdown-footer">
                                        <span>💡 Pick from the list or type any custom path</span>
                                      </div>
                                    </div>
                                  {/if}
                                </div>
                              </div>
                              <span class="mapping-arrow">➔</span>
                              <div class="mapping-col">
                                <label class="mini-label" for={`tgt-${mapping.id}`}>Target (Path):</label>
                                <input
                                  id={`tgt-${mapping.id}`}
                                  type="text"
                                  class="side-text-input mini-input"
                                  placeholder="e.g. customerId or profile.email"
                                  bind:value={mapping.targetPath}
                                  on:input={notifyChange}
                                  spellcheck="false"
                                />
                              </div>
                              <button
                                type="button"
                                class="req-delete-btn"
                                title="Remove rule"
                                aria-label="Remove rule"
                                on:click={() => selectedNode && removeTransformMapping(selectedNode, mapping.id)}
                              >
                                <svg class="req-del-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <path d="M3 6h18" />
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              </button>
                            </div>

                            <div class="mapping-options-row">
                              <div class="option-col">
                                <label class="mini-label" for={`mod-${mapping.id}`}>Modifier:</label>
                                <select
                                  id={`mod-${mapping.id}`}
                                  class="side-method-select mini-select"
                                  bind:value={mapping.modifier}
                                  on:change={notifyChange}
                                >
                                  <option value="direct">Direct (original)</option>
                                  <option value="uppercase">UPPERCASE</option>
                                  <option value="lowercase">lowercase</option>
                                  <option value="trim">trim (remove whitespace)</option>
                                  <option value="number">number</option>
                                  <option value="string">string (text)</option>
                                  <option value="boolean">boolean</option>
                                </select>
                              </div>
                              <div class="option-col">
                                <label class="mini-label" for={`def-${mapping.id}`}>Default Value (Fallback):</label>
                                <input
                                  id={`def-${mapping.id}`}
                                  type="text"
                                  class="side-text-input mini-input"
                                  placeholder="optional if null"
                                  bind:value={mapping.defaultValue}
                                  on:input={notifyChange}
                                  spellcheck="false"
                                />
                              </div>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>

                  <!-- Live Transformation Preview -->
                  <div class="transform-live-preview-section">
                    <div class="preview-header-row">
                      <span class="section-title">Live Preview:</span>
                      <button
                        type="button"
                        class="btn-run-mapping"
                        on:click={() => selectedNode && executeSingleNode(selectedNode)}
                      >
                        ▶ Test Mapping
                      </button>
                    </div>
                    <pre class="console-logs preview-box">{getLiveTransformPreview(selectedNode)}</pre>
                  </div>

                  <!-- Variable Saving -->
                  <div class="field-row">
                    <label class="field-label" for="save-env-var">Save Resulting JSON to Environment Variable:</label>
                    <input
                      id="save-env-var"
                      type="text"
                      class="side-text-input"
                      placeholder="e.g. mappedCustomer (optional)"
                      bind:value={selectedNode.transformData.saveToEnvVar}
                      on:input={notifyChange}
                    />
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head-row">
                    <span class="console-head">Transformation Output:</span>
                    {#if selectedNode.lastRun?.responseText && onOpenInEditor}
                      <button
                        type="button"
                        class="node-quick-btn"
                        on:click={() => selectedNode && openResponseInEditor(selectedNode)}
                      >
                        ↗ Open in Editor
                      </button>
                    {/if}
                  </div>
                  {#if selectedNode.lastRun}
                    <pre class="console-logs">{selectedNode.lastRun.responseText || selectedNode.lastRun.outputSummary}</pre>
                  {:else}
                    <div class="console-empty">Not executed yet. Run flow or click ▶ to test.</div>
                  {/if}
                </div>
              </div>
            {/if}
          {:else if selectedNode.type === 'loop' && selectedNode.loopData}
            {@const loopInfo = getLoopUpstreamInfo(selectedNode)}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-loop">
                <div class="loop-card">
                  <!-- Header with Mode Selector -->
                  <div class="loop-card-header">
                    <div class="loop-badge">🔁 Iterator Loop</div>
                    <div class="loop-mode-toggle">
                      <button
                        type="button"
                        class="loop-mode-btn"
                        class:active={!selectedNode.loopData.mode || selectedNode.loopData.mode === 'for-each'}
                        on:click={() => {
                          if (selectedNode.loopData) selectedNode.loopData.mode = 'for-each'
                          notifyChange()
                        }}
                      >
                        Collection (Array)
                      </button>
                      <button
                        type="button"
                        class="loop-mode-btn"
                        class:active={selectedNode.loopData.mode === 'count'}
                        on:click={() => {
                          if (selectedNode.loopData) {
                            selectedNode.loopData.mode = 'count'
                            if (!selectedNode.loopData.repeatCount) selectedNode.loopData.repeatCount = 5
                            if (!selectedNode.loopData.indexVar) selectedNode.loopData.indexVar = 'index'
                          }
                          notifyChange()
                        }}
                      >
                        Counter (N Times)
                      </button>
                    </div>
                  </div>

                  {#if !selectedNode.loopData.mode || selectedNode.loopData.mode === 'for-each'}
                    <!-- Smart Upstream Array Detection Banner -->
                    {#if loopInfo.connected}
                      <div class="loop-upstream-bar">
                        <div class="upstream-meta">
                          <span class="upstream-icon">⚡</span>
                          <span class="upstream-label">Connected input: <strong>{loopInfo.upNode?.title || 'Previous Node'}</strong></span>
                        </div>
                        {#if loopInfo.executed}
                          {#if loopInfo.detectedArrays.length > 0}
                            <div class="detected-section">
                              <span class="detected-title">✨ Arrays detected in the payload:</span>
                              <div class="detected-chips">
                                {#each loopInfo.detectedArrays as arr}
                                  <button
                                    type="button"
                                    class="preset-chip chip-detected"
                                    class:active={selectedNode.loopData.arrayPath === arr.path}
                                    title={`Select ${arr.path || 'Root array'} with ${arr.length} items`}
                                    on:click={() => {
                                      if (selectedNode.loopData) selectedNode.loopData.arrayPath = arr.path
                                      notifyChange()
                                    }}
                                  >
                                    <span class="chip-path">{arr.path || '[ ] Root'}</span>
                                    <span class="chip-count">{arr.length} {arr.length === 1 ? 'item' : 'items'}</span>
                                  </button>
                                {/each}
                              </div>
                            </div>
                          {:else}
                            <div class="upstream-hint">
                              ℹ️ The previous node ran, but no array was automatically detected in its output.
                            </div>
                          {/if}
                        {:else}
                          <div class="upstream-hint">
                            ⏳ The previous node has not run yet. Click <strong>▶ Run Block</strong> on it to detect arrays in real time.
                          </div>
                        {/if}
                      </div>
                    {:else}
                      <div class="loop-upstream-bar is-unconnected">
                        <span class="upstream-icon">🔗</span>
                        <span class="upstream-hint">
                          Connect a previous node (REST, JS or Mapper) to the Iterator Loop to detect collections automatically.
                        </span>
                      </div>
                    {/if}

                    <!-- Collection Path Field -->
                    <div class="field-row">
                      <div class="field-label-row">
                        <label class="field-label" for="loop-array-path">Collection Path (Array):</label>
                        <span class="field-subnote">Dot-notation path in the JSON</span>
                      </div>
                      <input
                        id="loop-array-path"
                        type="text"
                        class="side-text-input"
                        placeholder="e.g. items or data.users, or leave empty for a root array"
                        bind:value={selectedNode.loopData.arrayPath}
                        on:input={notifyChange}
                      />
                      <!-- Common quick suggestion chips -->
                      <div class="quick-chips-row">
                        <span class="chips-label">Suggestions:</span>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.arrayPath = 'items'; notifyChange(); }}>items</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.arrayPath = 'data.items'; notifyChange(); }}>data.items</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.arrayPath = 'results'; notifyChange(); }}>results</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.arrayPath = 'data'; notifyChange(); }}>data</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.arrayPath = ''; notifyChange(); }}>[ ] Root</button>
                      </div>
                    </div>

                    <!-- Live Array Evaluation Preview Box -->
                    {#if loopInfo.currentEvaluation}
                      <div class="array-eval-box" class:is-valid={loopInfo.currentEvaluation.isValid}>
                        {#if loopInfo.currentEvaluation.isValid}
                          <div class="eval-status-row">
                            <span class="eval-badge-success">✓ Valid Array</span>
                            <span class="eval-count-tag">{loopInfo.currentEvaluation.length} items found</span>
                            {#if loopInfo.currentEvaluation.length > (selectedNode.loopData.maxIterations || 1000)}
                              <span class="eval-limit-warning">⚠️ Limited to {selectedNode.loopData.maxIterations || 1000}</span>
                            {/if}
                          </div>
                          {#if loopInfo.currentEvaluation.sampleItem !== undefined}
                            <div class="sample-preview-card">
                              <span class="sample-tag">Item [0] (Preview):</span>
                              <pre class="sample-preview-code">{JSON.stringify(loopInfo.currentEvaluation.sampleItem, null, 2)}</pre>
                            </div>
                          {/if}
                        {:else}
                          <div class="eval-status-row is-error">
                            <span class="eval-badge-error">Warning</span>
                            <span class="eval-msg">{loopInfo.currentEvaluation.errorMsg}</span>
                          </div>
                        {/if}
                      </div>
                    {/if}

                    <!-- Item Variable Name -->
                    <div class="field-row">
                      <div class="field-label-row">
                        <label class="field-label" for="loop-item-var">Item Variable Name:</label>
                        <span class="field-subnote">Injected as <code>{"{{" + (selectedNode.loopData.itemVar || 'item') + "}}"}</code></span>
                      </div>
                      <input
                        id="loop-item-var"
                        type="text"
                        class="side-text-input"
                        placeholder="e.g. item"
                        bind:value={selectedNode.loopData.itemVar}
                        on:input={notifyChange}
                      />
                      <div class="quick-chips-row">
                        <span class="chips-label">Presets:</span>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.itemVar = 'item'; notifyChange(); }}>item</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.itemVar = 'row'; notifyChange(); }}>row</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.itemVar = 'user'; notifyChange(); }}>user</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.itemVar = 'record'; notifyChange(); }}>record</button>
                      </div>
                    </div>
                  {:else}
                    <!-- Counter / Repeat Mode -->
                    <div class="field-row">
                      <div class="field-label-row">
                        <label class="field-label" for="loop-repeat-count">Repeat How Many Times (Iterations):</label>
                        <span class="field-subnote">Total loop iterations</span>
                      </div>
                      <input
                        id="loop-repeat-count"
                        type="number"
                        min="1"
                        max="5000"
                        class="side-text-input"
                        placeholder="5"
                        bind:value={selectedNode.loopData.repeatCount}
                        on:input={notifyChange}
                      />
                      <div class="quick-chips-row">
                        <span class="chips-label">Shortcuts:</span>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.repeatCount = 3; notifyChange(); }}>3x</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.repeatCount = 5; notifyChange(); }}>5x</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.repeatCount = 10; notifyChange(); }}>10x</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.repeatCount = 20; notifyChange(); }}>20x</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.repeatCount = 50; notifyChange(); }}>50x</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.repeatCount = 100; notifyChange(); }}>100x</button>
                      </div>
                    </div>

                    <div class="field-row">
                      <div class="field-label-row">
                        <label class="field-label" for="loop-index-var">Counter Variable Name:</label>
                        <span class="field-subnote">Injected as <code>{"{{" + (selectedNode.loopData.indexVar || 'index') + "}}"}</code> (0, 1, 2...)</span>
                      </div>
                      <input
                        id="loop-index-var"
                        type="text"
                        class="side-text-input"
                        placeholder="e.g. index or i"
                        bind:value={selectedNode.loopData.indexVar}
                        on:input={notifyChange}
                      />
                      <div class="quick-chips-row">
                        <span class="chips-label">Presets:</span>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.indexVar = 'index'; notifyChange(); }}>index</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.indexVar = 'i'; notifyChange(); }}>i</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.indexVar = 'step'; notifyChange(); }}>step</button>
                        <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.indexVar = 'count'; notifyChange(); }}>count</button>
                      </div>
                    </div>
                  {/if}

                  <!-- Max Iterations Limit -->
                  <div class="field-row">
                    <div class="field-label-row">
                      <label class="field-label" for="loop-max-iter">Maximum Safety Limit:</label>
                      <span class="field-subnote">Prevents infinite loops</span>
                    </div>
                    <input
                      id="loop-max-iter"
                      type="number"
                      class="side-text-input"
                      placeholder="1000"
                      bind:value={selectedNode.loopData.maxIterations}
                      on:input={notifyChange}
                    />
                    <div class="quick-chips-row">
                      <span class="chips-label">Quick limits:</span>
                      <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.maxIterations = 10; notifyChange(); }}>10</button>
                      <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.maxIterations = 50; notifyChange(); }}>50</button>
                      <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.maxIterations = 100; notifyChange(); }}>100</button>
                      <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.maxIterations = 500; notifyChange(); }}>500</button>
                      <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.maxIterations = 1000; notifyChange(); }}>1000</button>
                      <button type="button" class="preset-chip" on:click={() => { if (selectedNode.loopData) selectedNode.loopData.maxIterations = 5000; notifyChange(); }}>5000</button>
                    </div>
                  </div>

                  <!-- Available Variables Reference Callout -->
                  <div class="loop-vars-callout">
                    <span class="vars-callout-title">📦 Variables Available Inside the Loop:</span>
                    <div class="vars-callout-grid">
                      <div class="var-item">
                        <code>{"{{" + (selectedNode.loopData.mode === 'count' ? (selectedNode.loopData.indexVar || 'index') : (selectedNode.loopData.itemVar || 'item')) + "}}"}</code>
                        <span>{selectedNode.loopData.mode === 'count' ? 'Current iteration number (0, 1, 2...)' : 'Current element content'}</span>
                      </div>
                      <div class="var-item">
                        <code>{"{{index}}"}</code>
                        <span>Numeric iteration index (0-indexed)</span>
                      </div>
                      <div class="var-item">
                        <code>{"{{loop_total}}"}</code>
                        <span>Total items iterated in this run</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head-row">
                    <span class="console-head">Loop Summary:</span>
                    {#if selectedNode.lastRun?.responseText && onOpenInEditor}
                      <button
                        type="button"
                        class="node-quick-btn"
                        on:click={() => selectedNode && openResponseInEditor(selectedNode)}
                      >
                        ↗ Open in Editor
                      </button>
                    {/if}
                  </div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Details: {selectedNode.lastRun.outputSummary}</div>
                      <div>Time: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                    {#if selectedNode.lastRun.logs && selectedNode.lastRun.logs.length > 0}
                      <div class="console-head-row" style="margin-top: 10px;">
                        <span class="console-head">Iteration Trace ({selectedNode.lastRun.logs.length}):</span>
                      </div>
                      <pre class="console-logs" style="max-height: 160px; overflow-y: auto;">{selectedNode.lastRun.logs.join('\n')}</pre>
                    {/if}
                    {#if selectedNode.lastRun.responseText}
                      <div class="console-head-row" style="margin-top: 10px;">
                        <span class="console-head">Loop Output:</span>
                      </div>
                      <pre class="console-logs">{selectedNode.lastRun.responseText}</pre>
                    {/if}
                  {:else}
                    <div class="console-empty">Not executed yet.</div>
                  {/if}
                </div>
              </div>
            {/if}
          {:else if selectedNode.type === 'delay' && selectedNode.delayData}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-delay">
                <div class="delay-card">
                  <div class="delay-badge">⏳ Delay & Throttle</div>
                  <div class="field-row">
                    <label class="field-label" for="delay-mode">Mode:</label>
                    <select
                      id="delay-mode"
                      class="side-method-select"
                      bind:value={selectedNode.delayData.mode}
                      on:change={notifyChange}
                    >
                      <option value="delay">Fixed Delay (Pause flow)</option>
                      <option value="throttle">Rate Limit / Throttle</option>
                    </select>
                  </div>
                  <div class="field-row">
                    <label class="field-label" for="delay-ms">Delay Duration (ms):</label>
                    <input
                      id="delay-ms"
                      type="number"
                      class="side-text-input"
                      placeholder="1000"
                      bind:value={selectedNode.delayData.delayMs}
                      on:input={notifyChange}
                    />
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head-row">
                    <span class="console-head">Delay Status:</span>
                    {#if selectedNode.lastRun?.responseText && onOpenInEditor}
                      <button
                        type="button"
                        class="node-quick-btn"
                        on:click={() => selectedNode && openResponseInEditor(selectedNode)}
                      >
                        ↗ Open in Editor
                      </button>
                    {/if}
                  </div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Details: {selectedNode.lastRun.outputSummary}</div>
                      <div>Time: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                    {#if selectedNode.lastRun.responseText}
                      <pre class="console-logs">{selectedNode.lastRun.responseText}</pre>
                    {/if}
                  {:else}
                    <div class="console-empty">Not executed yet.</div>
                  {/if}
                </div>
              </div>
            {/if}
          {:else if selectedNode.type === 'merge' && selectedNode.mergeData}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-merge">
                <div class="merge-card">
                  <div class="merge-badge">🔗 Branch Synchronization Barrier</div>
                  <div class="field-row">
                    <label class="field-label" for="merge-strategy">Join Strategy:</label>
                    <select
                      id="merge-strategy"
                      class="side-method-select"
                      bind:value={selectedNode.mergeData.strategy}
                      on:change={notifyChange}
                    >
                      <option value="wait-all">Wait for All Branches (Solid Join)</option>
                      <option value="first-complete">First Complete (Race)</option>
                    </select>
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head-row">
                    <span class="console-head">Merge Status:</span>
                    {#if selectedNode.lastRun?.responseText && onOpenInEditor}
                      <button
                        type="button"
                        class="node-quick-btn"
                        on:click={() => selectedNode && openResponseInEditor(selectedNode)}
                      >
                        ↗ Open in Editor
                      </button>
                    {/if}
                  </div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Details: {selectedNode.lastRun.outputSummary}</div>
                      <div>Time: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                    {#if selectedNode.lastRun.responseText}
                      <pre class="console-logs">{selectedNode.lastRun.responseText}</pre>
                    {/if}
                  {:else}
                    <div class="console-empty">Not executed yet.</div>
                  {/if}
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

<!-- cURL Import Modal (placed at component root to escape side-panel and toolbar stacking contexts) -->
{#if showCurlImport && selectedNode && selectedNode.type === 'rest'}
  <CurlImportModal
    open={true}
    onImport={importCurlIntoNode}
    onClose={() => (showCurlImport = false)}
  />
{/if}

<style lang="scss">
  .flow-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--theme-bg-editor, #1e1e1e);
    color: var(--theme-t-main, #e2e8f0);
    font-family: inherit;
    overflow: hidden;
  }

  /* Toolbar */
  .flow-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    min-height: 44px;
    padding: 6px 14px;
    background: var(--theme-bg-chrome, #181818);
    border-bottom: 1px solid var(--theme-b-main, #333333);
    flex-shrink: 0;
    gap: 8px;
    flex-wrap: nowrap;
    white-space: nowrap;
    position: relative;
    z-index: 200;
    overflow: visible;
  }

  .flow-toolbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .flow-toolbar-divider {
    width: 1px;
    height: 20px;
    background: var(--theme-b-main, rgba(255, 255, 255, 0.12));
    margin: 0 4px;
    flex-shrink: 0;
  }

  .flow-toolbar-spacer {
    flex: 1;
    min-width: 8px;
  }

  .toolbar-group-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theme-t-sub, #94a3b8);
    margin-right: 2px;
  }

  .flow-toolbar button {
    white-space: nowrap;
    flex-shrink: 0;
  }

  .flow-btn-secondary {
    background: transparent !important;
    border-color: var(--theme-b-main, rgba(255, 255, 255, 0.12)) !important;
    color: var(--theme-t-main, #cbd5e1) !important;

    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08)) !important;
      color: var(--theme-t-bright, #ffffff) !important;
    }
  }

  .flow-btn-clear:hover {
    border-color: rgba(239, 68, 68, 0.4) !important;
    color: #f87171 !important;
  }

  .flow-btn-event {
    border-color: rgba(56, 189, 248, 0.35);

    &:hover {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
    }
  }
  .flow-file-menu,
  .flow-examples-wrap {
    position: relative;
    z-index: 210;
  }
  .flow-file-menu .file-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flow-file-menu .flow-btn.is-open {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-ac, rgba(56, 189, 248, 0.6));
    color: var(--theme-t-bright, #ffffff);
  }
  .btn-caret {
    font-size: 9px;
    opacity: 0.7;
  }
  .flow-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    left: auto;
    min-width: 190px;
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 8px;
    box-shadow: var(--theme-shadow-lg, 0 10px 28px rgba(0, 0, 0, 0.5));
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }
  .flow-menu button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--theme-t-bright, #cbd5e1);
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .flow-menu button:hover {
    background: var(--theme-bg-hover, #383838);
    color: var(--theme-t-bright, #ffffff);
  }
  .flow-menu small {
    color: var(--theme-t-muted, #64748b);
    font-size: 10px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flow-menu-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theme-t-sub, #94a3b8);
    padding: 6px 10px 2px;
    user-select: none;
  }
  .flow-examples-dropdown {
    min-width: 290px;
  }
  .flow-menu button.menu-item-rich {
    height: auto;
    padding: 8px 10px;
    align-items: flex-start;
    gap: 10px;
    line-height: 1.3;
    white-space: normal;
  }
  .menu-item-icon {
    font-size: 15px;
    margin-top: 1px;
    flex-shrink: 0;
  }
  .menu-item-desc {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    white-space: normal;

    strong {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--theme-t-bright, #cbd5e1);
    }
    small {
      font-size: 10px;
      color: var(--theme-t-muted, #94a3b8);
      max-width: none;
      white-space: normal;
    }
  }
  .flow-menu-item-danger {
    color: #f87171 !important;
  }
  .flow-menu-item-danger:hover {
    background: rgba(239, 68, 68, 0.15) !important;
    color: #fca5a5 !important;
  }
  .flow-menu-sep {
    height: 1px;
    background: var(--theme-b-subtle, rgba(255, 255, 255, 0.1));
    margin: 4px 2px;
  }
  .flow-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    background: var(--theme-ac, #0078d4);
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: all 0.12s ease;
  }
  .flow-btn-primary:hover:not(:disabled) {
    background: var(--theme-ac-hover, #0067b8);
    transform: translateY(-1px);
  }
  .flow-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .flow-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    background: var(--theme-bg-card, #2d2d30);
    color: var(--theme-t-bright, #cbd5e1);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .flow-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-b-input-hover, rgba(255, 255, 255, 0.2));
    color: var(--theme-t-bright, #ffffff);
  }
  .btn-icon {
    font-size: 12px;
  }
  .flow-divider {
    width: 1px;
    height: 16px;
    background: var(--theme-b-subtle, rgba(255, 255, 255, 0.12));
    margin: 0 2px;
  }
  .flow-legend {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 10px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .legend-line {
    display: inline-block;
    width: 18px;
    height: 2px;
  }
  .legend-line.solid {
    background: #38bdf8;
  }
  .legend-line.dotted {
    background: #a855f7;
    border-top: 2px dashed #a855f7;
    height: 0;
  }
  .legend-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;

    &.green {
      background: #22c55e;
      box-shadow: 0 0 5px rgba(34, 197, 94, 0.7);
    }
    &.red {
      background: #ef4444;
      box-shadow: 0 0 5px rgba(239, 68, 68, 0.7);
    }
    &.blue {
      background: #0284c7;
      box-shadow: 0 0 5px rgba(2, 132, 199, 0.7);
    }
    &.blue-dashed {
      background: rgba(14, 165, 233, 0.25);
      border: 1px dashed #38bdf8;
    }
  }
  .flow-status-msg {
    font-size: 11px;
    color: var(--theme-ac, #3883fa);
    background: var(--theme-ac-subtle, rgba(56, 189, 248, 0.1));
    padding: 2px 8px;
    border-radius: 4px;
  }

  /* Zoom Controls */
  .flow-zoom-control {
    display: inline-flex;
    align-items: center;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 6px;
    padding: 1px;
    gap: 1px;
  }
  .zoom-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #94a3b8);
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 700;
    transition: all 0.12s ease;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.1));
      color: var(--theme-ac, #3883fa);
    }
  }
  .zoom-level-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-bright, #e2e8f0);
    font-size: 11px;
    font-weight: 600;
    padding: 0 6px;
    height: 24px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.12s ease;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.1));
      color: var(--theme-ac, #3883fa);
    }
  }
  .zoom-reset-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #64748b);
    width: 22px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
    font-size: 11px;
    transition: all 0.12s ease;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.1));
      color: var(--theme-t-bright, #f1f5f9);
    }
  }

  /* Floating Zoom in Bottom Right of Canvas Viewport */
  .flow-floating-zoom {
    position: absolute;
    bottom: 20px;
    right: 20px;
    z-index: 25;
    display: flex;
    align-items: center;
    background: var(--theme-bg-panel, rgba(30, 30, 30, 0.88));
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--theme-b-main, rgba(255, 255, 255, 0.14));
    border-radius: 20px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
    padding: 3px 6px;
    gap: 3px;
    user-select: none;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      border-color: var(--theme-ac, rgba(56, 189, 248, 0.5));
    }
  }

  /* Floating Legend in Bottom Left of Canvas Viewport */
  .flow-floating-legend {
    position: absolute;
    bottom: 20px;
    left: 20px;
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--theme-bg-panel, rgba(30, 30, 30, 0.88));
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--theme-b-main, rgba(255, 255, 255, 0.14));
    border-radius: 20px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
    padding: 6px 14px;
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
    user-select: none;
    pointer-events: auto;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      border-color: var(--theme-ac, rgba(56, 189, 248, 0.5));
    }

    .legend-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--theme-t-bright, #e2e8f0);
      padding-right: 10px;
      border-right: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.14));
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .legend-items {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: nowrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
      white-space: nowrap;
      transition: color 0.15s ease;

      &:hover {
        color: var(--theme-t-bright, #ffffff);
      }
    }
  }

  /* Work area with canvas on left and side panel on right */
  .flow-work-area {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    z-index: 1;
  }

  @media (max-width: 900px) {
    .flow-toolbar {
      padding: 6px 8px;
      gap: 6px;
    }
    .flow-toolbar-palette .toolbar-group-label {
      display: none;
    }
    .flow-btn-draggable .btn-drag-handle {
      display: none;
    }
  }

  @media (max-width: 750px) {
    .flow-toolbar-palette .flow-btn span:not(.btn-icon) {
      display: none;
    }
    .flow-toolbar-layout .flow-btn span:not(.btn-icon) {
      display: none;
    }
  }

  /* Viewport wrapper for spatial canvas with pinned floating overlays */
  .flow-canvas-viewport {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
    display: flex;
  }

  /* Spatial Canvas (scrollable infinite canvas) */
  .flow-canvas {
    flex: 1;
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--theme-bg-editor, #1e1e1e);
    overflow: auto;
    min-height: 0;
    user-select: none;
  }
  .flow-zoom-container {
    width: 4000px;
    height: 4000px;
    position: relative;
    transform-origin: 0 0;
    background: radial-gradient(
      circle,
      var(--theme-b-subtle, rgba(255, 255, 255, 0.08)) 1px,
      transparent 1px
    );
    background-size: 24px 24px;
  }
  .flow-svg-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 4000px;
    height: 4000px;
    pointer-events: none;
    z-index: 1;
  }
  .connection-group {
    pointer-events: all;
    cursor: pointer;
  }
  .conn-hitbox {
    fill: none;
    stroke: transparent;
    stroke-width: 18px;
    cursor: pointer;
  }
  .conn-line {
    fill: none;
    stroke: #3883fa;
    stroke-width: 2.2px;
    transition:
      stroke 0.2s,
      stroke-width 0.2s;
  }
  .connection-group:hover .conn-line {
    stroke-width: 3.2px;
    filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.4));
  }
  .connection-group.is-selected .conn-line {
    stroke-width: 3.5px;
    filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.8));
  }
  .conn-line.dotted {
    stroke: #a855f7;
    stroke-dasharray: 6, 4;
  }
  .connection-group.is-selected .conn-line.dotted {
    stroke-width: 3.5px;
    filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.8));
  }
  .conn-line.running {
    stroke: #facc15;
    animation: dash-anim 1s linear infinite;
  }
  .conn-line-draft {
    fill: none;
    stroke: #3883fa;
    stroke-width: 2px;
    stroke-dasharray: 4, 3;
  }
  @keyframes dash-anim {
    to {
      stroke-dashoffset: -20;
    }
  }

  /* Draggable toolbar buttons */
  .flow-btn-draggable {
    cursor: grab;
    user-select: none;
    position: relative;
    &:active {
      cursor: grabbing;
    }
  }
  .btn-drag-handle {
    opacity: 0.45;
    font-size: 11px;
    letter-spacing: -1px;
    margin-left: 2px;
    transition: opacity 0.15s ease;
  }
  .flow-btn-draggable:hover .btn-drag-handle {
    opacity: 0.9;
    color: #3883fa;
  }

  /* Connection Ball Control on Arrow ("Bola acima da seta") */
  .conn-ball-overlay-wrap {
    position: absolute;
    transform: translate(-50%, calc(-100% - 14px));
    z-index: 25; /* Always above all node boxes (z-index: 2) */
    pointer-events: auto;
    transition: transform 0.12s ease;

    &.align-below {
      transform: translate(-50%, 14px);

      .conn-ball-control::after {
        top: auto;
        bottom: 100%;
        border-color: transparent transparent #38bdf8 transparent;
      }

      .conn-ball-control.is-dotted::after {
        border-color: transparent transparent #a855f7 transparent;
      }
    }
  }
  .conn-ball-control {
    position: relative;
    display: inline-flex;
    align-items: center;
    background: #090d16;
    border: 2px solid #38bdf8;
    border-radius: 9999px;
    padding: 3px 6px;
    gap: 4px;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.8),
      0 0 10px rgba(56, 189, 248, 0.5);
    animation: ball-pop 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    user-select: none;
    pointer-events: auto;
    white-space: nowrap;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;

    &::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border-width: 5px;
      border-style: solid;
      border-color: #38bdf8 transparent transparent transparent;
    }
  }
  @keyframes ball-pop {
    from {
      transform: scale(0.65);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  .conn-ball-control.is-dotted {
    background: #0e0a1a;
    border-color: #a855f7;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.8),
      0 0 10px rgba(168, 85, 247, 0.5);

    &::after {
      border-color: #a855f7 transparent transparent transparent;
    }
  }
  .ball-dot-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .ball-dot-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f1f5f9;
  }
  .ball-dot-btn.blue.active {
    background: rgba(56, 189, 248, 0.22);
    color: #3883fa;
  }
  .ball-dot-btn.purple.active {
    background: rgba(168, 85, 247, 0.25);
    color: #d8b4fe;
  }
  .color-disc {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }
  .color-disc.blue {
    background: #38bdf8;
    box-shadow: 0 0 6px #38bdf8;
  }
  .color-disc.purple {
    background: #c084fc;
    box-shadow: 0 0 6px #a855f7;
  }
  .color-name {
    font-size: 11px;
    line-height: 1;
  }
  .ball-divider {
    width: 1px;
    height: 12px;
    background: rgba(255, 255, 255, 0.15);
  }
  .ball-delete-btn {
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 14px;
    font-weight: bold;
    padding: 1px 5px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.12s ease;
    line-height: 1;
  }
  .ball-delete-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  /* HTML Nodes */
  .flow-node {
    position: absolute;
    width: 280px;
    height: 140px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 9px;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, #3e3e42);
    box-shadow: var(--theme-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.35));
    z-index: 2;
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      opacity 0.15s ease;
    user-select: none;
    cursor: grab;
  }
  .flow-node:active {
    cursor: grabbing;
  }
  .flow-node.is-dragging {
    opacity: 0.55;
    cursor: grabbing !important;
    box-shadow:
      0 16px 36px rgba(0, 0, 0, 0.7),
      0 0 0 2px var(--theme-ac, #38bdf8),
      0 0 18px rgba(56, 189, 248, 0.3);
    z-index: 100;
  }
  .flow-node:hover {
    border-color: var(--theme-b-input-hover, rgba(255, 255, 255, 0.25));
  }
  .flow-node.is-selected {
    border-color: var(--theme-ac, #3883fa);
    box-shadow:
      0 0 0 2px rgba(56, 189, 248, 0.35),
      var(--theme-shadow-md, 0 6px 16px rgba(0, 0, 0, 0.5));
  }
  .flow-node-js {
    border-left: 3px solid #a855f7;
  }
  .flow-node-transform {
    border-left: 3px solid #06b6d4;
  }
  .flow-node-rest {
    border-left: 3px solid var(--theme-ac, #3883fa);
  }
  .flow-node-router {
    border-left: 3px solid #f59e0b;
  }
  .flow-node-loop {
    border-left: 3px solid #6366f1;
  }
  .flow-node-delay {
    border-left: 3px solid #10b981;
  }
  .flow-node-merge {
    border-left: 3px solid #8b5cf6;
  }

  /* Floating switch type button on cards (top-left ↻) */
  .card-switch-btn {
    position: absolute;
    top: -6px;
    left: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--theme-bg-panel, #1e1e1e);
    border: 1px solid var(--theme-b-main, #444);
    color: var(--theme-t-sub, #aaa);
    display: none;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 15;
    padding: 0;
    transition: all 0.15s ease;

    &:hover,
    &.active {
      background: var(--theme-ac, #3883fa);
      color: #fff;
      border-color: var(--theme-ac, #3883fa);
      box-shadow: 0 0 8px rgba(56, 131, 250, 0.4);
    }
  }

  .flow-node:hover .card-switch-btn,
  .flow-node.is-selected .card-switch-btn,
  .flow-node.has-switcher-open .card-switch-btn {
    display: flex;
  }
  .flow-node.status-running {
    border-color: #facc15;
    box-shadow: 0 0 8px rgba(229, 142, 38, 0.3);
  }
  .flow-node.status-success {
    border-color: #4ec9b0;
  }
  .flow-node.status-error {
    border-color: #ef4444;
  }
  .flow-node.status-skipped {
    border-color: #64748b;
    opacity: 0.55;
    filter: grayscale(0.6);
  }

  /* Circular BPMN Diagram Nodes */
  .flow-node-circle {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 0.18s,
      border-color 0.18s;

    .circle-inner {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .circle-symbol {
      font-size: 20px;
      line-height: 1;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .circle-symbol.start {
      color: #ffffff;
      font-size: 18px;
      margin-left: 2px;
    }

    .circle-symbol.terminate {
      color: #ffffff;
      font-size: 17px;
    }

    .circle-symbol.throw {
      color: #ffffff;
      font-size: 18px;
    }

    .circle-symbol.catch {
      color: #38bdf8;
      font-size: 18px;
    }

    /* Start Node: Green Ball */
    &.flow-node-start {
      background: radial-gradient(circle at 35% 35%, #22c55e, #15803d);
      border: 2.5px solid #4ade80;
      box-shadow:
        0 4px 14px rgba(34, 197, 94, 0.35),
        inset 0 1px 2px rgba(255, 255, 255, 0.4);

      &:hover {
        box-shadow:
          0 6px 20px rgba(34, 197, 94, 0.5),
          inset 0 1px 2px rgba(255, 255, 255, 0.5);
        transform: scale(1.06);
      }
    }

    /* Terminate Node: Red/Dark Ball */
    &.flow-node-terminate {
      background: radial-gradient(circle at 35% 35%, #ef4444, #991b1b);
      border: 2.5px solid #f87171;
      box-shadow:
        0 4px 14px rgba(239, 68, 68, 0.35),
        inset 0 1px 2px rgba(255, 255, 255, 0.35);

      &:hover {
        box-shadow:
          0 6px 20px rgba(239, 68, 68, 0.5),
          inset 0 1px 2px rgba(255, 255, 255, 0.45);
        transform: scale(1.06);
      }
    }

    /* Event Throw Node: Solid Blue Ball */
    &.flow-node-event-throw {
      background: radial-gradient(circle at 35% 35%, #0284c7, #0369a1);
      border: 2.5px solid #38bdf8;
      box-shadow:
        0 4px 16px rgba(2, 132, 199, 0.4),
        inset 0 1px 2px rgba(255, 255, 255, 0.4);

      &:hover {
        box-shadow:
          0 6px 22px rgba(2, 132, 199, 0.55),
          inset 0 1px 2px rgba(255, 255, 255, 0.5);
        transform: scale(1.06);
      }
    }

    /* Event Catch Node: Dotted Blue Ball */
    &.flow-node-event-catch {
      background: radial-gradient(
        circle at 50% 50%,
        rgba(14, 165, 233, 0.22),
        rgba(2, 132, 199, 0.08)
      );
      backdrop-filter: blur(4px);
      border: 2.5px dashed var(--theme-accent-text, #0066cc);
      box-shadow: 0 4px 14px rgba(56, 189, 248, 0.25);

      &:hover {
        box-shadow: 0 6px 20px rgba(56, 189, 248, 0.4);
        transform: scale(1.06);
        background: radial-gradient(
          circle at 50% 50%,
          rgba(14, 165, 233, 0.3),
          rgba(2, 132, 199, 0.14)
        );
      }
    }

    /* Selection Glow */
    &.is-selected {
      z-index: 50;
      box-shadow:
        0 0 0 3px var(--theme-ac, #38bdf8),
        0 8px 24px rgba(0, 0, 0, 0.4) !important;
    }

    &.has-switcher-open {
      z-index: 100;
    }

    /* Running status pulse */
    &.status-running {
      animation: circle-pulse 1.2s infinite ease-in-out;
    }

    /* Ports for circle nodes */
    .circle-port-input {
      top: 50% !important;
      left: -6px !important;
      transform: translateY(-50%) !important;
    }

    .circle-port-output {
      top: 50% !important;
      right: -6px !important;
      transform: translateY(-50%) !important;
    }

    /* Floating switch type button (top-left) */
    .circle-switch-btn {
      position: absolute;
      top: -6px;
      left: -6px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--theme-bg-panel, #1e1e1e);
      border: 1px solid var(--theme-b-main, #444);
      color: var(--theme-t-sub, #aaa);
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      padding: 0;
      transition: all 0.15s ease;

      &:hover,
      &.active {
        background: var(--theme-ac, #3883fa);
        color: #fff;
        border-color: var(--theme-ac, #3883fa);
        box-shadow: 0 0 8px rgba(56, 131, 250, 0.4);
      }
    }

    &:hover .circle-switch-btn,
    &.is-selected .circle-switch-btn,
    &.has-switcher-open .circle-switch-btn {
      display: flex;
    }

    /* Floating delete button */
    .circle-delete-btn {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--theme-bg-panel, #1e1e1e);
      border: 1px solid var(--theme-b-main, #444);
      color: var(--theme-t-sub, #aaa);
      font-size: 12px;
      line-height: 1;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      padding: 0;

      &:hover {
        background: #ef4444;
        color: #fff;
        border-color: #ef4444;
      }
    }

    &:hover .circle-delete-btn,
    &.is-selected .circle-delete-btn {
      display: flex;
    }

    /* Label badge beneath circle */
    .circle-label-badge {
      position: absolute;
      top: 58px;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      background: var(--theme-bg-panel, #252526);
      border: 1px solid var(--theme-b-main, #3e3e42);
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--theme-t-bright, #0f172a);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;

      .circle-badge-text.event {
        color: var(--theme-accent-text, #0066cc);
      }
    }

    /* Floating Type Switcher (Just like conn-ball-control on line) */
    .circle-type-control {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--theme-bg-panel, #1e1e1e);
      border: 1px solid var(--theme-b-main, rgba(255, 255, 255, 0.16));
      box-shadow:
        0 6px 20px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(0, 0, 0, 0.1);
      border-radius: 20px;
      padding: 4px 6px;
      white-space: nowrap;
      z-index: 100;
      pointer-events: auto;
      cursor: default;

      &::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-width: 5px;
        border-style: solid;
        border-color: var(--theme-b-main, rgba(255, 255, 255, 0.16)) transparent transparent
          transparent;
      }

      &.align-left {
        left: 0;
        transform: translateX(0);

        &::after {
          left: 27px;
          transform: translateX(-50%);
        }
      }

      &.align-bottom {
        bottom: auto;
        top: calc(100% + 10px);

        &::after {
          top: auto;
          bottom: 100%;
          border-color: transparent transparent var(--theme-b-main, rgba(255, 255, 255, 0.16))
            transparent;
        }
      }

      .circle-type-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 24px;
        padding: 0 8px;
        border-radius: 12px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--theme-t-sub, #94a3b8);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.12s ease;

        &:hover {
          background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
          color: var(--theme-t-main, #fff);
        }

        &.active {
          font-weight: 600;
          color: var(--theme-t-bright, #fff);
          background: var(--theme-bg-hover, rgba(255, 255, 255, 0.14));
          border-color: var(--theme-b-subtle, rgba(255, 255, 255, 0.2));
        }

        .type-disc {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;

          &.green {
            background: #22c55e;
          }
          &.red {
            background: #ef4444;
          }
          &.blue {
            background: #0284c7;
          }
          &.blue-dashed {
            background: rgba(14, 165, 233, 0.3);
            border: 1px dashed #38bdf8;
          }
        }
      }
    }
  }

  @keyframes circle-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.12);
    }
  }

  /* Side panel event configuration tab */
  .tab-pane-event {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .event-config-card {
    background: var(--theme-bg-panel, #1e1e1e);
    border: 1px solid var(--theme-b-main, #333);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .event-type-badge {
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 12px;
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;

    &.event-throw {
      background: rgba(2, 132, 199, 0.15);
      color: var(--theme-accent-text, #0066cc);
      border: 1px solid rgba(56, 189, 248, 0.4);
    }
    &.event-catch {
      background: rgba(14, 165, 233, 0.1);
      color: var(--theme-accent-text, #0066cc);
      border: 1px dashed rgba(56, 189, 248, 0.5);
    }
    &.start {
      background: rgba(34, 197, 94, 0.15);
      color: var(--theme-console-log, #047857);
      border: 1px solid rgba(74, 222, 128, 0.4);
    }
    &.terminate {
      background: rgba(239, 68, 68, 0.15);
      color: var(--theme-danger-text, #b91c1c);
      border: 1px solid rgba(248, 113, 113, 0.4);
    }
  }
  .event-help-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--theme-t-sub, #94a3b8);
  }
  .event-input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .event-field-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-main, #e2e8f0);
  }
  .event-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .event-input {
    flex: 1;
    font-size: 13px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--theme-bg-input, #18181b);
    border: 1px solid var(--theme-b-main, #3f3f46);
    color: var(--theme-t-main, #fff);
  }
  .event-tip {
    font-size: 11px;
    color: var(--theme-t-sub, #64748b);
  }
  .event-run-info {
    font-size: 12px;
    line-height: 1.6;
    color: var(--theme-t-main, #cbd5e1);
  }

  /* Ports */
  .node-port {
    position: absolute;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--theme-bg-panel, #2d2d30);
    border: 2px solid var(--theme-ac, #38bdf8);
    cursor: crosshair;
    z-index: 6;
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .node-port:hover {
    transform: translate(-50%, -50%) scale(1.3);
  }
  .port-input {
    left: -3px;
    top: 50%;
    transform: translate(-50%, -50%);
    border-color: var(--theme-t-muted, #94a3b8);
  }
  .port-input:hover {
    transform: translate(-50%, -50%) scale(1.3);
  }
  .port-output {
    right: -1px;
    top: 50%;
    transform: translate(50%, -50%);
    border-color: var(--theme-ac, #3883fa);
  }
  .port-output:hover {
    transform: translate(50%, -50%) scale(1.3);
  }

  /* Multi-Port Rack on Node (physical slots: Top, Right, Bottom) */
  .node-ports-rack {
    position: absolute;
    top: -1px;
    bottom: -1px;
    right: -1px;
    left: -3px;
    pointer-events: none;
    z-index: 6;
  }
  .port-multi {
    pointer-events: auto;
    position: absolute;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--theme-bg-panel, #2d2d30);
    border: 2px solid var(--theme-ac, #38bdf8);
    cursor: crosshair;
    z-index: 6;
    right: auto;
    bottom: auto;
    transform: translate(-50%, -50%);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .port-multi:hover {
    transform: translate(-50%, -50%) scale(1.35);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
  }
  .port-multi.slot-top {
    border-color: #10b981;
  }
  .port-multi.slot-middle {
    border-color: #f59e0b;
  }
  .port-multi.slot-bottom {
    border-color: #ef4444;
  }
  .port-tooltip {
    display: none;
    position: absolute;
    background: #18181b;
    color: #f1f5f9;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    z-index: 20;
  }
  .port-multi:hover .port-tooltip {
    display: block;
  }
  .port-tooltip.slot-tip-top {
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
  }
  .port-tooltip.slot-tip-middle {
    right: 22px;
    top: 50%;
    transform: translateY(-50%);
  }
  .port-tooltip.slot-tip-bottom {
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
  }

  /* Multi-Input Rack for Merge */
  .node-inputs-rack {
    position: absolute;
    top: -1px;
    bottom: -1px;
    right: -1px;
    left: -3px;
    pointer-events: none;
    z-index: 6;
  }
  .port-multi-input {
    pointer-events: auto;
    position: absolute;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--theme-bg-panel, #2d2d30);
    border: 2px solid var(--theme-t-muted, #94a3b8);
    cursor: pointer;
    z-index: 6;
    right: auto;
    bottom: auto;
    transform: translate(-50%, -50%);
    transition: transform 0.15s, box-shadow 0.15s;

    &:hover {
      transform: translate(-50%, -50%) scale(1.35);
      border-color: var(--theme-ac, #3883fa);
      box-shadow: 0 0 10px rgba(56, 131, 250, 0.6);

      .input-tip {
        display: block;
      }
    }

    .input-tip {
      display: none;
      position: absolute;
      left: 22px;
      top: 50%;
      transform: translateY(-50%);
      background: #18181b;
      color: #f1f5f9;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      pointer-events: none;
      z-index: 20;
    }
  }

  /* Compact slim previews for Router, Transform, Loop, Delay, Merge */
  .node-router-preview-compact,
  .node-transform-preview-compact,
  .node-loop-preview-compact,
  .node-delay-preview-compact,
  .node-merge-preview-compact {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 0;
  }

  .node-compact-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .summary-label {
      color: var(--theme-t-sub, #475569);
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .summary-val {
      color: var(--theme-t-bright, #0f172a);
      font-weight: 600;
      font-family: monospace;
      font-size: 10.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .compact-chip {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 9.5px;
    font-weight: 600;
    background: var(--theme-chip-bg, #f1f5f9);
    color: var(--theme-chip-text, #1e293b);
    border: 1px solid var(--theme-chip-border, #cbd5e1);
    letter-spacing: 0.2px;
  }

  /* Node Router Preview in Card Body */
  .node-router-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    background: var(--theme-bg-panel, #f1f5f9);
    border-radius: 6px;
    border: 1px solid var(--theme-b-subtle, #cbd5e1);
  }
  .router-mode-chip {
    align-self: flex-start;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
  .router-rules-mini {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rule-mini-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--theme-t-bright, #f1f5f9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rule-slot-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .rule-slot-dot.slot-top {
    background: #10b981;
  }
  .rule-slot-dot.slot-middle {
    background: #f59e0b;
  }
  .rule-slot-dot.slot-bottom {
    background: #ef4444;
  }
  .rule-mini-text {
    font-family: monospace;
    font-size: 10px;
    color: #cbd5e1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rule-mini-arrow {
    color: #64748b;
    font-size: 9px;
    flex-shrink: 0;
  }
  .rule-mini-port {
    font-size: 10px;
    font-weight: 600;
    color: #f59e0b;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rules-more-count {
    font-size: 10px;
    color: #64748b;
    font-style: italic;
  }

  /* Toolbar Button for Router */
  .flow-btn-router {
    border-color: rgba(245, 158, 11, 0.35);
  }
  .flow-btn-router:hover {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
  }

  /* Chip for port snippets in JS editor */
  .chip-port {
    border-color: rgba(168, 85, 247, 0.4);
    color: #c084fc;
  }
  .chip-port:hover {
    background: rgba(168, 85, 247, 0.18);
    border-color: #a855f7;
  }

  /* Side Panel Tab Panes: Rules, Ports, Transform, Loop, Delay, Merge */
  .tab-pane-router-rules,
  .tab-pane-ports,
  .tab-pane-transform,
  .tab-pane-loop,
  .tab-pane-delay,
  .tab-pane-merge {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px 14px;
  }

  .transform-card,
  .loop-card,
  .delay-card,
  .merge-card {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, #3e3e42);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Intelligent Iterator Loop Styles */
  .loop-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    border-bottom: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    padding-bottom: 8px;
  }
  .loop-mode-toggle {
    display: inline-flex;
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.06));
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  .loop-mode-btn {
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    border: none;
    background: transparent;
    color: var(--theme-t-muted, #94a3b8);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .loop-mode-btn:hover {
    color: var(--theme-t-bright, #0f172a);
  }
  .loop-mode-btn.active {
    background: var(--theme-ac, #0284c7);
    color: #ffffff;
    box-shadow: 0 1px 4px rgba(2, 132, 199, 0.3);
  }
  .loop-upstream-bar {
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .loop-upstream-bar.is-unconnected {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
    font-style: italic;
  }
  .upstream-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--theme-t-bright, #0f172a);
  }
  .upstream-icon {
    font-size: 12px;
  }
  .upstream-hint {
    font-size: 11px;
    line-height: 1.4;
    color: var(--theme-t-muted, #64748b);
  }
  .detected-section {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 2px;
  }
  .detected-title {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--theme-ac, #0284c7);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .detected-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip-detected {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(2, 132, 199, 0.08);
    border: 1px solid rgba(2, 132, 199, 0.25);
    color: var(--theme-t-bright, #0f172a);
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .chip-detected:hover {
    background: rgba(2, 132, 199, 0.18);
    border-color: var(--theme-ac, #0284c7);
    transform: translateY(-1px);
  }
  .chip-detected.active {
    background: var(--theme-ac, #0284c7);
    border-color: var(--theme-ac, #0284c7);
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35);
  }
  .chip-detected .chip-count {
    font-size: 10px;
    opacity: 0.85;
    background: rgba(0, 0, 0, 0.15);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .field-label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
  }
  .field-subnote {
    font-size: 10px;
    color: var(--theme-t-muted, #64748b);
  }
  .field-subnote code {
    background: var(--theme-bg-input, rgba(0, 0, 0, 0.06));
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    color: var(--theme-ac, #0284c7);
  }
  .quick-chips-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }
  .chips-label {
    font-size: 10px;
    color: var(--theme-t-muted, #64748b);
    font-weight: 500;
  }
  .array-eval-box {
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .array-eval-box.is-valid {
    border-color: rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.04);
  }
  .eval-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .eval-badge-success {
    font-size: 10px;
    font-weight: 700;
    color: #10b981;
    background: rgba(16, 185, 129, 0.12);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .eval-badge-error {
    font-size: 10px;
    font-weight: 700;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .eval-count-tag {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .eval-limit-warning {
    font-size: 10.5px;
    color: #f59e0b;
    font-weight: 500;
  }
  .sample-preview-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 2px;
  }
  .sample-tag {
    font-size: 10px;
    font-weight: 600;
    color: var(--theme-t-muted, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .sample-preview-code {
    max-height: 90px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 10.5px;
    background: var(--theme-bg-input, #1e1e1e);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    padding: 6px 8px;
    color: var(--theme-t-bright, #e2e8f0);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .loop-vars-callout {
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.05));
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .vars-callout-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .vars-callout-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .var-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
  }
  .var-item code {
    background: rgba(2, 132, 199, 0.12);
    color: var(--theme-ac, #0284c7);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;
    font-weight: 600;
    font-size: 10.5px;
    flex-shrink: 0;
  }

  .transform-badge,
  .loop-badge,
  .delay-badge,
  .merge-badge {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-bright, #ffffff);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .transform-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .fields-count {
    font-size: 11px;
    color: var(--theme-t-sub, #94a3b8);
  }

  .transform-help-text {
    font-size: 11.5px;
    color: var(--theme-t-sub, #94a3b8);
    margin: 0;
    line-height: 1.4;
  }

  .transform-sample-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .side-code-textarea {
    width: 100%;
    font-family: monospace;
    font-size: 11px;
    padding: 8px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 6px;
    color: var(--theme-t-bright, #0f172a);
    resize: vertical;
    outline: none;

    &:focus {
      border-color: var(--theme-ac, #3883fa);
    }
  }

  .sample-label-row,
  .mappings-header-row,
  .preview-header-row,
  .console-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .btn-copy-sample,
  .btn-add-mapping,
  .btn-run-mapping {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--theme-b-input, #cbd5e1);
    background: var(--theme-bg-card, #ffffff);
    color: var(--theme-t-bright, #0f172a);
    cursor: pointer;
    font-weight: 500;
    transition: all 0.12s ease;

    &:hover {
      background: var(--theme-ac, #3883fa);
      color: #ffffff;
      border-color: var(--theme-ac, #3883fa);
    }
  }

  .transform-mappings-section,
  .transform-live-preview-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .mappings-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mapping-item-card {
    background: var(--theme-bg-panel, #f8fafc);
    border: 1px solid var(--theme-b-subtle, #e2e8f0);
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;

    &.has-active-dropdown {
      z-index: 100;
    }
  }

  .mapping-paths-row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }

  .mapping-options-row {
    display: flex;
    gap: 8px;
  }

  .mapping-col,
  .option-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .path-autocomplete-col {
    position: relative;
  }

  .path-combo-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .path-combo-input {
    width: 100%;
    padding-right: 22px;
  }

  .path-combo-input::-webkit-calendar-picker-indicator {
    display: none !important;
  }

  .path-combo-trigger {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--theme-t-muted, #64748b);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;

    &:hover {
      background: var(--theme-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--theme-ac, #0078d4);
    }

    &.is-active {
      color: var(--theme-ac, #0078d4);
      transform: translateY(-50%) rotate(180deg);
    }
  }

  .path-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    min-width: 230px;
    background: var(--theme-bg-card, #ffffff);
    border: 1px solid var(--theme-b-main, #cbd5e1);
    border-radius: 6px;
    box-shadow: var(--theme-shadow-lg, 0 10px 26px rgba(0, 0, 0, 0.15));
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: comboFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes comboFadeIn {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .path-dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theme-t-sub, #64748b);
    background: var(--theme-bg-panel, #f8fafc);
    border-bottom: 1px solid var(--theme-b-subtle, #e2e8f0);
    user-select: none;
  }

  .path-dropdown-header-title {
    font-size: 10px;
  }

  .path-dropdown-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--theme-ac-subtle, rgba(0, 120, 212, 0.12));
    color: var(--theme-ac, #0078d4);
  }

  .path-dropdown-scroll {
    max-height: 160px;
    overflow-y: auto;
    padding: 3px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .path-dropdown-scroll::-webkit-scrollbar {
    width: 5px;
  }

  .path-dropdown-scroll::-webkit-scrollbar-thumb {
    background: var(--theme-b-main, #cbd5e1);
    border-radius: 4px;
  }

  .path-dropdown-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--theme-t-bright, #0f172a);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    width: 100%;
    transition: background 0.1s ease, color 0.1s ease;

    &:hover,
    &.is-highlighted {
      background: var(--theme-bg-hover, rgba(0, 120, 212, 0.08));
      color: var(--theme-ac, #0078d4);
    }

    &.is-exact {
      font-weight: 600;
    }
  }

  .path-option-key {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .path-icon-bracket {
    font-size: 10px;
    font-weight: bold;
    color: var(--theme-ac, #0078d4);
    opacity: 0.85;
    flex-shrink: 0;
  }

  .path-text {
    font-family: var(--jse-font-family-mono, monospace);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path-selected-check {
    color: var(--theme-ac, #0078d4);
    font-weight: bold;
    font-size: 11px;
    flex-shrink: 0;
  }

  .path-dropdown-empty {
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    text-align: center;
    color: var(--theme-t-muted, #64748b);
  }

  .path-dropdown-empty .empty-title {
    font-size: 11px;
    font-weight: 500;
    color: var(--theme-t-sub, #475569);
  }

  .path-dropdown-empty .empty-subtitle {
    font-size: 10px;
    color: var(--theme-t-muted, #94a3b8);
  }

  .path-dropdown-footer {
    padding: 5px 8px;
    font-size: 9.5px;
    color: var(--theme-t-muted, #94a3b8);
    background: var(--theme-bg-panel, #f8fafc);
    border-top: 1px solid var(--theme-b-subtle, #e2e8f0);
    user-select: none;
  }

  .mini-label {
    font-size: 10px;
    color: var(--theme-t-sub, #94a3b8);
    font-weight: 500;
  }

  .mappings-title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .detected-badge-count {
    font-size: 9.5px;
    font-weight: 600;
    color: #10b981;
    background: rgba(16, 185, 129, 0.12);
    padding: 1px 6px;
    border-radius: 4px;
    letter-spacing: 0.2px;
  }

  .mappings-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-auto-map {
    font-size: 10.5px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.12s ease;

    &:hover {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10b981;
      transform: translateY(-1px);
    }
  }

  .mini-input,
  .mini-select {
    font-size: 11px;
    padding: 4px 6px;
    height: 26px;
  }

  .mapping-arrow {
    color: var(--theme-ac, #06b6d4);
    font-weight: bold;
    font-size: 12px;
    margin-bottom: 5px;
  }

  .btn-remove-mapping {
    background: transparent;
    border: none;
    color: var(--theme-t-sub, #94a3b8);
    font-size: 14px;
    cursor: pointer;
    padding: 0 4px;
    margin-bottom: 3px;
    border-radius: 3px;

    &:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.15);
    }
  }

  .mappings-empty-hint {
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
    padding: 10px;
    background: var(--theme-bg-hover, rgba(0, 0, 0, 0.04));
    border: 1px dashed var(--theme-b-subtle, #cbd5e1);
    border-radius: 6px;
    text-align: center;
  }

  .preview-box {
    max-height: 140px;
    overflow-y: auto;
    font-size: 10.5px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 6px;
    padding: 6px 8px;
    color: var(--theme-console-log, #047857);
  }

  .rules-toolbar-card,
  .ports-header-card {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, #3e3e42);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mode-select-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .router-mode-select {
    flex: 1;
  }
  .add-rule-btn {
    align-self: flex-start;
  }
  .rules-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rules-empty {
    padding: 20px;
    text-align: center;
    color: var(--theme-t-muted, #64748b);
    font-size: 12px;
    background: var(--theme-bg-hover, rgba(0, 0, 0, 0.04));
    border-radius: 8px;
    border: 1px dashed var(--theme-b-subtle, #cbd5e1);
  }
  .rule-edit-card {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, #3e3e42);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
  }
  .rule-card-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .rule-num-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 140px;
    min-width: 0;
  }
  .rule-index {
    font-size: 11px;
    font-weight: 700;
    color: #f59e0b;
    padding: 2px 6px;
    background: rgba(245, 158, 11, 0.15);
    border-radius: 4px;
    flex-shrink: 0;
  }
  .rule-label-input {
    flex: 1;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    background: var(--theme-bg-input, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    padding: 4px 8px;
    color: var(--theme-t-bright, #f1f5f9);
    font-size: 12px;
  }
  .rule-label-input:focus {
    outline: none;
    border-color: var(--theme-ac, #3883fa);
  }
  .rule-target-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    justify-content: flex-end;
    min-width: 0;
  }
  .rule-dest-label {
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .rule-port-select {
    background: var(--theme-bg-input, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    padding: 4px 8px;
    color: #d97706;
    font-weight: 600;
    font-size: 11px;
    max-width: 170px;
    min-width: 0;
    text-overflow: ellipsis;
    flex-shrink: 1;
  }
  .rule-port-select:focus {
    outline: none;
    border-color: var(--theme-ac, #3883fa);
  }
  .rule-del-btn {
    background: transparent;
    border: none;
    color: #ef4444;
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .rule-del-btn:hover {
    background: rgba(239, 68, 68, 0.2);
  }
  .rule-condition-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .rule-type-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
  }
  .rule-type-btn {
    flex: 1 1 auto;
    padding: 4px 8px;
    font-size: 11px;
    text-align: center;
    white-space: nowrap;
    border-radius: 4px;
    background: var(--theme-sb-btn-bg, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--theme-sb-btn-border, rgba(255, 255, 255, 0.1));
    color: var(--theme-t-main, #334155);
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .rule-type-btn:hover {
    background: var(--theme-bg-hover, rgba(0, 0, 0, 0.08));
  }
  .rule-type-btn.active {
    background: rgba(245, 158, 11, 0.18);
    border-color: #f59e0b;
    color: #d97706;
    font-weight: 700;
  }
  .condition-fields {
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.05));
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    overflow: hidden;
  }
  .field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .field-sublabel {
    font-size: 11px;
    color: var(--theme-t-main, #334155);
    font-weight: 600;
  }
  .status-preset-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
    box-sizing: border-box;
  }
  .jsonpath-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    align-items: flex-start;
  }
  .path-col,
  .op-col,
  .val-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    box-sizing: border-box;
  }

  /* When Value field is present: JSON Path takes full top row so long paths don't get truncated,
     Operator and Value sit side by side on row 2 */
  .jsonpath-grid.has-val .path-col {
    flex: 1 1 100%;
    width: 100%;
  }
  .jsonpath-grid.has-val .op-col {
    flex: 1 1 120px;
  }
  .jsonpath-grid.has-val .val-col {
    flex: 1 1 120px;
  }

  /* When Value field is absent (is_empty / exists): JSON Path and Operator share row 1 cleanly */
  .jsonpath-grid:not(.has-val) .path-col {
    flex: 2 1 140px;
  }
  .jsonpath-grid:not(.has-val) .op-col {
    flex: 1 1 130px;
  }

  @media (min-width: 480px) {
    .jsonpath-grid.has-val .path-col {
      flex: 2 1 160px;
      width: auto;
    }
    .jsonpath-grid.has-val .op-col {
      flex: 1 1 120px;
    }
    .jsonpath-grid.has-val .val-col {
      flex: 1 1 120px;
    }
  }

  .path-col .side-text-input,
  .val-col .side-text-input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .op-col .side-method-select {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    text-overflow: ellipsis;
  }
  .otherwise-callout {
    font-size: 11px;
    color: var(--theme-t-main, #334155);
    font-style: italic;
    line-height: 1.4;
  }

  /* Slot Sections in Ports Tab */
  .ports-header-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .ports-total-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--theme-t-bright, #0f172a);
  }
  .ports-total-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-ac, #0078d4);
    padding: 2px 6px;
    background: var(--theme-ac-subtle, rgba(56, 189, 248, 0.12));
    border-radius: 4px;
  }
  .ports-help-note {
    font-size: 11px;
    line-height: 1.5;
    color: var(--theme-t-muted, #64748b);
    margin: 0;
  }
  .slot-section {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, #3e3e42);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .slot-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .slot-badge-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slot-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot-top {
    background: #10b981;
  }
  .dot-mid {
    background: #f59e0b;
  }
  .dot-bot {
    background: #ef4444;
  }
  .slot-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .slot-count {
    font-size: 10px;
    color: var(--theme-t-muted, #64748b);
  }
  .slot-add-btn {
    background: var(--theme-sb-btn-bg, rgba(15, 23, 42, 0.06));
    border: 1px solid var(--theme-sb-btn-border, rgba(15, 23, 42, 0.15));
    color: var(--theme-t-bright, #0f172a);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .slot-add-btn:hover:not(:disabled) {
    background: var(--theme-sb-btn-hover-bg, rgba(15, 23, 42, 0.12));
    border-color: var(--theme-sb-btn-hover-border, rgba(15, 23, 42, 0.25));
  }
  .slot-add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .slot-ports-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .slot-empty-notice {
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
    font-style: italic;
    padding: 4px 0;
  }
  .port-item-card {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.05));
    border: 1px solid var(--theme-b-subtle, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    padding: 4px 8px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .port-pin-preview {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .port-label-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--theme-t-bright, #0f172a);
    font-size: 12px;
    font-weight: 500;
  }
  .port-label-input:focus {
    outline: none;
    border-bottom: 1px solid var(--theme-ac, #38bdf8);
  }
  .port-id-pill {
    font-size: 10px;
    font-family: monospace;
    color: var(--theme-t-muted, #64748b);
    background: var(--theme-sb-btn-bg, rgba(0, 0, 0, 0.04));
    padding: 2px 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .port-color-picker {
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .port-delete-btn {
    background: transparent;
    border: none;
    color: #ef4444;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    border-radius: 4px;
  }
  .port-delete-btn:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  /* Universal Professional Request Delete Button */
  .req-delete-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid transparent;
    background: transparent;
    color: var(--theme-t-muted, #858585);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
    line-height: 1;

    .req-del-icon {
      width: 12px;
      height: 12px;
      display: block;
      pointer-events: none;
      transition: transform 0.12s ease;
    }

    &:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.35);
      color: #ef4444;
      transform: scale(1.05);

      .req-del-icon {
        transform: scale(1.08);
      }
    }

    &:active {
      transform: scale(0.95);
      background: rgba(239, 68, 68, 0.25);
    }

    &:focus-visible {
      outline: 2px solid #ef4444;
      outline-offset: 1px;
    }
  }

  :global(.jse-theme-default) .req-delete-btn,
  :global(.jse-theme-light) .req-delete-btn {
    color: #64748b;

    &:hover {
      background: #fee2e2;
      border-color: #fca5a5;
      color: #dc2626;
    }
  }

  .side-text-input {
    width: 100%;
    box-sizing: border-box;
    height: 28px;
    background: var(--theme-bg-input, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #cccccc);
    font-size: 11px;
    padding: 0 8px;
    outline: none;
    transition: border-color 0.12s ease;
  }
  .side-text-input:focus {
    border-color: var(--theme-ac, #3883fa);
  }

  /* Router Evaluation Response Panel */
  .router-eval-card {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, #3e3e42);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .eval-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .eval-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .meta-label {
    font-size: 10px;
    color: var(--theme-t-muted, #64748b);
    text-transform: uppercase;
  }
  .meta-val {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .meta-val.badge-success {
    color: #10b981;
  }
  .meta-val.badge-error {
    color: #ef4444;
  }
  .eval-json-preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .eval-preview-title {
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
  }

  /* Node Header */
  .node-header {
    height: 36px;
    box-sizing: border-box;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 18px;
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.15));
    border-bottom: 1px solid var(--theme-b-subtle, #3e3e42);
    border-radius: 8px 8px 0 0;
    cursor: move;
  }
  .node-title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .node-type-icon {
    font-size: 12px;
  }
  .node-title-input {
    background: transparent;
    border: none;
    color: var(--theme-t-bright, #0f172a);
    font-size: 11px;
    font-weight: 600;
    outline: none;
    width: 100%;
  }
  .node-actions {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .node-tool-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .node-tool-btn:hover {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.1));
    color: var(--theme-t-bright, #fff);
  }

  /* Node Body */
  .node-body {
    flex: 1;
    min-height: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 6px 20px;
    cursor: pointer;
    overflow: hidden;
  }
  .node-rest-preview {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .method-tag {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .method-get {
    background: rgba(16, 185, 129, 0.15);
    color: var(--theme-method-get, #047857);
  }
  .method-post {
    background: rgba(245, 158, 11, 0.15);
    color: var(--theme-method-post, #b45309);
  }
  .method-put {
    background: rgba(59, 130, 246, 0.15);
    color: var(--theme-method-put, #1d4ed8);
  }
  .method-delete {
    background: rgba(239, 68, 68, 0.15);
    color: var(--theme-method-delete, #b91c1c);
  }
  .url-text {
    font-size: 10px;
    font-family: Consolas, monospace;
    color: var(--theme-t-main, #334155);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .node-sub-meta {
    font-size: 9px;
    color: var(--theme-ac, #3883fa);
    margin-top: 2px;
  }
  .node-js-preview code {
    font-size: 10px;
    color: var(--theme-t-main, #334155);
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Node Footer */
  .node-footer {
    height: 32px;
    box-sizing: border-box;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 18px;
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.2));
    border-top: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.05));
    font-size: 10px;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
  }
  .node-idle-text {
    color: var(--theme-t-muted, #64748b);
  }
  .status-running-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #facc15;
  }
  .last-run-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-code {
    font-weight: 700;
  }
  .run-ok .status-code {
    color: var(--theme-console-log, #047857);
  }
  .run-bad .status-code {
    color: var(--theme-danger-text, #b91c1c);
  }
  .run-skipped .status-code {
    color: #64748b;
  }
  .duration {
    color: var(--theme-t-muted, #94a3b8);
  }
  .summary-text {
    max-width: 110px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--theme-t-main, #334155);
  }
  .node-quick-btn {
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-ac, #3883fa);
    font-size: 9px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .node-quick-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-ac, #3883fa);
    color: var(--theme-ac-hover, #60a5fa);
  }

  /* Resizer Separator between Canvas and Side Panel */
  .flow-side-resizer {
    width: 6px;
    background: var(--theme-bg-panel, #252526);
    cursor: col-resize;
    position: relative;
    z-index: 10;
    transition: background 0.15s;
    border-left: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.06));
    border-right: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.06));
  }
  .flow-side-resizer:hover,
  .flow-side-resizer.is-active {
    background: var(--theme-ac, #3883fa);
  }

  /* Right Side Inspector Panel */
  .flow-side-panel {
    display: flex;
    flex-direction: column;
    background: var(--theme-bg-panel, #252526);
    border-left: 1px solid var(--theme-b-main, #3e3e42);
    color: var(--theme-t-main, #d4d4d4);
    height: 100%;
    z-index: 5;
    flex-shrink: 0;
    box-shadow: var(--theme-shadow-lg, -4px 0 16px rgba(0, 0, 0, 0.3));
    min-height: 0;
    user-select: text; /* Allow clicking and editing text inside side panel */
  }

  .side-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--theme-bg-chrome, #252526);
    border-bottom: 1px solid var(--theme-b-main, #3e3e42);
    gap: 8px;
    flex-shrink: 0;
  }
  .side-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .side-type-icon {
    font-size: 14px;
    flex-shrink: 0;
  }
  .side-title-edit-wrap {
    display: flex;
    align-items: center;
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .side-title-input {
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 5px;
    color: var(--theme-t-bright, #0f172a);
    font-size: 13px;
    font-weight: 600;
    width: 100%;
    padding: 3px 22px 3px 8px;
    outline: none;
    cursor: text;
    user-select: text;
    transition: all 0.15s ease;
  }
  .side-title-input:hover {
    border-color: var(--theme-b-input-hover, rgba(56, 189, 248, 0.4));
  }
  .side-title-input:focus {
    background: var(--theme-bg-input, #ffffff);
    border-color: var(--theme-ac, #3883fa);
    box-shadow: 0 0 0 2px var(--theme-ac-subtle, rgba(56, 189, 248, 0.2));
  }
  .side-title-pencil {
    position: absolute;
    right: 7px;
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
    pointer-events: none;
  }
  .side-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .side-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-t-bright, #0f172a);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .side-action-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-b-input-hover, #4f4f54);
    color: var(--theme-t-bright, #ffffff);
  }
  .side-run-btn {
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-console-log, #047857);
    font-weight: 600;
  }
  .side-run-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-console-log, #047857);
    color: var(--theme-console-log, #047857);
  }
  .side-close-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 18px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
  }
  .side-close-btn:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .flow-toolbar-sep {
    width: 1px;
    height: 18px;
    background: var(--theme-b-subtle, rgba(255, 255, 255, 0.15));
    margin: 0 4px;
  }
  .flow-file-input {
    display: none;
  }

  /* URL bar */
  .side-url-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--theme-bg-chrome, #252526);
    border-bottom: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.06));
  }
  .side-method-select {
    height: 28px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    padding: 0 6px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    color: var(--theme-t-bright, #0f172a);
    outline: none;
    cursor: pointer;
    transition: all 0.12s;
  }
  .side-method-select:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-b-input-hover, #4f4f54);
  }
  .side-method-select:focus {
    border-color: var(--theme-ac, #3883fa);
  }
  .side-method-select.side-method-get {
    color: var(--theme-method-get, #047857);
  }
  .side-method-select.side-method-post {
    color: var(--theme-method-post, #b45309);
  }
  .side-method-select.side-method-put {
    color: var(--theme-method-put, #1d4ed8);
  }
  .side-method-select.side-method-patch {
    color: #8a6df0;
  }
  .side-method-select.side-method-delete {
    color: var(--theme-method-delete, #b91c1c);
  }
  .side-method-select option {
    background-color: var(--theme-bg-card, #252526);
    color: var(--theme-t-bright, #0f172a);
    font-weight: 600;
    padding: 4px 8px;
  }
  .side-method-select option[value='GET'] {
    color: var(--theme-method-get, #047857);
  }
  .side-method-select option[value='POST'] {
    color: var(--theme-method-post, #b45309);
  }
  .side-method-select option[value='PUT'] {
    color: var(--theme-method-put, #1d4ed8);
  }
  .side-method-select option[value='PATCH'] {
    color: #8a6df0;
  }
  .side-method-select option[value='DELETE'] {
    color: var(--theme-method-delete, #b91c1c);
  }
  .side-url-input {
    flex: 1;
    height: 28px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 4px;
    color: var(--theme-t-bright, #0f172a);
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 8px;
    outline: none;
  }
  .side-url-input:focus {
    border-color: var(--theme-ac, #3883fa);
  }
  .side-proxy-select {
    height: 28px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 4px;
    color: var(--theme-t-bright, #0f172a);
    font-size: 10px;
    padding: 0 6px;
    outline: none;
    cursor: pointer;
    transition: all 0.12s;
  }
  .side-proxy-select:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-b-input-hover, #4f4f54);
  }
  .side-proxy-select:focus {
    border-color: var(--theme-ac, #3883fa);
  }
  .side-proxy-select option {
    background-color: var(--theme-bg-card, #252526);
    color: var(--theme-t-bright, #0f172a);
    padding: 4px 8px;
  }
  .side-custom-proxy-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 8px 12px;
    background: var(--theme-bg-chrome, #252526);
    border-bottom: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.06));
    font-size: 11px;
  }
  .side-custom-proxy-input {
    flex: 1;
    height: 24px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 4px;
    color: var(--theme-t-bright, #0f172a);
    font-size: 10px;
    font-family: Consolas, monospace;
    padding: 0 6px;
  }

  /* Tabs navigation */
  .side-panel-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px 0 8px;
    background: var(--theme-bg-chrome, #252526);
    border-bottom: 1px solid var(--theme-b-main, #3e3e42);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .side-tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s;
  }
  .side-tab-btn:hover {
    color: var(--theme-t-bright, #f1f5f9);
    background: var(--theme-bg-hover, transparent);
  }
  .side-tab-btn.active {
    color: var(--theme-ac, #3883fa);
    border-bottom-color: var(--theme-ac, #3883fa);
    font-weight: 600;
  }
  .side-tab-badge {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.1));
    color: var(--theme-t-main, #cbd5e1);
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 8px;
  }

  /* Content area */
  .side-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    min-height: 0;
  }

  /* Pane tools & action bar */
  .pane-action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .pane-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .pane-right-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pane-mode-toggle {
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-t-main, #cccccc);
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .pane-mode-toggle:hover {
    background: var(--theme-bg-hover, #383838);
    color: var(--theme-t-bright, #ffffff);
  }
  .pane-action-mini-btn {
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-ac, #3883fa);
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .pane-action-mini-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-ac, #3883fa);
    color: var(--theme-ac-hover, #60a5fa);
  }

  /* Key-Value Tables (Params & Headers) */
  .key-value-table {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-b-main, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    overflow: hidden;
    background: var(--theme-bg-card, #1e1e1e);
  }
  .kv-header-row {
    display: flex;
    align-items: center;
    background: var(--theme-bg-chrome, #252526);
    padding: 6px 8px;
    font-size: 10px;
    font-weight: 600;
    color: var(--theme-t-muted, #94a3b8);
    border-bottom: 1px solid var(--theme-b-subtle, #3e3e42);
  }
  .kv-row {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.05));
    gap: 6px;
  }
  .kv-row:last-child {
    border-bottom: none;
  }
  .kv-col-check {
    width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kv-col-key {
    flex: 1;
  }
  .kv-col-val {
    flex: 1.5;
  }
  .kv-col-del {
    width: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kv-row input[type='text'] {
    width: 100%;
    height: 24px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--theme-t-bright, #0f172a);
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 5px;
    outline: none;
  }
  .kv-row input[type='text']:focus {
    background: var(--theme-bg-input, #ffffff);
    border-color: var(--theme-ac, #3883fa);
  }
  .kv-del-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 14px;
    cursor: pointer;
  }
  .kv-del-btn:hover {
    color: #ef4444;
  }
  .kv-empty-msg {
    padding: 14px;
    text-align: center;
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
  }

  /* Preset chips */
  .headers-presets-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .presets-label {
    font-size: 10px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .preset-chip {
    background: var(--theme-bg-card, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-t-bright, #0f172a);
    font-size: 10px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .preset-chip:hover {
    background: var(--theme-ac-subtle, rgba(56, 189, 248, 0.15));
    border-color: var(--theme-ac, rgba(56, 189, 248, 0.3));
    color: var(--theme-ac, #0078d4);
  }
  .side-raw-textarea {
    width: 100%;
    height: 180px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 6px;
    color: var(--theme-t-bright, #0f172a);
    font-family: Consolas, monospace;
    font-size: 11px;
    padding: 8px;
    outline: none;
    resize: vertical;
  }

  /* Body Tab */
  .body-type-selector {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    padding: 6px 10px;
    background: var(--theme-bg-chrome, #252526);
    border: 1px solid var(--theme-b-subtle, transparent);
    border-radius: 6px;
  }
  .body-radio-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--theme-t-bright, inherit);
    cursor: pointer;
  }
  .body-none-msg {
    padding: 24px;
    text-align: center;
    font-size: 12px;
    color: var(--theme-t-muted, #64748b);
  }
  .body-editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .body-syntax-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-muted, #94a3b8);
  }
  .body-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .body-tool-btn {
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-t-main, #cccccc);
    font-size: 10px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .body-tool-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-b-input-hover, #4f4f54);
    color: var(--theme-t-bright, #ffffff);
  }
  .body-editor-launch-btn {
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-ac, #3883fa);
    color: var(--theme-ac, #3883fa);
    font-weight: 600;
    transition: all 0.12s;
  }
  .body-editor-launch-btn:hover {
    background: var(--theme-bg-hover, #383838);
    color: var(--theme-ac-hover, #60a5fa);
  }
  .body-code-textarea {
    width: 100%;
    height: 220px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 4px;
    color: var(--theme-t-bright, #0f172a);
    font-family: Consolas, monospace;
    font-size: 11px;
    padding: 8px;
    outline: none;
    resize: vertical;
    tab-size: 2;
  }

  /* Auth Tab */
  .auth-type-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .auth-field-label {
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .auth-select {
    height: 28px;
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #cccccc);
    font-size: 11px;
    padding: 0 8px;
    outline: none;
    cursor: pointer;
    transition: all 0.12s;
  }
  .auth-select:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: var(--theme-b-input-hover, #4f4f54);
  }
  .auth-select:focus {
    border-color: var(--theme-ac, #3883fa);
  }
  .auth-select option {
    background-color: var(--theme-bg-card, #252526);
    color: var(--theme-t-bright, #cccccc);
    padding: 4px 8px;
  }
  .auth-info-card {
    background: var(--theme-bg-chrome, rgba(255, 255, 255, 0.04));
    border: 1px dashed var(--theme-b-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    padding: 14px;
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .auth-fields-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--theme-bg-chrome, #252526);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 12px;
  }
  .auth-input-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--theme-t-main, #cbd5e1);
  }
  .auth-text-input {
    height: 28px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 4px;
    color: var(--theme-t-bright, #0f172a);
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 8px;
    outline: none;
  }
  .auth-hint {
    font-size: 10px;
    color: var(--theme-t-muted, #64748b);
  }
  .auth-validation-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .auth-val-btn {
    background: rgba(2, 132, 199, 0.18);
    border: 1px solid rgba(2, 132, 199, 0.35);
    color: #3883fa;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
  }
  .auth-val-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .auth-val-badge.ok {
    background: rgba(16, 185, 129, 0.15);
    color: var(--theme-console-log, #047857);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .auth-val-badge.bad {
    background: rgba(239, 68, 68, 0.15);
    color: var(--theme-danger-text, #b91c1c);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  /* Environment Tab */
  .env-head-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--theme-bg-chrome, #252526);
    border: 1px solid var(--theme-b-subtle, transparent);
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 11px;
  }
  .env-manage-btn {
    background: var(--theme-ac-subtle, rgba(2, 132, 199, 0.18));
    border: 1px solid var(--theme-ac, rgba(2, 132, 199, 0.4));
    color: var(--theme-ac, #3883fa);
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .env-manage-btn:hover {
    background: var(--theme-ac-subtle, rgba(2, 132, 199, 0.3));
  }
  .env-section-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }
  .env-section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .env-vars-grid {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .env-var-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 5px;
    font-size: 11px;
  }
  .env-var-card.global-card {
    border-left: 3px solid #38bdf8;
  }
  .env-var-key {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: Consolas, monospace;
    font-weight: 600;
    color: var(--theme-ac, #3883fa);
  }
  .env-copy-chip {
    background: var(--theme-chip-bg, #f1f5f9);
    border: 1px solid var(--theme-chip-border, #cbd5e1);
    color: var(--theme-chip-text, #1e293b);
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .env-var-value {
    color: var(--theme-t-muted, #94a3b8);
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .env-empty-box {
    text-align: center;
    padding: 12px;
    color: var(--theme-t-muted, #64748b);
    font-size: 11px;
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.02));
    border-radius: 4px;
  }

  /* History Tab (Strict limit of 5, No redundant body preview) */
  .response-summary-card {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 16px;
  }
  .res-summary-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .res-status-pill {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
  }
  .res-status-pill.ok {
    background: rgba(16, 185, 129, 0.18);
    color: var(--theme-console-log, #047857);
  }
  .res-status-pill.bad {
    background: rgba(239, 68, 68, 0.18);
    color: var(--theme-danger-text, #b91c1c);
  }
  .res-duration,
  .res-size,
  .res-time {
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .res-proxy-badge {
    font-size: 10px;
    color: var(--theme-ac, #3883fa);
    background: var(--theme-ac-subtle, rgba(56, 189, 248, 0.12));
    padding: 1px 5px;
    border-radius: 3px;
  }
  .res-summary-text {
    font-size: 11px;
    color: var(--theme-t-main, #334155);
    margin-bottom: 10px;
  }
  .res-editor-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--theme-ac, #3883fa);
    color: #ffffff;
    border: none;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 12px;
    cursor: pointer;
    transition: transform 0.1s;
  }
  .res-editor-btn:hover {
    transform: translateY(-1px);
    background: var(--theme-ac-hover, #2f72dd);
  }
  .res-no-runs-msg {
    padding: 20px;
    text-align: center;
    color: var(--theme-t-muted, #64748b);
    font-size: 11px;
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.03));
    border-radius: 6px;
    margin-bottom: 16px;
  }

  /* Node History List */
  .node-history-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .history-section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-bright, #0f172a);
  }
  .history-count {
    color: var(--theme-t-muted, #64748b);
  }
  .history-empty {
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
    padding: 10px;
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.02));
    border-radius: 4px;
  }
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 5px;
    font-size: 11px;
  }
  .hist-status {
    font-weight: 700;
  }
  .hist-status.ok {
    color: var(--theme-console-log, #047857);
  }
  .hist-status.bad {
    color: var(--theme-danger-text, #b91c1c);
  }
  .hist-meta {
    color: var(--theme-t-muted, #94a3b8);
  }
  .hist-open-btn {
    background: rgba(2, 132, 199, 0.15);
    border: 1px solid rgba(2, 132, 199, 0.35);
    color: #3883fa;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
  }
  .hist-open-btn:hover {
    background: rgba(2, 132, 199, 0.25);
  }

  /* JS tab styles */
  .js-snippets-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .snippets-label {
    font-size: 10px;
    color: var(--theme-t-muted, #94a3b8);
  }
  .js-code-textarea {
    width: 100%;
    height: 260px;
    background: var(--theme-bg-input, #ffffff);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 6px;
    color: var(--theme-t-bright, #0f172a);
    font-family: Consolas, monospace;
    font-size: 11px;
    padding: 10px;
    outline: none;
    resize: vertical;
    line-height: 1.4;
    tab-size: 2;
  }
  .js-console-box {
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    padding: 10px;
  }
  .console-head {
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-muted, #94a3b8);
    margin-bottom: 6px;
  }
  .console-logs {
    margin: 0;
    font-family: Consolas, monospace;
    font-size: 11px;
    color: var(--theme-console-log, #047857);
    max-height: 240px;
    overflow-y: auto;
    white-space: pre-wrap;
  }
  .console-empty {
    font-size: 11px;
    color: var(--theme-t-muted, #64748b);
  }

  /* Floating Toast */
  .flow-toast {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-ac, #38bdf8);
    color: var(--theme-t-bright, #e2e8f0);
    padding: 7px 16px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
    box-shadow: var(--theme-shadow-md, 0 4px 14px rgba(0, 0, 0, 0.5));
    z-index: 50;
    pointer-events: none;
    animation: toast-fade 0.2s ease;
  }
  @keyframes toast-fade {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  /* Spinner */
  .flow-spinner {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: flow-spin 0.8s linear infinite;
  }
  /* Light Theme Overrides for Floating Controls */
  :global(.jse-theme-default) .circle-type-control,
  :global(.jse-theme-light) .circle-type-control {
    background: #ffffff;
    border-color: #cbd5e1;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);

    &::after {
      border-color: #cbd5e1 transparent transparent transparent;
    }

    .circle-type-btn {
      color: #64748b;

      &:hover {
        background: rgba(0, 0, 0, 0.05);
        color: #0f172a;
      }

      &.active {
        color: #0f172a;
        background: rgba(0, 0, 0, 0.08);
        border-color: #cbd5e1;
      }
    }
  }

  :global(.jse-theme-default) .flow-floating-zoom,
  :global(.jse-theme-light) .flow-floating-zoom,
  :global(.jse-theme-default) .flow-floating-legend,
  :global(.jse-theme-light) .flow-floating-legend {
    background: rgba(255, 255, 255, 0.95);
    border-color: #cbd5e1;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    color: #475569;

    .legend-badge {
      color: #0f172a;
      border-right-color: #cbd5e1;
    }
  }

  /* Cross-Flow Jump (Beta) node visuals */
  :global(.flow-node-circle.is-cross-flow) {
    border-style: double !important;
    border-width: 4px !important;
    border-color: #a855f7 !important;
    box-shadow:
      0 0 16px rgba(168, 85, 247, 0.5),
      inset 0 0 10px rgba(56, 189, 248, 0.3) !important;
    background: radial-gradient(circle at 35% 35%, #581c87 0%, #1e1b4b 100%) !important;
    animation: cross-flow-pulse 2.2s infinite ease-in-out;
  }

  @keyframes cross-flow-pulse {
    0%,
    100% {
      box-shadow:
        0 0 14px rgba(168, 85, 247, 0.45),
        inset 0 0 8px rgba(56, 189, 248, 0.25);
    }
    50% {
      box-shadow:
        0 0 24px rgba(168, 85, 247, 0.8),
        inset 0 0 14px rgba(56, 189, 248, 0.55);
    }
  }

  .circle-badge-text.cross-event {
    color: #c084fc !important;
    font-weight: 700 !important;
  }

  .circle-symbol.jump-cross {
    font-size: 16px;
    filter: drop-shadow(0 0 4px #a855f7);
  }

  /* Active Flow Badge */
  .flow-active-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
  }
  .active-group-label {
    color: var(--theme-t-muted, #9d9d9d);
  }
  .active-flow-label {
    color: var(--theme-accent-text, #38bdf8);
  }

  /* Cross Flow Config Card in Side Panel */
  .cross-flow-config-card {
    margin-top: 12px;
    padding: 10px;
    background: rgba(168, 85, 247, 0.08);
    border: 1px solid rgba(168, 85, 247, 0.25);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cross-flow-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cross-flow-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-accent-text, #7e22ce);
  }
  .beta-badge {
    font-size: 9px;
    font-weight: 800;
    padding: 1px 5px;
    background: #a855f7;
    color: #ffffff;
    border-radius: 8px;
    letter-spacing: 0.5px;
  }
  .cross-flow-help {
    font-size: 11px;
    color: var(--theme-t-main, #334155);
    margin: 0;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cross-flow-warn {
    font-size: 10px;
    color: var(--theme-warning-text, #b45309);
    font-weight: 500;
  }
  .side-flow-select {
    width: 100%;
    margin-top: 4px;
  }

  .remote-collaborator-cursor {
    position: absolute;
    pointer-events: none;
    z-index: 1000;
    transition: left 0.05s linear, top 0.05s linear;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .remote-cursor-label {
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    margin-left: 12px;
    margin-top: -6px;
    letter-spacing: 0.3px;
  }
</style>
