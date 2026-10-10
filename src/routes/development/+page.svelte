<script lang="ts">
  /* eslint-disable @typescript-eslint/no-unused-vars */
  import {
    type Content,
    type ContextMenuItem,
    createAjvValidator,
    createValueSelection,
    EditableValue,
    isJSONContent,
    isTextContent,
    javascriptQueryLanguage,
    jmespathQueryLanguage,
    jsonQueryLanguage,
    jsonpathQueryLanguage,
    JSONEditor,
    type JSONEditorSelection,
    type JSONParser,
    lodashQueryLanguage,
    type MenuItem,
    Mode,
    type OnChangeStatus,
    ReadonlyValue,
    type RenderMenuContext,
    renderValue,
    type RenderValueComponentDescription,
    type RenderValueProps
  } from 'svelte-jsoneditor'
  import { useLocalStorage } from '$lib/utils/localStorageUtils.js'
  import PreviewModal from '$lib/components/modals/PreviewModal.svelte'
  import type { EditWithPreviewProps, JSONEditorModalCallback } from '$lib/types.js'
  import { range } from 'lodash-es'
  import { mount, onMount, tick } from 'svelte'
  import { parse, stringify } from 'lossless-json'
  import { parseJSONPath, stringifyJSONPath } from '$lib/utils/pathUtils.js'
  import {
    compileJSONPointer,
    immutableJSONPatch,
    parseJSONPointer,
    type JSONPath
  } from 'immutable-json-patch'
  import { loadWorkspace, saveWorkspace } from './workspaceStorage.js'
  import type { StoredWorkspace } from './workspaceStorage.js'
  import {
    WORKSPACE_FILE_EXT,
    parseWorkspaceFile,
    serializeWorkspaceFile,
    type WorkspaceBundle
  } from './workspaceFile.js'
  import CommandPalette from './components/CommandPalette.svelte'
  import FolderTree from './components/FolderTree.svelte'
  import TabContextMenu from './components/TabContextMenu.svelte'
  import CurlImportModal from './components/CurlImportModal.svelte'
  import FlowCanvas from './components/FlowCanvas.svelte'
  import EnvironmentManagerModal from './components/EnvironmentManagerModal.svelte'
  import CapturePathsTable from './components/CapturePathsTable.svelte'
  import {
    type FlowGraph,
    type FlowNode,
    createDefaultFlowGraph,
    migrateChainToFlowGraph
  } from './flowTypes.js'
  import type { CaptureRule } from './tabUtils.js'
  import {
    computeDiffPaths,
    contentToValue,
    jsonPathToPointer,
    matchesDiffPath
  } from './diffUtils.js'
  import { contentErrorsToProblems, type Problem } from './problemsUtils.js'
  import {
    moveBefore,
    createPrimaryTab,
    addSubTabToPrimary,
    removeSubTabFromPrimary,
    promoteSubTabToPrimary,
    canPromoteSubTab,
    canCloseSubTab,
    movePrimaryTabToPane,
    reorderTabIds,
    movePrimaryTabBetweenPanes,
    createDefaultRequestContext,
    type PrimaryTabState,
    type SubTabState,
    type SubTabKind
  } from './tabUtils.js'
  import {
    collectLeaves,
    collectNodeIds,
    computeRects,
    createLeaf,
    createSplit,
    findLeaf,
    findLeafByTab,
    mapLeaves,
    parseLayout,
    removeLeaf,
    replaceLeaf,
    serializeLayout,
    setSplitRatio,
    splitLeaf,
    type LayoutNode,
    type SplitDirection,
    type SplitLeaf
  } from './splitLayout.js'
  import {
    buildCurlCommand,
    buildQueryParamsString,
    buildUrlWithQuery,
    encodeBasicAuth,
    extractValueByPath,
    fetchWithProxy,
    formatBytes,
    headersToRows,
    isCurlCommand,
    parseCaptureList,
    parseCurlCommand,
    parseHeadersText,
    parseQueryParams,
    proxyUrl,
    relativeTime,
    resolveVariables,
    responseName,
    rowsToHeadersText,
    truncateText,
    type HeaderRow,
    type QueryParam
  } from './requestsUtils.js'
  import {
    loadRequestHistory,
    saveRequestHistory,
    type RequestHistoryEntry
  } from './requestsStorage.js'
  import {
    ensureWritePermission,
    enumerateDirectory,
    isFileSystemAccessSupported,
    loadDirectoryHandle,
    loadFileHandles,
    openFilesFromDisk,
    pickDirectoryHandle,
    readHandleText,
    removeFileHandle,
    saveDirectoryHandle,
    saveFileHandles,
    writeHandleText,
    type DirectoryHandle,
    type FileEntry,
    type FileHandle
  } from './filesystem.js'

  // ============================================================
  const LosslessJSON = { parse, stringify }

  const defaultJson = `{
  "boolean": true,
  "color": "#82b92c",
  "null": null,
  "number": 123,
  "object": { "a": "b", "c": "d" },
  "string": "Hello World",
  "array": [1, 2, [3, 4], 5],
  "url": "https://jsoneditoronline.org"
}`

  const themes = [
    { value: 'jse-theme-default', label: 'Default' },
    { value: 'jse-theme-dark', label: 'Dark' },
    { value: 'jse-theme-big', label: 'Big' },
    { value: 'jse-theme-custom-contents', label: 'Custom' }
  ]
  const indentations = [
    { value: 2, label: '2' },
    { value: 4, label: '4' },
    { value: '\t', label: 'Tab' }
  ]
  interface ParserOption {
    id: string
    value: JSONParser
    label: string
  }
  const parsers: ParserOption[] = [
    { id: 'JSON', value: JSON, label: 'JSON' },
    { id: 'LosslessJSON', value: LosslessJSON, label: 'LosslessJSON' }
  ]
  const pathParsers = [
    {
      id: 'JSONPath',
      value: { parse: parseJSONPath, stringify: stringifyJSONPath },
      label: 'JSONPath'
    },
    {
      id: 'JSONPointer',
      value: { parse: parseJSONPointer, stringify: compileJSONPointer },
      label: 'JSONPointer'
    }
  ]
  const schema = {
    title: 'Employee',
    type: 'object',
    properties: {
      boolean: { type: 'boolean' },
      array: { type: 'array', items: { type: 'number', minimum: 10 } }
    },
    required: ['foo']
  }
  const validator = createAjvValidator({ schema })

  // ============================================================
  // TAB STATE — 2-level hierarchy:
  // Level 1: Primary tabs (Editor 1, Editor 2...)
  // Level 2: Secondary tabs (Principal, extract, edit, requests...)
  // SPLIT STATE — binary tree layout (VS Code / mosaic model)
  // ============================================================
  let nextPrimaryTabId = 2
  let primaryTabs: PrimaryTabState[] = [
    {
      id: 1,
      title: 'Editor 1',
      subTabIds: [1],
      activeSubTabId: 1,
      requestState: createDefaultRequestContext()
    }
  ]
  let activePrimaryTabId = 1
  let subTabsMeta = new Map<number, SubTabState>([
    [1, { id: 1, primaryTabId: 1, title: 'Principal', kind: 'main' }]
  ])
  let draggedLeafId: number | undefined
  let draggedPrimaryId: number | undefined
  let draggedPrimarySourceLeafId: number | undefined
  let dragOverTargetPrimaryId: number | undefined
  let dragOverTargetPrimaryPosition: 'before' | 'after' | undefined
  let dragOverLeafId: number | undefined
  let dragOverTargetSubId: number | undefined
  let dragOverTargetSubPosition: 'before' | 'after' | undefined
  let panePrimaryMap = new Map<number, number[]>([[1, [1]]])
  let paneActivePrimaryMap = new Map<number, number>([[1, 1]])
  let tabsRenderVersion = 0

  let tabIds: number[] = [1]
  let tabTitles: string[] = ['Principal']
  let tabContents: Content[] = [{ text: defaultJson, json: undefined }]
  let tabModes: Mode[] = [Mode.tree]
  let tabSelections: (JSONEditorSelection | undefined)[] = [undefined]
  let tabRefs: (JSONEditor | undefined)[] = [undefined]
  let tabRevisions: number[] = [0]
  let nextTabId = 2

  let layout: LayoutNode = createLeaf(1, 0)
  let nextNodeId = 2
  let activeLeafId = 1

  // ---- IDE workspace state ----
  let tabLastSavedText: (string | undefined)[] = [undefined]
  let panesEl: HTMLDivElement | undefined
  let tabDragActive = false
  let draggedTabId: number | undefined
  let tabMenu:
    | { x: number; y: number; tabId: number; type?: 'primary' | 'sub'; leafId?: number }
    | undefined

  // ---- Requests panel (HTTP client) ----
  let showRequests = false
  let showCurlModal = false
  let reqMethod = 'GET'
  let reqUrl = ''
  let reqHeaders = ''
  let reqBody = ''
  let reqSending = false
  let reqSendMode: 'same' | 'new' = 'same'

  function getPanePrimaryTabs(leafId: number, _version?: number): PrimaryTabState[] {
    const pids = panePrimaryMap.get(leafId)
    if (pids && pids.length > 0) {
      const tabs = pids
        .map((pid) => primaryTabs.find((p) => p.id === pid))
        .filter((p): p is PrimaryTabState => Boolean(p))
      if (tabs.length > 0) return tabs
    }
    return primaryTabs
  }

  function getPaneActivePrimaryId(leafId: number, _version?: number): number {
    const active = paneActivePrimaryMap.get(leafId)
    const prims = getPanePrimaryTabs(leafId, _version)
    if (active !== undefined && prims.some((p) => p.id === active)) return active
    return prims[0]?.id ?? primaryTabs[0]?.id ?? 1
  }

  function getPaneActivePrimary(leafId: number, _version?: number): PrimaryTabState {
    const activeId = getPaneActivePrimaryId(leafId, _version)
    const prims = getPanePrimaryTabs(leafId, _version)
    return prims.find((p) => p.id === activeId) ?? prims[0] ?? primaryTabs[0]
  }

  function getPaneSubTabs(
    primary: PrimaryTabState | undefined,
    _version?: number
  ): Array<{
    subTabId: number
    idx: number
    meta: SubTabState
  }> {
    if (!primary) return []
    return primary.subTabIds
      .map((sid) => {
        const idx = getTabIdx(sid)
        const meta = subTabsMeta.get(sid) ?? {
          id: sid,
          primaryTabId: primary.id,
          title: tabTitles[idx] || 'Principal',
          kind: 'main' as SubTabKind
        }
        return { subTabId: sid, idx, meta }
      })
      .filter((item) => item.idx !== -1)
  }

  $: activePrimary = getPaneActivePrimary(activeLeafId, tabsRenderVersion)

  $: {
    if (layoutLeaves.length > 0) {
      let changed = false
      const currentLeafIds = new Set(layoutLeaves.map((l) => l.id))
      for (const k of [...panePrimaryMap.keys()]) {
        if (!currentLeafIds.has(k)) {
          panePrimaryMap.delete(k)
          paneActivePrimaryMap.delete(k)
          changed = true
        }
      }
      for (const leaf of layoutLeaves) {
        if (!panePrimaryMap.has(leaf.id) || (panePrimaryMap.get(leaf.id)?.length ?? 0) === 0) {
          if (layoutLeaves.length === 1) {
            panePrimaryMap.set(
              leaf.id,
              primaryTabs.map((p) => p.id)
            )
          } else {
            const assigned = new Set<number>()
            for (const ids of panePrimaryMap.values()) ids.forEach((id) => assigned.add(id))
            const unassigned = primaryTabs.filter((p) => !assigned.has(p.id))
            if (unassigned.length > 0) {
              panePrimaryMap.set(leaf.id, [unassigned[0].id])
            } else {
              panePrimaryMap.set(leaf.id, [primaryTabs[0]?.id ?? 1])
            }
          }
          changed = true
        }
        if (!paneActivePrimaryMap.has(leaf.id)) {
          paneActivePrimaryMap.set(leaf.id, panePrimaryMap.get(leaf.id)?.[0] ?? 1)
          changed = true
        }
      }
      if (changed) {
        panePrimaryMap = new Map(panePrimaryMap)
        paneActivePrimaryMap = new Map(paneActivePrimaryMap)
      }
    }
  }

  $: if (activePrimary) {
    activePrimary.requestState.method = reqMethod
    activePrimary.requestState.url = reqUrl
    activePrimary.requestState.headers = reqHeaders
    activePrimary.requestState.body = reqBody
    activePrimary.requestState.bodyType = reqBodyType
    activePrimary.requestState.sendMode = reqSendMode
    activePrimary.requestState.authType = reqAuthType
    activePrimary.requestState.authBearerToken = authBearerToken
    activePrimary.requestState.authBasicUser = authBasicUser
    activePrimary.requestState.authBasicPass = authBasicPass
    activePrimary.requestState.authApiKeyName = authApiKeyName
    activePrimary.requestState.authApiKeyValue = authApiKeyValue
    activePrimary.requestState.proxyMode = reqProxyMode
    activePrimary.requestState.customProxyUrl = reqCustomProxyUrl
    activePrimary.requestState.captures = reqCaptures
  }
  let reqActiveTab: 'params' | 'headers' | 'body' | 'auth' | 'captures' | 'env' = 'params'
  let reqParams: QueryParam[] = []
  let reqHeaderRows: HeaderRow[] = []
  let reqBodyType: 'none' | 'json' | 'text' = 'json'
  let reqAuthType: 'none' | 'bearer' | 'basic' | 'apikey' = 'none'
  let authBearerToken = '{{token}}'
  let authBasicUser = ''
  let authBasicPass = ''
  let authApiKeyName = 'X-API-Key'
  let authApiKeyValue = ''
  let authValidationMessage: { ok: boolean; text: string } | null = null
  let reqProxyMode: 'inherit' | 'direct' | 'corsproxy' | 'allorigins' | 'custom' = 'inherit'
  let reqCustomProxyUrl = ''
  let reqCaptures: CaptureRule[] = []
  let reqResponseText = ''

  const requestsViewMode = useLocalStorage('svelte-jsoneditor-demo-requests-view-mode', 'form')
  const flowGraphStore = useLocalStorage(
    'svelte-jsoneditor-demo-flow-graph',
    createDefaultFlowGraph()
  )

  const chainOpen = useLocalStorage('svelte-jsoneditor-demo-chain-open', true)
  const historyOpen = useLocalStorage('svelte-jsoneditor-demo-history-open', true)
  const sidebarAdvancedOpen = useLocalStorage('svelte-jsoneditor-demo-sidebar-advanced', false)
  const sidebarSamplesOpen = useLocalStorage('svelte-jsoneditor-demo-sidebar-samples', false)
  let reqResult:
    | {
        status: number
        statusText: string
        durationMs: number
        sizeBytes: number
        missing?: string[]
        viaProxy?: boolean
      }
    | { error: string }
    | undefined
  let reqHistory: RequestHistoryEntry[] = []
  const corsProxy = useLocalStorage('svelte-jsoneditor-demo-cors-proxy', '')
  const proxyCustom = useLocalStorage('svelte-jsoneditor-demo-cors-proxy-custom', false)

  // ---- Environments, tokens and execution chain ----
  const environments = useLocalStorage('svelte-jsoneditor-demo-environments', {})
  const activeEnvName = useLocalStorage('svelte-jsoneditor-demo-active-env', '')
  const globalEnvironment = useLocalStorage('svelte-jsoneditor-demo-global-env', {})
  let envManagerOpen = false

  /**
   * Pre-registered example chain (Rick and Morty API):
   * step 1 uses the env variable `{{baseUrl}}` and captures `id` into `{{charId}}`;
   * the following steps reuse that captured value in the URL and in a header.
   */
  const EXAMPLE_CHAIN: ChainItem[] = [
    {
      method: 'GET',
      url: '{{baseUrl}}/character/1',
      headers: '',
      body: '',
      captures: [{ path: 'id', name: 'charId' }]
    },
    {
      method: 'GET',
      url: '{{baseUrl}}/episode/{{charId}}',
      headers: '',
      body: '',
      captures: [{ path: 'name', name: 'episodeName' }]
    },
    {
      method: 'GET',
      url: '{{baseUrl}}/location/{{charId}}',
      headers: 'X-Character-Id: {{charId}}',
      body: '',
      captures: []
    }
  ]
  const requestChain = useLocalStorage('svelte-jsoneditor-demo-chain', EXAMPLE_CHAIN)
  let tokenUrl = ''
  let tokenPath = 'access_token'
  let chainRunning = false
  let chainRunningIndex = -1
  let chainResults: Array<{
    method: string
    url: string
    status: number | 'error'
    durationMs: number
    sizeBytes: number
    captured?: string
  }> = []
  let capturePath = ''
  let captureVar = ''
  let envJsonText = '{}'
  let editingChainIndex = -1
  const requestsHeight = useLocalStorage('svelte-jsoneditor-demo-requests-height', 320)
  let requestsPanelEl: HTMLDivElement | undefined
  let envTabId: number | undefined
  let bodyTabId: number | undefined

  // ---- Edit-in-tab support: preview windows and nested content open as tabs ----
  let previewTabInfo = new Map<number, { pathLabel: string; onSave: (value: string) => void }>()
  let nestedTabInfo = new Map<
    number,
    { pointer: string; sourceTabId: number; onClose: () => void }
  >()

  // ---- Preserve tree expansion across tab switches ----
  let tabExpandedPaths = new Map<number, JSONPath[]>()

  /**
   * Apply a JSON patch (replace at pointer) to a source tab's CONTENT directly,
   * so it works even when that tab's editor is not mounted (it is unmounted
   * while another tab is active in the same pane).
   */
  function applyReplaceToSource(sourceTabId: number, pointer: string, value: unknown) {
    const sourceIdx = getTabIdx(sourceTabId)
    if (sourceIdx === -1) return
    const sourceContent = tabContents[sourceIdx]
    if (!sourceContent) return

    let json: unknown
    if (isJSONContent(sourceContent) && sourceContent.json !== undefined) {
      json = sourceContent.json
    } else if (isTextContent(sourceContent)) {
      try {
        json = JSON.parse(sourceContent.text ?? 'null')
      } catch {
        return
      }
    } else {
      return
    }

    const patched = immutableJSONPatch(json, [{ op: 'replace', path: pointer, value }])
    tabContents[sourceIdx] = { text: JSON.stringify(patched, null, 2), json: undefined }
    tabContents = [...tabContents]
    tabRevisions[sourceIdx]++
    tabRevisions = [...tabRevisions]
    updateDirtyFlags()
    scheduleAutosave()
    showDiskSaveLabel(`Saved back to the document at "${pointer}"`)
  }

  $: activeEnv = $activeEnvName ? ($environments[$activeEnvName] ?? {}) : {}
  $: chainItems = ($requestChain ?? []) as ChainItem[]
  $: urlSuggestions = [...new Set(reqHistory.map((entry) => entry.url).filter(Boolean))].slice(0, 8)
  $: reqBodyInvalid = reqBodyType === 'json' && reqBody.trim() !== '' && !isValidJsonText(reqBody)
  $: bodyIgnored =
    reqBodyType !== 'none' && reqBody.trim() !== '' && ['GET', 'HEAD'].includes(reqMethod)

  function isValidJsonText(text: string): boolean {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }

  $: layoutRects = computeRects(layout)
  $: layoutLeaves = collectLeaves(layout)

  function getActiveLeaf(): SplitLeaf {
    return findLeaf(layout, activeLeafId) ?? layoutLeaves[0]
  }

  function setActiveLeafTab(idx: number) {
    const leaf = getActiveLeaf()
    if (leaf.tabIdx !== idx) {
      // save the expansion state of the outgoing tab (its editor will be unmounted)
      const prevTabId = tabIds[leaf.tabIdx]
      const prevRef = tabRefs[leaf.tabIdx]
      if (prevTabId !== undefined && prevRef) {
        try {
          const paths = prevRef.getExpandedPaths()
          if (paths.length > 0) tabExpandedPaths.set(prevTabId, paths)
        } catch {
          // method may be missing in older builds
        }
      }

      layout = replaceLeaf(layout, leaf.id, { ...leaf, tabIdx: idx })

      // restore the expansion state of the incoming tab once its editor is mounted
      void tick().then(() => {
        const ref = tabRefs[idx]
        const paths = tabExpandedPaths.get(tabIds[idx])
        if (ref && paths && paths.length > 0) {
          ref.expandPaths(paths)
        }
      })
    }
  }

  function remapLeafTabs(mapFn: (tabIdx: number) => number) {
    layout = mapLeaves(layout, (leaf) => ({ ...leaf, tabIdx: mapFn(leaf.tabIdx) }))
  }

  function getTabIdx(tabId: number): number {
    return tabIds.indexOf(tabId)
  }

  // ---- Split operations (tree-based) ----
  function splitActiveLeaf(direction: SplitDirection, _tabId?: number) {
    if (layoutLeaves.length >= 4) {
      showDiskSaveLabel('Maximum of 4 panes reached')
      return
    }
    const sourceLeafId = activeLeafId
    const newLeafId = nextNodeId++
    const splitId = nextNodeId++
    layout = splitLeaf(layout, sourceLeafId, direction, splitId, newLeafId)

    const currentTabs = panePrimaryMap.get(sourceLeafId) ?? []
    if (currentTabs.length > 1) {
      const primToMove = getPaneActivePrimaryId(sourceLeafId)
      const { updatedMap } = movePrimaryTabToPane(panePrimaryMap, primToMove, newLeafId)
      panePrimaryMap = updatedMap
      selectPrimaryTabInPane(newLeafId, primToMove)
    } else {
      const newPrimId = nextPrimaryTabId++
      const newSubId = nextTabId++
      addDocWithId(newSubId, 'Principal', '{}', Mode.tree)
      const { primary, initialSubTab } = createPrimaryTab(
        newPrimId,
        `Editor ${newPrimId}`,
        newSubId
      )
      subTabsMeta.set(newSubId, initialSubTab)
      primaryTabs = [...primaryTabs, primary]
      panePrimaryMap.set(newLeafId, [newPrimId])
      paneActivePrimaryMap.set(newLeafId, newPrimId)
      panePrimaryMap = new Map(panePrimaryMap)
      paneActivePrimaryMap = new Map(paneActivePrimaryMap)
      selectPrimaryTabInPane(newLeafId, newPrimId)
    }
    scheduleAutosave()
    showDiskSaveLabel('Tela dividida em grid ✓')
  }

  function closeActiveLeaf() {
    if (layoutLeaves.length <= 1) return
    closeLeafById(activeLeafId)
  }

  function closeLeafById(leafId: number) {
    if (layoutLeaves.length <= 1) return
    const surviving = layoutLeaves.find((l) => l.id !== leafId)
    if (surviving) {
      const tabsToMove = panePrimaryMap.get(leafId) ?? []
      const survivingTabs = panePrimaryMap.get(surviving.id) ?? []
      panePrimaryMap.set(surviving.id, [...survivingTabs, ...tabsToMove])
    }
    panePrimaryMap.delete(leafId)
    paneActivePrimaryMap.delete(leafId)
    panePrimaryMap = new Map(panePrimaryMap)
    paneActivePrimaryMap = new Map(paneActivePrimaryMap)

    const next = removeLeaf(layout, leafId)
    if (next) {
      layout = next
      const remainingLeaf = collectLeaves(layout)[0]
      activeLeafId = remainingLeaf.id
      activePrimaryTabId = getPaneActivePrimaryId(remainingLeaf.id)
      const p = primaryTabs.find((x) => x.id === activePrimaryTabId)
      if (p) loadPrimaryRequestToForm(p)
      scheduleAutosave()
      showDiskSaveLabel('Grid fechado e tela ajustada ✓')
    }
  }

  // ---- Tab operations (2-level hierarchy) ----
  function addDocWithId(id: number, title: string, text: string, mode: Mode = Mode.tree): number {
    tabIds = [...tabIds, id]
    tabTitles = [...tabTitles, title]
    tabContents = [...tabContents, { text, json: undefined }]
    tabModes = [...tabModes, mode]
    tabSelections = [...tabSelections, undefined]
    tabRefs = [...tabRefs, undefined]
    tabRevisions = [...tabRevisions, 0]
    tabLastSavedText = [...tabLastSavedText, text]
    updateDirtyFlags()
    scheduleAutosave()
    return tabIds.length - 1
  }

  function selectPrimaryTabInPane(leafId: number, primaryId: number) {
    paneActivePrimaryMap.set(leafId, primaryId)
    paneActivePrimaryMap = new Map(paneActivePrimaryMap)
    activeLeafId = leafId
    activePrimaryTabId = primaryId
    const primary = primaryTabs.find((p) => p.id === primaryId)
    if (primary) {
      loadPrimaryRequestToForm(primary)
      const targetIdx = getTabIdx(primary.activeSubTabId)
      if (targetIdx !== -1) {
        layout = replaceLeaf(layout, leafId, { id: leafId, type: 'leaf', tabIdx: targetIdx })
      }
    }
    tabsRenderVersion++
    scheduleAutosave()
  }

  function selectPrimaryTab(primaryId: number) {
    selectPrimaryTabInPane(activeLeafId, primaryId)
  }

  function selectSubTabInPane(leafId: number, primary: PrimaryTabState, subTabId: number) {
    primary.activeSubTabId = subTabId
    primaryTabs = [...primaryTabs]
    activeLeafId = leafId
    activePrimaryTabId = primary.id
    loadPrimaryRequestToForm(primary)
    const idx = getTabIdx(subTabId)
    if (idx !== -1) {
      layout = replaceLeaf(layout, leafId, { id: leafId, type: 'leaf', tabIdx: idx })
    }
    tabsRenderVersion++
    scheduleAutosave()
  }

  function selectSubTab(subTabId: number) {
    if (activePrimary) {
      selectSubTabInPane(activeLeafId, activePrimary, subTabId)
    }
  }

  function addPrimaryTabInPane(leafId: number) {
    const newPrimId = nextPrimaryTabId++
    const newSubId = nextTabId++
    const title = `Editor ${newPrimId}`
    const idx = addDocWithId(newSubId, 'Principal', '{}', Mode.tree)
    const { primary, initialSubTab } = createPrimaryTab(newPrimId, title, newSubId)
    subTabsMeta.set(newSubId, initialSubTab)
    primaryTabs = [...primaryTabs, primary]
    const existing = panePrimaryMap.get(leafId) ?? []
    panePrimaryMap.set(leafId, [...existing, newPrimId])
    panePrimaryMap = new Map(panePrimaryMap)
    tabsRenderVersion++
    selectPrimaryTabInPane(leafId, newPrimId)
  }

  function addPrimaryTab() {
    addPrimaryTabInPane(activeLeafId)
  }

  function addSubTabInPane(leafId: number, primary: PrimaryTabState) {
    const newSubId = nextTabId++
    const title = `Documento ${primary.subTabIds.length + 1}`
    const idx = addDocWithId(newSubId, title, '{}', Mode.tree)
    const { updatedPrimary, subTab } = addSubTabToPrimary(primary, newSubId, title, 'custom')
    subTabsMeta.set(newSubId, subTab)
    primaryTabs = primaryTabs.map((p) => (p.id === updatedPrimary.id ? updatedPrimary : p))
    tabsRenderVersion++
    selectSubTabInPane(leafId, updatedPrimary, newSubId)
  }

  function addSubTab() {
    if (activePrimary) {
      addSubTabInPane(activeLeafId, activePrimary)
    }
  }

  function loadPrimaryRequestToForm(primary: PrimaryTabState) {
    const rs = primary.requestState
    reqMethod = rs.method || 'GET'
    reqUrl = rs.url || ''
    reqHeaders = rs.headers || ''
    reqBody = rs.body || ''
    reqBodyType = rs.bodyType || 'json'
    reqSendMode = rs.sendMode || 'same'
    reqParams = parseQueryParams(reqUrl)
    reqHeaderRows = headersToRows(reqHeaders)
    reqAuthType = rs.authType || 'none'
    authBearerToken = rs.authBearerToken || '{{token}}'
    authBasicUser = rs.authBasicUser || ''
    authBasicPass = rs.authBasicPass || ''
    authApiKeyName = rs.authApiKeyName || 'X-API-Key'
    authApiKeyValue = rs.authApiKeyValue || ''
    reqProxyMode = rs.proxyMode || 'inherit'
    reqCustomProxyUrl = rs.customProxyUrl || ''
    reqCaptures = rs.captures ? [...rs.captures] : []
    authValidationMessage = null
  }

  function closePrimaryTabInPane(leafId: number, primaryId: number) {
    const primary = primaryTabs.find((p) => p.id === primaryId)
    if (!primary) return

    primary.subTabIds.forEach((sid) => {
      subTabsMeta.delete(sid)
      closeTab(sid)
    })

    primaryTabs = primaryTabs.filter((p) => p.id !== primaryId)

    const currentList = panePrimaryMap.get(leafId) ?? []
    const updatedList = currentList.filter((id) => id !== primaryId)
    panePrimaryMap.set(leafId, updatedList)
    panePrimaryMap = new Map(panePrimaryMap)

    if (updatedList.length === 0) {
      if (layoutLeaves.length > 1) {
        const collapsed = removeLeaf(layout, leafId)
        if (collapsed) {
          layout = collapsed
          panePrimaryMap.delete(leafId)
          paneActivePrimaryMap.delete(leafId)
          panePrimaryMap = new Map(panePrimaryMap)
          paneActivePrimaryMap = new Map(paneActivePrimaryMap)
          const remainingLeaf = collectLeaves(layout)[0]
          activeLeafId = remainingLeaf.id
          activePrimaryTabId = getPaneActivePrimaryId(remainingLeaf.id)
          const p = primaryTabs.find((x) => x.id === activePrimaryTabId)
          if (p) loadPrimaryRequestToForm(p)
          tabsRenderVersion++
          scheduleAutosave()
          showDiskSaveLabel('Grid colapsado e tela ajustada ✓')
          return
        }
      } else {
        const newPrimId = 1
        const newSubId = nextTabId++
        addDocWithId(newSubId, 'Principal', '{}', Mode.tree)
        const { primary: newP, initialSubTab } = createPrimaryTab(newPrimId, 'Editor 1', newSubId)
        nextPrimaryTabId = 2
        primaryTabs = [newP]
        subTabsMeta.clear()
        subTabsMeta.set(newSubId, initialSubTab)
        panePrimaryMap.set(leafId, [newPrimId])
        panePrimaryMap = new Map(panePrimaryMap)
        tabsRenderVersion++
        selectPrimaryTabInPane(leafId, newPrimId)
        return
      }
    } else {
      selectPrimaryTabInPane(leafId, updatedList[0])
    }
    tabsRenderVersion++
  }

  function closePrimaryTab(primaryId: number) {
    closePrimaryTabInPane(activeLeafId, primaryId)
  }

  function closeSubTabInPane(leafId: number, primary: PrimaryTabState, subTabId: number) {
    const meta = subTabsMeta.get(subTabId)
    if (!canCloseSubTab(meta)) {
      showDiskSaveLabel('The main page cannot be closed')
      return
    }

    if (primary.subTabIds.length <= 1) {
      return
    }

    const { updatedPrimary } = removeSubTabFromPrimary(primary, subTabId)
    primaryTabs = primaryTabs.map((p) => (p.id === updatedPrimary.id ? updatedPrimary : p))
    subTabsMeta.delete(subTabId)
    closeTab(subTabId)
    tabsRenderVersion++
    selectSubTabInPane(leafId, updatedPrimary, updatedPrimary.activeSubTabId)
  }

  function closeSubTab(subTabId: number) {
    const primary = primaryTabs.find((p) => p.subTabIds.includes(subTabId))
    if (primary) {
      closeSubTabInPane(activeLeafId, primary, subTabId)
    }
  }

  function promoteSubTabInPane(leafId: number, subTabId: number) {
    const meta = subTabsMeta.get(subTabId)
    if (!canPromoteSubTab(meta)) {
      showDiskSaveLabel('The main tab cannot be promoted')
      return
    }
    const fromPrimary = primaryTabs.find((p) => p.subTabIds.includes(subTabId))
    if (!fromPrimary) return
    const idx = getTabIdx(subTabId)
    const subTitle = tabTitles[idx] || meta?.title || `Editor ${nextPrimaryTabId}`
    const newPrimId = nextPrimaryTabId++

    let fallbackSubId: number | undefined
    if (fromPrimary.subTabIds.length <= 1) {
      fallbackSubId = nextTabId++
      addDocWithId(fallbackSubId, 'Principal', '{}', Mode.tree)
    }

    const { updatedSource, newPrimary, updatedSubTab, fallbackCreated } = promoteSubTabToPrimary(
      fromPrimary,
      subTabId,
      newPrimId,
      subTitle,
      fallbackSubId
    )

    if (fallbackCreated && fallbackSubId !== undefined) {
      subTabsMeta.set(fallbackSubId, fallbackCreated)
    }
    subTabsMeta.set(subTabId, updatedSubTab)

    primaryTabs = [
      ...primaryTabs.map((p) => (p.id === updatedSource.id ? updatedSource : p)),
      newPrimary
    ]

    const existing = panePrimaryMap.get(leafId) ?? []
    panePrimaryMap.set(leafId, [...existing, newPrimId])
    panePrimaryMap = new Map(panePrimaryMap)

    tabsRenderVersion++
    selectPrimaryTabInPane(leafId, newPrimId)
    showDiskSaveLabel(`Sub-tab "${subTitle}" promoted to Level 1 ✓`)
  }

  function promoteSubTab(subTabId: number) {
    promoteSubTabInPane(activeLeafId, subTabId)
  }

  function renamePrimaryTab(primaryId: number, title: string) {
    primaryTabs = primaryTabs.map((p) => (p.id === primaryId ? { ...p, title } : p))
    tabsRenderVersion++
    scheduleAutosave()
  }

  function renameSubTab(subTabId: number, title: string) {
    const idx = getTabIdx(subTabId)
    if (idx !== -1) {
      tabTitles[idx] = title
      tabTitles = [...tabTitles]
    }
    const meta = subTabsMeta.get(subTabId)
    if (meta) {
      meta.title = title
      subTabsMeta.set(subTabId, meta)
    }
    tabsRenderVersion++
    scheduleAutosave()
  }

  function addPrimaryTabWithContent(title: string, text: string, mode: Mode = Mode.tree): number {
    const newPrimId = nextPrimaryTabId++
    const newSubId = nextTabId++
    const idx = addDocWithId(newSubId, title, text, mode)
    const { primary, initialSubTab } = createPrimaryTab(newPrimId, title, newSubId)
    subTabsMeta.set(newSubId, initialSubTab)
    primaryTabs = [...primaryTabs, primary]
    const existing = panePrimaryMap.get(activeLeafId) ?? []
    panePrimaryMap.set(activeLeafId, [...existing, newPrimId])
    panePrimaryMap = new Map(panePrimaryMap)
    paneActivePrimaryMap.set(activeLeafId, newPrimId)
    paneActivePrimaryMap = new Map(paneActivePrimaryMap)
    activePrimaryTabId = newPrimId
    setActiveLeafTab(idx)
    loadPrimaryRequestToForm(primary)
    tabsRenderVersion++
    return idx
  }

  function addSubTabWithContent(
    title: string,
    text: string,
    mode: Mode = Mode.tree,
    kind: SubTabKind = 'custom'
  ): number {
    const activeP = getPaneActivePrimary(activeLeafId)
    const newSubId = nextTabId++
    const idx = addDocWithId(newSubId, title, text, mode)
    const { updatedPrimary, subTab } = addSubTabToPrimary(activeP, newSubId, title, kind)
    subTabsMeta.set(newSubId, subTab)
    primaryTabs = primaryTabs.map((p) => (p.id === updatedPrimary.id ? updatedPrimary : p))
    tabsRenderVersion++
    selectSubTabInPane(activeLeafId, updatedPrimary, newSubId)
    return idx
  }

  function addTabWithContent(title: string, text: string, mode: Mode = Mode.tree): number {
    return addPrimaryTabWithContent(title, text, mode)
  }

  function addTab() {
    addPrimaryTab()
  }

  function closeTab(tabId: number) {
    const idx = getTabIdx(tabId)
    if (idx === -1) return
    if (tabIds.length <= 1) {
      // Closing the last tab resets to a fresh untitled document
      closeAllTabs()
      return
    }
    tabIds = tabIds.filter((_, i) => i !== idx)
    tabTitles = tabTitles.filter((_, i) => i !== idx)
    tabContents = tabContents.filter((_, i) => i !== idx)
    tabModes = tabModes.filter((_, i) => i !== idx)
    tabSelections = tabSelections.filter((_, i) => i !== idx)
    tabRefs = tabRefs.filter((_, i) => i !== idx)
    tabRevisions = tabRevisions.filter((_, i) => i !== idx)
    tabLastSavedText = tabLastSavedText.filter((_, i) => i !== idx)
    if (fileHandles.has(tabId)) {
      fileHandles.delete(tabId)
      void removeFileHandle(tabId)
    }
    if (envTabId === tabId) envTabId = undefined
    if (bodyTabId === tabId) bodyTabId = undefined
    if (previewTabInfo.has(tabId)) previewTabInfo.delete(tabId)
    if (nestedTabInfo.has(tabId)) {
      nestedTabInfo.get(tabId)?.onClose()
      nestedTabInfo.delete(tabId)
    }
    if (tabExpandedPaths.has(tabId)) tabExpandedPaths.delete(tabId)
    updateDirtyFlags()
    scheduleAutosave()
    remapLeafTabs((t) => (t > idx ? t - 1 : t === idx ? Math.min(idx, tabIds.length - 1) : t))
  }

  function renameTab(tabId: number, title: string) {
    const idx = getTabIdx(tabId)
    if (idx === -1) return
    tabTitles[idx] = title
    tabTitles = [...tabTitles]
    tabsRenderVersion++
    scheduleAutosave()
  }

  function closeOtherTabs(tabId: number) {
    const idx = getTabIdx(tabId)
    if (idx === -1 || tabIds.length <= 1) return
    tabIds = [tabId]
    tabTitles = [tabTitles[idx]]
    tabContents = [tabContents[idx]]
    tabModes = [tabModes[idx]]
    tabSelections = [tabSelections[idx]]
    tabRefs = [tabRefs[idx]]
    tabRevisions = [tabRevisions[idx]]
    tabLastSavedText = [tabLastSavedText[idx]]
    for (const key of [...fileHandles.keys()]) {
      if (key !== tabId) fileHandles.delete(key)
    }
    void saveFileHandles(fileHandles)
    for (const key of [...previewTabInfo.keys()]) {
      if (key !== tabId) previewTabInfo.delete(key)
    }
    for (const key of [...nestedTabInfo.keys()]) {
      if (key !== tabId) {
        nestedTabInfo.get(key)?.onClose()
        nestedTabInfo.delete(key)
      }
    }
    for (const key of [...tabExpandedPaths.keys()]) {
      if (key !== tabId) tabExpandedPaths.delete(key)
    }
    remapLeafTabs(() => 0)
    updateDirtyFlags()
    scheduleAutosave()
  }

  function closeAllTabs() {
    tabIds = [nextTabId++]
    tabTitles = ['Untitled']
    tabContents = [{ text: '{}', json: undefined }]
    tabModes = [Mode.tree]
    tabSelections = [undefined]
    tabRefs = [undefined]
    tabRevisions = [0]
    tabLastSavedText = ['{}']
    previewTabInfo.clear()
    nestedTabInfo.clear()
    tabExpandedPaths.clear()
    remapLeafTabs(() => 0)
    if (fileHandles.size > 0) {
      fileHandles.clear()
      void saveFileHandles(fileHandles)
    }
    updateDirtyFlags()
    scheduleAutosave()
  }

  function moveTab(tabId: number, beforeTabId: number) {
    const from = getTabIdx(tabId)
    const to = getTabIdx(beforeTabId)
    if (from === -1 || to === -1 || from === to) return
    const { order, newIndexOfOld } = moveBefore(tabIds.length, from, to)
    const reorder = <T,>(arr: T[]): T[] => order.map((oldIndex) => arr[oldIndex])
    tabIds = reorder(tabIds)
    tabTitles = reorder(tabTitles)
    tabContents = reorder(tabContents)
    tabModes = reorder(tabModes)
    tabSelections = reorder(tabSelections)
    tabRefs = reorder(tabRefs)
    tabRevisions = reorder(tabRevisions)
    tabLastSavedText = reorder(tabLastSavedText)
    remapLeafTabs((t) => newIndexOfOld[t])
    dirtyFlags = reorder(dirtyFlags)
    scheduleAutosave()
  }

  /**
   * Resize by dragging a divider: translate the pointer position into a new
   * ratio for the split node that owns the divider.
   */
  function startResize(e: MouseEvent, splitId: number) {
    if (layoutLeaves.length < 2 || !panesEl) return
    e.preventDefault()
    const splitRect = layoutRects.splits.find((s) => s.splitId === splitId)
    if (!splitRect) return
    const container = panesEl.getBoundingClientRect()
    const sideBySide = splitRect.direction === 'vertical'
    const origin = sideBySide
      ? container.left + (splitRect.x / 100) * container.width
      : container.top + (splitRect.y / 100) * container.height
    const size = sideBySide
      ? (splitRect.width / 100) * container.width
      : (splitRect.height / 100) * container.height
    if (size <= 0) return

    const onMove = (ev: MouseEvent) => {
      const pos = sideBySide ? ev.clientX : ev.clientY
      const ratio = (pos - origin) / size
      layout = setSplitRatio(layout, splitId, ratio)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      scheduleAutosave()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function buildPrimaryTabMenuItems(primaryId: number, leafId?: number) {
    const p = primaryTabs.find((pt) => pt.id === primaryId)
    const effectiveLeafId = leafId ?? activeLeafId
    const currentPaneTabs = getPanePrimaryTabs(effectiveLeafId)
    const isSingle = currentPaneTabs.length <= 1 && layoutLeaves.length <= 1
    return [
      {
        label: '+ Nova Sub-aba',
        disabled: false,
        action: () => {
          if (p) {
            selectPrimaryTabInPane(effectiveLeafId, primaryId)
            addSubTabInPane(effectiveLeafId, p)
          }
        }
      },
      {
        label: 'Renomear…',
        disabled: false,
        action: () => {
          const n = prompt('Renomear aba principal:', p?.title)
          if (n) renamePrimaryTab(primaryId, n)
        }
      },
      {
        label: 'Dividir tela (Split Vertical)',
        disabled: layoutLeaves.length >= 4,
        action: () => splitActiveLeaf('vertical')
      },
      {
        label: 'Dividir tela (Split Horizontal)',
        disabled: layoutLeaves.length >= 4,
        action: () => splitActiveLeaf('horizontal')
      },
      {
        label: 'Close Main Tab',
        disabled: isSingle,
        action: () => closePrimaryTabInPane(effectiveLeafId, primaryId)
      }
    ]
  }

  function buildSubTabMenuItems(subTabId: number, leafId?: number) {
    const meta = subTabsMeta.get(subTabId)
    const canPromote = canPromoteSubTab(meta)
    const canClose = canCloseSubTab(meta)
    const effectiveLeafId = leafId ?? activeLeafId
    const primary = primaryTabs.find((p) => p.subTabIds.includes(subTabId))
    const isSingle = (primary?.subTabIds.length ?? 0) <= 1
    return [
      ...(canPromote
        ? [
            {
              label: '⇡ Promote to Main Tab (Level 1)',
              disabled: false,
              action: () => promoteSubTabInPane(effectiveLeafId, subTabId)
            }
          ]
        : []),
      {
        label: 'Renomear…',
        disabled: false,
        action: () => {
          const idx = getTabIdx(subTabId)
          const n = prompt('Renomear sub-aba:', tabTitles[idx])
          if (n) renameSubTab(subTabId, n)
        }
      },
      ...(canClose
        ? [
            {
              label: 'Close Sub-tab',
              disabled: isSingle,
              action: () => {
                if (primary) closeSubTabInPane(effectiveLeafId, primary, subTabId)
              }
            }
          ]
        : [])
    ]
  }

  function buildTabMenuItems(tabId: number) {
    return buildSubTabMenuItems(tabId)
  }

  // ---- Drag & drop: Level 1 tabs, Level 2 sub-tabs, and Pane auto-collapse ----
  function onPrimaryTabDragStartInPane(e: DragEvent, leafId: number, primaryId: number) {
    draggedPrimaryId = primaryId
    draggedPrimarySourceLeafId = leafId
    tabDragActive = true
    e.dataTransfer!.setData('application/x-primary-id', String(primaryId))
    e.dataTransfer!.setData('application/x-source-leaf-id', String(leafId))
    e.dataTransfer!.effectAllowed = 'move'
  }

  function onPrimaryTabDragOverInPane(e: DragEvent, leafId: number, targetPrimaryId: number) {
    if (!draggedPrimaryId) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer!.dropEffect = 'move'
    dragOverLeafId = leafId
    if (draggedPrimaryId !== targetPrimaryId) {
      dragOverTargetPrimaryId = targetPrimaryId
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      dragOverTargetPrimaryPosition = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    } else {
      dragOverTargetPrimaryId = undefined
      dragOverTargetPrimaryPosition = undefined
    }
  }

  function onPrimaryTabDrop(e: DragEvent, targetLeafId: number, targetPrimaryId?: number) {
    e.preventDefault()
    e.stopPropagation()
    if (draggedPrimaryId === undefined || draggedPrimarySourceLeafId === undefined) {
      onTabDragEnd()
      return
    }

    const primId = draggedPrimaryId
    const sourceLeafId = draggedPrimarySourceLeafId
    const targetPos = dragOverTargetPrimaryPosition ?? 'after'

    if (sourceLeafId === targetLeafId) {
      // Reordering within the same pane
      let list = [...(panePrimaryMap.get(targetLeafId) ?? [])]
      if (list.length === 0 || !list.includes(primId)) {
        list = getPanePrimaryTabs(targetLeafId).map((p) => p.id)
      }
      const nextList = reorderTabIds(list, primId, targetPrimaryId, targetPos)
      panePrimaryMap.set(targetLeafId, nextList)
      panePrimaryMap = new Map(panePrimaryMap)

      // Synchronize global primaryTabs order
      const reordered: PrimaryTabState[] = []
      for (const id of nextList) {
        const p = primaryTabs.find((item) => item.id === id)
        if (p) reordered.push(p)
      }
      for (const p of primaryTabs) {
        if (!reordered.includes(p)) reordered.push(p)
      }
      primaryTabs = reordered
      showDiskSaveLabel('Abas reorganizadas ✓')
    } else {
      // Moving between panes
      let sourceList = [...(panePrimaryMap.get(sourceLeafId) ?? [])]
      if (sourceList.length === 0 || !sourceList.includes(primId)) {
        sourceList = getPanePrimaryTabs(sourceLeafId).map((p) => p.id)
        panePrimaryMap.set(sourceLeafId, sourceList)
      }

      let targetList = [...(panePrimaryMap.get(targetLeafId) ?? [])]
      if (targetList.length === 0) {
        targetList = getPanePrimaryTabs(targetLeafId).map((p) => p.id)
        panePrimaryMap.set(targetLeafId, targetList)
      }

      const { updatedMap, emptySourceLeafId } = movePrimaryTabBetweenPanes(
        panePrimaryMap,
        primId,
        sourceLeafId,
        targetLeafId,
        targetPrimaryId,
        targetPos
      )
      panePrimaryMap = updatedMap

      // If source pane still has tabs, ensure its active tab is valid
      const remainingSource = panePrimaryMap.get(sourceLeafId) ?? []
      if (remainingSource.length > 0) {
        const currentSourceActive = paneActivePrimaryMap.get(sourceLeafId)
        if (
          currentSourceActive === primId ||
          !remainingSource.includes(currentSourceActive ?? -1)
        ) {
          paneActivePrimaryMap.set(sourceLeafId, remainingSource[0])
          paneActivePrimaryMap = new Map(paneActivePrimaryMap)
        }
      }

      // Auto-collapse if source pane became empty
      if (emptySourceLeafId !== undefined && layoutLeaves.length > 1) {
        const collapsed = removeLeaf(layout, emptySourceLeafId)
        if (collapsed) {
          layout = collapsed
          panePrimaryMap.delete(emptySourceLeafId)
          paneActivePrimaryMap.delete(emptySourceLeafId)
          panePrimaryMap = new Map(panePrimaryMap)
          paneActivePrimaryMap = new Map(paneActivePrimaryMap)
        }
      }

      selectPrimaryTabInPane(targetLeafId, primId)
      showDiskSaveLabel('Aba movida para o grid ✓')
    }

    tabsRenderVersion++
    scheduleAutosave()
    onTabDragEnd()
  }

  function onSubTabDragStart(e: DragEvent, subTabId: number) {
    draggedTabId = subTabId
    tabDragActive = true
    e.dataTransfer!.setData('text/plain', String(subTabId))
    e.dataTransfer!.setData('application/x-subtab-id', String(subTabId))
    e.dataTransfer!.effectAllowed = 'move'
  }

  function onSubTabDragOver(e: DragEvent, targetSubId: number) {
    if (!draggedTabId) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer!.dropEffect = 'move'
    if (draggedTabId !== targetSubId) {
      dragOverTargetSubId = targetSubId
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      dragOverTargetSubPosition = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    } else {
      dragOverTargetSubId = undefined
      dragOverTargetSubPosition = undefined
    }
  }

  function onSubTabDrop(e: DragEvent, targetPrimary: PrimaryTabState, targetSubId?: number) {
    e.preventDefault()
    e.stopPropagation()
    if (draggedTabId === undefined) {
      onTabDragEnd()
      return
    }

    const sid = draggedTabId
    const targetPos = dragOverTargetSubPosition ?? 'after'

    if (targetPrimary.subTabIds.includes(sid)) {
      // Reordering within the same primary tab
      targetPrimary.subTabIds = reorderTabIds(targetPrimary.subTabIds, sid, targetSubId, targetPos)
      primaryTabs = [...primaryTabs]
      tabsRenderVersion++
      showDiskSaveLabel('Sub-abas reorganizadas ✓')
      scheduleAutosave()
    } else {
      // Dragging a subtab to another primary tab
      const sourcePrimary = primaryTabs.find((p) => p.subTabIds.includes(sid))
      const meta = subTabsMeta.get(sid)
      if (sourcePrimary && meta && canPromoteSubTab(meta)) {
        sourcePrimary.subTabIds = sourcePrimary.subTabIds.filter((id) => id !== sid)
        if (sourcePrimary.activeSubTabId === sid) {
          sourcePrimary.activeSubTabId = sourcePrimary.subTabIds[0] ?? 0
        }
        meta.primaryTabId = targetPrimary.id
        subTabsMeta.set(sid, meta)
        if (targetSubId !== undefined && targetPrimary.subTabIds.includes(targetSubId)) {
          const insertIdx =
            targetPos === 'before'
              ? targetPrimary.subTabIds.indexOf(targetSubId)
              : targetPrimary.subTabIds.indexOf(targetSubId) + 1
          targetPrimary.subTabIds.splice(insertIdx, 0, sid)
        } else {
          targetPrimary.subTabIds = [...targetPrimary.subTabIds, sid]
        }
        targetPrimary.activeSubTabId = sid
        primaryTabs = [...primaryTabs]
        tabsRenderVersion++
        showDiskSaveLabel('Sub-aba transferida para o editor ✓')
        scheduleAutosave()
      }
    }

    onTabDragEnd()
  }

  function onTabDragEnd() {
    draggedTabId = undefined
    draggedLeafId = undefined
    draggedPrimaryId = undefined
    draggedPrimarySourceLeafId = undefined
    dragOverTargetPrimaryId = undefined
    dragOverTargetPrimaryPosition = undefined
    dragOverLeafId = undefined
    dragOverTargetSubId = undefined
    dragOverTargetSubPosition = undefined
    tabDragActive = false
  }

  function onPaneDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
  }

  function onPaneDrop(e: DragEvent, targetLeafId: number) {
    e.preventDefault()
    if (draggedPrimaryId !== undefined) {
      onPrimaryTabDrop(e, targetLeafId)
      return
    }
    if (draggedTabId !== undefined) {
      const targetPrim = getPaneActivePrimary(targetLeafId)
      if (targetPrim) {
        onSubTabDrop(e, targetPrim)
      }
      return
    }
    onTabDragEnd()
  }

  function onSplitDropPrimary(e: DragEvent, sourceLeafId: number, direction: SplitDirection) {
    e.preventDefault()
    if (draggedPrimaryId === undefined) return
    if (layoutLeaves.length >= 4) {
      showDiskSaveLabel('Maximum of 4 panes reached')
      return
    }

    const primId = draggedPrimaryId
    const sourceLeaf = draggedPrimarySourceLeafId ?? sourceLeafId
    const newLeafId = nextNodeId++
    const splitId = nextNodeId++

    layout = splitLeaf(layout, sourceLeaf, direction, splitId, newLeafId)

    const { updatedMap, emptySourceLeafId } = movePrimaryTabToPane(
      panePrimaryMap,
      primId,
      newLeafId
    )
    panePrimaryMap = updatedMap

    if (emptySourceLeafId !== undefined) {
      const fallbackPrimId = nextPrimaryTabId++
      const fallbackSubId = nextTabId++
      addDocWithId(fallbackSubId, 'Principal', '{}', Mode.tree)
      const { primary: fbP, initialSubTab: fbSub } = createPrimaryTab(
        fallbackPrimId,
        `Editor ${fallbackPrimId}`,
        fallbackSubId
      )
      subTabsMeta.set(fallbackSubId, fbSub)
      primaryTabs = [...primaryTabs, fbP]
      panePrimaryMap.set(emptySourceLeafId, [fallbackPrimId])
      paneActivePrimaryMap.set(emptySourceLeafId, fallbackPrimId)
    }

    panePrimaryMap = new Map(panePrimaryMap)
    selectPrimaryTabInPane(newLeafId, primId)
    draggedPrimaryId = undefined
    draggedPrimarySourceLeafId = undefined
    tabDragActive = false
    tabsRenderVersion++
    scheduleAutosave()
    showDiskSaveLabel('Tela dividida com sucesso ✓')
  }

  // ---- Settings ----
  const showSidebar = useLocalStorage('svelte-jsoneditor-demo-sidebar', true)
  const selectedTheme = useLocalStorage('svelte-jsoneditor-demo-theme', themes[0].value)
  const selectedIndent = useLocalStorage(
    'svelte-jsoneditor-demo-indentation',
    indentations[0].value
  )
  const selectedParserId = useLocalStorage('svelte-jsoneditor-demo-parser', parsers[0].id)
  const selectedPathId = useLocalStorage('svelte-jsoneditor-demo-path-parser', pathParsers[0].id)
  const tabSz = useLocalStorage('svelte-jsoneditor-demo-tabSize', 4)
  const readOnly = useLocalStorage('svelte-jsoneditor-demo-readOnly', false)
  const mainMenuBar = useLocalStorage('svelte-jsoneditor-demo-mainMenuBar', true)
  const navigationBar = useLocalStorage('svelte-jsoneditor-demo-navigationBar', true)
  const statusBar = useLocalStorage('svelte-jsoneditor-demo-statusBar', true)
  const askToFormat = useLocalStorage('svelte-jsoneditor-demo-askToFormat', true)
  const escapeCtrl = useLocalStorage('svelte-jsoneditor-demo-escapeControlCharacters', false)
  const escapeUni = useLocalStorage('svelte-jsoneditor-demo-escapeUnicodeCharacters', false)
  const flatten = useLocalStorage('svelte-jsoneditor-demo-flattenColumns', false)
  const validateDoc = useLocalStorage('svelte-jsoneditor-demo-validate', false)
  const customRenderer = useLocalStorage('svelte-jsoneditor-demo-useCustomValueRenderer', false)
  const multiQuery = useLocalStorage('svelte-jsoneditor-demo-multipleQueryLanguages', true)

  $: queryLangs = $multiQuery
    ? [
        jsonQueryLanguage,
        jmespathQueryLanguage,
        jsonpathQueryLanguage,
        javascriptQueryLanguage,
        lodashQueryLanguage
      ]
    : [jsonQueryLanguage]
  let queryLangId = jsonQueryLanguage.id
  $: selParser = parsers.find((p) => p.id === $selectedParserId)?.value ?? JSON
  $: selPath = pathParsers.find((p) => p.id === $selectedPathId)?.value ?? pathParsers[0].value
  $: selValidator = $validateDoc ? validator : undefined

  function refresh() {
    tabRefs.forEach((r) => r?.refresh())
  }

  function customRenderValue(props: RenderValueProps): RenderValueComponentDescription[] {
    return props.isEditing
      ? [{ component: EditableValue, props }]
      : [{ component: ReadonlyValue, props }]
  }

  function onRenderMenu(items: MenuItem[]) {
    return items
  }
  function onRenderContextMenu(items: ContextMenuItem[]) {
    return items
  }
  function onChangeQueryLanguage(id: string) {
    queryLangId = id
  }

  // ---- Diff / Compare ----
  let diffMode = false

  function bumpRevision(tabIdx: number) {
    tabRevisions[tabIdx]++
    tabRevisions = [...tabRevisions]
    updateDirtyFlags()
    scheduleAutosave()
    if (envTabId !== undefined && tabIds[tabIdx] === envTabId) syncEnvFromTab(tabIdx)
    if (bodyTabId !== undefined && tabIds[tabIdx] === bodyTabId) syncBodyFromTab(tabIdx)

    // Nested edit tabs: apply changes back to the source document live
    const nested = nestedTabInfo.get(tabIds[tabIdx])
    if (nested) {
      try {
        const parsed: unknown = JSON.parse(getTabText(tabIdx))
        applyReplaceToSource(nested.sourceTabId, nested.pointer, parsed)
      } catch {
        // invalid JSON while typing in the nested tab — wait until it parses
      }
    }

    if ($validateDoc) void collectProblems()
  }

  $: diffRevision =
    tabRevisions[layoutLeaves[0]?.tabIdx ?? 0] + tabRevisions[layoutLeaves[1]?.tabIdx ?? 0]
  $: diffPaths =
    diffMode && layoutLeaves.length >= 2 && diffRevision
      ? computeDiffPaths(
          contentToValue(tabContents[layoutLeaves[0].tabIdx]),
          contentToValue(tabContents[layoutLeaves[1].tabIdx])
        )
      : new Set<string>()

  // Auto-switch to tree mode when comparing
  $: if (diffMode && layoutLeaves.length >= 2) {
    for (const leaf of layoutLeaves.slice(0, 2)) {
      if (tabModes[leaf.tabIdx] === Mode.text) {
        tabModes[leaf.tabIdx] = Mode.tree
        tabModes = [...tabModes]
      }
    }
  }

  function onClassNameDiff(path: JSONPath, _value: unknown): string | undefined {
    if (!diffMode || diffPaths.size === 0) return undefined
    return matchesDiffPath(jsonPathToPointer(path), diffPaths) ? 'jse-diff-changed' : undefined
  }

  // ---- Persistence / autosave (IndexedDB) ----
  let hydrated = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let savedFlashTimer: ReturnType<typeof setTimeout> | undefined
  let saveStatus: 'idle' | 'saving' | 'saved' = 'idle'

  function getTabText(i: number): string {
    const c = tabContents[i]
    if (!c) return ''
    return isJSONContent(c) ? JSON.stringify(c.json, null, 2) : (c.text ?? '')
  }

  $: workspaceSnapshot = {
    version: 3 as const,
    tabs: tabIds.map((id, i) => ({
      id,
      title: tabTitles[i],
      text: getTabText(i),
      mode: tabModes[i],
      primaryTabId: subTabsMeta.get(id)?.primaryTabId,
      kind: subTabsMeta.get(id)?.kind
    })),
    primaryTabs: primaryTabs.map((pt) => ({
      id: pt.id,
      title: pt.title,
      subTabIds: pt.subTabIds,
      activeSubTabId: pt.activeSubTabId,
      requestState: pt.requestState
    })),
    activePrimaryTabId,
    panePrimaryMap: Object.fromEntries([...panePrimaryMap.entries()].map(([k, v]) => [k, v])),
    paneActivePrimaryMap: Object.fromEntries(
      [...paneActivePrimaryMap.entries()].map(([k, v]) => [k, v])
    ),
    layout: serializeLayout(layout),
    nextTabId,
    nextPrimaryTabId,
    nextNodeId
  }

  function scheduleAutosave() {
    if (!hydrated) return
    saveStatus = 'saving'
    clearTimeout(saveTimer)
    clearTimeout(savedFlashTimer)
    saveTimer = setTimeout(() => {
      void saveWorkspace(workspaceSnapshot).then(() => {
        saveStatus = 'saved'
        clearTimeout(savedFlashTimer)
        savedFlashTimer = setTimeout(() => (saveStatus = 'idle'), 2500)
      })
    }, 600)
  }

  let dirtyFlags: boolean[] = [false]

  function updateDirtyFlags() {
    dirtyFlags = tabIds.map((_, i) => {
      const saved = tabLastSavedText[i]
      return saved !== undefined ? getTabText(i) !== saved : false
    })
  }

  function markTabClean(i: number) {
    tabLastSavedText = tabLastSavedText.map((t, j) => (j === i ? getTabJsonText(i) : t))
    updateDirtyFlags()
  }

  /** Replace the whole Level 1 workspace (tabs, sub-tabs, layout) with a stored snapshot. */
  function applyWorkspace(saved: StoredWorkspace | undefined) {
    if (saved && saved.tabs.length > 0) {
      const n = saved.tabs.length
      tabIds = saved.tabs.map((t) => t.id)
      tabTitles = saved.tabs.map((t) => t.title)
      tabContents = saved.tabs.map((t) => ({ text: t.text, json: undefined }))
      tabModes = saved.tabs.map((t) => t.mode as Mode)
      tabSelections = Array(n).fill(undefined)
      tabRefs = Array(n).fill(undefined)
      tabRevisions = Array(n).fill(0)
      tabLastSavedText = saved.tabs.map((t) => t.text)
      updateDirtyFlags()
      nextTabId = Math.max(saved.nextTabId, ...saved.tabs.map((t) => t.id)) + 1

      if (saved.primaryTabs && saved.primaryTabs.length > 0) {
        primaryTabs = saved.primaryTabs.map((pt) => ({
          ...pt,
          requestState: pt.requestState ?? createDefaultRequestContext()
        }))
        activePrimaryTabId = saved.activePrimaryTabId ?? primaryTabs[0].id
        nextPrimaryTabId =
          Math.max(saved.nextPrimaryTabId ?? 1, ...primaryTabs.map((p) => p.id)) + 1
      } else {
        primaryTabs = saved.tabs.map((t, i) => ({
          id: i + 1,
          title: t.title || `Editor ${i + 1}`,
          subTabIds: [t.id],
          activeSubTabId: t.id,
          requestState: createDefaultRequestContext()
        }))
        activePrimaryTabId = primaryTabs[0]?.id ?? 1
        nextPrimaryTabId = primaryTabs.length + 1
      }

      subTabsMeta.clear()
      primaryTabs.forEach((pt) => {
        pt.subTabIds.forEach((sid) => {
          const t = saved.tabs.find((x) => x.id === sid)
          subTabsMeta.set(sid, {
            id: sid,
            primaryTabId: pt.id,
            title: t?.title ?? 'Principal',
            kind: (t?.kind as SubTabKind) ?? 'main'
          })
        })
      })

      const currP = primaryTabs.find((p) => p.id === activePrimaryTabId) ?? primaryTabs[0]
      if (currP) loadPrimaryRequestToForm(currP)

      const validTabIdx = (idx: number) => (idx >= 0 && idx < n ? idx : 0)
      if ((saved.version === 2 || saved.version === 3) && saved.layout) {
        layout = mapLeaves(parseLayout(saved.layout), (leaf) => ({
          ...leaf,
          tabIdx: validTabIdx(leaf.tabIdx)
        }))
        nextNodeId = Math.max(saved.nextNodeId ?? 0, ...collectNodeIds(layout)) + 1
      } else if (saved.panes && saved.panes.length > 0) {
        // Migrate the v1 flat pane list to a left-deep split tree
        let root: LayoutNode | undefined
        for (const pane of saved.panes.slice(0, 4)) {
          const leaf = createLeaf(nextNodeId++, validTabIdx(pane.tabIdx))
          root = root
            ? createSplit(nextNodeId++, saved.splitDir ?? 'vertical', 0.5, root, leaf)
            : leaf
        }
        layout = root ?? createLeaf(1, 0)
      }
      if (saved.panePrimaryMap) {
        panePrimaryMap = new Map(
          Object.entries(saved.panePrimaryMap).map(([k, v]) => [Number(k), v])
        )
      }
      if (saved.paneActivePrimaryMap) {
        paneActivePrimaryMap = new Map(
          Object.entries(saved.paneActivePrimaryMap).map(([k, v]) => [Number(k), v])
        )
      }
      activeLeafId = collectLeaves(layout)[0]?.id ?? 1
      tabsRenderVersion++
    }
  }

  // ---- Workspace file (.jsew): whole Level 1 workspace + Spatial Flow + environments ----
  type WorkspacePickerWindow = Window & {
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>
  }
  const WORKSPACE_PICKER_TYPES = [
    {
      description: 'JSON Editor Workspace',
      accept: { 'application/json': [WORKSPACE_FILE_EXT] }
    }
  ]
  let workspaceFileHandle: FileSystemFileHandle | null = null
  let workspaceFileName = ''

  function buildWorkspaceBundle(): WorkspaceBundle {
    return {
      workspace: workspaceSnapshot,
      flowGraph: ($flowGraphStore as FlowGraph) ?? createDefaultFlowGraph(),
      environments: $environments as Record<string, Record<string, string>>,
      globalEnvironment: $globalEnvironment as Record<string, string>,
      activeEnvName: $activeEnvName as string
    }
  }

  function applyWorkspaceBundle(bundle: WorkspaceBundle) {
    fileHandles.clear()
    applyWorkspace(bundle.workspace)
    if (bundle.flowGraph) $flowGraphStore = bundle.flowGraph
    if (bundle.environments) $environments = bundle.environments
    if (bundle.globalEnvironment) $globalEnvironment = bundle.globalEnvironment
    if (bundle.activeEnvName !== undefined) $activeEnvName = bundle.activeEnvName
    envJsonText = $activeEnvName ? JSON.stringify($environments[$activeEnvName] ?? {}, null, 2) : ''
    scheduleAutosave()
  }

  function downloadWorkspaceFile(text: string) {
    const name = workspaceFileName || `workspace${WORKSPACE_FILE_EXT}`
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showDiskSaveLabel(`Exported ${name}`)
  }

  async function saveWorkspaceFile(saveAs = false) {
    const text = serializeWorkspaceFile(buildWorkspaceBundle())
    const w = window as WorkspacePickerWindow
    if (!w.showSaveFilePicker) {
      downloadWorkspaceFile(text)
      return
    }
    try {
      let handle = workspaceFileHandle
      if (!handle || saveAs) {
        handle = await w.showSaveFilePicker({
          suggestedName: workspaceFileName || `workspace${WORKSPACE_FILE_EXT}`,
          types: WORKSPACE_PICKER_TYPES
        })
        workspaceFileHandle = handle
        workspaceFileName = handle.name
      }
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      showDiskSaveLabel(`Workspace saved: ${handle.name}`)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') showDiskSaveLabel('Could not save workspace')
    }
  }

  function loadWorkspaceText(text: string, name: string) {
    try {
      applyWorkspaceBundle(parseWorkspaceFile(text))
      workspaceFileName = name
      showDiskSaveLabel(`Workspace opened: ${name}`)
    } catch (err) {
      showDiskSaveLabel(err instanceof Error ? err.message : 'Could not open workspace')
    }
  }

  async function openWorkspaceFile() {
    if (
      dirtyFlags.some(Boolean) &&
      !confirm('Opening a workspace replaces the current tabs. Continue?')
    ) {
      return
    }
    const w = window as WorkspacePickerWindow
    if (w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({ types: WORKSPACE_PICKER_TYPES })
        const file = await handle.getFile()
        loadWorkspaceText(await file.text(), file.name)
        workspaceFileHandle = handle
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') showDiskSaveLabel('Could not open workspace')
      }
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${WORKSPACE_FILE_EXT},application/json`
    input.onchange = async () => {
      const file = input.files?.[0]
      if (file) loadWorkspaceText(await file.text(), file.name)
    }
    input.click()
  }

  onMount(async () => {
    applyWorkspace(await loadWorkspace())
    hydrated = true

    // Restore file handles so documents can be saved back to disk
    const handles = await loadFileHandles()
    handles.forEach((handle, tabId) => fileHandles.set(tabId, handle))

    const savedDir = await loadDirectoryHandle()
    if (savedDir) {
      directoryHandle = savedDir
      folderName = savedDir.name
      try {
        if ((await savedDir.queryPermission({ mode: 'read' })) === 'granted') {
          await refreshFolderEntries()
        } else {
          folderPendingPermission = true
        }
      } catch {
        folderPendingPermission = true
      }
    }

    reqHistory = await loadRequestHistory()

    // Sync the Env JSON textarea with the persisted active environment
    if ($activeEnvName) {
      envJsonText = JSON.stringify($environments[$activeEnvName] ?? {}, null, 2)
    }
  })

  // ---- Global keyboard shortcuts ----
  let paletteOpen = false

  function cycleActiveTab(dir: number) {
    if (tabIds.length < 2) return
    const i = getActiveLeaf().tabIdx
    setActiveLeafTab((i + dir + tabIds.length) % tabIds.length)
    scheduleAutosave()
  }

  function setActiveMode(m: Mode) {
    const i = getActiveLeaf().tabIdx
    if (tabModes[i] !== m) {
      tabModes[i] = m
      tabModes = [...tabModes]
      scheduleAutosave()
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (ctrl && e.shiftKey && key === 'p') {
      e.preventDefault()
      paletteOpen = !paletteOpen
      return
    }
    if (ctrl && key === 's') {
      e.preventDefault()
      void saveToDisk()
      return
    }
    if (ctrl && e.code === 'Backslash') {
      e.preventDefault()
      splitActiveLeaf('vertical')
      return
    }
    if (ctrl && e.altKey && key === 'n') {
      e.preventDefault()
      addTab()
      return
    }
    if (ctrl && e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault()
      cycleActiveTab(e.code === 'BracketRight' ? 1 : -1)
      return
    }
    if (e.key === 'Escape' && paletteOpen) {
      paletteOpen = false
    }
  }

  // ---- Problems panel ----
  interface TabProblem extends Problem {
    tabId: number
    tabTitle: string
  }

  let showProblems = false
  let problems: TabProblem[] = []

  async function collectProblems() {
    if (!$validateDoc) {
      problems = []
      return
    }
    await tick()
    const items: TabProblem[] = []
    tabIds.forEach((tabId, i) => {
      const errors = tabRefs[i]?.validate()
      if (!errors) return
      contentErrorsToProblems(errors).forEach((problem) => {
        items.push({ ...problem, tabId, tabTitle: tabTitles[i] })
      })
    })
    problems = items
  }

  $: if ($validateDoc) {
    void tick().then(collectProblems)
  } else {
    problems = []
  }

  function jumpToProblem(problem: TabProblem) {
    const idx = getTabIdx(problem.tabId)
    if (idx === -1) return
    setActiveLeafTab(idx)
    const ref = tabRefs[idx]
    if (ref) {
      ref.select(problem.path.length > 0 ? createValueSelection(problem.path) : undefined)
      ref.focus()
    }
  }

  // ---- File operations ----
  let fileInput: HTMLInputElement | undefined

  function guessMode(name: string, text: string): Mode {
    if (name.toLowerCase().endsWith('.json')) return Mode.tree
    try {
      JSON.parse(text)
      return Mode.tree
    } catch {
      return Mode.text
    }
  }

  function readFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target ? String(e.target.result) : ''
      if (!text) return
      addTabWithContent(file.name, text, guessMode(file.name, text))
    }
    reader.readAsText(file)
  }

  function handleOpenFile(event: Event) {
    const input = event.target as HTMLInputElement
    Array.from(input.files ?? []).forEach(readFile)
    input.value = ''
  }

  function onDropFiles(e: DragEvent) {
    e.preventDefault()
    Array.from(e.dataTransfer?.files ?? []).forEach(readFile)
  }

  function getTabJsonText(i: number): string {
    const c = tabContents[i]
    return isJSONContent(c)
      ? (selParser.stringify(c.json, null, $selectedIndent as number) ?? '')
      : (c.text ?? '')
  }

  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadJson() {
    const i = getActiveLeaf().tabIdx
    downloadText(`${tabTitles[i].replace(/\s+/g, '_')}.json`, getTabJsonText(i))
  }

  function downloadAllTabs() {
    tabIds.forEach((tabId, i) => {
      const filename = `${tabTitles[i].replace(/\s+/g, '_')}.json`
      window.setTimeout(() => downloadText(filename, getTabText(i)), i * 250)
    })
  }

  // ---- Open files / folders (File System Access API) -------
  const fileHandles = new Map<number, FileHandle>()
  let directoryHandle: DirectoryHandle | undefined
  let folderName = ''
  let folderEntries: FileEntry[] = []
  let folderPendingPermission = false

  async function openFilesFromPicker() {
    if (isFileSystemAccessSupported()) {
      try {
        const files = await openFilesFromDisk()
        files.forEach((file) => {
          const idx = addTabWithContent(file.name, file.text, guessMode(file.name, file.text))
          fileHandles.set(tabIds[idx], file.handle)
        })
        await saveFileHandles(fileHandles)
        return
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return
        // other errors: fall through to the classic file input
      }
    }
    fileInput?.click()
  }

  async function refreshFolderEntries() {
    if (!directoryHandle) return
    try {
      folderEntries = await enumerateDirectory(directoryHandle)
      folderEntries = [...folderEntries]
    } catch (err) {
      console.warn('Failed to read folder contents', err)
      folderEntries = []
    }
  }

  async function openFolder() {
    if (!isFileSystemAccessSupported()) {
      showDiskSaveLabel('Folder browsing is not supported in this browser')
      return
    }
    try {
      directoryHandle = await pickDirectoryHandle()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      showDiskSaveLabel('Failed to open folder')
      return
    }
    folderName = directoryHandle.name
    folderPendingPermission = false
    await saveDirectoryHandle(directoryHandle)
    await refreshFolderEntries()
  }

  async function reconnectFiles() {
    if (!directoryHandle) return
    try {
      const perm = await directoryHandle.requestPermission({ mode: 'read' })
      if (perm === 'granted') {
        folderPendingPermission = false
        await refreshFolderEntries()
      }
    } catch (err) {
      console.warn('Failed to reconnect folder', err)
    }
  }

  async function openFolderFile(entry: FileEntry) {
    if (entry.kind !== 'file') return
    const handle = entry.handle as FileHandle
    try {
      const text = await readHandleText(handle)
      if (!text) return
      const idx = addTabWithContent(entry.name, text, guessMode(entry.name, text))
      fileHandles.set(tabIds[idx], handle)
      await saveFileHandles(fileHandles)
    } catch (err) {
      console.warn('Failed to open folder file', err)
      showDiskSaveLabel('Failed to open file from folder')
    }
  }

  // ---- Save to disk (File System Access API) ----
  type SaveFilePicker = (options?: {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<FileHandle>

  let diskSaveLabel = ''
  let diskSaveTimer: ReturnType<typeof setTimeout> | undefined

  function showDiskSaveLabel(label: string) {
    diskSaveLabel = label
    clearTimeout(diskSaveTimer)
    diskSaveTimer = setTimeout(() => (diskSaveLabel = ''), 4000)
  }

  async function saveToDisk(tabIdxArg?: number) {
    const i = tabIdxArg ?? getActiveLeaf().tabIdx
    const tabId = tabIds[i]
    const text = getTabJsonText(i)
    const suggestedName = `${tabTitles[i].replace(/\s+/g, '_')}.json`

    // 1) Write back to the file the tab was opened from (no prompt needed)
    const existing = fileHandles.get(tabId)
    if (existing) {
      try {
        if (await ensureWritePermission(existing)) {
          await writeHandleText(existing, text)
          markTabClean(i)
          showDiskSaveLabel(`Saved: ${existing.name}`)
          return
        }
      } catch (err) {
        console.warn('Failed to write back to opened file', err)
      }
      showDiskSaveLabel('Write permission unavailable — opening Save As…')
    }

    // 2) Save As picker, with download fallback
    const pickSaveFile = (window as Window & { showSaveFilePicker?: SaveFilePicker })
      .showSaveFilePicker

    if (typeof pickSaveFile !== 'function') {
      downloadJson()
      showDiskSaveLabel('Direct save not supported here — downloaded instead')
      return
    }

    try {
      const handle = await pickSaveFile({
        suggestedName,
        types: [{ description: 'JSON document', accept: { 'application/json': ['.json'] } }]
      })
      await writeHandleText(handle, text)
      fileHandles.set(tabId, handle)
      await saveFileHandles(fileHandles)
      markTabClean(i)
      showDiskSaveLabel(`Saved to disk: ${handle.name}`)
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return // user cancelled the picker
      console.warn('Failed to save file to disk', err)
      showDiskSaveLabel('Failed to save to disk — downloaded instead')
      downloadJson()
    }
  }

  function openInWindow() {
    const i = getActiveLeaf().tabIdx
    const w = window.open('', '_blank', 'width=900,height=700,left=100,top=50')
    if (!w) return
    w.document.title = `${tabTitles[i]} — JSON Editor`
    for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
      w.document.head.appendChild(node.cloneNode(true))
    }
    w.document.body.className = $selectedTheme
    const style = w.document.createElement('style')
    style.textContent = 'body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}'
    w.document.head.appendChild(style)
    mount(JSONEditor, {
      target: w.document.body,
      props: {
        content: tabContents[i],
        mode: tabModes[i],
        mainMenuBar: true,
        navigationBar: true,
        statusBar: true
      }
    })
  }

  /** Extract the selected JSON into a Level 2 sub-tab, keeping the original document untouched. */
  function handleExtractToNewTab(extractedValue: unknown, pointer: string) {
    const text = JSON.stringify(extractedValue, null, 2)
    const suffix = (pointer || 'root').replace(/^\/+/, '').replace(/[^a-zA-Z0-9_.-]+/g, '-')
    const name = `extract-${suffix || 'root'}.json`
    addSubTabWithContent(name, text, guessMode(name, text), 'extract')
    showDiskSaveLabel(`Extracted "${pointer || '/'}" as sub-tab (Level 2)`)
  }

  /** Open a primitive value in a preview tab as a Level 2 sub-tab. */
  function handleEditWithPreview(props: EditWithPreviewProps) {
    const sourceTabId = tabIds[getActiveLeaf().tabIdx]
    const pointer = compileJSONPointer(props.path)
    const title = `Preview: ${props.pathLabel}`
    const idx = addSubTabWithContent(title, props.value, Mode.text, 'preview')
    previewTabInfo.set(tabIds[idx], {
      pathLabel: props.pathLabel,
      onSave: (value: string) => {
        let updated: unknown = value
        try {
          updated = JSON.parse(value)
        } catch {
          // not valid JSON — keep the raw string
        }
        applyReplaceToSource(sourceTabId, pointer, updated)
      }
    })
    showDiskSaveLabel(`Preview opened as sub-tab (Level 2): "${props.pathLabel}"`)
  }

  /** Open nested object/array content as a Level 2 sub-tab, syncing edits back live. */
  function handleEditNestedContent(props: JSONEditorModalCallback) {
    const pointer = compileJSONPointer(props.path)
    const sourceTabId = tabIds[getActiveLeaf().tabIdx]
    const text = isJSONContent(props.content)
      ? JSON.stringify(props.content.json, null, 2)
      : (props.content.text ?? '{}')
    const title = `Edit: ${pointer || '(root)'}`
    const idx = addSubTabWithContent(title, text, Mode.tree, 'nested')
    nestedTabInfo.set(tabIds[idx], { pointer, sourceTabId, onClose: props.onClose })
    showDiskSaveLabel(`Nested edit opened as sub-tab (Level 2): "${pointer || '/'}"`)
  }

  // ---- Samples ----
  function loadSample(name: string) {
    const samples: Record<string, Content> = {
      array: { json: [1, 2, 3, 4, 5], text: undefined },
      object: { json: { name: 'John', age: 30, city: 'NYC' }, text: undefined },
      long: { json: range(0, 500), text: undefined },
      empty: { text: '', json: undefined },
      invalid: { text: '[1,2,3', json: undefined }
    }
    const s = samples[name]
    if (!s) return
    const i = getActiveLeaf().tabIdx
    tabContents[i] = s
    tabContents = [...tabContents]
    updateDirtyFlags()
    scheduleAutosave()
  }

  // ---- Requests panel actions ----
  const MAX_RESPONSE_HISTORY = 256 * 1024

  interface ChainItem {
    method: string
    url: string
    headers: string
    body: string
    captures: Array<{ path: string; name: string }>
    /** legacy fields from older persisted chains */
    capturePath?: string
    captureVar?: string
  }

  function getItemCaptures(item: ChainItem): Array<{ path: string; name: string }> {
    if (item.captures && item.captures.length > 0) return item.captures
    if (item.capturePath && item.captureVar) {
      return [{ path: item.capturePath, name: item.captureVar }]
    }
    return []
  }

  function itemCaptureNames(item: ChainItem): string {
    return getItemCaptures(item)
      .map((c) => c.name)
      .join(', ')
  }

  const PROXY_PRESETS = [
    { label: 'None (direct)', value: '' },
    { label: 'corsproxy.io', value: 'https://corsproxy.io/?url={url}' },
    { label: 'allorigins.win', value: 'https://api.allorigins.win/raw?url={url}' }
  ]

  $: proxyPresetValue = $proxyCustom
    ? 'custom'
    : PROXY_PRESETS.some((p) => p.value === $corsProxy)
      ? $corsProxy
      : $corsProxy
        ? 'custom'
        : ''

  function onProxyPresetChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value
    if (value === 'custom') {
      // Keep the current URL as a starting point, but switch to custom mode.
      $proxyCustom = true
    } else {
      $proxyCustom = false
      $corsProxy = value
    }
  }

  /** Add a default Content-Type automatically when a body is sent without one. */
  function withContentType(
    headers: Record<string, string>,
    body: string | undefined,
    contentType = 'application/json'
  ): Record<string, string> {
    if (!body) return headers
    const has = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
    return has ? headers : { ...headers, 'Content-Type': contentType }
  }

  /** Build the Authorization (or API-key) headers from the Auth section. */
  function buildAuthHeaders(
    env: Record<string, string>,
    globalEnv: Record<string, string> = {}
  ): Record<string, string> {
    const auth: Record<string, string> = {}
    if (reqAuthType === 'bearer') {
      const token = resolveVariables(authBearerToken, env, globalEnv).resolved.trim()
      if (token) auth.Authorization = `Bearer ${token}`
    } else if (reqAuthType === 'basic') {
      const user = resolveVariables(authBasicUser, env, globalEnv).resolved
      const pass = resolveVariables(authBasicPass, env, globalEnv).resolved
      if (user || pass) auth.Authorization = `Basic ${encodeBasicAuth(user, pass)}`
    } else if (reqAuthType === 'apikey') {
      const name = resolveVariables(authApiKeyName, env, globalEnv).resolved.trim()
      const value = resolveVariables(authApiKeyValue, env, globalEnv).resolved
      if (name && value) auth[name] = value
    }
    return auth
  }

  async function sendRequest() {
    const url = reqUrl.trim()
    if (!url || reqSending) return
    reqSending = true
    reqResult = undefined
    reqResponseText = ''
    const started = performance.now()
    const method = reqMethod
    const env = activeEnv as Record<string, string>
    const globalEnv = ($globalEnvironment ?? {}) as Record<string, string>
    const resolvedUrl = resolveVariables(url, env, globalEnv)
    const resolvedHeaders = resolveVariables(reqHeaders, env, globalEnv)
    const resolvedBody = resolveVariables(reqBody, env, globalEnv)
    const authHeaders = buildAuthHeaders(env, globalEnv)
    const authValues = Object.values(authHeaders).join(' ')
    const authMissing = resolveVariables(authValues, env, globalEnv).missing
    const missing = [
      ...new Set([
        ...resolvedUrl.missing,
        ...resolvedHeaders.missing,
        ...resolvedBody.missing,
        ...authMissing
      ])
    ]
    const hasBody = reqBodyType !== 'none' && !['GET', 'HEAD'].includes(method)
    const body = hasBody ? resolvedBody.resolved : undefined
    const contentType = reqBodyType === 'text' ? 'text/plain' : 'application/json'
    const headers = withContentType(
      { ...parseHeadersText(resolvedHeaders.resolved), ...authHeaders },
      body,
      contentType
    )
    let proxyTemplate = String($corsProxy).trim()
    if (reqProxyMode === 'direct') {
      proxyTemplate = ''
    } else if (reqProxyMode === 'corsproxy') {
      proxyTemplate = 'https://corsproxy.io/?url={url}'
    } else if (reqProxyMode === 'allorigins') {
      proxyTemplate = 'https://api.allorigins.win/raw?url={url}'
    } else if (reqProxyMode === 'custom' && reqCustomProxyUrl) {
      proxyTemplate = reqCustomProxyUrl.trim()
    }

    try {
      const { res, viaProxy } = await fetchWithProxy(
        resolvedUrl.resolved,
        { method, headers, body },
        proxyTemplate
      )
      const durationMs = Math.round(performance.now() - started)
      const text = await res.text()
      const sizeBytes = new Blob([text]).size
      reqResponseText = truncateText(text, 64 * 1024)
      reqResult = {
        status: res.status,
        statusText: res.statusText,
        durationMs,
        sizeBytes,
        missing,
        viaProxy
      }

      // Process response captures into active environment
      if ($activeEnvName && reqCaptures && reqCaptures.length > 0) {
        try {
          const jsonRes: unknown = JSON.parse(text)
          const envUpdates: Record<string, string> = { ...env }
          const capturedNames: string[] = []
          for (const rule of reqCaptures) {
            if (!rule.enabled || !rule.path.trim() || !rule.name.trim()) continue
            const val = extractValueByPath(jsonRes, rule.path.trim())
            if (val !== undefined) {
              envUpdates[rule.name.trim()] = String(val)
              capturedNames.push(`${rule.name.trim()}=${String(val).slice(0, 20)}`)
            }
          }
          if (capturedNames.length > 0) {
            $environments = { ...$environments, [$activeEnvName]: envUpdates }
            envJsonText = JSON.stringify($environments[$activeEnvName], null, 2)
            updateEnvTabContent()
            showDiskSaveLabel(`Captured into environment: ${capturedNames.join(', ')}`)
          }
        } catch {
          // non-JSON
        }
      }
      const entry: RequestHistoryEntry = {
        id: Date.now(),
        method,
        url,
        headers: reqHeaders,
        body: reqBody,
        status: res.status,
        statusText: res.statusText,
        durationMs,
        sizeBytes,
        timestamp: Date.now(),
        viaProxy,
        responseText: truncateText(text, MAX_RESPONSE_HISTORY)
      }
      reqHistory = [entry, ...reqHistory].slice(0, 20)
      const name = responseName(method, resolvedUrl.resolved)
      const pathPart =
        resolvedUrl.resolved.split('?')[0].split('/').filter(Boolean).pop() || 'endpoint'
      const displayTitle = `⚡ ${method} ${pathPart} [${res.status}]`

      if (reqSendMode === 'same' && activePrimary.requestState.lastResponseTabId !== undefined) {
        const lastRespId = activePrimary.requestState.lastResponseTabId
        const existingIdx = getTabIdx(lastRespId)
        if (existingIdx !== -1 && activePrimary.subTabIds.includes(lastRespId)) {
          tabContents[existingIdx] = { text, json: undefined }
          tabTitles[existingIdx] = displayTitle
          tabModes[existingIdx] = guessMode(name, text)
          tabLastSavedText[existingIdx] = text
          bumpRevision(existingIdx)
          activePrimary.activeSubTabId = lastRespId
          primaryTabs = [...primaryTabs]
          setActiveLeafTab(existingIdx)
          showDiskSaveLabel(`Response updated in tab: ${displayTitle}`)
          reqSending = false
          return
        }
      }

      const newSubId = nextTabId++
      const newIdx = addDocWithId(newSubId, displayTitle, text, guessMode(name, text))
      const { updatedPrimary, subTab } = addSubTabToPrimary(
        activePrimary,
        newSubId,
        displayTitle,
        'response'
      )
      subTabsMeta.set(newSubId, subTab)
      updatedPrimary.requestState.lastResponseTabId = newSubId
      primaryTabs = primaryTabs.map((p) => (p.id === updatedPrimary.id ? updatedPrimary : p))
      setActiveLeafTab(newIdx)
      showDiskSaveLabel(`Response opened as new sub-tab: ${displayTitle}`)
    } catch (err) {
      reqResult = {
        error: proxyTemplate
          ? `Request failed even via the proxy (${proxyTemplate}). Check the URL or the proxy configuration.`
          : 'Request failed — the API may block browser access (CORS) or the network is unreachable. Choose a proxy in the header bar.'
      }
    }
    reqSending = false
  }

  function loadRequestIntoForm(entry: RequestHistoryEntry) {
    reqMethod = entry.method
    reqUrl = entry.url
    reqHeaders = entry.headers
    reqBody = entry.body
    reqParams = parseQueryParams(entry.url)
    reqHeaderRows = headersToRows(entry.headers)
    reqBodyType = entry.body ? 'json' : 'none'
  }

  // ---- Params / Headers row editors & cURL support ----
  function applyCurlCommand(curlText: string): boolean {
    const parsed = parseCurlCommand(curlText)
    if (!parsed) return false

    reqMethod = parsed.method
    reqUrl = parsed.url
    reqParams = parsed.params.length > 0 ? parsed.params : parseQueryParams(parsed.url)
    reqHeaderRows = parsed.headerRows
    reqHeaders = rowsToHeadersText(reqHeaderRows)
    reqBody = parsed.body
    reqBodyType = parsed.bodyType

    if (parsed.auth) {
      if (parsed.auth.type === 'bearer' && parsed.auth.token) {
        reqAuthType = 'bearer'
        authBearerToken = parsed.auth.token
      } else if (parsed.auth.type === 'basic') {
        reqAuthType = 'basic'
        authBasicUser = parsed.auth.username ?? ''
        authBasicPass = parsed.auth.password ?? ''
      }
    }

    if (parsed.params.length > 0) {
      reqActiveTab = 'params'
    } else if (parsed.headerRows.length > 0) {
      reqActiveTab = 'headers'
    } else if (parsed.body) {
      reqActiveTab = 'body'
    }

    showRequests = true
    showDiskSaveLabel(`cURL imported: ${reqMethod} ${reqUrl}`)
    return true
  }

  function onUrlPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text')
    if (text && isCurlCommand(text)) {
      e.preventDefault()
      const applied = applyCurlCommand(text)
      if (!applied) {
        reqUrl = text
        onUrlInput()
      }
    }
  }

  function onUrlInput() {
    if (isCurlCommand(reqUrl)) {
      applyCurlCommand(reqUrl)
      return
    }
    reqParams = parseQueryParams(reqUrl)
  }

  function copyRequestAsCurl() {
    const url = reqUrl.trim()
    if (!url) {
      showDiskSaveLabel('Request URL is empty')
      return
    }
    const env = activeEnv as Record<string, string>
    const authHeaders = buildAuthHeaders(env)
    const headersObj: Record<string, string> = {}
    for (const row of reqHeaderRows) {
      if (row.enabled && row.key.trim()) {
        headersObj[row.key.trim()] = row.value
      }
    }
    const combinedHeaders = { ...headersObj, ...authHeaders }
    const curl = buildCurlCommand({
      method: reqMethod,
      url,
      headers: combinedHeaders,
      body: reqBodyType !== 'none' && !['GET', 'HEAD'].includes(reqMethod) ? reqBody : undefined,
      bodyType: reqBodyType
    })
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(curl).then(
        () => showDiskSaveLabel('cURL command copied to clipboard'),
        () => showDiskSaveLabel('Failed to copy to clipboard')
      )
    } else {
      showDiskSaveLabel('Clipboard not supported in this browser')
    }
  }

  function syncBodyIfUrlEncoded() {
    const isUrlEncoded = reqHeaderRows.some(
      (h) =>
        h.enabled &&
        h.key.toLowerCase() === 'content-type' &&
        h.value.toLowerCase().includes('application/x-www-form-urlencoded')
    )
    if (isUrlEncoded) {
      reqBody = buildQueryParamsString(reqParams)
      reqBodyType = 'text'
    }
  }

  function onParamChange() {
    reqParams = [...reqParams]
    reqUrl = buildUrlWithQuery(reqUrl, reqParams)
    syncBodyIfUrlEncoded()
  }

  function addParam() {
    reqParams = [...reqParams, { key: '', value: '', enabled: true }]
  }

  function removeParam(index: number) {
    reqParams = reqParams.filter((_, i) => i !== index)
    reqUrl = buildUrlWithQuery(reqUrl, reqParams)
    syncBodyIfUrlEncoded()
  }

  function onHeaderRowChange() {
    reqHeaderRows = [...reqHeaderRows]
    reqHeaders = rowsToHeadersText(reqHeaderRows)
  }

  function addHeaderRow() {
    reqHeaderRows = [...reqHeaderRows, { key: '', value: '', enabled: true }]
  }

  function removeHeaderRow(index: number) {
    reqHeaderRows = reqHeaderRows.filter((_, i) => i !== index)
    reqHeaders = rowsToHeadersText(reqHeaderRows)
  }

  const HEADER_SUGGESTIONS = [
    'Accept',
    'Authorization',
    'Cache-Control',
    'Content-Type',
    'Cookie',
    'Origin',
    'Referer',
    'User-Agent'
  ]
  const PROXY_PLACEHOLDER = 'https://my-proxy/?url={url}'
  const BEARER_PLACEHOLDER = 'token (use {{token}} for the env token)'
  const TOKEN_VAR = '{{token}}'
  const REQ_TABS: Array<['params' | 'headers' | 'body' | 'auth' | 'captures' | 'env', string]> = [
    ['params', 'Params'],
    ['headers', 'Headers'],
    ['body', 'Body'],
    ['auth', 'Auth'],
    ['captures', 'Captures'],
    ['env', 'Env']
  ]
  const AUTH_METHODS: Array<['none' | 'bearer' | 'basic' | 'apikey', string, string]> = [
    ['none', 'None', 'No authentication header is sent'],
    ['bearer', 'Bearer', 'Adds Authorization: Bearer <token>'],
    ['basic', 'Basic', 'Adds Authorization: Basic (base64 of user:password)'],
    ['apikey', 'API Key', 'Adds a custom header with the key']
  ]

  function validateAndRevalidateAuth() {
    const env = (activeEnv as Record<string, string>) || {}
    const globalEnv = ($globalEnvironment ?? {}) as Record<string, string>
    if (reqAuthType === 'none') {
      authValidationMessage = { ok: true, text: 'No authentication required (None).' }
      return
    }

    if (reqAuthType === 'bearer') {
      const rawToken = authBearerToken.trim()
      if (!rawToken) {
        authValidationMessage = { ok: false, text: 'Bearer token not configured.' }
        return
      }
      const resolved = resolveVariables(rawToken, env, globalEnv).resolved.trim()
      if (!resolved || resolved === '{{token}}') {
        if (tokenUrl.trim()) {
          authValidationMessage = { ok: true, text: 'Revalidating token via configured URL...' }
          void fetchToken()
          return
        }
        authValidationMessage = {
          ok: false,
          text: `Variable ${rawToken} is empty in the active environment "${$activeEnvName || 'none'}". Fill in the token or configure the Token URL.`
        }
        return
      }
      const isJwt = resolved.split('.').length === 3
      authValidationMessage = {
        ok: true,
        text: `✓ Valid Bearer Token! (${resolved.slice(0, 16)}...${isJwt ? ' - JWT format detected' : ''})`
      }
      showDiskSaveLabel('Bearer authentication validated successfully')
      return
    }

    if (reqAuthType === 'basic') {
      const user = resolveVariables(authBasicUser, env, globalEnv).resolved.trim()
      const pass = resolveVariables(authBasicPass, env, globalEnv).resolved
      if (!user && !pass) {
        authValidationMessage = {
          ok: false,
          text: 'Username and password not provided for Basic Auth.'
        }
        return
      }
      authValidationMessage = {
        ok: true,
        text: `✓ Basic Auth configurado: [${user} : ****] → Header: Basic ${encodeBasicAuth(user, pass).slice(0, 14)}...`
      }
      showDiskSaveLabel('Basic Auth validado')
      return
    }

    if (reqAuthType === 'apikey') {
      const name = resolveVariables(authApiKeyName, env, globalEnv).resolved.trim()
      const val = resolveVariables(authApiKeyValue, env, globalEnv).resolved.trim()
      if (!name || !val) {
        authValidationMessage = { ok: false, text: 'Header name or API Key value is missing.' }
        return
      }
      authValidationMessage = {
        ok: true,
        text: `✓ API Key configurada: [${name}: ${val.slice(0, 8)}...]`
      }
      showDiskSaveLabel('API Key validada')
      return
    }
  }

  /** Open the stored response as a new editor tab AND load the request into the form. */
  function openHistoryResponse(entry: RequestHistoryEntry) {
    loadRequestIntoForm(entry)
    if (!entry.responseText) {
      showDiskSaveLabel('Response not stored for this entry — loaded the request into the form')
      return
    }
    const name = responseName(entry.method, entry.url)
    addSubTabWithContent(name, entry.responseText, guessMode(name, entry.responseText), 'response')
  }

  async function reSendRequest(entry: RequestHistoryEntry) {
    loadRequestIntoForm(entry)
    await tick()
    await sendRequest()
  }

  function removeHistoryEntry(id: number) {
    reqHistory = reqHistory.filter((e) => e.id !== id)
    void saveRequestHistory(reqHistory)
  }

  function clearHistory() {
    reqHistory = []
    void saveRequestHistory(reqHistory)
  }

  // ---- Environments / tokens ----
  function onEnvSelected() {
    envJsonText = JSON.stringify($environments[$activeEnvName] ?? {}, null, 2)
  }

  function newEnvironment() {
    const name = `env-${Object.keys($environments).length + 1}`
    $environments = { ...$environments, [name]: { baseUrl: '', token: '' } }
    $activeEnvName = name
    envJsonText = JSON.stringify($environments[name], null, 2)
  }

  function onEnvJsonInput() {
    if (!$activeEnvName) return
    try {
      const parsed: unknown = JSON.parse(envJsonText)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        $environments = { ...$environments, [$activeEnvName]: parsed as Record<string, string> }
      }
    } catch {
      // invalid JSON while typing — ignore until it parses
    }
    updateEnvTabContent()
  }

  /** Keep the env editor tab (if open) in sync with the environment store. */
  function updateEnvTabContent() {
    if (envTabId === undefined) return
    const idx = getTabIdx(envTabId)
    if (idx === -1) return
    const current = JSON.stringify($environments[$activeEnvName] ?? {}, null, 2)
    if (getTabText(idx) !== current) {
      tabContents[idx] = { text: current, json: undefined }
      tabContents = [...tabContents]
    }
  }

  /** Open the environment JSON as a regular editor tab (live-synced). */
  function openEnvInEditor() {
    if (!$activeEnvName) {
      showDiskSaveLabel('Select an environment first')
      return
    }
    const existingIdx = envTabId !== undefined ? getTabIdx(envTabId) : -1
    if (existingIdx !== -1) {
      setActiveLeafTab(existingIdx)
      return
    }
    const idx = addTabWithContent(`${$activeEnvName}.json`, envJsonText, Mode.tree)
    envTabId = tabIds[idx]
  }

  /** Open the request body as a regular editor tab (live-synced). */
  function openBodyInEditor() {
    const text = reqBody || '{}'
    const name = `request-body-${reqMethod.toLowerCase()}.json`
    const existingIdx = bodyTabId !== undefined ? getTabIdx(bodyTabId) : -1
    if (existingIdx !== -1) {
      setActiveLeafTab(existingIdx)
      return
    }
    const idx = addTabWithContent(name, text, guessMode(name, text))
    bodyTabId = tabIds[idx]
  }

  function syncEnvFromTab(tabIdx: number) {
    if (!$activeEnvName) return
    const text = getTabText(tabIdx)
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        $environments = { ...$environments, [$activeEnvName]: parsed as Record<string, string> }
      }
    } catch {
      // invalid JSON in the editor — keep the environment unchanged
    }
    if (envJsonText !== text) envJsonText = text
  }

  function syncBodyFromTab(tabIdx: number) {
    const text = getTabText(tabIdx)
    if (reqBody !== text) reqBody = text
  }

  function onBodyInput() {
    if (bodyTabId === undefined) return
    const idx = getTabIdx(bodyTabId)
    if (idx !== -1 && getTabText(idx) !== reqBody) {
      tabContents[idx] = { text: reqBody, json: undefined }
      tabContents = [...tabContents]
    }
  }

  /** Run the token endpoint and store the extracted value as {{token}}. */
  async function fetchToken() {
    if (!$activeEnvName) {
      showDiskSaveLabel('Create or select an environment first')
      return
    }
    const url = resolveVariables(tokenUrl.trim(), activeEnv as Record<string, string>).resolved
    if (!url) {
      showDiskSaveLabel('Token URL is empty')
      return
    }
    try {
      const { res } = await fetchWithProxy(url, {}, String($corsProxy).trim())
      const json: unknown = await res.json()
      const value = extractValueByPath(json, tokenPath)
      if (value === undefined) {
        showDiskSaveLabel(`Token path "${tokenPath}" not found in response`)
        return
      }
      $environments = {
        ...$environments,
        [$activeEnvName]: { ...activeEnv, token: String(value) }
      }
      envJsonText = JSON.stringify($environments[$activeEnvName], null, 2)
      updateEnvTabContent()
      // pre-fill the Bearer token field when it is empty
      if (reqAuthType === 'bearer' && !authBearerToken.trim()) {
        authBearerToken = '{{token}}'
      }
      showDiskSaveLabel(`Token saved as {{token}} in "${$activeEnvName}"`)
    } catch (err) {
      console.warn('Failed to fetch token', err)
      showDiskSaveLabel('Failed to fetch token — check the URL (CORS or network)')
    }
  }

  // ---- Execution chain ----
  function editChainItem(index: number) {
    const item = (chainItems as ChainItem[])[index]
    if (!item) return
    reqMethod = item.method
    reqUrl = item.url
    reqHeaders = item.headers
    reqBody = item.body
    const captures = getItemCaptures(item)
    capturePath = captures.map((c) => c.path).join(', ')
    captureVar = captures.map((c) => c.name).join(', ')
    editingChainIndex = index
  }

  function addToChain() {
    if (!reqUrl.trim()) return
    const draft: ChainItem = {
      method: reqMethod,
      url: reqUrl,
      headers: reqHeaders,
      body: reqBody,
      captures: parseCaptureList(capturePath, captureVar)
    }
    if (editingChainIndex >= 0 && editingChainIndex < (chainItems as ChainItem[]).length) {
      $requestChain = (chainItems as ChainItem[]).map((item, i) =>
        i === editingChainIndex ? draft : item
      )
      showDiskSaveLabel('Chain step updated')
    } else {
      $requestChain = [...(chainItems as ChainItem[]), draft]
      showDiskSaveLabel('Added to execution chain')
    }
    editingChainIndex = -1
  }

  function removeFromChain(index: number) {
    $requestChain = (chainItems as ChainItem[]).filter((_, i) => i !== index)
    if (editingChainIndex === index) editingChainIndex = -1
    if (editingChainIndex > index) editingChainIndex--
  }

  function clearChain() {
    $requestChain = []
    chainResults = []
    editingChainIndex = -1
    chainRunningIndex = -1
  }

  /**
   * Ensure a dedicated environment for the example chain, so it runs out of the
   * box without touching the values of the user's own environments.
   */
  function ensureExampleEnv() {
    const envs = ($environments as Record<string, Record<string, string>>) ?? {}
    if (!envs['Rick & Morty']) {
      $environments = {
        ...envs,
        'Rick & Morty': { baseUrl: 'https://rickandmortyapi.com/api' }
      }
    }
    $activeEnvName = 'Rick & Morty'
    envJsonText = JSON.stringify(
      ($environments as Record<string, Record<string, string>>)['Rick & Morty'] ?? {},
      null,
      2
    )
    updateEnvTabContent()
  }

  /** Pre-populate the chain with the ready-to-run example. */
  function loadExampleChain() {
    ensureExampleEnv()
    $requestChain = EXAMPLE_CHAIN
    chainResults = []
    editingChainIndex = -1
    chainRunningIndex = -1
    showDiskSaveLabel('Example chain loaded (env "Rick & Morty" activated)')
  }

  /** Sample from the sidebar: load the example chain and open the Requests panel. */
  function loadChainSample() {
    loadExampleChain()
    $chainOpen = true
    showRequests = true
  }

  /** Move a chain step up (-1) or down (+1). */
  function moveChainItem(index: number, direction: -1 | 1) {
    const items = [...(chainItems as ChainItem[])]
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const [item] = items.splice(index, 1)
    items.splice(target, 0, item)
    $requestChain = items
    if (editingChainIndex === index) editingChainIndex = target
  }

  /** Stop editing the current chain step without saving. */
  function cancelChainEdit() {
    editingChainIndex = -1
  }

  function startRequestsResize(e: MouseEvent) {
    if (!requestsPanelEl) return
    e.preventDefault()
    const bottom = requestsPanelEl.getBoundingClientRect().bottom
    const onMove = (ev: MouseEvent) => {
      const height = Math.max(150, Math.min(bottom - ev.clientY, window.innerHeight - 180))
      $requestsHeight = height
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function runChain() {
    const items = [...(chainItems as ChainItem[])]
    if (items.length === 0 || chainRunning) return
    chainRunning = true
    chainResults = []
    const proxyTemplate = String($corsProxy).trim()
    for (const [itemIndex, item] of items.entries()) {
      chainRunningIndex = itemIndex
      // Read the environment fresh at every step, so values captured by
      // previous steps (e.g. tokens) are available to the next one.
      const env = ($environments[$activeEnvName] ?? {}) as Record<string, string>
      const globalEnv = ($globalEnvironment ?? {}) as Record<string, string>
      const resolvedUrl = resolveVariables(item.url, env, globalEnv).resolved
      const started = performance.now()
      try {
        const { res, viaProxy } = await fetchWithProxy(
          resolvedUrl,
          {
            method: item.method,
            headers: withContentType(
              parseHeadersText(resolveVariables(item.headers, env, globalEnv).resolved),
              ['GET', 'HEAD'].includes(item.method)
                ? undefined
                : resolveVariables(item.body, env, globalEnv).resolved
            ),
            body: ['GET', 'HEAD'].includes(item.method)
              ? undefined
              : resolveVariables(item.body, env, globalEnv).resolved
          },
          proxyTemplate
        )
        const text = await res.text()
        const durationMs = Math.round(performance.now() - started)
        const sizeBytes = new Blob([text]).size

        // Capture values from the response into the environment (1..n pairs)
        let captured: string | undefined
        if ($activeEnvName) {
          const captures = getItemCaptures(item)
          if (captures.length > 0) {
            try {
              const json: unknown = JSON.parse(text)
              const updates: Record<string, string> = { ...env }
              const names: string[] = []
              for (const capture of captures) {
                const value = extractValueByPath(json, capture.path)
                if (value !== undefined) {
                  updates[capture.name] = String(value)
                  names.push(`${capture.name}=${String(value).slice(0, 24)}`)
                }
              }
              if (names.length > 0) {
                $environments = { ...$environments, [$activeEnvName]: updates }
                envJsonText = JSON.stringify($environments[$activeEnvName], null, 2)
                updateEnvTabContent()
                captured = names.join(', ')
              }
            } catch {
              // response is not JSON — nothing to capture
            }
          }
        }

        chainResults = [
          ...chainResults,
          {
            method: item.method,
            url: item.url,
            status: res.status,
            durationMs,
            sizeBytes,
            captured
          }
        ]
        const name = responseName(item.method, resolvedUrl)
        addSubTabWithContent(name, text, guessMode(name, text), 'response')
        const entry: RequestHistoryEntry = {
          id: Date.now(),
          method: item.method,
          url: item.url,
          headers: item.headers,
          body: item.body,
          status: res.status,
          statusText: res.statusText,
          durationMs,
          sizeBytes,
          timestamp: Date.now(),
          viaProxy,
          responseText: truncateText(text, MAX_RESPONSE_HISTORY)
        }
        reqHistory = [entry, ...reqHistory].slice(0, 20)
        void saveRequestHistory(reqHistory)
      } catch (err) {
        chainResults = [
          ...chainResults,
          {
            method: item.method,
            url: item.url,
            status: 'error',
            durationMs: Math.round(performance.now() - started),
            sizeBytes: 0
          }
        ]
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    chainRunning = false
    chainRunningIndex = -1
  }

  /** Add the active request in the form as a new REST block in the spatial flow. */
  function addCurrentFormToFlow() {
    const currentGraph = ($flowGraphStore as FlowGraph) ?? createDefaultFlowGraph()
    const offset = currentGraph.nodes.length * 40
    const segments = reqUrl.split('?')[0].split('/').filter(Boolean)
    const namePart = segments.pop() || 'Request'

    const newNode: FlowNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'rest',
      title: `${reqMethod} ${namePart}`,
      x: 80 + (offset % 280),
      y: 80 + (offset % 200),
      status: 'idle',
      restData: {
        method: reqMethod,
        url: reqUrl,
        queryParams: parseQueryParams(reqUrl),
        headers: reqHeaders,
        headerRows: headersToRows(reqHeaders),
        body: reqBody,
        bodyType: reqBodyType,
        proxyMode: reqProxyMode,
        customProxyUrl: reqCustomProxyUrl,
        authType: reqAuthType,
        authBearerToken: authBearerToken,
        authBasicUser: authBasicUser,
        authBasicPass: authBasicPass,
        authApiKeyName: authApiKeyName,
        authApiKeyValue: authApiKeyValue,
        captures: [...reqCaptures]
      },
      history: []
    }

    $flowGraphStore = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, newNode]
    }
    showDiskSaveLabel(`Block "${newNode.title}" added to the Spatial Flow!`)
  }

  /** Add a request from history as a new REST block in the spatial flow. */
  function addHistoryEntryToFlow(entry: RequestHistoryEntry) {
    const currentGraph = ($flowGraphStore as FlowGraph) ?? createDefaultFlowGraph()
    const offset = currentGraph.nodes.length * 40
    const segments = entry.url.split('?')[0].split('/').filter(Boolean)
    const namePart = segments.pop() || 'Request'

    const newNode: FlowNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'rest',
      title: `${entry.method} ${namePart}`,
      x: 80 + (offset % 280),
      y: 80 + (offset % 200),
      status: typeof entry.status === 'number' && entry.status < 400 ? 'success' : 'idle',
      restData: {
        method: entry.method,
        url: entry.url,
        queryParams: parseQueryParams(entry.url),
        headers: entry.headers || '',
        headerRows: headersToRows(entry.headers || ''),
        body: entry.body || '',
        bodyType: entry.body ? 'json' : 'none',
        proxyMode: entry.viaProxy ? 'corsproxy' : 'inherit',
        authType: 'inherit',
        captures: []
      },
      lastRun: entry.responseText
        ? {
            durationMs: entry.durationMs,
            status: entry.status,
            timestamp: entry.timestamp,
            responseText: entry.responseText,
            sizeBytes: entry.sizeBytes,
            viaProxy: entry.viaProxy
          }
        : undefined,
      history: entry.responseText
        ? [
            {
              id: String(entry.timestamp),
              timestamp: entry.timestamp,
              status: entry.status,
              durationMs: entry.durationMs,
              responseText: entry.responseText,
              sizeBytes: entry.sizeBytes,
              viaProxy: entry.viaProxy
            }
          ]
        : []
    }

    $flowGraphStore = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, newNode]
    }
    showDiskSaveLabel(`History "${newNode.title}" added to the Flow!`)
  }

  /** Load the sample spatial flow and open the Requests panel. */
  function loadFlowSample() {
    ensureExampleEnv()
    $flowGraphStore = createDefaultFlowGraph()
    $requestsViewMode = 'flow'
    showRequests = true
    showDiskSaveLabel('Rick & Morty flow loaded!')
  }

  /** Write back to disk every tab that has a file handle and unsaved changes. */
  function saveAllToDisk() {
    let count = 0
    const tasks = tabIds.map((tabId, i) => {
      const handle = fileHandles.get(tabId)
      if (!handle || !dirtyFlags[i]) return Promise.resolve()
      return (async () => {
        try {
          if (await ensureWritePermission(handle)) {
            await writeHandleText(handle, getTabJsonText(i))
            markTabClean(i)
            count++
          }
        } catch (err) {
          console.warn('Failed to save', tabTitles[i], err)
        }
      })()
    })
    void Promise.all(tasks).then(() => {
      showDiskSaveLabel(`Saved ${count} file(s) to disk`)
    })
  }

  function handleBeforeUnload(e: BeforeUnloadEvent) {
    if (dirtyFlags.some(Boolean)) {
      e.preventDefault()
      e.returnValue = ''
    }
  }

  // ---- Command palette actions ----
  const paletteActions = [
    { id: 'new-tab', group: 'File', label: 'New tab', hint: 'Ctrl+Alt+N', run: () => addTab() },
    {
      id: 'open-file',
      group: 'File',
      label: 'Open file(s)…',
      run: () => void openFilesFromPicker()
    },
    { id: 'open-folder', group: 'File', label: 'Open folder…', run: () => void openFolder() },
    { id: 'download', group: 'File', label: 'Download active document', run: downloadJson },
    {
      id: 'save-disk',
      group: 'File',
      label: 'Save active document to disk…',
      hint: 'Ctrl+S',
      run: () => void saveToDisk()
    },
    { id: 'download-all', group: 'File', label: 'Download all tabs', run: downloadAllTabs },
    { id: 'save-all', group: 'File', label: 'Save all files to disk', run: saveAllToDisk },
    {
      id: 'workspace-open',
      group: 'File',
      label: 'Open workspace file (.jsew)…',
      run: () => void openWorkspaceFile()
    },
    {
      id: 'workspace-save',
      group: 'File',
      label: 'Save workspace file (.jsew)',
      run: () => void saveWorkspaceFile(false)
    },
    {
      id: 'workspace-save-as',
      group: 'File',
      label: 'Save workspace file as…',
      run: () => void saveWorkspaceFile(true)
    },
    { id: 'popout', group: 'File', label: 'Popout active editor', run: openInWindow },
    {
      id: 'sidebar',
      group: 'View',
      label: 'Toggle sidebar',
      run: () => ($showSidebar = !$showSidebar)
    },
    {
      id: 'split-right',
      group: 'View',
      label: 'Split active tab right',
      hint: 'Ctrl+\\',
      run: () => splitActiveLeaf('vertical')
    },
    {
      id: 'split-down',
      group: 'View',
      label: 'Split active tab down',
      run: () => splitActiveLeaf('horizontal')
    },
    { id: 'close-pane', group: 'View', label: 'Close active pane', run: closeActiveLeaf },
    {
      id: 'requests',
      group: 'View',
      label: 'Toggle requests panel',
      run: () => (showRequests = !showRequests)
    },
    {
      id: 'req-import-curl',
      group: 'Requests',
      label: 'Import cURL command…',
      run: () => {
        showRequests = true
        showCurlModal = true
      }
    },
    {
      id: 'req-copy-curl',
      group: 'Requests',
      label: 'Copy request as cURL',
      run: copyRequestAsCurl
    },
    {
      id: 'diff',
      group: 'View',
      label: 'Toggle compare (diff)',
      run: () => (diffMode = !diffMode)
    },
    {
      id: 'problems',
      group: 'View',
      label: 'Toggle problems panel',
      run: () => {
        showProblems = !showProblems
        if (showProblems) void collectProblems()
      }
    },
    { id: 'mode-tree', group: 'Mode', label: 'Mode: tree', run: () => setActiveMode(Mode.tree) },
    { id: 'mode-text', group: 'Mode', label: 'Mode: text', run: () => setActiveMode(Mode.text) },
    { id: 'mode-table', group: 'Mode', label: 'Mode: table', run: () => setActiveMode(Mode.table) },
    ...themes.map((t) => ({
      id: `theme-${t.value}`,
      group: 'Theme',
      label: `Theme: ${t.label}`,
      run: () => ($selectedTheme = t.value)
    })),
    {
      id: 'sample-array',
      group: 'Samples',
      label: 'Load sample: Array',
      run: () => loadSample('array')
    },
    {
      id: 'sample-object',
      group: 'Samples',
      label: 'Load sample: Object',
      run: () => loadSample('object')
    },
    {
      id: 'sample-long',
      group: 'Samples',
      label: 'Load sample: Long array',
      run: () => loadSample('long')
    },
    {
      id: 'sample-empty',
      group: 'Samples',
      label: 'Load sample: Empty',
      run: () => loadSample('empty')
    },
    {
      id: 'sample-invalid',
      group: 'Samples',
      label: 'Load sample: Invalid JSON',
      run: () => loadSample('invalid')
    }
  ]
</script>

<svelte:head><title>JSON Editor — Dev</title></svelte:head>

<svelte:window on:keydown={handleGlobalKeydown} on:beforeunload={handleBeforeUnload} />

<div class="app-shell {$selectedTheme}">
  <!-- TOOLBAR -->
  <header class="toolbar">
    <button class="tb-btn" on:click={() => ($showSidebar = !$showSidebar)} title="Sidebar"
      >☰</button
    >
    <span class="tb-brand">JSON Editor</span>
    <button
      class="tb-btn"
      on:click={() => (paletteOpen = true)}
      title="Command palette (Ctrl+Shift+P)">⌕</button
    >
    <div class="tb-group">
      <label class="tb-label" for="tb-theme-select">Theme</label>
      <select id="tb-theme-select" class="tb-select" bind:value={$selectedTheme} on:change={refresh}
        >{#each themes as t}<option value={t.value}>{t.label}</option>{/each}</select
      >
    </div>
    <div class="tb-group">
      <label class="tb-label" for="tb-indent-select">Indent</label>
      <select id="tb-indent-select" class="tb-select" bind:value={$selectedIndent}
        >{#each indentations as i}<option value={i.value}>{i.label}</option>{/each}</select
      >
    </div>
    <div class="tb-group">
      <label class="tb-label" for="tb-parser-select">Parser</label>
      <select id="tb-parser-select" class="tb-select" bind:value={$selectedParserId}
        >{#each parsers as p}<option value={p.id}>{p.label}</option>{/each}</select
      >
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-group">
      <button
        class="tb-btn"
        on:click={() => splitActiveLeaf('vertical')}
        title="Split right (Ctrl+\)">▦{layoutLeaves.length}</button
      >
      <button class="tb-btn" on:click={() => splitActiveLeaf('horizontal')} title="Split down"
        >⬒</button
      >
      <button class="tb-btn" on:click={closeActiveLeaf} title="Close active pane">◫</button>
    </div>
    <button class="tb-btn" on:click={openInWindow} title="Popout">↗</button>
    <button class="tb-btn" on:click={downloadJson} title="Download JSON">⬇</button>
    <button
      class="tb-btn-label"
      on:click={() => void saveToDisk()}
      title="Quick save: write the active tab back to its file (Ctrl+S)">💾 Save</button
    >
    <button
      class="tb-btn"
      on:click={() => void openFilesFromPicker()}
      title="Open file(s) — writable (opens in a new tab)">📂</button
    >
    <button class="tb-btn" on:click={() => void openFolder()} title="Open folder…">📁</button>
    <button
      class="tb-btn"
      class:tb-active={showRequests}
      on:click={() => (showRequests = !showRequests)}
      title="Requests (HTTP client)">📡</button
    >
    <label class="tb-btn" title="Open file(s) — fallback" style="display:none"
      >📂<input
        type="file"
        multiple
        bind:this={fileInput}
        on:change={handleOpenFile}
        style="display:none"
      /></label
    >
  </header>

  <!-- MAIN -->
  <div class="main-area">
    {#if $showSidebar}
      <aside class="sidebar">
        {#if folderName}
          <section class="sb-section">
            <h3 class="sb-title">Folder: {folderName}</h3>
            {#if folderEntries.length > 0}
              <FolderTree entries={folderEntries} onOpen={(entry) => void openFolderFile(entry)} />
            {:else}
              <p class="sb-note">No files found.</p>
            {/if}
          </section>
        {/if}
        <section class="sb-section">
          <h3 class="sb-title">📁 Files & Workspace</h3>
          <p class="sb-note">
            The workspace autosaves in this browser and is restored when reopening the same address
            (host and port).
          </p>
          <button class="sb-btn" on:click={() => void openFilesFromPicker()}
            >📂 Open files (writable)</button
          >
          <button class="sb-btn" on:click={() => void openFolder()}>📁 Open folder…</button>
          {#if folderPendingPermission}
            <button class="sb-btn" on:click={() => void reconnectFiles()}
              >🔌 Reconnect saved files</button
            >
          {/if}
          <button class="sb-btn" on:click={() => void saveToDisk()}
            >💾 Save active tab to disk</button
          >
          <button class="sb-btn" on:click={saveAllToDisk}>💾 Save all files</button>
          <button class="sb-btn" on:click={downloadAllTabs}>⬇ Download all tabs</button>
          <p class="sb-note">
            Workspace file (<code>{WORKSPACE_FILE_EXT}</code>): all main tabs, sub-tabs, Spatial
            Flow and environments in one file.
          </p>
          <button
            class="sb-btn"
            title="Open a workspace file (replaces the current tabs and flow)"
            on:click={() => void openWorkspaceFile()}>🗂 Open workspace…</button
          >
          <button
            class="sb-btn"
            title={workspaceFileName
              ? `Save to ${workspaceFileName}`
              : 'Save the whole workspace to a file'}
            on:click={() => void saveWorkspaceFile(false)}
            >💾 Save workspace{workspaceFileName ? `: ${workspaceFileName}` : ''}</button
          >
          <button class="sb-btn" on:click={() => void saveWorkspaceFile(true)}
            >📝 Save workspace as…</button
          >
        </section>
        <section class="sb-section">
          <h3 class="sb-title">👁 Editor</h3>
          <label class="sb-check" title="Prevent all editing in the document"
            ><input type="checkbox" bind:checked={$readOnly} /> Read only</label
          >
          <label class="sb-check" title="Show the main menu bar at the top of the editor"
            ><input type="checkbox" bind:checked={$mainMenuBar} /> Main menu</label
          >
          <label class="sb-check" title="Show the navigation bar (path of the selected item)"
            ><input type="checkbox" bind:checked={$navigationBar} /> Navigation</label
          >
          <label class="sb-check" title="Show the status bar with validation info"
            ><input type="checkbox" bind:checked={$statusBar} /> Status bar</label
          >
          <label class="sb-check" title="Ask confirmation before formatting the document"
            ><input type="checkbox" bind:checked={$askToFormat} /> Ask to format</label
          >
        </section>
        <button
          class="sb-section-head"
          on:click={() => ($sidebarAdvancedOpen = !$sidebarAdvancedOpen)}
        >
          <span class="sb-caret">{$sidebarAdvancedOpen ? '▾' : '▸'}</span>
          ⚙ Advanced
        </button>
        {#if $sidebarAdvancedOpen}
          <section class="sb-section">
            <h3 class="sb-title">Validation</h3>
            <label class="sb-check" title="Validate the document against a JSON Schema"
              ><input type="checkbox" bind:checked={$validateDoc} /> JSON Schema</label
            >
            <label class="sb-check" title="Use the custom value renderer (colors, links)"
              ><input type="checkbox" bind:checked={$customRenderer} /> Custom renderer</label
            >
            <label class="sb-check" title="Show two panes side by side and highlight differences"
              ><input type="checkbox" bind:checked={diffMode} /> Compare panes (diff)</label
            >
          </section>
          <section class="sb-section">
            <h3 class="sb-title">Text</h3>
            <label
              class="sb-check"
              title="Escape control characters in the rendered text (e.g. \\n)"
              ><input type="checkbox" bind:checked={$escapeCtrl} /> Control characters</label
            >
            <label
              class="sb-check"
              title="Escape unicode characters in the rendered text (e.g. \\u00e9)"
              ><input type="checkbox" bind:checked={$escapeUni} /> Unicode characters</label
            >
            <label class="sb-check" title="Flatten nested columns in table mode"
              ><input type="checkbox" bind:checked={$flatten} /> Flat columns</label
            >
            <label class="sb-check" title="Allow multiple query languages at once"
              ><input type="checkbox" bind:checked={$multiQuery} /> Multi query</label
            >
          </section>
        {/if}
        <button
          class="sb-section-head"
          on:click={() => ($sidebarSamplesOpen = !$sidebarSamplesOpen)}
        >
          <span class="sb-caret">{$sidebarSamplesOpen ? '▾' : '▸'}</span>
          🧪 Samples
        </button>
        {#if $sidebarSamplesOpen}
          <section class="sb-section">
            <button class="sb-btn" on:click={() => loadSample('array')}>Array</button>
            <button class="sb-btn" on:click={() => loadSample('object')}>Object</button>
            <button class="sb-btn" on:click={() => loadSample('long')}>Long Array</button>
            <button class="sb-btn" on:click={() => loadSample('empty')}>Empty Text</button>
            <button class="sb-btn" on:click={() => loadSample('invalid')}>Invalid JSON</button>
            <button
              class="sb-btn"
              title="Load full example into the Spatial Flow and open the requests panel"
              on:click={loadFlowSample}>🔀 Flow · Rick & Morty</button
            >
          </section>
        {/if}
      </aside>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="editor-area" on:dragover|preventDefault on:drop={onDropFiles}>
      <!-- PANES -->
      <div class="editor-panes" bind:this={panesEl}>
        {#each layoutRects.leaves as lr (lr.leafId)}
          {@const panePrimTabs = getPanePrimaryTabs(lr.leafId, tabsRenderVersion)}
          {@const paneActivePrim = getPaneActivePrimary(lr.leafId, tabsRenderVersion)}
          {@const paneSubTabs = getPaneSubTabs(paneActivePrim, tabsRenderVersion)}
          {@const activeSubTabId = paneActivePrim?.activeSubTabId}
          {@const i = getTabIdx(activeSubTabId)}
          <div
            class="editor-pane"
            class:active-pane={lr.leafId === activeLeafId}
            style="left:{lr.x}%;top:{lr.y}%;width:{lr.width}%;height:{lr.height}%"
            on:mousedown={() => {
              activeLeafId = lr.leafId
              if (paneActivePrim) {
                activePrimaryTabId = paneActivePrim.id
                loadPrimaryRequestToForm(paneActivePrim)
              }
            }}
            on:dragover={onPaneDragOver}
            on:drop={(e) => onPaneDrop(e, lr.leafId)}
          >
            <!-- TAB BAR LEVEL 1 (Abas Principais deste Painel) -->
            <nav
              class="tab-bar tab-bar-l1"
              aria-label="Main Tabs (Level 1)"
              on:dragover={(e) => {
                if (draggedPrimaryId !== undefined) {
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  dragOverLeafId = lr.leafId
                } else if (
                  draggedTabId !== undefined &&
                  canPromoteSubTab(subTabsMeta.get(draggedTabId))
                ) {
                  e.preventDefault()
                }
              }}
              on:drop={(e) => {
                if (draggedPrimaryId !== undefined) {
                  onPrimaryTabDrop(e, lr.leafId)
                } else if (
                  draggedTabId !== undefined &&
                  canPromoteSubTab(subTabsMeta.get(draggedTabId))
                ) {
                  e.preventDefault()
                  e.stopPropagation()
                  promoteSubTabInPane(lr.leafId, draggedTabId)
                  onTabDragEnd()
                }
              }}
            >
              {#each panePrimTabs as pt (pt.id)}
                <button
                  class="tab tab-l1"
                  class:active={pt.id === paneActivePrim?.id}
                  class:drag-over-before={dragOverTargetPrimaryId === pt.id &&
                    dragOverTargetPrimaryPosition === 'before'}
                  class:drag-over-after={dragOverTargetPrimaryId === pt.id &&
                    dragOverTargetPrimaryPosition === 'after'}
                  on:click={() => selectPrimaryTabInPane(lr.leafId, pt.id)}
                  on:dblclick={() => {
                    const n = prompt('Renomear aba principal:', pt.title)
                    if (n) renamePrimaryTab(pt.id, n)
                  }}
                  on:contextmenu|preventDefault={(e) =>
                    (tabMenu = {
                      x: e.clientX,
                      y: e.clientY,
                      tabId: pt.id,
                      type: 'primary',
                      leafId: lr.leafId
                    })}
                  draggable="true"
                  on:dragstart={(e) => onPrimaryTabDragStartInPane(e, lr.leafId, pt.id)}
                  on:dragend={onTabDragEnd}
                  on:dragover={(e) => onPrimaryTabDragOverInPane(e, lr.leafId, pt.id)}
                  on:drop={(e) => onPrimaryTabDrop(e, lr.leafId, pt.id)}
                >
                  <span
                    class="tab-dirty"
                    class:dirty={pt.subTabIds.some((sid) => dirtyFlags[getTabIdx(sid)])}
                  ></span>
                  <span class="tab-l1-icon">📁</span>
                  <span class="tab-label">{pt.title}</span>
                  {#if pt.subTabIds.length > 1}
                    <span class="tab-count-badge" title="{pt.subTabIds.length} sub-abas"
                      >{pt.subTabIds.length}</span
                    >
                  {/if}
                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                  <span
                    class="tab-close"
                    title="Close main tab (and its sub-tabs)"
                    on:click|stopPropagation={() => closePrimaryTabInPane(lr.leafId, pt.id)}>×</span
                  >
                </button>
              {/each}

              <!-- Indicador de Mover para este Grid (mostrado na área vazia da barra ao arrastar de outro grid!) -->
              {#if draggedPrimaryId !== undefined && draggedPrimarySourceLeafId !== lr.leafId}
                <div
                  class="tab-drop-move-pane"
                  class:drag-hover={dragOverLeafId === lr.leafId &&
                    dragOverTargetPrimaryId === undefined}
                  on:dragover|preventDefault={(e) => {
                    e.stopPropagation()
                    dragOverLeafId = lr.leafId
                    dragOverTargetPrimaryId = undefined
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  }}
                  on:drop={(e) => onPrimaryTabDrop(e, lr.leafId)}
                >
                  <span class="tab-drop-icon">↳</span>
                  <span>Mover para este grid</span>
                </div>
              {/if}

              <!-- Área Azul para Subir Sub-abas para Nível 1 -->
              {#if draggedTabId !== undefined && canPromoteSubTab(subTabsMeta.get(draggedTabId))}
                <div
                  class="tab-drop-promote"
                  on:dragover|preventDefault
                  on:drop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (draggedTabId !== undefined) {
                      promoteSubTabInPane(lr.leafId, draggedTabId)
                      onTabDragEnd()
                    }
                  }}
                >
                  <span class="tab-drop-promote-icon">⇡</span>
                  <span>Drop here to move up to Level 1</span>
                </div>
              {/if}

              <button
                class="tab tab-add"
                on:click={() => addPrimaryTabInPane(lr.leafId)}
                title="Nova aba principal neste painel">+</button
              >
            </nav>

            <!-- TAB BAR LEVEL 2 (Abas Secundárias do Editor Ativo deste Painel) -->
            <nav
              class="tab-bar tab-bar-l2"
              aria-label="Secondary Tabs (Level 2)"
              on:dragover={(e) => {
                if (draggedTabId !== undefined) {
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                }
              }}
              on:drop={(e) => {
                if (paneActivePrim && draggedTabId !== undefined) {
                  onSubTabDrop(e, paneActivePrim)
                }
              }}
            >
              {#each paneSubTabs as item (item.subTabId)}
                <button
                  class="tab tab-l2 tab-kind-{item.meta.kind}"
                  class:active={item.subTabId === activeSubTabId}
                  class:drag-over-before={dragOverTargetSubId === item.subTabId &&
                    dragOverTargetSubPosition === 'before'}
                  class:drag-over-after={dragOverTargetSubId === item.subTabId &&
                    dragOverTargetSubPosition === 'after'}
                  on:click={() => selectSubTabInPane(lr.leafId, paneActivePrim, item.subTabId)}
                  on:dblclick={() => {
                    const n = prompt('Renomear sub-aba:', tabTitles[item.idx])
                    if (n) renameSubTab(item.subTabId, n)
                  }}
                  on:contextmenu|preventDefault={(e) =>
                    (tabMenu = {
                      x: e.clientX,
                      y: e.clientY,
                      tabId: item.subTabId,
                      type: 'sub',
                      leafId: lr.leafId
                    })}
                  draggable="true"
                  on:dragstart={(e) => onSubTabDragStart(e, item.subTabId)}
                  on:dragend={onTabDragEnd}
                  on:dragover={(e) => onSubTabDragOver(e, item.subTabId)}
                  on:drop={(e) => {
                    if (paneActivePrim) onSubTabDrop(e, paneActivePrim, item.subTabId)
                  }}
                >
                  <span class="tab-dirty" class:dirty={dirtyFlags[item.idx]}></span>
                  <span class="tab-l2-icon" title={item.meta.kind}>
                    {#if item.meta.kind === 'response'}⚡{:else if item.meta.kind === 'extract'}🔍{:else if item.meta.kind === 'nested'}✏️{:else if item.meta.kind === 'preview'}👁️{:else}📄{/if}
                  </span>
                  <span class="tab-label">{tabTitles[item.idx] || item.meta.title}</span>
                  {#if canPromoteSubTab(item.meta)}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <span
                      class="tab-promote-btn"
                      title="Promote to new main tab (Level 1)"
                      on:click|stopPropagation={() => promoteSubTabInPane(lr.leafId, item.subTabId)}
                      >⇡</span
                    >
                  {/if}
                  {#if canCloseSubTab(item.meta)}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <span
                      class="tab-close"
                      title="Close sub-tab"
                      on:click|stopPropagation={() =>
                        closeSubTabInPane(lr.leafId, paneActivePrim, item.subTabId)}>×</span
                    >
                  {/if}
                </button>
              {/each}
              <button
                class="tab tab-add tab-add-l2"
                on:click={() => addSubTabInPane(lr.leafId, paneActivePrim)}
                title="New sub-tab (Level 2)">+ Sub-tab</button
              >
            </nav>

            <!-- Drop zones for split inside this pane (dragging Level 1 primary tabs) -->
            {#if draggedPrimaryId !== undefined && layoutLeaves.length < 4}
              <div
                class="drop-zone dz-right"
                on:dragover|preventDefault
                on:drop={(e) => onSplitDropPrimary(e, lr.leafId, 'vertical')}
              >
                Split right (New grid)
              </div>
              <div
                class="drop-zone dz-bottom"
                on:dragover|preventDefault
                on:drop={(e) => onSplitDropPrimary(e, lr.leafId, 'horizontal')}
              >
                Split below (New grid)
              </div>
            {/if}

            <div class="editor-wrapper">
              {#if i >= 0 && previewTabInfo.has(tabIds[i])}
                <PreviewModal
                  inline
                  windowId={String(tabIds[i])}
                  pathLabel={previewTabInfo.get(tabIds[i])?.pathLabel ?? ''}
                  renderValue={getTabText(i)}
                  onChangeRenderValue={(value) => {
                    tabContents[i] = { text: value, json: undefined }
                    tabContents = [...tabContents]
                  }}
                  onSave={previewTabInfo.get(tabIds[i])?.onSave}
                  onClose={() => closeSubTabInPane(lr.leafId, paneActivePrim, tabIds[i])}
                />
              {:else if i >= 0}
                <form novalidate action="/" class="editor-form">
                  <JSONEditor
                    bind:this={tabRefs[i]}
                    bind:content={tabContents[i]}
                    bind:selection={tabSelections[i]}
                    mode={tabModes[i]}
                    mainMenuBar={$mainMenuBar}
                    navigationBar={$navigationBar}
                    statusBar={$statusBar}
                    askToFormat={$askToFormat}
                    escapeControlCharacters={$escapeCtrl}
                    escapeUnicodeCharacters={$escapeUni}
                    flattenColumns={$flatten}
                    readOnly={$readOnly}
                    indentation={$selectedIndent}
                    tabSize={$tabSz}
                    parser={selParser}
                    pathParser={selPath}
                    validator={selValidator}
                    queryLanguages={queryLangs}
                    bind:queryLanguageId={queryLangId}
                    onRenderValue={$customRenderer ? customRenderValue : renderValue}
                    onClassName={diffMode ? onClassNameDiff : undefined}
                    onChange={() => bumpRevision(i)}
                    onChangeMode={(m: Mode) => {
                      tabModes[i] = m
                      tabModes = [...tabModes]
                      scheduleAutosave()
                    }}
                    {onRenderMenu}
                    {onRenderContextMenu}
                    {onChangeQueryLanguage}
                    onExtract={handleExtractToNewTab}
                    onEditWithPreview={handleEditWithPreview}
                    onEditNestedContent={handleEditNestedContent}
                  />
                </form>
              {/if}
            </div>
          </div>
        {/each}
        {#each layoutRects.dividers as divider (divider.splitId)}
          <div
            class="pane-divider"
            class:divider-col={divider.direction === 'vertical'}
            class:divider-row={divider.direction === 'horizontal'}
            style="left:{divider.x}%;top:{divider.y}%;width:{divider.width}%;height:{divider.height}%"
            on:mousedown={(e) => startResize(e, divider.splitId)}
          ></div>
        {/each}
      </div>

      {#if showProblems}
        <div class="problems-panel">
          <div class="problems-header">
            <span class="problems-title">Problems ({problems.length})</span>
            <button
              class="problems-close"
              on:click={() => (showProblems = false)}
              title="Close problems panel">×</button
            >
          </div>
          <div class="problems-list">
            {#if problems.length === 0}
              <div class="problems-empty">No problems detected ✓</div>
            {:else}
              {#each problems as problem (problem.tabId + ':' + problem.pathLabel + ':' + problem.message)}
                <button type="button" class="problem-item" on:click={() => jumpToProblem(problem)}>
                  <span class="problem-sev {problem.severity}">●</span>
                  <span class="problem-message">{problem.message}</span>
                  {#if problem.pathLabel}
                    <span class="problem-path">{problem.pathLabel}</span>
                  {/if}
                  <span class="problem-tab">{problem.tabTitle}</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      {#if showRequests}
        <div class="requests-panel" bind:this={requestsPanelEl} style="height:{$requestsHeight}px">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="requests-resizer"
            title="Drag to resize"
            on:mousedown={startRequestsResize}
          ></div>
          <div class="requests-header">
            <div class="requests-header-left">
              <div class="requests-brand">
                <span class="requests-brand-icon">⚡</span>
                <span class="requests-brand-text">REQUESTS</span>
              </div>

              <!-- View Mode Toggle: Form vs Spatial Flow -->
              <div class="req-view-toggle">
                <button
                  type="button"
                  class="req-view-btn"
                  class:active={$requestsViewMode === 'form'}
                  on:click={() => ($requestsViewMode = 'form')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                  <span>Form</span>
                </button>
                <button
                  type="button"
                  class="req-view-btn"
                  class:active={$requestsViewMode === 'flow'}
                  on:click={() => ($requestsViewMode = 'flow')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="18" cy="18" r="3" />
                    <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
                  </svg>
                  <span>Spatial Flow</span>
                  {#if $flowGraphStore?.nodes?.length > 0}
                    <span class="req-badge-pill">{$flowGraphStore.nodes.length}</span>
                  {/if}
                </button>
              </div>
            </div>

            <div class="requests-header-right">
              <!-- Environment Manager Pill (Postman style) -->
              <div class="requests-env-pill">
                <span class="req-env-icon" title="Environments">🌍</span>
                <span class="req-env-label">Environment:</span>
                <select
                  class="tb-select req-env-select"
                  bind:value={$activeEnvName}
                  title="Select active environment"
                >
                  <option value="">(No Environment)</option>
                  {#each Object.keys($environments) as envName}
                    <option value={envName}>{envName}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="req-env-manage-btn"
                  on:click={() => (envManagerOpen = true)}
                  title="Manage Environments & Globals (Postman style)"
                >
                  ⚙️
                </button>
              </div>

              <!-- Global Proxy Pill -->
              <div class="requests-proxy-pill">
                <span class="req-proxy-icon" title="CORS Proxy Global">🛡</span>
                <span class="req-proxy-label">Proxy Geral:</span>
                <select
                  class="tb-select req-proxy-select"
                  value={proxyPresetValue}
                  on:change={onProxyPresetChange}
                >
                  {#each PROXY_PRESETS as preset}
                    <option value={preset.value}>{preset.label}</option>
                  {/each}
                  <option value="custom">Custom…</option>
                </select>
                {#if proxyPresetValue === 'custom'}
                  <input
                    class="req-proxy-input"
                    type="text"
                    placeholder={PROXY_PLACEHOLDER}
                    title="The placeholder is replaced by the request URL"
                    bind:value={$corsProxy}
                  />
                {/if}
              </div>

              <!-- Import cURL Button -->
              <button
                type="button"
                class="req-top-btn req-btn-import"
                title="Import cURL command copied from Postman or terminal"
                on:click={() => (showCurlModal = true)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Import cURL</span>
              </button>

              <!-- Copy cURL Button -->
              <button
                type="button"
                class="req-top-btn req-btn-copy"
                title="Copy active request as cURL command"
                on:click={copyRequestAsCurl}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy cURL</span>
              </button>

              <!-- Close Button -->
              <button
                type="button"
                class="requests-close-btn"
                on:click={() => (showRequests = false)}
                title="Close requests panel">×</button
              >
            </div>
          </div>

          {#if $requestsViewMode === 'flow'}
            <div class="requests-flow-container">
              <FlowCanvas
                bind:flowGraph={$flowGraphStore}
                bind:environments={$environments}
                bind:globalEnvironment={$globalEnvironment}
                activeEnvName={$activeEnvName}
                globalProxy={String($corsProxy).trim()}
                onSaveGraph={(g) => ($flowGraphStore = g)}
                onManageEnvironments={() => (envManagerOpen = true)}
                onOpenInEditor={(title, text) => {
                  const mode = guessMode(title, text)
                  addSubTabWithContent(title, text, mode, 'response')
                  showDiskSaveLabel(`Aberto no editor: "${title}"`)
                }}
              />
            </div>
          {:else}
            <!-- Request row -->
            <div class="requests-form">
              <select
                class="tb-select req-method req-method-{reqMethod.toLowerCase()}"
                bind:value={reqMethod}
              >
                {#each ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as m}<option>{m}</option>{/each}
              </select>
              <input
                class="req-url"
                type="text"
                list="req-url-history"
                placeholder="https://api.example.com/items (or paste cURL here)"
                bind:value={reqUrl}
                on:paste={onUrlPaste}
                on:input={onUrlInput}
                on:keydown={(e) => {
                  if (e.key === 'Enter') void sendRequest()
                }}
              />
              <datalist id="req-url-history">
                {#each urlSuggestions as suggestion}<option value={suggestion}></option>{/each}
              </datalist>

              <!-- Proxy Per Request Option -->
              <div class="req-proxy-select-wrap">
                <span class="req-proxy-icon" title="Proxy for this request">🛡</span>
                <select
                  class="tb-select req-item-proxy-select"
                  bind:value={reqProxyMode}
                  title="Specific proxy for this request"
                >
                  <option value="inherit">Proxy: Geral</option>
                  <option value="direct">Proxy: Direto</option>
                  <option value="corsproxy">Proxy: corsproxy.io</option>
                  <option value="allorigins">Proxy: allorigins.win</option>
                  <option value="custom">Proxy: Customizado…</option>
                </select>
                {#if reqProxyMode === 'custom'}
                  <input
                    class="req-proxy-input-inline"
                    type="text"
                    placeholder="https://proxy/?url=&#123;url&#125;"
                    bind:value={reqCustomProxyUrl}
                    title="URL do proxy com &#123;url&#125;"
                  />
                {/if}
              </div>

              <div class="req-send-combo">
                <button
                  type="button"
                  class="req-send-btn"
                  disabled={reqSending}
                  title="Send request (Enter in URL field)"
                  on:click={() => void sendRequest()}
                >
                  {#if reqSending}
                    <span class="req-spinner"></span>
                    <span>Enviando…</span>
                  {:else}
                    <svg
                      class="req-send-icon"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    <span>Send</span>
                  {/if}
                </button>
                <div class="req-send-divider"></div>
                <select
                  class="req-send-mode-select"
                  bind:value={reqSendMode}
                  title="Response target: same tab or new secondary tab"
                >
                  <option value="same">Mesma aba</option>
                  <option value="new">Nova aba</option>
                </select>
              </div>
              <button
                type="button"
                class="req-curl-btn"
                title="Copy active request as cURL command"
                on:click={copyRequestAsCurl}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>cURL</span>
              </button>
              <button
                type="button"
                class="req-curl-btn req-add-to-flow-btn"
                title="Add this request as a block in the Spatial Flow"
                on:click={addCurrentFormToFlow}
              >
                <span style="font-size: 11px;">➕</span>
                <span>Add to Flow</span>
              </button>
            </div>

            <!-- Section tabs -->
            <div class="req-tabs">
              {#each REQ_TABS as [tab, label]}
                <button
                  class="req-tab"
                  class:active={reqActiveTab === tab}
                  on:click={() => (reqActiveTab = tab)}>{label}</button
                >
              {/each}
            </div>

            <!-- Section content -->
            <div class="req-section-content">
              {#if reqActiveTab === 'params'}
                <div class="req-params">
                  {#if reqParams.length === 0}
                    <p class="req-note">No query parameters. Add key/value pairs below.</p>
                  {/if}
                  {#if reqParams.length > 0}
                    <table class="req-rows">
                      <thead>
                        <tr><th></th><th>Key</th><th>Value</th><th></th></tr>
                      </thead>
                      <tbody>
                        {#each reqParams as param, pi (pi)}
                          <tr>
                            <td>
                              <input
                                type="checkbox"
                                title="Include this parameter"
                                bind:checked={param.enabled}
                                on:change={onParamChange}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                placeholder="key"
                                bind:value={param.key}
                                on:input={onParamChange}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                placeholder="value"
                                bind:value={param.value}
                                on:input={onParamChange}
                              />
                            </td>
                            <td>
                              <button
                                class="req-mini-btn"
                                title="Remove parameter"
                                on:click={() => removeParam(pi)}>×</button
                              >
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  {/if}
                  <button class="req-mini-btn" on:click={addParam}>＋ Add parameter</button>
                </div>
              {:else if reqActiveTab === 'headers'}
                <div class="req-headers">
                  {#if reqHeaderRows.length > 0}
                    <table class="req-rows">
                      <thead>
                        <tr><th></th><th>Key</th><th>Value</th><th></th></tr>
                      </thead>
                      <tbody>
                        {#each reqHeaderRows as row, ri (ri)}
                          <tr>
                            <td>
                              <input
                                type="checkbox"
                                title="Include this header"
                                bind:checked={row.enabled}
                                on:change={onHeaderRowChange}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                list="req-header-suggest"
                                placeholder="Header"
                                bind:value={row.key}
                                on:input={onHeaderRowChange}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                placeholder="value"
                                bind:value={row.value}
                                on:input={onHeaderRowChange}
                              />
                            </td>
                            <td>
                              <button
                                class="req-mini-btn"
                                title="Remove header"
                                on:click={() => removeHeaderRow(ri)}>×</button
                              >
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  {/if}
                  <datalist id="req-header-suggest">
                    {#each HEADER_SUGGESTIONS as suggestion}
                      <option value={suggestion}></option>
                    {/each}
                  </datalist>
                  <button class="req-mini-btn" on:click={addHeaderRow}>＋ Add header</button>
                </div>
              {:else if reqActiveTab === 'body'}
                <div class="req-body">
                  <div class="req-label-row">
                    <span class="req-label"
                      >Body{#if bodyIgnored}
                        <span class="req-note"> (ignored for {reqMethod})</span>{/if}</span
                    >
                    <span class="req-spacer"></span>
                    <button
                      class="req-open-btn"
                      title="Open body in the main editor"
                      on:click={openBodyInEditor}>↗ Editor</button
                    >
                  </div>
                  <div class="req-row">
                    <span class="req-label">Type</span>
                    <select class="tb-select" bind:value={reqBodyType}>
                      <option value="none">None</option>
                      <option value="json">JSON</option>
                      <option value="text">Text</option>
                    </select>
                  </div>
                  <textarea
                    class="req-textarea"
                    rows="6"
                    placeholder={'{"key": "value"}'}
                    bind:value={reqBody}
                    on:input={onBodyInput}
                    on:keydown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void sendRequest()
                    }}
                  ></textarea>
                  {#if reqBodyInvalid}
                    <div class="req-warn">⚠ Invalid JSON in the body — fix it before sending.</div>
                  {/if}
                </div>
              {:else if reqActiveTab === 'auth'}
                <div class="req-auth">
                  <p class="req-note">How should the request authenticate?</p>
                  <div class="req-auth-methods">
                    {#each AUTH_METHODS as [value, label, hint]}
                      <button
                        class="req-auth-method"
                        class:active={reqAuthType === value}
                        title={hint}
                        on:click={() => (reqAuthType = value)}>{label}</button
                      >
                    {/each}
                  </div>
                  {#if reqAuthType === 'bearer'}
                    <div class="req-auth-fields">
                      <label class="req-auth-field">
                        <span class="req-label">Token</span>
                        <input
                          class="req-auth-input"
                          type="text"
                          placeholder={BEARER_PLACEHOLDER}
                          bind:value={authBearerToken}
                        />
                      </label>
                      <div class="req-token-block">
                        <span class="req-note"
                          >Fetch a token from an API — saves it as <code>{TOKEN_VAR}</code> in the active
                          environment.</span
                        >
                        <div class="req-token-row">
                          <input
                            class="req-auth-input"
                            type="text"
                            placeholder="Token URL (https://auth.example.com/token)"
                            bind:value={tokenUrl}
                          />
                          <input
                            class="req-path"
                            type="text"
                            placeholder="token path"
                            bind:value={tokenPath}
                          />
                          <button
                            class="sb-btn-status"
                            title={'Fetch token into {{token}} of the active environment'}
                            on:click={() => void fetchToken()}>🔑 Get token</button
                          >
                        </div>
                      </div>
                    </div>
                  {:else if reqAuthType === 'basic'}
                    <div class="req-auth-fields">
                      <label class="req-auth-field">
                        <span class="req-label">Username</span>
                        <input
                          class="req-auth-input"
                          type="text"
                          placeholder="username"
                          bind:value={authBasicUser}
                        />
                      </label>
                      <label class="req-auth-field">
                        <span class="req-label">Password</span>
                        <input
                          class="req-auth-input"
                          type="password"
                          placeholder="password"
                          bind:value={authBasicPass}
                        />
                      </label>
                    </div>
                  {:else if reqAuthType === 'apikey'}
                    <div class="req-auth-fields">
                      <label class="req-auth-field">
                        <span class="req-label">Header name</span>
                        <input
                          class="req-auth-input"
                          type="text"
                          placeholder="X-API-Key"
                          bind:value={authApiKeyName}
                        />
                      </label>
                      <label class="req-auth-field">
                        <span class="req-label">Key value</span>
                        <input
                          class="req-auth-input"
                          type="text"
                          placeholder="key"
                          bind:value={authApiKeyValue}
                        />
                      </label>
                    </div>
                  {/if}
                  <div class="req-auth-actions-bar">
                    <button
                      type="button"
                      class="sb-btn-status auth-validate-btn"
                      title="Audit and validate the configured authentication"
                      on:click={validateAndRevalidateAuth}
                    >
                      ⚡ Testar / Validar Auth
                    </button>
                    {#if authValidationMessage}
                      <span
                        class="auth-validation-badge"
                        class:ok={authValidationMessage.ok}
                        class:bad={!authValidationMessage.ok}
                      >
                        {authValidationMessage.text}
                      </span>
                    {/if}
                  </div>
                </div>
              {:else if reqActiveTab === 'captures'}
                <div class="req-captures-pane">
                  <CapturePathsTable bind:captures={reqCaptures} sampleJsonText={reqResponseText} />
                </div>
              {:else}
                <div class="req-env">
                  <div class="req-row">
                    <select class="tb-select" bind:value={$activeEnvName} on:change={onEnvSelected}>
                      <option value="">No environment</option>
                      {#each Object.keys($environments) as name}
                        <option value={name}>{name}</option>
                      {/each}
                    </select>
                    <button class="sb-btn-status" title="New environment" on:click={newEnvironment}
                      >＋ Env</button
                    >
                    <button
                      class="sb-btn-status"
                      title="Manage Environments & Globals (Postman style)"
                      on:click={() => (envManagerOpen = true)}
                    >
                      ⚙️ Gerenciar
                    </button>
                  </div>
                  <label class="req-field">
                    <span class="req-label-row">
                      <span class="req-label"
                        >Env JSON{#if $activeEnvName}
                          ({$activeEnvName}){/if}</span
                      >
                      <span class="req-spacer"></span>
                      <button
                        class="req-open-btn"
                        title="Open environment in the main editor"
                        on:click={openEnvInEditor}>↗ Editor</button
                      >
                    </span>
                    <textarea
                      class="req-textarea"
                      rows="5"
                      placeholder={'{"baseUrl": "…", "token": "…"}'}
                      disabled={!$activeEnvName}
                      bind:value={envJsonText}
                      on:input={onEnvJsonInput}
                    ></textarea>
                  </label>
                </div>
              {/if}
            </div>

            <!-- Response -->
            {#if reqResult}
              {#if 'error' in reqResult}
                <div class="req-response">
                  <div class="req-result req-error">⚠ {reqResult.error}</div>
                </div>
              {:else}
                <div class="req-response">
                  <div class="req-response-head">
                    <span
                      class="req-status-chip"
                      class:ok={reqResult.status < 400}
                      class:bad={reqResult.status >= 400}
                    >
                      {reqResult.status}
                      {reqResult.statusText}
                    </span>
                    <span class="req-meta"
                      >{reqResult.durationMs} ms · {formatBytes(
                        reqResult.sizeBytes
                      )}{#if reqResult.viaProxy}
                        · 🛡 via proxy{/if}</span
                    >
                    <span class="req-spacer"></span>
                    <span class="req-meta">full response opened as a new tab</span>
                  </div>
                  {#if reqResult.missing && reqResult.missing.length > 0}
                    <div class="req-result req-error">
                      Unresolved variables: {reqResult.missing.join(', ')}
                    </div>
                  {/if}
                  {#if reqResponseText}
                    <pre class="req-response-body">{reqResponseText}</pre>
                  {/if}
                </div>
              {/if}
            {/if}

            <!-- Fluxograma Espacial (Substitui o antigo Chain) -->
            <div class="req-flow-banner">
              <div class="flow-banner-left">
                <span class="flow-banner-icon">🔀</span>
                <div class="flow-banner-text">
                  <span class="flow-banner-title">Spatial Flow (Chain replacement)</span>
                  <span class="flow-banner-sub">
                    Visual chaining with REST and JS blocks, solid (wait/join) and dotted (async)
                    arrows, and an integrated side panel.
                  </span>
                </div>
              </div>
              <div class="flow-banner-actions">
                <button
                  type="button"
                  class="flow-banner-btn-secondary"
                  title="Add the active request as a block in the flow"
                  on:click={addCurrentFormToFlow}
                >
                  ➕ Add to Flow
                </button>
                <button
                  type="button"
                  class="flow-banner-btn-primary"
                  title="Open the visual flow editor"
                  on:click={() => ($requestsViewMode = 'flow')}
                >
                  Open Spatial Flow →
                </button>
              </div>
            </div>

            <!-- History (collapsible) -->
            {#if reqHistory.length > 0}
              <div class="req-history">
                <div
                  class="req-section-head"
                  role="button"
                  tabindex="0"
                  on:click={() => ($historyOpen = !$historyOpen)}
                  on:keydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') $historyOpen = !$historyOpen
                  }}
                >
                  <span class="req-caret">{$historyOpen ? '▾' : '▸'}</span>
                  <span class="req-label">History ({reqHistory.length})</span>
                  <span class="req-spacer"></span>
                  <button
                    class="req-mini-btn"
                    title="Clear history"
                    on:click|stopPropagation={clearHistory}>Clear</button
                  >
                </div>
                {#if $historyOpen}
                  {#each reqHistory as entry (entry.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <div
                      class="req-history-item"
                      title="Open response in the editor and load the request into the form"
                      on:click={() => openHistoryResponse(entry)}
                    >
                      <span class="req-method-tag">{entry.method}</span>
                      <span
                        class="req-status"
                        class:ok={typeof entry.status === 'number' && entry.status < 400}
                        class:bad={entry.status === 'error' ||
                          (typeof entry.status === 'number' && entry.status >= 400)}
                      >
                        {entry.status}
                      </span>
                      <span class="req-history-url">{entry.url}</span>
                      <span class="req-history-meta"
                        >{relativeTime(entry.timestamp)} · {entry.durationMs} ms ·
                        {formatBytes(entry.sizeBytes)}{#if entry.viaProxy}
                          · 🛡 proxy{/if}</span
                      >
                      <span class="req-history-actions">
                        <button
                          class="req-mini-btn"
                          title="Add this request as a block in the Spatial Flow"
                          on:click|stopPropagation={() => addHistoryEntryToFlow(entry)}
                          >＋ Flow</button
                        >
                        <button
                          class="req-mini-btn"
                          title="Load request into form"
                          on:click|stopPropagation={() => loadRequestIntoForm(entry)}>✎</button
                        >
                        <button
                          class="req-mini-btn"
                          title="Re-send"
                          on:click|stopPropagation={() => void reSendRequest(entry)}>↻</button
                        >
                        <button
                          class="req-mini-btn"
                          title="Remove"
                          on:click|stopPropagation={() => removeHistoryEntry(entry.id)}>×</button
                        >
                      </span>
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- STATUS -->
      <footer class="status-bar">
        <span>{tabModes[getActiveLeaf().tabIdx]}</span>
        <span>{queryLangId}</span>
        {#if dirtyFlags[getActiveLeaf().tabIdx]}
          <button
            class="sb-btn-status sb-unsaved"
            title="Save to disk (Ctrl+S)"
            on:click={() => void saveToDisk()}>● Unsaved — Save</button
          >
        {/if}
        <button
          class="sb-btn-status"
          class:sb-problems-active={problems.length > 0}
          on:click={() => (showProblems = !showProblems)}
          title="Toggle problems panel">⚠ {problems.length}</button
        >
        {#if saveStatus !== 'idle'}
          <span>{saveStatus === 'saving' ? 'Saving workspace…' : 'Workspace saved ✓'}</span>
        {/if}
        {#if diskSaveLabel}
          <span title="Saved to your machine">💾 {diskSaveLabel}</span>
        {/if}
        <span class="sb-spacer"></span>
        <button class="sb-btn-status" on:click={() => (paletteOpen = true)} title="Command palette"
          >⌕ Ctrl+Shift+P</button
        >
        <span>Tabs: {tabIds.length} · Panes: {layoutLeaves.length}</span>
      </footer>
    </div>
  </div>

  <CommandPalette bind:open={paletteOpen} actions={paletteActions} />

  <CurlImportModal
    open={showCurlModal}
    onImport={(text) => applyCurlCommand(text)}
    onClose={() => (showCurlModal = false)}
  />

  <EnvironmentManagerModal
    bind:open={envManagerOpen}
    bind:environments={$environments}
    bind:globalEnvironment={$globalEnvironment}
    bind:activeEnvName={$activeEnvName}
    onOpenInEditor={(filename, content) => {
      const mode = guessMode(filename, content)
      addSubTabWithContent(filename, content, mode, 'custom')
      showDiskSaveLabel(`Environment opened in editor: "${filename}"`)
    }}
    onClose={() => (envManagerOpen = false)}
  />

  {#if tabMenu}
    <TabContextMenu
      x={tabMenu.x}
      y={tabMenu.y}
      items={tabMenu.type === 'primary'
        ? buildPrimaryTabMenuItems(tabMenu.tabId)
        : buildSubTabMenuItems(tabMenu.tabId)}
      onClose={() => (tabMenu = undefined)}
    />
  {/if}
</div>

{#if false}<slot />{/if}

<style lang="scss">
  @import '../../lib/themes/jse-theme-dark.css';
  @import '../themes/jse-theme-big.css';

  $bg: #1e1e1e;
  $bg2: #252526;
  $bg3: #323233;
  $b: #3e3e42;
  $t: #cccccc;
  $td: #888;
  $ac: #0078d4;

  .app-shell {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: $bg;
    color: $t;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: $bg3;
    border-bottom: 1px solid $b;
    flex-shrink: 0;
    height: 36px;
    user-select: none;
  }
  .tb-brand {
    font-weight: 700;
    font-size: 13px;
    color: #fff;
    margin-right: 12px;
    letter-spacing: -0.3px;
  }
  .tb-group {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .tb-label {
    font-size: 10px;
    color: $td;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .tb-select {
    padding: 1px 4px;
    font-size: 11px;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    outline: none;
    &:focus {
      border-color: $ac;
    }
  }
  .tb-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    border: none;
    background: transparent;
    color: $t;
    font-size: 14px;
    cursor: pointer;
    border-radius: 3px;
    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }
  }
  .tb-btn-label {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid $b;
    border-radius: 3px;
    background: rgba(0, 120, 212, 0.25);
    color: #fff;
    font-size: 11px;
    cursor: pointer;
    &:hover {
      background: rgba(0, 120, 212, 0.45);
    }
  }
  .tb-spacer {
    flex: 1;
  }

  .main-area {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }
  .sidebar {
    width: 190px;
    flex-shrink: 0;
    background: $bg2;
    border-right: 1px solid $b;
    overflow-y: auto;
    padding: 8px 0;
    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: #555;
      border-radius: 3px;
    }
  }
  .sb-section {
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    &:last-child {
      border-bottom: none;
    }
  }
  .sb-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: $td;
    margin: 0 0 6px 0;
    font-weight: 600;
  }
  .sb-check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 12px;
    cursor: pointer;
    input {
      accent-color: $ac;
    }
  }
  .sb-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
    font-size: 12px;
    gap: 6px;
  }
  .sb-input {
    width: 50px;
    padding: 2px 4px;
    font-size: 11px;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    text-align: center;
  }
  .sb-btn {
    display: block;
    width: 100%;
    padding: 3px 8px;
    margin: 2px 0;
    font-size: 11px;
    background: transparent;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    cursor: pointer;
    text-align: left;
    &:hover {
      background: rgba(255, 255, 255, 0.06);
    }
  }
  .sb-note {
    font-size: 11px;
    color: $td;
    margin: 0 0 6px 0;
    line-height: 1.4;
  }

  .editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    position: relative;
  }

  .tab-bar-l1 {
    display: flex;
    align-items: center;
    background: #181818;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    height: 36px;
    flex-shrink: 0;
    overflow-x: auto;
    user-select: none;
    padding: 0 4px;
    gap: 3px;
    &::-webkit-scrollbar {
      height: 3px;
    }
    &::-webkit-scrollbar-thumb {
      background: #444;
    }
  }
  .tab-l1 {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 30px;
    border: none;
    border-radius: 6px 6px 0 0;
    background: #242424;
    color: #969696;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.12s,
      color 0.12s;
    &.active {
      background: #252526;
      color: #ffffff;
      border-bottom: 2px solid #007acc;
      font-weight: 600;
    }
    &:hover:not(.active) {
      background: #2c2c2c;
      color: #dddddd;
    }
  }
  .tab-l1-icon {
    font-size: 11px;
    opacity: 0.7;
  }
  .tab-count-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.12);
    color: #bbbbbb;
    line-height: 1;
  }
  .tab-drop-promote {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 6px;
    padding: 0 12px;
    height: 28px;
    font-size: 11px;
    font-weight: 600;
    color: #ffffff;
    border: 1.5px dashed #0098ff;
    border-radius: 6px;
    background: rgba(0, 152, 255, 0.18);
    box-shadow: 0 0 12px rgba(0, 152, 255, 0.3);
    white-space: nowrap;
    animation: tab-pulse-blue 1.5s infinite ease-in-out;
    cursor: copy;
    transition: all 0.15s ease;
    flex-shrink: 0;
    &:hover {
      background: rgba(0, 152, 255, 0.35);
      border-color: #38bdf8;
      box-shadow: 0 0 16px rgba(0, 152, 255, 0.55);
      transform: translateY(-1px);
    }
  }
  .tab-drop-promote-icon {
    font-size: 13px;
    font-weight: 700;
    color: #7dd3fc;
  }
  @keyframes tab-pulse-blue {
    0%,
    100% {
      border-color: #0098ff;
      background: rgba(0, 152, 255, 0.16);
      box-shadow: 0 0 8px rgba(0, 152, 255, 0.2);
    }
    50% {
      border-color: #38bdf8;
      background: rgba(0, 152, 255, 0.3);
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.45);
    }
  }

  .tab-l1.drag-over-before,
  .tab-l2.drag-over-before {
    position: relative;
    &::before {
      content: '';
      position: absolute;
      left: -2px;
      top: 2px;
      bottom: 2px;
      width: 3px;
      background: #0098ff;
      box-shadow: 0 0 8px #0098ff;
      border-radius: 2px;
      z-index: 10;
      pointer-events: none;
    }
  }

  .tab-l1.drag-over-after,
  .tab-l2.drag-over-after {
    position: relative;
    &::after {
      content: '';
      position: absolute;
      right: -2px;
      top: 2px;
      bottom: 2px;
      width: 3px;
      background: #0098ff;
      box-shadow: 0 0 8px #0098ff;
      border-radius: 2px;
      z-index: 10;
      pointer-events: none;
    }
  }

  .tab-drop-move-pane {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 6px;
    padding: 0 10px;
    height: 26px;
    font-size: 11px;
    font-weight: 600;
    color: #38bdf8;
    border: 1.5px dashed rgba(56, 189, 248, 0.6);
    border-radius: 6px;
    background: rgba(56, 189, 248, 0.1);
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.15);
    white-space: nowrap;
    cursor: copy;
    transition: all 0.15s ease;
    flex-shrink: 0;
    animation: tab-pulse-pane 1.5s infinite ease-in-out;
    &.drag-hover,
    &:hover {
      background: rgba(56, 189, 248, 0.28);
      border-color: #38bdf8;
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.45);
      transform: translateY(-1px);
    }
  }
  .tab-drop-icon {
    font-size: 12px;
    font-weight: 700;
  }
  @keyframes tab-pulse-pane {
    0%,
    100% {
      border-color: rgba(56, 189, 248, 0.5);
      background: rgba(56, 189, 248, 0.08);
    }
    50% {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.2);
    }
  }

  .tab-bar-l2 {
    display: flex;
    align-items: center;
    background: #252526;
    border-bottom: 1px solid $b;
    height: 29px;
    flex-shrink: 0;
    overflow-x: auto;
    user-select: none;
    padding: 0 6px;
    gap: 2px;
    &::-webkit-scrollbar {
      height: 2px;
    }
    &::-webkit-scrollbar-thumb {
      background: #555;
    }
  }
  .tab-l2 {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    height: 23px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #999999;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.1s,
      color 0.1s;
    &.active {
      background: #37373d;
      color: #ffffff;
      font-weight: 500;
    }
    &:hover:not(.active) {
      background: rgba(255, 255, 255, 0.05);
      color: #cccccc;
    }
  }
  .tab-l2-icon {
    font-size: 11px;
    line-height: 1;
  }
  .tab-promote-btn {
    font-size: 11px;
    padding: 0 3px;
    border-radius: 2px;
    opacity: 0;
    color: #4ec9b0;
    cursor: pointer;
    transition:
      opacity 0.1s,
      background 0.1s;
    &:hover {
      background: rgba(78, 201, 176, 0.2);
    }
  }
  .tab-l2:hover .tab-promote-btn {
    opacity: 0.7;
  }
  .tab-promote-btn:hover {
    opacity: 1 !important;
  }
  .tab-add-l2 {
    font-size: 11px;
    padding: 0 8px;
    height: 22px;
    color: $td;
    border-radius: 3px;
    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 12px;
    height: 100%;
    border: none;
    background: #2d2d2d;
    color: $td;
    font-size: 12px;
    cursor: pointer;
    border-right: 1px solid $b;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.1s;
    &.active {
      background: #1e1e1e;
      color: #fff;
      border-bottom: 2px solid $ac;
    }
    &:hover:not(.active) {
      background: #353535;
    }
  }
  .tab-label {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-close {
    font-size: 14px;
    opacity: 0;
    width: 16px;
    text-align: center;
    border-radius: 2px;
    &:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }
  }
  .tab-l1:hover .tab-close,
  .tab-l1.active .tab-close,
  .tab-l2:hover .tab-close,
  .tab-l2.active .tab-close,
  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 0.6;
  }
  .tab-add {
    font-size: 16px;
    padding: 0 10px;
    color: $td;
    background: transparent;
    border: none;
    cursor: pointer;
    &:hover {
      color: #fff;
    }
  }

  .editor-panes {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }
  .editor-pane {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid $b;
    border-bottom: 1px solid $b;
  }
  .pane-header {
    display: flex;
    align-items: center;
    background: #1a1a1a;
    border-bottom: 1px solid $b;
    flex-shrink: 0;
    height: 26px;
    padding: 0 4px;
    user-select: none;
  }
  .pane-doc {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 80%;
    height: 100%;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: $t;
    font-size: 11px;
    cursor: grab;
    overflow: hidden;
    white-space: nowrap;
    &:active {
      cursor: grabbing;
    }
    &:hover {
      background: rgba(255, 255, 255, 0.06);
    }
  }
  .pane-grab-icon {
    font-size: 11px;
    opacity: 0.6;
    letter-spacing: -1px;
  }
  .pane-doc-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pane-save {
    border: none;
    background: transparent;
    color: #dcdcaa;
    font-size: 12px;
    cursor: pointer;
    padding: 0 4px;
    flex-shrink: 0;
    &:hover {
      color: #fff;
    }
  }
  .pane-spacer {
    flex: 1;
  }
  .pane-close-btn {
    border: none;
    background: transparent;
    color: $td;
    font-size: 14px;
    cursor: pointer;
    padding: 0 6px;
    height: 100%;
    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
  }

  .req-send-combo {
    display: inline-flex;
    align-items: stretch;
    height: 28px;
    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
    border-radius: 6px;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    overflow: hidden;
    transition: all 0.15s ease;
    flex-shrink: 0;
    &:hover {
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      box-shadow:
        0 2px 10px rgba(2, 132, 199, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }
  }

  .req-send-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 100%;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }
    &:active:not(:disabled) {
      background: rgba(0, 0, 0, 0.15);
    }
    &:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
  }

  .req-send-icon {
    flex-shrink: 0;
  }

  .req-send-divider {
    width: 1px;
    background: rgba(255, 255, 255, 0.25);
    height: 100%;
  }

  .req-send-mode-select {
    height: 100%;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 11px;
    font-weight: 500;
    padding: 0 22px 0 8px;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 7px center;
    transition: background-color 0.12s;
    &:hover {
      background-color: rgba(255, 255, 255, 0.12);
    }
    option {
      background: #1e222b;
      color: #f1f5f9;
      font-size: 12px;
      padding: 6px 10px;
    }
  }
  .editor-wrapper {
    flex: 1;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .editor-form {
    flex: 1;
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .status-bar {
    display: flex;
    align-items: center;
    padding: 0 10px;
    height: 22px;
    background: $ac;
    color: #fff;
    font-size: 11px;
    flex-shrink: 0;
    gap: 16px;
  }
  .sb-spacer {
    flex: 1;
  }
  .sb-btn-status {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 6px;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    border-radius: 3px;
    color: #fff;
    font-size: 10px;
    cursor: pointer;
    &:hover {
      background: rgba(255, 255, 255, 0.22);
    }
  }
  .sb-problems-active {
    background: rgba(241, 76, 76, 0.55);
  }
  .sb-unsaved {
    background: rgba(204, 167, 0, 0.45);
    &:hover {
      background: rgba(204, 167, 0, 0.65);
    }
  }
  .sb-input-wide {
    width: 100%;
    text-align: left;
  }

  // Requests panel
  .requests-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 320px;
    background: $bg2;
    border-top: 1px solid $b;
  }
  .requests-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    flex-shrink: 0;
    background: $bg2;
    border-bottom: 1px solid $b;
    gap: 16px;
  }
  .requests-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .requests-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(56, 131, 250, 0.15);
    border: 1px solid rgba(56, 131, 250, 0.35);
  }
  .requests-brand-icon {
    font-size: 12px;
    color: #3883fa;
  }
  .requests-brand-text {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: #3883fa;
  }
  .req-view-toggle {
    display: flex;
    align-items: center;
    background: $bg;
    border: 1px solid $b;
    border-radius: 4px;
    padding: 2px;
    gap: 2px;
  }
  .req-view-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 3px;
    background: transparent;
    color: $td;
    border: none;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s ease;
    &:hover {
      color: $t;
      background: rgba(255, 255, 255, 0.05);
    }
    &.active {
      background: #3883fa;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
  }
  .req-badge-pill {
    background: #3883fa;
    color: #ffffff;
    font-size: 9px;
    font-weight: 700;
    border-radius: 10px;
    padding: 0 5px;
    line-height: 14px;
  }
  .requests-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .requests-env-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: $bg;
    border: 1px solid $b;
    border-radius: 4px;
    padding: 2px 8px;
  }
  .req-env-icon {
    font-size: 12px;
  }
  .req-env-label {
    font-size: 11px;
    color: $td;
    font-weight: 500;
  }
  .req-env-select {
    min-width: 135px;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 22px 3px 8px;
    background-color: $bg;
    border: 1px solid $b;
    color: $t;
    border-radius: 3px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%23cccccc' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E");
    background-position: right 5px center;
    background-repeat: no-repeat;
    background-size: 13px;
    transition: all 0.15s ease;
    &:focus {
      outline: none;
      border-color: #3883fa;
      box-shadow: 0 0 0 2px rgba(56, 131, 250, 0.25);
    }
    &:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }
  }
  .req-env-select option {
    background-color: $bg2;
    color: $t;
    padding: 6px 10px;
    font-size: 12px;
  }
  .req-env-manage-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    font-size: 12px;
    border-radius: 3px;
    color: $td;
    transition: all 0.15s ease;
    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #3883fa;
    }
  }
  .requests-proxy-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: $bg;
    border: 1px solid $b;
    border-radius: 4px;
    padding: 2px 8px;
  }
  .req-proxy-icon {
    font-size: 12px;
    color: #3883fa;
  }
  .req-proxy-label {
    font-size: 11px;
    color: $td;
    font-weight: 500;
  }
  .req-top-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    background: $bg3;
    color: $t;
    border: 1px solid $b;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s ease;
    &:hover {
      background: #3a3d41;
      border-color: rgba(255, 255, 255, 0.25);
      color: #ffffff;
    }
  }
  .requests-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    color: $td;
    font-size: 16px;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1;
    &:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
  }
  .requests-flow-container {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .req-proxy-select-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .req-item-proxy-select {
    height: 26px;
    border-radius: 4px;
    padding: 0 8px;
    font-size: 11px;
    border: 1px solid $b;
    background: $bg;
    color: $t;
    outline: none;
    cursor: pointer;
    &:focus {
      border-color: #3883fa;
    }
  }
  .req-proxy-input-inline {
    height: 26px;
    padding: 0 8px;
    font-size: 11px;
    font-family: Consolas, monospace;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 4px;
    outline: none;
    width: 140px;
  }
  .req-auth-actions-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .auth-validate-btn {
    background: rgba(2, 132, 199, 0.2);
    border: 1px solid rgba(2, 132, 199, 0.4);
    color: #38bdf8;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    &:hover {
      background: rgba(2, 132, 199, 0.3);
    }
  }
  .auth-validation-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: Consolas, monospace;
    &.ok {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    &.bad {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
  }
  .req-captures-pane {
    padding: 4px 0;
  }
  .requests-resizer {
    height: 5px;
    flex-shrink: 0;
    cursor: row-resize;
    background: transparent;
    transition: background 0.1s;
    &:hover {
      background: rgba(255, 255, 255, 0.14);
    }
  }
  .requests-form {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.15);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .req-method {
    flex-shrink: 0;
    height: 28px;
    border-radius: 4px;
    padding: 0 22px 0 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
    border: 1px solid $b;
    background-color: $bg2;
    outline: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='9' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    transition: all 0.12s ease;
    &:focus {
      border-color: $ac;
      box-shadow: 0 0 0 2px rgba(56, 131, 250, 0.2);
    }
    &.req-method-get {
      color: #10b981;
    }
    &.req-method-post {
      color: #f59e0b;
    }
    &.req-method-put {
      color: #3b82f6;
    }
    &.req-method-patch {
      color: #a855f7;
    }
    &.req-method-delete {
      color: #ef4444;
    }
    option {
      background: $bg2;
      color: $t;
      font-weight: 600;
      padding: 4px 8px;
    }
  }
  .req-url {
    flex: 1;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    font-family: Consolas, 'Cascadia Code', monospace;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 4px;
    outline: none;
    transition: all 0.12s ease;
    &:focus {
      border-color: $ac;
      box-shadow: 0 0 0 2px rgba(56, 131, 250, 0.25);
      background: $bg;
    }
    &::placeholder {
      color: $td;
    }
  }
  .req-curl-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 11px;
    background: $bg3;
    color: $t;
    border: 1px solid $b;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s ease;
    flex-shrink: 0;
    &:hover {
      background: #3a3d41;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.28);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    }
    &:active {
      transform: translateY(1px);
    }
  }
  .req-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: req-spin 0.6s linear infinite;
  }
  @keyframes req-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .requests-fields {
    display: flex;
    gap: 8px;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .req-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .req-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: $td;
  }
  .req-label-row {
    display: flex;
    align-items: center;
    gap: 4px;
    .req-mini-btn {
      padding: 0 3px;
    }
  }
  .req-textarea {
    resize: none;
    padding: 3px 6px;
    font-size: 11px;
    font-family: Consolas, 'Courier New', monospace;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    outline: none;
    &:focus {
      border-color: $ac;
    }
  }
  .req-result {
    flex-shrink: 0;
    padding: 4px 8px;
    font-size: 11px;
    color: #89d185;
  }
  .req-error {
    color: #f14c4c;
  }
  .req-history {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }
  .req-history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: $t;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    border-radius: 3px;
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
  .req-method-tag {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    color: #9cdcfe;
    width: 48px;
  }
  .req-status {
    flex-shrink: 0;
    width: 28px;
    text-align: center;
    border-radius: 3px;
    &.ok {
      background: rgba(137, 209, 133, 0.25);
      color: #89d185;
    }
    &.bad {
      background: rgba(241, 76, 76, 0.3);
      color: #f14c4c;
    }
  }
  .req-history-url {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .req-history-meta {
    flex-shrink: 0;
    color: $td;
    font-size: 10px;
  }
  .req-env-row {
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .req-path {
    width: 120px;
    flex-shrink: 0;
    padding: 3px 6px;
    font-size: 11px;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    outline: none;
    &:focus {
      border-color: $ac;
    }
  }
  .req-mini-btn {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: $td;
    font-size: 11px;
    cursor: pointer;
    padding: 0 4px;
    border-radius: 3px;
    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
  }
  .req-history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px;
  }
  .req-add-to-flow-btn {
    border-color: rgba(56, 189, 248, 0.35) !important;
    color: #38bdf8 !important;
    &:hover {
      background: rgba(2, 132, 199, 0.18) !important;
    }
  }
  .req-flow-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 8px 12px;
    padding: 8px 12px;
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 7px;
    gap: 12px;
    flex-shrink: 0;
  }
  .flow-banner-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .flow-banner-icon {
    font-size: 16px;
  }
  .flow-banner-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .flow-banner-title {
    font-size: 11px;
    font-weight: 700;
    color: #38bdf8;
  }
  .flow-banner-sub {
    font-size: 10px;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flow-banner-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .flow-banner-btn-primary {
    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
    color: #fff;
    border: none;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 600;
    padding: 4px 10px;
    cursor: pointer;
    transition: all 0.12s;
    &:hover {
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      transform: translateY(-1px);
    }
  }
  .flow-banner-btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #cbd5e1;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 500;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 0.12s;
    &:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
  }
  .req-chain {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px 8px;
    flex-shrink: 0;
  }
  .req-chain-item {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 220px;
    padding: 1px 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    &.editing {
      outline: 1px solid $ac;
      background: rgba(0, 120, 212, 0.18);
    }
  }
  .req-chain-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .req-chain-result {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    &.ok {
      background: rgba(137, 209, 133, 0.25);
      color: #89d185;
    }
    &.bad {
      background: rgba(241, 76, 76, 0.3);
      color: #f14c4c;
    }
  }
  .req-capture {
    width: 150px;
    flex-shrink: 0;
    padding: 3px 6px;
    font-size: 11px;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    outline: none;
    &:focus {
      border-color: $ac;
    }
  }
  .req-var {
    width: 90px;
  }
  .req-arrow {
    color: $td;
    font-size: 11px;
    flex-shrink: 0;
  }
  .req-capture-badge {
    flex-shrink: 0;
    color: #dcdcaa;
    font-size: 10px;
  }

  .problems-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 150px;
    background: $bg2;
    border-top: 1px solid $b;
  }
  .problems-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 8px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .problems-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: $td;
  }
  .problems-close {
    border: none;
    background: transparent;
    color: $t;
    font-size: 14px;
    cursor: pointer;
    padding: 0 4px;
    &:hover {
      color: #fff;
    }
  }
  .problems-list {
    flex: 1;
    overflow-y: auto;
    padding: 2px 0;
  }
  .problems-empty {
    padding: 6px 10px;
    color: $td;
    font-size: 12px;
  }
  .problem-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 3px 10px;
    border: none;
    background: transparent;
    color: $t;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
  .problem-sev {
    font-size: 8px;
    flex-shrink: 0;
    &.error {
      color: #f14c4c;
    }
    &.warning {
      color: #cca700;
    }
    &.info {
      color: #3794ff;
    }
  }
  .problem-message {
    flex-shrink: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .problem-path {
    flex: 1;
    color: $td;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .problem-tab {
    flex-shrink: 0;
    color: $td;
    font-size: 10px;
    background: rgba(255, 255, 255, 0.06);
    padding: 0 5px;
    border-radius: 3px;
  }

  // Tab bar
  .tab-dirty {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: transparent;
    &.dirty {
      background: #fff;
      opacity: 0.9;
    }
  }

  // Pane dividers + drop zones
  .pane-divider {
    position: absolute;
    background: rgba(255, 255, 255, 0.08);
    transition: background 0.1s;
    z-index: 5;
    &:hover {
      background: rgba(255, 255, 255, 0.22);
    }
  }
  .divider-col {
    cursor: col-resize;
  }
  .divider-row {
    cursor: row-resize;
  }
  .drop-zone {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 120, 212, 0.25);
    border: 2px dashed $ac;
    color: #fff;
    font-size: 11px;
    z-index: 50;
  }
  .dz-right {
    top: 34px;
    bottom: 0;
    right: 0;
    width: 40%;
  }
  .dz-bottom {
    left: 0;
    right: 0;
    bottom: 0;
    height: 35%;
  }

  // Diff highlighting
  :global(.jse-diff-changed) {
    background: rgba(255, 200, 0, 0.15) !important;
    border-left: 3px solid #ffc800 !important;
  }

  // ---- Requests panel: redesigned layout ----
  .req-spacer {
    flex: 1;
  }
  .req-meta {
    font-size: 11px;
    color: $td;
    white-space: nowrap;
  }
  .req-note {
    font-size: 11px;
    color: $td;
    margin: 4px 0;
  }
  .req-warn {
    font-size: 11px;
    color: #f1b24c;
    margin: 4px 0;
  }
  .requests-proxy {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 12px;
  }
  .req-proxy-select {
    max-width: 140px;
    background-color: $bg2;
    color: $t;
    border: 1px solid $b;
    border-radius: 4px;
    option {
      background-color: $bg2;
      color: $t;
      padding: 6px 10px;
      font-size: 12px;
    }
  }
  .req-proxy-input {
    width: 220px;
    padding: 2px 6px;
    font-size: 11px;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    outline: none;
    &:focus {
      border-color: $ac;
    }
  }
  .req-method {
    font-weight: 600;
    &.req-method-get {
      color: #89d185;
    }
    &.req-method-post {
      color: #f1b24c;
    }
    &.req-method-put {
      color: #64b5f6;
    }
    &.req-method-patch {
      color: #b48df2;
    }
    &.req-method-delete {
      color: #f14c4c;
    }
  }
  .req-tabs {
    display: flex;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid $b;
    flex-shrink: 0;
  }
  .req-tab {
    padding: 4px 12px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: transparent;
    color: $td;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    &:hover {
      color: $t;
    }
    &.active {
      color: $t;
      border-bottom-color: $ac;
    }
  }
  .req-section-content {
    flex-shrink: 0;
    padding: 6px 8px;
    max-height: 180px;
    overflow-y: auto;
  }
  .req-rows {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    th {
      text-align: left;
      color: $td;
      font-weight: 600;
      padding: 2px 4px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      padding: 2px 2px;
    }
    input[type='text'] {
      width: 100%;
      padding: 3px 6px;
      font-size: 11px;
      background: $bg;
      color: $t;
      border: 1px solid $b;
      border-radius: 3px;
      outline: none;
      &:focus {
        border-color: $ac;
      }
    }
    input[type='checkbox'] {
      accent-color: $ac;
    }
  }
  .req-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .req-auth-input {
    display: block;
    width: 100%;
    max-width: 420px;
    margin-bottom: 6px;
    padding: 4px 8px;
    font-size: 12px;
    background: $bg;
    color: $t;
    border: 1px solid $b;
    border-radius: 3px;
    outline: none;
    &:focus {
      border-color: $ac;
    }
  }
  .req-token-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .req-response {
    flex-shrink: 0;
    border-top: 1px solid $b;
    padding: 4px 8px;
  }
  .req-response-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .req-status-chip {
    font-size: 12px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 10px;
    &.ok {
      background: rgba(137, 209, 133, 0.25);
      color: #89d185;
    }
    &.bad {
      background: rgba(241, 76, 76, 0.3);
      color: #f14c4c;
    }
  }
  .req-response-body {
    margin: 6px 0 2px 0;
    max-height: 160px;
    overflow: auto;
    padding: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid $b;
    border-radius: 4px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .req-section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    background: transparent;
    color: $t;
    border: none;
    border-top: 1px solid $b;
    cursor: pointer;
    font-size: 12px;
    text-align: left;
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
  .req-caret {
    font-size: 10px;
    color: $td;
    width: 12px;
  }
  .req-chain-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 8px;
  }
  .req-chain-table {
    th {
      white-space: nowrap;
    }
    td {
      vertical-align: middle;
    }
    .req-chain-url {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
    }
  }
  .req-chain-row {
    &.editing {
      background: rgba(0, 120, 212, 0.14);
      outline: 1px solid $ac;
    }
    &.running {
      background: rgba(255, 200, 0, 0.12);
    }
  }
  .req-chain-actions {
    display: flex;
    gap: 2px;
    justify-content: flex-end;
  }
  .req-chain-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .req-chain-empty {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .req-open-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    color: $ac;
    background: rgba(0, 120, 212, 0.12);
    border: 1px solid $ac;
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      background: rgba(0, 120, 212, 0.22);
    }
  }
  .req-auth-methods {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .req-auth-method {
    padding: 5px 14px;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.05);
    color: $td;
    border: 1px solid $b;
    border-radius: 4px;
    cursor: pointer;
    &:hover {
      color: $t;
      border-color: $td;
    }
    &.active {
      background: $ac;
      color: #fff;
      border-color: $ac;
    }
  }
  .req-auth-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .req-auth-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 480px;
  }
  .req-token-block {
    margin-top: 6px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px dashed $b;
    border-radius: 4px;
  }
  .req-history-actions {
    display: inline-flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .req-history-item:hover .req-history-actions {
    opacity: 1;
  }

  // ---- Sidebar: collapsible section headers ----
  .sb-section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    color: $t;
    border: none;
    border-top: 1px solid $b;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
  .sb-caret {
    font-size: 10px;
    color: $td;
    width: 12px;
  }
</style>
