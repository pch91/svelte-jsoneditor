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
    proxyUrl,
    parseQueryParams,
    buildUrlWithQuery,
    headersToRows,
    rowsToHeadersText,
    parseCurlCommand,
    buildCurlCommand,
    formatBytes,
    relativeTime,
    responseName,
    type QueryParam,
    type HeaderRow
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
  let sidePanelWidth = 520
  let isResizingSidePanel = false
  let sidePanelTab: 'params' | 'headers' | 'body' | 'auth' | 'captures' | 'env' | 'response' | 'script' = 'params'

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
    selectedNodeId = node.id
    authValidationStatus = null
    showCurlImport = false
    if (node.type === 'rest') {
      if (sidePanelTab === 'script') sidePanelTab = 'params'
    } else {
      sidePanelTab = 'script'
    }
  }

  function closeSidePanel() {
    selectedNodeId = null
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

    const exists = flowGraph.connections.find(
      (c) => c.fromId === fromId && c.toId === toId
    )
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
    const newNode: FlowNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      title: type === 'rest' ? 'New REST Request' : 'New JS Script',
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
    } else {
      newNode.jsData = {
        code: `// JavaScript script to prepare or transform data\n// Available environment variables:\nconst charId = pm.environment.get('charId') || 1;\nconsole.log('Selected character ID:', charId);\npm.environment.set('nextCharId', Number(charId) + 1);\n`
      }
    }

    flowGraph.nodes = [...flowGraph.nodes, newNode]
    selectNode(newNode)
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

  function onCanvasDrop(e: DragEvent) {
    const type = (e.dataTransfer?.getData('application/x-flow-node-type') ||
      e.dataTransfer?.getData('text/plain') ||
      draggingNewBlockType) as FlowNodeType | undefined

    if (type === 'rest' || type === 'js') {
      e.preventDefault()
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect()
        const dropX = Math.round((e.clientX - rect.left + canvasEl.scrollLeft) / zoomLevel)
        const dropY = Math.round((e.clientY - rect.top + canvasEl.scrollTop) / zoomLevel)
        // Center the 280px wide node around drop location
        const finalX = Math.max(20, dropX - 140)
        const finalY = Math.max(20, dropY - 45)
        addNodeAt(type, finalX, finalY)
      } else {
        addNode(type)
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
    notifyChange()
  }

  function autoLayout() {
    const NODE_W = 280
    const NODE_H = 140
    const GAP_X = 140
    const GAP_Y = 50

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

    const levels: Record<string, number> = {}
    const queue = flowGraph.nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id)

    queue.forEach((id) => {
      levels[id] = 0
    })

    while (queue.length > 0) {
      const u = queue.shift()!
      const currentLevel = levels[u] ?? 0
      for (const v of adj[u] ?? []) {
        levels[v] = Math.max(levels[v] ?? 0, currentLevel + 1)
        inDegree[v]--
        if (inDegree[v] === 0) {
          queue.push(v)
        }
      }
    }

    const levelGroups: Record<number, FlowNode[]> = {}
    flowGraph.nodes.forEach((n) => {
      const lvl = levels[n.id] ?? 0
      if (!levelGroups[lvl]) levelGroups[lvl] = []
      levelGroups[lvl].push(n)
    })

    Object.entries(levelGroups).forEach(([lvlStr, nodesInLevel]) => {
      const lvl = Number(lvlStr)
      nodesInLevel.forEach((node, idx) => {
        node.x = 60 + lvl * (NODE_W + GAP_X)
        node.y = 60 + idx * (NODE_H + GAP_Y)
      })
    })

    flowGraph = { ...flowGraph }
    notifyChange()
    showToast('Auto layout arranged successfully!')
  }

  function resetToExample() {
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
    else if (rest.authType === 'basic') authStr = `${rest.authBasicUser || ''} ${rest.authBasicPass || ''}`
    else if (rest.authType === 'apikey') authStr = `${rest.authApiKeyName || ''} ${rest.authApiKeyValue || ''}`

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
        else if (rest.proxyMode === 'allorigins') proxyToUse = 'https://api.allorigins.win/raw?url={url}'
        else if (rest.proxyMode === 'custom' && rest.customProxyUrl) proxyToUse = rest.customProxyUrl

        const hasBody = rest.bodyType !== 'none' && !['GET', 'HEAD'].includes(rest.method)
        const bodyPayload = hasBody ? resolvedBody : undefined
        const contentType = rest.bodyType === 'text' ? 'text/plain' : 'application/json'

        const headersObj = withContentType(parseHeadersText(resolvedHeaders), bodyPayload, contentType)

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
            capturedNames.length > 0 ? `Capturou: ${capturedNames.join(', ')}` : `Status ${res.status}`,
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
            outputSummary:
              res.logs.length > 0 ? res.logs[res.logs.length - 1] : 'Script completed',
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
      if (completedNodes.has(node.id) || failedNodes.has(node.id) || node.status === 'running')
        return false

      const solidPre = getSolidPrereqs(node.id)
      const dottedPre = getDottedPrereqs(node.id)

      if (solidPre.length === 0 && dottedPre.length === 0) {
        return true
      }

      const allSolidDone = solidPre.length === 0 || solidPre.every((p) => completedNodes.has(p))
      if (!allSolidDone) return false

      if (solidPre.length > 0) return true
      return dottedPre.some((p) => completedNodes.has(p))
    }

    try {
      while (completedNodes.size + failedNodes.size < flowGraph.nodes.length) {
        const readyNodes = flowGraph.nodes.filter(isReadyToRun)
        if (readyNodes.length === 0) {
          break
        }

        await Promise.all(
          readyNodes.map(async (node) => {
            node.status = 'running'
            flowGraph = { ...flowGraph }

            const started = performance.now()

            try {
              if (node.type === 'rest' && node.restData) {
                const rest = node.restData
                const resolvedUrl = resolveVariables(rest.url, currentEnv, globalEnvironment).resolved
                const headersStr = rest.headerRows
                  ? rowsToHeadersText(rest.headerRows)
                  : rest.headers
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

      flowStatusMessage = `Flow completed: ${completedNodes.size} passed, ${failedNodes.size} failed.`
      showToast(flowStatusMessage)
    } finally {
      flowRunning = false
      flowGraph = { ...flowGraph }
      notifyChange()
    }
  }

  // --- SVG BEZIER PATH HELPERS ---
  const NODE_WIDTH = 280

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
    <div class="flow-toolbar-left">
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

      <div class="flow-divider"></div>

      <button
        type="button"
        class="flow-btn flow-btn-draggable"
        draggable="true"
        title="Click to add or drag to drop on flow canvas"
        on:click={() => addNode('rest')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'rest')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">🌐</span>
        <span>＋ REST Block</span>
        <span class="btn-drag-handle" title="Drag to drop on flow">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn flow-btn-draggable"
        draggable="true"
        title="Click to add or drag to drop on flow canvas"
        on:click={() => addNode('js')}
        on:dragstart={(e) => onNewBlockDragStart(e, 'js')}
        on:dragend={onNewBlockDragEnd}
      >
        <span class="btn-icon">⚡</span>
        <span>＋ JS Block</span>
        <span class="btn-drag-handle" title="Drag to drop on flow">⋮⋮</span>
      </button>

      <button
        type="button"
        class="flow-btn"
        title="Automatically organize blocks"
        on:click={autoLayout}
      >
        <span class="btn-icon">🪄</span>
        <span>Auto Layout</span>
      </button>

      {#if onManageEnvironments}
        <button
          type="button"
          class="flow-btn"
          title="Manage global variables and environments (Postman style)"
          on:click={onManageEnvironments}
        >
          <span class="btn-icon">🌍</span>
          <span>Environments</span>
        </button>
      {/if}

      <button
        type="button"
        class="flow-btn"
        title="Load full example flow"
        on:click={resetToExample}
      >
        <span class="btn-icon">⛓</span>
        <span>Example</span>
      </button>

      <button type="button" class="flow-btn" title="Clear entire flow" on:click={clearAll}>
        <span class="btn-icon">🧹</span>
        <span>Clear</span>
      </button>

      <span class="flow-toolbar-sep"></span>

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
            <button type="button" role="menuitem" on:click={() => runFileAction(() => saveFlowFile(false))}>
              <span>💾 Save</span>
              {#if flowFileName}<small>{flowFileName}</small>{/if}
            </button>
            <button type="button" role="menuitem" on:click={() => runFileAction(() => saveFlowFile(true))}>
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
      <input
        bind:this={flowFileInput}
        type="file"
        accept=".json,.flow.json,application/json"
        class="flow-file-input"
        on:change={onFlowFileInputChange}
      />
    </div>

    <div class="flow-toolbar-right">
      <!-- Zoom Controls -->
      <div class="flow-zoom-control">
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
        <button
          type="button"
          class="zoom-btn"
          title="Zoom in (Ctrl + scroll up)"
          on:click={zoomIn}
        >
          ＋
        </button>
        <button
          type="button"
          class="zoom-reset-btn"
          title="Reset to 100%"
          on:click={resetZoom}
        >
          ⟲
        </button>
      </div>

      <div class="flow-legend">
        <span class="legend-item"><span class="legend-line solid"></span> Solid: Wait</span>
        <span class="legend-item"><span class="legend-line dotted"></span> Dotted: Async</span>
      </div>
      {#if flowStatusMessage}
        <span class="flow-status-msg">{flowStatusMessage}</span>
      {/if}
    </div>
  </div>

  <!-- Main Work Area: Canvas on Left, Resizable Inspector Panel on Right -->
  <div class="flow-work-area">
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
              {@const x1 = fromNode.x + NODE_WIDTH}
              {@const y1 = fromNode.y + 45}
              {@const x2 = toNode.x}
              {@const y2 = toNode.y + 45}
              {@const pathD = getBezierPath(x1, y1, x2, y2)}
              {@const mid = getPathMidpoint(x1, y1, x2, y2)}
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
              {@const sx = sourceNode.x + NODE_WIDTH}
              {@const sy = sourceNode.y + 45}
              <path
                d={getBezierPath(sx, sy, mouseX, mouseY)}
                class="conn-line-draft"
                marker-end="url(#arrow-solid)"
              />
            {/if}
          {/if}
        </svg>

        <!-- HTML Nodes Layer -->
        {#each flowGraph.nodes as node (node.id)}
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
                  on:click|stopPropagation={() => executeSingleNode(node)}
                >▶</button>
                <button
                  type="button"
                  class="node-tool-btn"
                  title="Delete block"
                  on:click|stopPropagation={() => deleteNode(node.id)}
                >×</button>
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
        {/each}

        <!-- Active Connection Selection Ball Overlay (z-index: 25, always above boxes) -->
        {#if selectedConnection}
          {@const selConn = selectedConnection}
          {@const sFrom = flowGraph.nodes.find((n) => n.id === selConn.fromId)}
          {@const sTo = flowGraph.nodes.find((n) => n.id === selConn.toId)}
          {#if sFrom && sTo}
            {@const x1 = sFrom.x + NODE_WIDTH}
            {@const y1 = sFrom.y + 45}
            {@const x2 = sTo.x}
            {@const y2 = sTo.y + 45}
            {@const mid = getPathMidpoint(x1, y1, x2, y2)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="conn-ball-overlay-wrap"
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

      <!-- Floating Zoom Controls at Bottom Left -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flow-zoom-floating" on:click|stopPropagation>
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
        <button
          type="button"
          class="zoom-btn"
          title="Zoom in (Ctrl + scroll up)"
          on:click={zoomIn}
        >
          ＋
        </button>
        <button
          type="button"
          class="zoom-reset-btn"
          title="Reset to 100%"
          on:click={resetZoom}
        >
          ⟲
        </button>
        <span class="zoom-floating-hint">Ctrl + Scroll</span>
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
            <span class="side-type-icon">{selectedNode.type === 'rest' ? '🌐' : '⚡'}</span>
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

        <!-- cURL Import (shared system modal) -->
        <CurlImportModal
          open={showCurlImport && selectedNode.type === 'rest'}
          onImport={importCurlIntoNode}
          onClose={() => (showCurlImport = false)}
        />

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
                            on:click={() => removeParam(pIdx)}
                          >×</button>
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
                              on:click={() => removeHeaderRow(hIdx)}
                            >×</button>
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
                  <div class="body-none-msg">
                    This request will send no body (Empty payload).
                  </div>
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
                      Hint: you can use environment variables like <code>{`{{token}}`}</code> or capture them from a previous block.
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
                  <span class="env-section-title">Active Environment Variables ({Object.keys(activeEnv).length})</span>
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
                  <span class="env-section-title">🌐 Env Geral / Globais ({Object.keys(globalEnvironment).length})</span>
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
                        class:ok={typeof selectedNode.lastRun.status === 'number' && selectedNode.lastRun.status < 400}
                        class:bad={typeof selectedNode.lastRun.status === 'number' && selectedNode.lastRun.status >= 400}
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
                    This block has not been run yet. Click <strong>▶ Run Block</strong> above or run the flow.
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
                          <span class="hist-meta">{entry.durationMs}ms · {relativeTime(entry.timestamp)}</span>
                          {#if entry.responseText && onOpenInEditor}
                            <button
                              type="button"
                              class="hist-open-btn"
                              title="Abrir esta resposta no editor JSON"
                              on:click={() => selectedNode && openResponseInEditor(selectedNode, entry)}
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
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

<style>
  .flow-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: #0f1117;
    color: #e2e8f0;
    font-family: inherit;
    overflow: hidden;
  }

  /* Toolbar */
  .flow-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 42px;
    padding: 6px 14px;
    background: #141722;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    gap: 8px 12px;
    flex-wrap: wrap;
    container-type: inline-size;
    position: relative;
    z-index: 30;
  }
  .flow-toolbar-left {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 8px;
    min-width: 0;
  }
  .flow-toolbar-right {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 14px;
    min-width: 0;
    margin-left: auto;
  }
  .flow-toolbar button {
    white-space: nowrap;
    flex-shrink: 0;
  }
  /* Narrow widths: icon-only buttons and no legend, so nothing overflows the toolbar */
  @container (max-width: 980px) {
    .flow-toolbar .flow-btn > span:not(.btn-icon):not(.btn-drag-handle):not(.btn-caret),
    .flow-toolbar .flow-btn-primary > span:not(.flow-spinner) {
      display: none;
    }
    .flow-toolbar .flow-btn-primary svg {
      margin: 0;
    }
    .flow-toolbar .flow-legend {
      display: none;
    }
  }
  .flow-file-menu {
    position: relative;
  }
  .flow-file-menu .file-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flow-file-menu .flow-btn.is-open {
    background: #252a3d;
    border-color: rgba(56, 189, 248, 0.6);
    color: #ffffff;
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
    background: #1a1e2b;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: 60;
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
    color: #cbd5e1;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .flow-menu button:hover {
    background: #2b3148;
    color: #ffffff;
  }
  .flow-menu small {
    color: #64748b;
    font-size: 10px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flow-menu-sep {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 2px;
  }
  .flow-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 5px rgba(2, 132, 199, 0.25);
    transition: all 0.12s ease;
  }
  .flow-btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
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
    background: #1a1e2b;
    color: #cbd5e1;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .flow-btn:hover {
    background: #252a3d;
    border-color: rgba(255, 255, 255, 0.2);
    color: #ffffff;
  }
  .btn-icon {
    font-size: 12px;
  }
  .flow-divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.12);
    margin: 0 2px;
  }
  .flow-legend {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 10px;
    color: #94a3b8;
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
  .flow-status-msg {
    font-size: 11px;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.1);
    padding: 2px 8px;
    border-radius: 4px;
  }

  /* Zoom Controls */
  .flow-zoom-control {
    display: inline-flex;
    align-items: center;
    background: #181b26;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 1px;
    gap: 1px;
  }
  .zoom-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
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
      background: rgba(255, 255, 255, 0.1);
      color: #38bdf8;
    }
  }
  .zoom-level-btn {
    background: transparent;
    border: none;
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 600;
    padding: 0 6px;
    height: 24px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.12s ease;
    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #38bdf8;
    }
  }
  .zoom-reset-btn {
    background: transparent;
    border: none;
    color: #64748b;
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
      background: rgba(255, 255, 255, 0.1);
      color: #f1f5f9;
    }
  }
  .flow-zoom-floating {
    position: absolute;
    bottom: 16px;
    left: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    background: rgba(22, 25, 34, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    padding: 3px 5px;
    gap: 3px;
  }
  .zoom-floating-hint {
    font-size: 10px;
    color: #64748b;
    padding-left: 6px;
    padding-right: 4px;
    user-select: none;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
  }

  /* Work area with canvas on left and side panel on right */
  .flow-work-area {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  /* Spatial Canvas */
  .flow-canvas {
    flex: 1;
    position: relative;
    background: #0f121a;
    overflow: auto;
    min-height: 0;
    user-select: none;
  }
  .flow-zoom-container {
    width: 4000px;
    height: 4000px;
    position: relative;
    transform-origin: 0 0;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
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
    stroke: #38bdf8;
    stroke-width: 2.2px;
    transition: stroke 0.2s, stroke-width 0.2s;
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
    stroke: #38bdf8;
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
    color: #38bdf8;
  }

  /* Connection Ball Control on Arrow ("Bola em cima da seta") */
  .conn-ball-overlay-wrap {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 25; /* Always above all node boxes (z-index: 2) */
    pointer-events: auto;
  }
  .conn-ball-control {
    display: inline-flex;
    align-items: center;
    background: #090d16;
    border: 2px solid #38bdf8;
    border-radius: 9999px;
    padding: 3px 6px;
    gap: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8), 0 0 10px rgba(56, 189, 248, 0.5);
    animation: ball-pop 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    user-select: none;
    pointer-events: auto;
    white-space: nowrap;
    transition: border-color 0.2s, box-shadow 0.2s;
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
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8), 0 0 10px rgba(168, 85, 247, 0.5);
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
    color: #38bdf8;
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
    background: #161922;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    z-index: 2;
    transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s ease;
    user-select: none;
    cursor: grab;
  }
  .flow-node:active {
    cursor: grabbing;
  }
  .flow-node.is-dragging {
    opacity: 0.55;
    cursor: grabbing !important;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7), 0 0 0 2px #38bdf8, 0 0 18px rgba(56, 189, 248, 0.3);
    z-index: 100;
  }
  .flow-node:hover {
    border-color: rgba(255, 255, 255, 0.25);
  }
  .flow-node.is-selected {
    border-color: #38bdf8;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.35), 0 6px 16px rgba(0, 0, 0, 0.5);
  }
  .flow-node-js {
    border-left: 3px solid #a855f7;
  }
  .flow-node-rest {
    border-left: 3px solid #0284c7;
  }
  .flow-node.status-running {
    border-color: #facc15;
    box-shadow: 0 0 12px rgba(250, 204, 21, 0.35);
  }
  .flow-node.status-success {
    border-color: #10b981;
  }
  .flow-node.status-error {
    border-color: #ef4444;
  }

  /* Ports */
  .node-port {
    position: absolute;
    top: 40px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #1e2230;
    border: 2px solid #38bdf8;
    cursor: crosshair;
    z-index: 3;
    transition: transform 0.1s;
  }
  .node-port:hover {
    transform: scale(1.3);
  }
  .port-input {
    left: -8px;
    border-color: #94a3b8;
  }
  .port-output {
    right: -8px;
    border-color: #38bdf8;
  }

  /* Node Header */
  .node-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
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
    color: #f1f5f9;
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
    color: #94a3b8;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .node-tool-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
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
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .node-sub-meta {
    font-size: 9px;
    color: #38bdf8;
    margin-top: 2px;
  }
  .node-js-preview code {
    font-size: 10px;
    color: #cbd5e1;
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
    background: rgba(0, 0, 0, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 10px;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
  }
  .node-idle-text {
    color: #64748b;
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
    color: #34d399;
  }
  .run-bad .status-code {
    color: #f87171;
  }
  .duration {
    color: #94a3b8;
  }
  .summary-text {
    max-width: 110px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #cbd5e1;
  }
  .node-quick-btn {
    background: rgba(2, 132, 199, 0.15);
    border: 1px solid rgba(2, 132, 199, 0.35);
    color: #38bdf8;
    font-size: 9px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .node-quick-btn:hover {
    background: rgba(2, 132, 199, 0.3);
  }

  /* Resizer Separator between Canvas and Side Panel */
  .flow-side-resizer {
    width: 6px;
    background: #141722;
    cursor: col-resize;
    position: relative;
    z-index: 10;
    transition: background 0.15s;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }
  .flow-side-resizer:hover,
  .flow-side-resizer.is-active {
    background: #0284c7;
  }

  /* Right Side Inspector Panel */
  .flow-side-panel {
    display: flex;
    flex-direction: column;
    background: #141722;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    height: 100%;
    z-index: 5;
    flex-shrink: 0;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
    min-height: 0;
    user-select: text; /* Allow clicking and editing text inside side panel */
  }

  .side-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #181c2a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 5px;
    color: #f1f5f9;
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
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(56, 189, 248, 0.4);
  }
  .side-title-input:focus {
    background: #0f1118;
    border-color: #38bdf8;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
  }
  .side-title-pencil {
    position: absolute;
    right: 7px;
    font-size: 11px;
    color: #64748b;
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
    background: #23283a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .side-action-btn:hover {
    background: #2e354d;
    color: #fff;
  }
  .side-run-btn {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }
  .side-run-btn:hover {
    background: rgba(16, 185, 129, 0.3);
  }
  .side-close-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
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
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .flow-toolbar-sep {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.15);
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
    background: #181c2a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .side-method-select {
    height: 28px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
    padding: 0 6px;
    background: #23283a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f1f5f9;
    outline: none;
    cursor: pointer;
  }
  .side-url-input {
    flex: 1;
    height: 28px;
    background: #0f1117;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    color: #f8fafc;
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 8px;
    outline: none;
  }
  .side-url-input:focus {
    border-color: #0284c7;
  }
  .side-proxy-select {
    height: 28px;
    background: #23283a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    color: #cbd5e1;
    font-size: 10px;
    padding: 0 6px;
    outline: none;
    cursor: pointer;
  }
  .side-custom-proxy-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 8px 12px;
    background: #181c2a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 11px;
  }
  .side-custom-proxy-input {
    flex: 1;
    height: 24px;
    background: #0f1117;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: #fff;
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
    background: #141722;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
    color: #94a3b8;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s;
  }
  .side-tab-btn:hover {
    color: #f1f5f9;
  }
  .side-tab-btn.active {
    color: #38bdf8;
    border-bottom-color: #38bdf8;
    font-weight: 600;
  }
  .side-tab-badge {
    background: rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
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
    color: #cbd5e1;
  }
  .pane-right-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pane-mode-toggle {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #94a3b8;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
  }
  .pane-action-mini-btn {
    background: rgba(2, 132, 199, 0.15);
    border: 1px solid rgba(2, 132, 199, 0.3);
    color: #38bdf8;
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .pane-action-mini-btn:hover {
    background: rgba(2, 132, 199, 0.25);
  }

  /* Key-Value Tables (Params & Headers) */
  .key-value-table {
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    overflow: hidden;
    background: #0f1118;
  }
  .kv-header-row {
    display: flex;
    align-items: center;
    background: #181c2a;
    padding: 6px 8px;
    font-size: 10px;
    font-weight: 600;
    color: #94a3b8;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .kv-row {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
    color: #e2e8f0;
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 5px;
    outline: none;
  }
  .kv-row input[type='text']:focus {
    background: #181c2a;
    border-color: #0284c7;
  }
  .kv-del-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
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
    color: #64748b;
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
    color: #94a3b8;
  }
  .preset-chip {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
  }
  .preset-chip:hover {
    background: rgba(56, 189, 248, 0.15);
    border-color: rgba(56, 189, 248, 0.3);
    color: #38bdf8;
  }
  .side-raw-textarea {
    width: 100%;
    height: 180px;
    background: #0f1118;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #f1f5f9;
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
    background: #181c2a;
    border-radius: 6px;
  }
  .body-radio-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    cursor: pointer;
  }
  .body-none-msg {
    padding: 24px;
    text-align: center;
    font-size: 12px;
    color: #64748b;
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
    color: #94a3b8;
  }
  .body-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .body-tool-btn {
    background: #23283a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    font-size: 10px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .body-tool-btn:hover {
    background: #2d344d;
    color: #fff;
  }
  .body-editor-launch-btn {
    background: rgba(2, 132, 199, 0.15);
    border-color: rgba(2, 132, 199, 0.35);
    color: #38bdf8;
    font-weight: 600;
  }
  .body-editor-launch-btn:hover {
    background: rgba(2, 132, 199, 0.3);
  }
  .body-code-textarea {
    width: 100%;
    height: 220px;
    background: #0f1118;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #f1f5f9;
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
    color: #94a3b8;
  }
  .auth-select {
    height: 28px;
    background: #1e2232;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    color: #fff;
    font-size: 11px;
    padding: 0 8px;
  }
  .auth-info-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px dashed rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 14px;
    font-size: 11px;
    color: #94a3b8;
  }
  .auth-fields-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: #181c2a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 12px;
  }
  .auth-input-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: #cbd5e1;
  }
  .auth-text-input {
    height: 28px;
    background: #0f1118;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
    font-family: Consolas, monospace;
    padding: 0 8px;
    outline: none;
  }
  .auth-hint {
    font-size: 10px;
    color: #64748b;
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
    color: #38bdf8;
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
    background: #181c2a;
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 11px;
  }
  .env-manage-btn {
    background: rgba(2, 132, 199, 0.18);
    border: 1px solid rgba(2, 132, 199, 0.4);
    color: #38bdf8;
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .env-manage-btn:hover {
    background: rgba(2, 132, 199, 0.3);
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
    color: #94a3b8;
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
    background: #181c2a;
    border: 1px solid rgba(255, 255, 255, 0.06);
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
    color: #38bdf8;
  }
  .env-copy-chip {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    color: #cbd5e1;
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .env-var-value {
    color: #94a3b8;
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .env-empty-box {
    text-align: center;
    padding: 12px;
    color: #64748b;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
  }

  /* History Tab (Strict limit of 5, No redundant body preview) */
  .response-summary-card {
    background: #181c2a;
    border: 1px solid rgba(255, 255, 255, 0.08);
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
    color: #94a3b8;
  }
  .res-proxy-badge {
    font-size: 10px;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .res-summary-text {
    font-size: 11px;
    color: #cbd5e1;
    margin-bottom: 10px;
  }
  .res-editor-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
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
  }
  .res-no-runs-msg {
    padding: 20px;
    text-align: center;
    color: #64748b;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.03);
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
    color: #cbd5e1;
  }
  .history-count {
    color: #64748b;
  }
  .history-empty {
    font-size: 11px;
    color: #64748b;
    padding: 10px;
    background: rgba(255, 255, 255, 0.02);
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
    background: #181c2a;
    border: 1px solid rgba(255, 255, 255, 0.06);
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
    color: #94a3b8;
  }
  .hist-open-btn {
    background: rgba(2, 132, 199, 0.15);
    border: 1px solid rgba(2, 132, 199, 0.35);
    color: #38bdf8;
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
    color: #94a3b8;
  }
  .js-code-textarea {
    width: 100%;
    height: 260px;
    background: #0f1118;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #f8fafc;
    font-family: Consolas, monospace;
    font-size: 11px;
    padding: 10px;
    outline: none;
    resize: vertical;
    line-height: 1.4;
    tab-size: 2;
  }
  .js-console-box {
    background: #0f1118;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 10px;
  }
  .console-head {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
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
    color: #64748b;
  }

  /* Floating Toast */
  .flow-toast {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #1e2230;
    border: 1px solid #38bdf8;
    color: #e2e8f0;
    padding: 7px 16px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
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
  @keyframes flow-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
