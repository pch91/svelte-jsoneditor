<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    FlowGraph,
    FlowNode,
    FlowConnection,
    FlowNodeType,
    FlowNodeExecutionHistoryEntry
  } from '../flowTypes.js'
  import {
    executeJsSandbox,
    createDefaultFlowGraph,
    serializeFlowFile,
    parseFlowFile,
    remapFlowGraphIds
  } from '../flowTypes.js'
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
    relativeTime
  } from '../requestsUtils.js'

  export let flowGraph: FlowGraph = createDefaultFlowGraph()
  export let environments: Record<string, Record<string, string>> = {}
  export let globalEnvironment: Record<string, string> = {}
  export let activeEnvName = ''
  export let globalProxy = ''
  export let onSaveGraph: ((graph: FlowGraph) => void) | undefined = undefined
  export let onOpenInEditor: ((title: string, text: string) => void) | undefined = undefined
  export let onManageEnvironments: (() => void) | undefined = undefined

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

  onMount(() => {
    if (canvasEl) {
      canvasEl.addEventListener('wheel', handleCanvasWheel, { passive: false })
    }
    return () => {
      if (canvasEl) {
        canvasEl.removeEventListener('wheel', handleCanvasWheel)
      }
    }
  })

  // Selection & Side Panel Inspector State
  let selectedNodeId: string | null = null
  let selectedConnection: FlowConnection | null = null
  let activeCircleSwitcherId: string | null = null

  function toggleCircleSwitcher(nodeId: string) {
    activeCircleSwitcherId = activeCircleSwitcherId === nodeId ? null : nodeId
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
    | 'config' = 'params'

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
      if (sidePanelTab === 'script') {
        sidePanelTab = 'params'
      }
    } else if (selectedNode.type === 'js' && selectedNode.jsData) {
      if (sidePanelTab !== 'script' && sidePanelTab !== 'env' && sidePanelTab !== 'response') {
        sidePanelTab = 'script'
      }
    }
  }

  function notifyChange() {
    flowGraph = { ...flowGraph }
    if (onSaveGraph) {
      onSaveGraph(flowGraph)
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
      if (sidePanelTab === 'script' || sidePanelTab === 'config') sidePanelTab = 'params'
    } else if (node.type === 'js') {
      if (sidePanelTab !== 'script' && sidePanelTab !== 'env' && sidePanelTab !== 'response') {
        sidePanelTab = 'script'
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
  function startConnect(e: MouseEvent, fromId: string) {
    e.stopPropagation()
    connectingFromId = fromId
    updateMousePos(e)

    const onMouseMove = (ev: MouseEvent) => {
      updateMousePos(ev)
    }

    const onMouseUp = () => {
      setTimeout(() => {
        connectingFromId = null
      }, 60)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function updateMousePos(e: MouseEvent) {
    if (!canvasEl) return
    const rect = canvasEl.getBoundingClientRect()
    mouseX = (e.clientX - rect.left + canvasEl.scrollLeft) / zoomLevel
    mouseY = (e.clientY - rect.top + canvasEl.scrollTop) / zoomLevel
  }

  function endConnect(toId: string) {
    if (!connectingFromId || connectingFromId === toId) {
      connectingFromId = null
      return
    }

    const fromId = connectingFromId
    connectingFromId = null

    const toNode = flowGraph.nodes.find((n) => n.id === toId)
    if (toNode?.type === 'start') return
    const fromNode = flowGraph.nodes.find((n) => n.id === fromId)
    if (fromNode?.type === 'terminate') return

    const exists = flowGraph.connections.find((c) => c.fromId === fromId && c.toId === toId)
    if (!exists) {
      const newConn: FlowConnection = {
        id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fromId,
        toId,
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
    let defaultTitle = 'New Block'
    if (type === 'rest') defaultTitle = 'New REST Request'
    else if (type === 'js') defaultTitle = 'New JS Script'
    else if (type === 'start') defaultTitle = 'Início'
    else if (type === 'terminate') defaultTitle = 'Terminate'
    else if (type === 'event-throw') defaultTitle = 'Salto Evento'
    else if (type === 'event-catch') defaultTitle = 'Receptor Evento'

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
        code: `// Script JavaScript com validação condicional IF\nconst charId = pm.environment.get('charId') || 1;\nif (Number(charId) > 0) {\n  pm.environment.set('isValid', 'true');\n  console.log('Validado com sucesso:', charId);\n}\n`
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
        const finalY = Math.max(20, dropY - (isCircle ? 27 : 45))
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
      node.title = 'Início'
    } else if (newType === 'terminate') {
      node.title = 'Fim do Fluxo'
    } else if (newType === 'event-throw') {
      if (!node.eventData) node.eventData = { eventName: 'valida total' }
      node.title = `Salto: ${node.eventData.eventName || 'valida total'}`
    } else if (newType === 'event-catch') {
      if (!node.eventData) node.eventData = { eventName: 'valida total' }
      node.title = `Receptor: ${node.eventData.eventName || 'valida total'}`
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

    const getNodeWidth = (type: FlowNodeType) => (isCircleNode(type) ? CIRCLE_SIZE : CARD_W)
    const getNodeHeight = (type: FlowNodeType) => (isCircleNode(type) ? CIRCLE_SIZE : CARD_H)

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
      node.y = Math.round(rowCenterY - getNodeHeight(node.type) / 2)

      currentX += w + gap
    })

    flowGraph = { ...flowGraph }
    notifyChange()
    showToast('Auto layout arranged successfully!')
  }

  function resetToExample() {
    if (!environments['Rick & Morty']) {
      environments['Rick & Morty'] = { baseUrl: 'https://rickandmortyapi.com/api' }
      environments = { ...environments }
    }
    if (!activeEnvName) {
      activeEnvName = 'Rick & Morty'
    }
    flowGraph = createDefaultFlowGraph()
    selectedNodeId = flowGraph.nodes[0]?.id ?? null
    notifyChange()
    showToast('Rick & Morty example flow loaded!')
  }

  function clearAll() {
    flowGraph = { nodes: [], connections: [] }
    selectedNodeId = null
    notifyChange()
    showToast('Flow cleared!')
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

  function runFileAction(action: () => void | Promise<void>) {
    fileMenuOpen = false
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
    showToast(`Header "${key}" adicionado`)
  }

  // --- CURL IMPORT & EXPORT (Requirement 3) ---
  function copyNodeCurl(node: FlowNode) {
    if (!node.restData) return
    const rest = node.restData
    const headersObj = rest.headerRows
      ? parseHeadersText(rowsToHeadersText(rest.headerRows))
      : parseHeadersText(rest.headers)

    const curl = buildCurlCommand({
      method: rest.method,
      url: rest.url,
      headers: headersObj,
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
        const res = executeJsSandbox(node.jsData.code, currentEnv, globalEnvironment)
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
      } else if (node.type === 'start') {
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'START',
          outputSummary: 'Ponto de início pronto',
          timestamp: Date.now()
        }
        showToast('Ponto de início acionado!')
      } else if (node.type === 'terminate') {
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'TERMINATED',
          outputSummary: 'Execução finalizada',
          timestamp: Date.now()
        }
        showToast('Bloco Terminate executado!')
      } else if (node.type === 'event-throw') {
        const ev = node.eventData?.eventName || 'valida total'
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'EVENT_THROWN',
          outputSummary: `Disparou: "${ev}"`,
          timestamp: Date.now()
        }
        showToast(`Evento disparado: "${ev}"`)
      } else if (node.type === 'event-catch') {
        const ev = node.eventData?.eventName || 'valida total'
        node.status = 'success'
        node.lastRun = {
          durationMs: 0,
          status: 'EVENT_CAUGHT',
          outputSummary: `Recebeu: "${ev}"`,
          timestamp: Date.now()
        }
        showToast(`Evento recebido: "${ev}"`)
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
    const activeEvents = new Set<string>()
    let flowTerminated = false
    const hasStartNodes = flowGraph.nodes.some((n) => n.type === 'start')

    const getSolidPrereqs = (nodeId: string): string[] => {
      return flowGraph.connections
        .filter((c) => c.toId === nodeId && c.kind === 'solid')
        .map((c) => c.fromId)
    }

    const getDottedPrereqs = (nodeId: string): string[] => {
      return flowGraph.connections
        .filter((c) => c.toId === nodeId && c.kind === 'dotted')
        .map((c) => c.fromId)
    }

    const isReadyToRun = (node: FlowNode): boolean => {
      if (flowTerminated) return false
      if (completedNodes.has(node.id) || failedNodes.has(node.id) || node.status === 'running')
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

      const allSolidDone = solidPre.length === 0 || solidPre.every((p) => completedNodes.has(p))
      if (!allSolidDone) return false

      if (solidPre.length > 0) return true
      if (node.type === 'event-catch') return true
      return dottedPre.some((p) => completedNodes.has(p))
    }

    try {
      while (!flowTerminated && completedNodes.size + failedNodes.size < flowGraph.nodes.length) {
        const readyNodes = flowGraph.nodes.filter(isReadyToRun)
        if (readyNodes.length === 0) {
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
                  outputSummary: 'Início executado',
                  timestamp: Date.now()
                }
                completedNodes.add(node.id)
              } else if (node.type === 'terminate') {
                node.status = 'success'
                node.lastRun = {
                  durationMs: 0,
                  status: 'TERMINATED',
                  outputSummary: 'Execução interrompida aqui',
                  timestamp: Date.now()
                }
                completedNodes.add(node.id)
                flowTerminated = true
                showToast('Fluxo finalizado pelo bloco Terminate!')
              } else if (node.type === 'event-throw') {
                const evName = (node.eventData?.eventName || '').trim().toLowerCase()
                if (evName) activeEvents.add(evName)
                node.status = 'success'
                node.lastRun = {
                  durationMs: 0,
                  status: 'EVENT_THROWN',
                  outputSummary: `Disparou: "${node.eventData?.eventName || ''}"`,
                  timestamp: Date.now()
                }
                completedNodes.add(node.id)
                showToast(`Evento disparado: "${node.eventData?.eventName || ''}"`)
              } else if (node.type === 'event-catch') {
                node.status = 'success'
                node.lastRun = {
                  durationMs: 0,
                  status: 'EVENT_CAUGHT',
                  outputSummary: `Recebeu: "${node.eventData?.eventName || ''}"`,
                  timestamp: Date.now()
                }
                completedNodes.add(node.id)
                showToast(`Evento recebido: "${node.eventData?.eventName || ''}"`)
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
                const res = executeJsSandbox(node.jsData.code, currentEnv, globalEnvironment)
                const durationMs = Math.round(performance.now() - started)

                if (res.success) {
                  currentEnv = { ...currentEnv, ...res.updatedEnv }
                  globalEnvironment = { ...globalEnvironment, ...res.updatedGlobalEnv }
                  node.status = 'success'
                  node.lastRun = {
                    durationMs,
                    status: 'OK',
                    outputSummary:
                      res.logs.length > 0 ? res.logs[res.logs.length - 1] : 'Script finished',
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
                    outputSummary: res.error ?? 'Falha no script',
                    timestamp: Date.now(),
                    logs: res.logs
                  }
                  failedNodes.add(node.id)
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              node.status = 'error'
              node.lastRun = {
                durationMs: Math.round(performance.now() - started),
                status: 'Falha',
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
        flowStatusMessage = `Fluxo finalizado: interrompido no bloco Terminate.`
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

  function getNodeOutputPort(node: FlowNode): { x: number; y: number } {
    if (isCircleNode(node.type)) {
      return {
        x: node.x + CIRCLE_NODE_SIZE,
        y: node.y + CIRCLE_NODE_SIZE / 2
      }
    }
    return {
      x: node.x + NODE_WIDTH,
      y: node.y + 45
    }
  }

  function getNodeInputPort(node: FlowNode): { x: number; y: number } {
    if (isCircleNode(node.type)) {
      return {
        x: node.x,
        y: node.y + CIRCLE_NODE_SIZE / 2
      }
    }
    return {
      x: node.x,
      y: node.y + 45
    }
  }

  function getBezierPath(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.abs(x2 - x1) * 0.5
    const cx1 = x1 + Math.max(40, dx)
    const cy1 = y1
    const cx2 = x2 - Math.max(40, dx)
    const cy2 = y2
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
  }

  function getPathMidpoint(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): { x: number; y: number } {
    return {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2
    }
  }
</script>

<svelte:window on:click={() => (fileMenuOpen = false)} />

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
          <span>▶ Run Flow</span>
        {/if}
      </button>
      {#if flowStatusMessage}
        <span class="flow-status-msg" title={flowStatusMessage}>{flowStatusMessage}</span>
      {/if}
    </div>

    <div class="flow-toolbar-divider"></div>

    <!-- Group 2: Palette / Adicionar Blocos -->
    <div class="flow-toolbar-group flow-toolbar-palette">
      <span class="toolbar-group-label">Blocos:</span>
      <button
        type="button"
        class="flow-btn flow-btn-draggable"
        draggable="true"
        title="Bloco REST: Requisição HTTP (GET, POST, etc.)"
        on:click={() => addNode('rest')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'rest')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">🌐</span>
        <span>＋ REST Block</span>
        <span class="btn-drag-handle" title="Arraste para soltar no fluxo">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-draggable"
        draggable="true"
        title="Bloco JavaScript: Script com variáveis e condicionais IF"
        on:click={() => addNode('js')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'js')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">⚡</span>
        <span>＋ JS Block</span>
        <span class="btn-drag-handle" title="Arraste para soltar no fluxo">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-draggable flow-btn-event"
        draggable="true"
        title="Bloco de Evento / BPMN: Início, Terminate, Salto ou Receptor (altere o tipo direto na bola)"
        on:click={() => addNode('event-throw')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'event-throw')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">⭕</span>
        <span>＋ Evento</span>
        <span class="btn-drag-handle" title="Arraste para soltar no fluxo">⋮⋮</span>
      </button>
    </div>

    <div class="flow-toolbar-divider"></div>

    <!-- Group 3: Canvas Layout -->
    <div class="flow-toolbar-group flow-toolbar-layout">
      <button
        type="button"
        class="flow-btn flow-btn-layout"
        title="Organizar blocos automaticamente em layout diagramático inteligente"
        on:click={autoLayout}
      >
        <span class="btn-icon">🪄</span>
        <span>Auto Layout</span>
      </button>
    </div>

    <!-- Spacer pushes File & Actions to the right -->
    <div class="flow-toolbar-spacer"></div>

    <!-- Group 4: File & Flow Actions (Distinctly on the right) -->
    <div class="flow-toolbar-group flow-toolbar-actions">
      <!-- File menu (Open / Save / Save As / Import / Export) -->
      <div class="flow-file-menu">
        <button
          type="button"
          class="flow-btn"
          class:is-open={fileMenuOpen}
          title={flowFileName ? `Flow file: ${flowFileName}` : 'Flow file actions'}
          aria-haspopup="menu"
          aria-expanded={fileMenuOpen}
          on:click|stopPropagation={() => (fileMenuOpen = !fileMenuOpen)}
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
              on:click={() => runFileAction(() => saveFlowFile(false))}
            >
              <span>💾 Save</span>
              {#if flowFileName}<small>{flowFileName}</small>{/if}
            </button>
            <button
              type="button"
              role="menuitem"
              on:click={() => runFileAction(() => saveFlowFile(true))}
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
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="flow-btn flow-btn-secondary"
        title="Carregar fluxo de exemplo completo Rick & Morty"
        on:click={resetToExample}
      >
        <span class="btn-icon">🧬</span>
        <span>Example</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-secondary flow-btn-clear"
        title="Limpar todos os blocos do canvas"
        on:click={clearAll}
      >
        <span class="btn-icon">🧹</span>
        <span>Clear</span>
      </button>
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
        on:mousemove={(e) => {
          if (connectingFromId) updateMousePos(e)
        }}
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
                {@const p1 = getNodeOutputPort(fromNode)}
                {@const p2 = getNodeInputPort(toNode)}
                {@const pathD = getBezierPath(p1.x, p1.y, p2.x, p2.y)}
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
                {@const sp = getNodeOutputPort(sourceNode)}
                <path
                  d={getBezierPath(sp.x, sp.y, mouseX, mouseY)}
                  class="conn-line-draft"
                  marker-end="url(#arrow-solid)"
                />
              {/if}
            {/if}
          </svg>

          <!-- HTML Nodes Layer -->
          {#each flowGraph.nodes as node (node.id)}
            {#if isCircleNode(node.type)}
              <!-- Circular BPMN Diagram Node -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="flow-node flow-node-circle flow-node-{node.type}"
                class:is-selected={node.id === selectedNodeId}
                class:is-dragging={node.id === draggingNodeId}
                class:has-switcher-open={activeCircleSwitcherId === node.id}
                class:status-idle={node.status === 'idle'}
                class:status-waiting={node.status === 'waiting'}
                class:status-running={node.status === 'running'}
                class:status-success={node.status === 'success'}
                class:status-error={node.status === 'error'}
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
                  title="Alterar tipo de evento (Início, Terminate, Salto, Receptor)"
                  aria-label="Alterar tipo de evento"
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
                  {#if node.type === 'event-throw' || node.type === 'event-catch'}
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
                      title="Início: Ponto de partida do fluxo"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'start')}
                    >
                      <span class="type-disc green"></span>
                      <span class="type-name">Início</span>
                    </button>
                    <button
                      type="button"
                      class="circle-type-btn red"
                      class:active={node.type === 'terminate'}
                      title="Terminate: Encerra o fluxo imediatamente"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'terminate')}
                    >
                      <span class="type-disc red"></span>
                      <span class="type-name">Terminate</span>
                    </button>
                    <button
                      type="button"
                      class="circle-type-btn blue"
                      class:active={node.type === 'event-throw'}
                      title="Salto: Transmite evento sem fio"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'event-throw')}
                    >
                      <span class="type-disc blue"></span>
                      <span class="type-name">Salto</span>
                    </button>
                    <button
                      type="button"
                      class="circle-type-btn blue-dashed"
                      class:active={node.type === 'event-catch'}
                      title="Receptor: Aguarda evento sem fio"
                      on:click|stopPropagation={() => setCircleNodeType(node, 'event-catch')}
                    >
                      <span class="type-disc blue-dashed"></span>
                      <span class="type-name">Receptor</span>
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
                class:status-idle={node.status === 'idle'}
                class:status-waiting={node.status === 'waiting'}
                class:status-running={node.status === 'running'}
                class:status-success={node.status === 'success'}
                class:status-error={node.status === 'error'}
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
                <!-- Input Port -->
                <div
                  class="node-port port-input"
                  title="Drop connection here to connect"
                  on:mouseup|stopPropagation={() => endConnect(node.id)}
                ></div>

                <!-- Node Header -->
                <div class="node-header">
                  <div class="node-title-wrap">
                    <span class="node-type-icon">{node.type === 'rest' ? '🌐' : '⚡'}</span>
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

                <!-- Node Body / Summary Preview -->
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
                  {:else if node.type === 'js' && node.jsData}
                    <div class="node-js-preview">
                      <code>{node.jsData.code.split('\n').filter(Boolean)[0] || '// JS Code'}</code>
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

                <!-- Output Port -->
                <div
                  class="node-port port-output"
                  title="Click and drag to connect to another block"
                  on:mousedown={(e) => startConnect(e, node.id)}
                ></div>
              </div>
            {/if}
          {/each}

          <!-- Active Connection Selection Ball Overlay (z-index: 25, always above boxes) -->
          {#if selectedConnection}
            {@const selConn = selectedConnection}
            {@const sFrom = flowGraph.nodes.find((n) => n.id === selConn.fromId)}
            {@const sTo = flowGraph.nodes.find((n) => n.id === selConn.toId)}
            {#if sFrom && sTo}
              {@const p1 = getNodeOutputPort(sFrom)}
              {@const p2 = getNodeInputPort(sTo)}
              {@const mid = getPathMidpoint(p1.x, p1.y, p2.x, p2.y)}
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
        <span class="legend-badge">Legenda</span>
        <div class="legend-items">
          <span class="legend-item" title="Linha sólida: aguarda conclusão do nó anterior"
            ><span class="legend-line solid"></span> Espera</span
          >
          <span class="legend-item" title="Linha pontilhada: execução assíncrona sem travar"
            ><span class="legend-line dotted"></span> Async</span
          >
          <span class="legend-item" title="Nó de Início: ponto de partida do fluxo"
            ><span class="legend-dot green"></span> Início</span
          >
          <span class="legend-item" title="Nó de Término: encerra e interrompe o fluxo"
            ><span class="legend-dot red"></span> Terminate</span
          >
          <span class="legend-item" title="Salto sem fio: emite o evento para receptores"
            ><span class="legend-dot blue"></span> Salto</span
          >
          <span class="legend-item" title="Receptor sem fio: aguarda o evento para continuar"
            ><span class="legend-dot blue-dashed"></span> Receptor</span
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
          {:else if selectedNode.type === 'event-throw' || selectedNode.type === 'event-catch'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Evento
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execução
            </button>
          {:else if selectedNode.type === 'start' || selectedNode.type === 'terminate'}
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'config'}
              on:click={() => (sidePanelTab = 'config')}
            >
              Propriedades
            </button>
            <button
              type="button"
              class="side-tab-btn"
              class:active={sidePanelTab === 'response'}
              on:click={() => (sidePanelTab = 'response')}
            >
              Execução
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
                            class="kv-del-btn"
                            title="Remove parameter"
                            on:click={() => removeParam(pIdx)}>×</button
                          >
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
                              class="kv-del-btn"
                              title="Remove header"
                              on:click={() => removeHeaderRow(hIdx)}>×</button
                            >
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
                              title="Copiar marcador"
                              on:click={() => {
                                navigator.clipboard.writeText(`{{${k}}}`)
                                showToast(`Variable {{${k}}} copied!`)
                              }}
                            >
                              Copiar
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
                    >🌐 Env Geral / Globais ({Object.keys(globalEnvironment).length})</span
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
                              title="Copiar marcador"
                              on:click={() => {
                                navigator.clipboard.writeText(`{{${k}}}`)
                                showToast(`Global variable {{${k}}} copied!`)
                              }}
                            >
                              Copiar
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
                              title="Abrir esta resposta no editor JSON"
                              on:click={() =>
                                selectedNode && openResponseInEditor(selectedNode, entry)}
                            >
                              ↗ Abrir no Editor
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
                </div>

                <div class="js-editor-wrap">
                  <textarea
                    class="js-code-textarea"
                    bind:value={selectedNode.jsData.code}
                    on:input={notifyChange}
                  ></textarea>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head">Logs do Console (console.log):</div>
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
          {:else if selectedNode.type === 'event-throw' || selectedNode.type === 'event-catch'}
            {#if sidePanelTab === 'config'}
              <div class="tab-pane-event">
                <div class="event-config-card">
                  <div class="event-type-badge {selectedNode.type}">
                    {selectedNode.type === 'event-throw'
                      ? '🔵 Salto de Fluxo (Broadcast Event)'
                      : '◌ Receptor de Fluxo (Catch Event)'}
                  </div>
                  <p class="event-help-text">
                    {#if selectedNode.type === 'event-throw'}
                      Ao ser executado, este nó de salto transmite o sinal com o nome do evento.
                      Todos os blocos receptores (bolas pontilhadas) com o mesmo nome serão
                      acionados sem fio!
                    {:else}
                      Este nó receptor aguarda a transmissão do evento correspondente para continuar
                      a execução do fluxo através de suas saídas.
                    {/if}
                  </p>
                  <div class="event-input-group">
                    <label class="event-field-label" for="event-name-input">Nome do Evento:</label>
                    <div class="event-input-row">
                      <input
                        id="event-name-input"
                        type="text"
                        class="side-text-input event-input"
                        placeholder="ex: valida total"
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
                        title="Usar evento de exemplo 'valida total'"
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
                        ? 'Os nós receptores com este nome exato serão disparados.'
                        : 'Deve coincidir com o nome disparado no nó de salto (bola cheia).'}
                    </span>
                  </div>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head">Status de Execução:</div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Detalhes: {selectedNode.lastRun.outputSummary}</div>
                      <div>Horário: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                  {:else}
                    <div class="console-empty">
                      Ainda não foi executado. Execute o fluxo para ver o resultado.
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
                      ? '🟢 Ponto de Início (Start Node)'
                      : '🛑 Bloco Terminate (Parada do Fluxo)'}
                  </div>
                  <p class="event-help-text">
                    {#if selectedNode.type === 'start'}
                      Ponto de partida do fluxo. Toda execução geral começa neste nó e se propaga
                      para as conexões de saída.
                    {:else}
                      Bloco finalizador: quando a execução do fluxo atinge este nó, o fluxo é
                      encerrado imediatamente e qualquer ramificação subsequente é interrompida.
                    {/if}
                  </p>
                </div>
              </div>
            {:else if sidePanelTab === 'response'}
              <div class="tab-pane-response">
                <div class="js-console-box">
                  <div class="console-head">Status de Execução:</div>
                  {#if selectedNode.lastRun}
                    <div class="event-run-info">
                      <div>Status: <strong>{selectedNode.lastRun.status}</strong></div>
                      <div>Detalhes: {selectedNode.lastRun.outputSummary}</div>
                      <div>Horário: {relativeTime(selectedNode.lastRun.timestamp)}</div>
                    </div>
                  {:else}
                    <div class="console-empty">Ainda não foi executado.</div>
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
  .flow-file-menu {
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
    left: 0;
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
    justify-content: space-between;
    gap: 12px;
    height: 28px;
    padding: 0 10px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--theme-t-bright, #cbd5e1);
    font-size: 12px;
    text-align: left;
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
  .flow-node-rest {
    border-left: 3px solid var(--theme-ac, #3883fa);
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
      border: 2.5px dashed #38bdf8;
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
      color: var(--theme-t-main, #e2e8f0);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;

      .circle-badge-text.event {
        color: #38bdf8;
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
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }
    &.event-catch {
      background: rgba(14, 165, 233, 0.1);
      color: #38bdf8;
      border: 1px dashed rgba(56, 189, 248, 0.5);
    }
    &.start {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(74, 222, 128, 0.4);
    }
    &.terminate {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
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
    top: 40px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--theme-bg-panel, #2d2d30);
    border: 2px solid var(--theme-ac, #38bdf8);
    cursor: crosshair;
    z-index: 3;
    transition: transform 0.1s;
  }
  .node-port:hover {
    transform: scale(1.3);
  }
  .port-input {
    left: -8px;
    border-color: var(--theme-t-muted, #94a3b8);
  }
  .port-output {
    right: -8px;
    border-color: var(--theme-ac, #3883fa);
  }

  /* Node Header */
  .node-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
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
    color: var(--theme-t-bright, #f1f5f9);
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
    padding: 8px 10px;
    cursor: pointer;
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
    color: #34d399;
  }
  .method-post {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
  }
  .method-put {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }
  .method-delete {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
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
    color: #10b981;
  }
  .run-bad .status-code {
    color: #ef4444;
  }
  .duration {
    color: var(--theme-t-muted, #94a3b8);
  }
  .summary-text {
    max-width: 110px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--theme-t-main, #cbd5e1);
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
    background: var(--theme-bg-card, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 5px;
    color: var(--theme-t-bright, #f1f5f9);
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
    background: var(--theme-bg-card, #1e1e1e);
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
    color: var(--theme-t-bright, #cccccc);
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
    color: #10b981;
    font-weight: 600;
  }
  .side-run-btn:hover {
    background: var(--theme-bg-hover, #383838);
    border-color: #10b981;
    color: #10b981;
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
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    color: var(--theme-t-bright, #cccccc);
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
    color: #10b981;
  }
  .side-method-select.side-method-post {
    color: #f59e0b;
  }
  .side-method-select.side-method-put {
    color: #3b82f6;
  }
  .side-method-select.side-method-patch {
    color: #a855f7;
  }
  .side-method-select.side-method-delete {
    color: #ef4444;
  }
  .side-method-select option {
    background-color: var(--theme-bg-card, #252526);
    color: var(--theme-t-bright, #cccccc);
    font-weight: 600;
    padding: 4px 8px;
  }
  .side-method-select option[value='GET'] {
    color: #10b981;
  }
  .side-method-select option[value='POST'] {
    color: #f59e0b;
  }
  .side-method-select option[value='PUT'] {
    color: #3b82f6;
  }
  .side-method-select option[value='PATCH'] {
    color: #a855f7;
  }
  .side-method-select option[value='DELETE'] {
    color: #ef4444;
  }
  .side-url-input {
    flex: 1;
    height: 28px;
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #cccccc);
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
    background: var(--theme-bg-card, #2d2d30);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #cccccc);
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
    color: var(--theme-t-bright, #cccccc);
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
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #fff);
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
    color: var(--theme-t-bright, #cbd5e1);
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
    color: var(--theme-t-bright, #e2e8f0);
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 5px;
    outline: none;
  }
  .kv-row input[type='text']:focus {
    background: var(--theme-bg-panel, #252526);
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
    color: var(--theme-t-main, #cbd5e1);
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
  }
  .preset-chip:hover {
    background: var(--theme-ac-subtle, rgba(56, 189, 248, 0.15));
    border-color: var(--theme-ac, rgba(56, 189, 248, 0.3));
    color: var(--theme-ac, #3883fa);
  }
  .side-raw-textarea {
    width: 100%;
    height: 180px;
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 6px;
    color: var(--theme-t-bright, #f1f5f9);
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
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #cccccc);
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
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 4px;
    color: var(--theme-t-bright, #fff);
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
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .auth-val-badge.bad {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
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
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--theme-b-subtle, transparent);
    color: var(--theme-t-main, #cbd5e1);
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
    color: #34d399;
  }
  .res-status-pill.bad {
    background: rgba(239, 68, 68, 0.18);
    color: #f87171;
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
    color: var(--theme-t-main, #cbd5e1);
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
    color: var(--theme-t-bright, #cbd5e1);
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
    color: #34d399;
  }
  .hist-status.bad {
    color: #f87171;
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
    background: var(--theme-bg-card, #1e1e1e);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 6px;
    color: var(--theme-t-bright, #f8fafc);
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
    color: #34d399;
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
</style>
