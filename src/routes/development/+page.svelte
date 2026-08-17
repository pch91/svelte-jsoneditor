<script lang="ts">
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
  import CommandPalette from './components/CommandPalette.svelte'
  import FolderTree from './components/FolderTree.svelte'
  import TabContextMenu from './components/TabContextMenu.svelte'
  import {
    computeDiffPaths,
    contentToValue,
    jsonPathToPointer,
    matchesDiffPath
  } from './diffUtils.js'
  import { contentErrorsToProblems, type Problem } from './problemsUtils.js'
  import { moveBefore } from './tabUtils.js'
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
    buildUrlWithQuery,
    encodeBasicAuth,
    extractValueByPath,
    formatBytes,
    headersToRows,
    parseCaptureList,
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
  // TAB STATE — flat parallel arrays for reliable Svelte bind
  // SPLIT STATE — binary tree layout (VS Code / mosaic model)
  // ============================================================
  let tabIds: number[] = [1]
  let tabTitles: string[] = ['Editor 1']
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
  let tabMenu: { x: number; y: number; tabId: number } | undefined

  // ---- Requests panel (HTTP client) ----
  let showRequests = false
  let reqMethod = 'GET'
  let reqUrl = ''
  let reqHeaders = ''
  let reqBody = ''
  let reqSending = false
  let reqActiveTab: 'params' | 'headers' | 'body' | 'auth' | 'env' = 'params'
  let reqParams: QueryParam[] = []
  let reqHeaderRows: HeaderRow[] = []
  let reqBodyType: 'none' | 'json' | 'text' = 'json'
  let reqAuthType: 'none' | 'bearer' | 'basic' | 'apikey' = 'none'
  let authBearerToken = ''
  let authBasicUser = ''
  let authBasicPass = ''
  let authApiKeyName = 'X-API-Key'
  let authApiKeyValue = ''
  let reqResponseText = ''
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
  function splitActiveLeaf(direction: SplitDirection, tabId?: number) {
    if (layoutLeaves.length >= 4) {
      showDiskSaveLabel('Maximum of 4 panes reached')
      return
    }
    if (tabId !== undefined) {
      const idx = getTabIdx(tabId)
      if (idx === -1) return
      const leaf = findLeafByTab(layout, idx) ?? getActiveLeaf()
      if (leaf.tabIdx !== idx) {
        layout = replaceLeaf(layout, leaf.id, { ...leaf, tabIdx: idx })
      }
      activeLeafId = leaf.id
    }
    const leaf = getActiveLeaf()
    const splitId = nextNodeId++
    const newLeafId = nextNodeId++
    layout = splitLeaf(layout, leaf.id, direction, splitId, newLeafId)
    activeLeafId = newLeafId
    scheduleAutosave()
  }

  function closeActiveLeaf() {
    if (layoutLeaves.length <= 1) return
    const next = removeLeaf(layout, activeLeafId)
    if (next) {
      layout = next
      activeLeafId = collectLeaves(layout)[0].id
      scheduleAutosave()
    }
  }

  // ---- Tab operations ----
  function addTabWithContent(title: string, text: string, mode: Mode = Mode.tree): number {
    tabIds = [...tabIds, nextTabId++]
    tabTitles = [...tabTitles, title]
    tabContents = [...tabContents, { text, json: undefined }]
    tabModes = [...tabModes, mode]
    tabSelections = [...tabSelections, undefined]
    tabRefs = [...tabRefs, undefined]
    tabRevisions = [...tabRevisions, 0]
    tabLastSavedText = [...tabLastSavedText, text]
    const idx = tabIds.length - 1
    setActiveLeafTab(idx)
    updateDirtyFlags()
    scheduleAutosave()
    return idx
  }

  function addTab() {
    addTabWithContent(`Editor ${tabIds.length + 1}`, '{}')
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

  function buildTabMenuItems(tabId: number) {
    const single = tabIds.length <= 1
    const idx = getTabIdx(tabId)
    const disabledSplit = layoutLeaves.length >= 4
    return [
      {
        label: 'Split Right',
        disabled: disabledSplit,
        action: () => splitActiveLeaf('vertical', tabId)
      },
      {
        label: 'Split Down',
        disabled: disabledSplit,
        action: () => splitActiveLeaf('horizontal', tabId)
      },
      {
        label: 'Rename…',
        action: () => {
          const n = prompt('Rename:', tabTitles[idx])
          if (n) renameTab(tabId, n)
        }
      },
      { label: 'Close', disabled: single, action: () => closeTab(tabId) },
      { label: 'Close Others', disabled: single, action: () => closeOtherTabs(tabId) },
      { label: 'Close All', disabled: single, action: closeAllTabs }
    ]
  }

  // ---- Drag tab between panes ----
  function onTabDragStart(e: DragEvent, tabId: number) {
    e.dataTransfer!.setData('text/plain', String(tabId))
    e.dataTransfer!.effectAllowed = 'move'
    draggedTabId = tabId
    tabDragActive = true
  }
  function onTabDragEnd() {
    draggedTabId = undefined
    tabDragActive = false
  }
  function onTabDragOverReorder(e: DragEvent, tabId: number) {
    if (!draggedTabId || draggedTabId === tabId) return
    e.preventDefault()
    moveTab(draggedTabId, tabId)
  }
  function onPaneDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
  }
  function onPaneDrop(e: DragEvent, leafId: number) {
    e.preventDefault()
    const tabId = Number(e.dataTransfer!.getData('text/plain'))
    const idx = getTabIdx(tabId)
    if (idx === -1) return
    const target = findLeaf(layout, leafId)
    if (!target || target.tabIdx === idx) return
    const source = findLeafByTab(layout, idx)
    if (source && source.id !== leafId) {
      // Move semantics: the target leaf gets this document, the source leaf
      // gets the document that was previously in the target leaf (swap).
      layout = replaceLeaf(layout, leafId, { ...target, tabIdx: idx })
      layout = replaceLeaf(layout, source.id, { ...source, tabIdx: target.tabIdx })
    } else {
      layout = replaceLeaf(layout, leafId, { ...target, tabIdx: idx })
    }
    scheduleAutosave()
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
    version: 2 as const,
    tabs: tabIds.map((id, i) => ({
      id,
      title: tabTitles[i],
      text: getTabText(i),
      mode: tabModes[i]
    })),
    layout: serializeLayout(layout),
    nextTabId,
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

  onMount(async () => {
    const saved = await loadWorkspace()
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
      const validTabIdx = (idx: number) => (idx >= 0 && idx < n ? idx : 0)
      if (saved.version === 2 && saved.layout) {
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
      activeLeafId = collectLeaves(layout)[0]?.id ?? 1
    }
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

  /** Extract the selected JSON into a NEW tab, keeping the original document untouched. */
  function handleExtractToNewTab(extractedValue: unknown, pointer: string) {
    const text = JSON.stringify(extractedValue, null, 2)
    const suffix = (pointer || 'root').replace(/^\/+/, '').replace(/[^a-zA-Z0-9_.-]+/g, '-')
    const name = `extract-${suffix || 'root'}.json`
    addTabWithContent(name, text, guessMode(name, text))
    showDiskSaveLabel(`Extracted "${pointer || '/'}" into a new tab`)
  }

  /** Open a primitive value in a preview tab (with the modal's full UI inline). */
  function handleEditWithPreview(props: EditWithPreviewProps) {
    const sourceTabId = tabIds[getActiveLeaf().tabIdx]
    const pointer = compileJSONPointer(props.path)
    const idx = addTabWithContent(`Preview: ${props.pathLabel}`, props.value, Mode.text)
    previewTabInfo.set(tabIds[idx], {
      pathLabel: props.pathLabel,
      onSave: (value: string) => {
        // keep the value as a string unless it parses as another JSON type
        let updated: unknown = value
        try {
          updated = JSON.parse(value)
        } catch {
          // not valid JSON — keep the raw string
        }
        applyReplaceToSource(sourceTabId, pointer, updated)
      }
    })
    showDiskSaveLabel(`Preview tab opened: "${props.pathLabel}"`)
  }

  /** Open nested object/array content in a regular tab, syncing edits back live. */
  function handleEditNestedContent(props: JSONEditorModalCallback) {
    const pointer = compileJSONPointer(props.path)
    const sourceTabId = tabIds[getActiveLeaf().tabIdx]
    const text = isJSONContent(props.content)
      ? JSON.stringify(props.content.json, null, 2)
      : (props.content.text ?? '{}')
    const idx = addTabWithContent(`Edit: ${pointer || '(root)'}`, text, Mode.tree)
    nestedTabInfo.set(tabIds[idx], { pointer, sourceTabId, onClose: props.onClose })
    showDiskSaveLabel(`Nested content tab opened: "${pointer || '/'}"`)
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
  function buildAuthHeaders(env: Record<string, string>): Record<string, string> {
    const auth: Record<string, string> = {}
    if (reqAuthType === 'bearer') {
      const token = resolveVariables(authBearerToken, env).resolved.trim()
      if (token) auth.Authorization = `Bearer ${token}`
    } else if (reqAuthType === 'basic') {
      const user = resolveVariables(authBasicUser, env).resolved
      const pass = resolveVariables(authBasicPass, env).resolved
      if (user || pass) auth.Authorization = `Basic ${encodeBasicAuth(user, pass)}`
    } else if (reqAuthType === 'apikey') {
      const name = resolveVariables(authApiKeyName, env).resolved.trim()
      const value = resolveVariables(authApiKeyValue, env).resolved
      if (name && value) auth[name] = value
    }
    return auth
  }

  /** Try the URL directly, then fall back to the CORS proxy when configured. */
  async function fetchWithProxy(
    url: string,
    init: RequestInit,
    proxyTemplate: string
  ): Promise<{ res: Response; viaProxy: boolean }> {
    const attempts = [url]
    if (proxyTemplate) attempts.push(proxyUrl(url, proxyTemplate))
    let lastError: unknown
    for (let index = 0; index < attempts.length; index++) {
      try {
        return { res: await fetch(attempts[index], init), viaProxy: index > 0 }
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
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
    const resolvedUrl = resolveVariables(url, env)
    const resolvedHeaders = resolveVariables(reqHeaders, env)
    const resolvedBody = resolveVariables(reqBody, env)
    const authHeaders = buildAuthHeaders(env)
    const authValues = Object.values(authHeaders).join(' ')
    const authMissing = resolveVariables(authValues, env).missing
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
    const proxyTemplate = String($corsProxy).trim()

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
      void saveRequestHistory(reqHistory)
      const name = responseName(method, resolvedUrl.resolved)
      addTabWithContent(name, text, guessMode(name, text))
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

  // ---- Params / Headers row editors ----
  function onUrlInput() {
    reqParams = parseQueryParams(reqUrl)
  }

  function onParamChange() {
    reqParams = [...reqParams]
    reqUrl = buildUrlWithQuery(reqUrl, reqParams)
  }

  function addParam() {
    reqParams = [...reqParams, { key: '', value: '', enabled: true }]
  }

  function removeParam(index: number) {
    reqParams = reqParams.filter((_, i) => i !== index)
    reqUrl = buildUrlWithQuery(reqUrl, reqParams)
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
  const REQ_TABS: Array<['params' | 'headers' | 'body' | 'auth' | 'env', string]> = [
    ['params', 'Params'],
    ['headers', 'Headers'],
    ['body', 'Body'],
    ['auth', 'Auth'],
    ['env', 'Env']
  ]
  const AUTH_METHODS: Array<['none' | 'bearer' | 'basic' | 'apikey', string, string]> = [
    ['none', 'None', 'No authentication header is sent'],
    ['bearer', 'Bearer', 'Adds Authorization: Bearer <token>'],
    ['basic', 'Basic', 'Adds Authorization: Basic (base64 of user:password)'],
    ['apikey', 'API Key', 'Adds a custom header with the key']
  ]

  /** Open the stored response as a new editor tab AND load the request into the form. */
  function openHistoryResponse(entry: RequestHistoryEntry) {
    loadRequestIntoForm(entry)
    if (!entry.responseText) {
      showDiskSaveLabel('Response not stored for this entry — loaded the request into the form')
      return
    }
    const name = responseName(entry.method, entry.url)
    addTabWithContent(name, entry.responseText, guessMode(name, entry.responseText))
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
      const resolvedUrl = resolveVariables(item.url, env).resolved
      const started = performance.now()
      try {
        const { res, viaProxy } = await fetchWithProxy(
          resolvedUrl,
          {
            method: item.method,
            headers: withContentType(
              parseHeadersText(resolveVariables(item.headers, env).resolved),
              ['GET', 'HEAD'].includes(item.method)
                ? undefined
                : resolveVariables(item.body, env).resolved
            ),
            body: ['GET', 'HEAD'].includes(item.method)
              ? undefined
              : resolveVariables(item.body, env).resolved
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
        addTabWithContent(name, text, guessMode(name, text))
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
      <label class="tb-label">Theme</label>
      <select class="tb-select" bind:value={$selectedTheme} on:change={refresh}
        >{#each themes as t}<option value={t.value}>{t.label}</option>{/each}</select
      >
    </div>
    <div class="tb-group">
      <label class="tb-label">Indent</label>
      <select class="tb-select" bind:value={$selectedIndent}
        >{#each indentations as i}<option value={i.value}>{i.label}</option>{/each}</select
      >
    </div>
    <div class="tb-group">
      <label class="tb-label">Parser</label>
      <select class="tb-select" bind:value={$selectedParserId}
        >{#each parsers as p}<option value={p.id}>{p.label}</option>{/each}</select
      >
    </div>
    <div class="tb-spacer" />
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
              title="Load a ready-to-run chain using the Rick and Morty API and open the Requests panel"
              on:click={loadChainSample}>⛓ Chain · Rick & Morty</button
            >
          </section>
        {/if}
      </aside>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="editor-area" on:dragover|preventDefault on:drop={onDropFiles}>
      <!-- TAB BAR -->
      <nav class="tab-bar">
        {#each tabIds as id, i (id)}
          <button
            class="tab"
            class:active={layoutLeaves.some((l) => l.tabIdx === i)}
            on:click={() => setActiveLeafTab(i)}
            on:dblclick={() => {
              const n = prompt('Rename:', tabTitles[i])
              if (n) renameTab(id, n)
            }}
            on:contextmenu|preventDefault={(e) =>
              (tabMenu = { x: e.clientX, y: e.clientY, tabId: id })}
            draggable="true"
            on:dragstart={(e) => onTabDragStart(e, id)}
            on:dragend={onTabDragEnd}
            on:dragover={(e) => onTabDragOverReorder(e, id)}
          >
            <span class="tab-dirty" class:dirty={dirtyFlags[i]}></span>
            <span class="tab-label">{tabTitles[i]}</span>
            <span
              class="tab-close"
              title="Close tab (or middle-click)"
              on:click|stopPropagation={() => closeTab(id)}
              on:auxclick|stopPropagation={(e) => {
                if (e.button === 1) closeTab(id)
              }}>×</span
            >
          </button>
        {/each}
        <button class="tab tab-add" on:click={addTab} title="New tab">+</button>
      </nav>

      {#if tabDragActive && layoutLeaves.length < 4}
        <div
          class="drop-zone dz-right"
          on:dragover|preventDefault
          on:drop={(e) => {
            e.preventDefault()
            if (draggedTabId !== undefined) splitActiveLeaf('vertical', draggedTabId)
          }}
        >
          Split right
        </div>
        <div
          class="drop-zone dz-bottom"
          on:dragover|preventDefault
          on:drop={(e) => {
            e.preventDefault()
            if (draggedTabId !== undefined) splitActiveLeaf('horizontal', draggedTabId)
          }}
        >
          Split down
        </div>
      {/if}

      <!-- PANES -->
      <div class="editor-panes" bind:this={panesEl}>
        {#each layoutRects.leaves as lr (lr.leafId)}
          {@const leaf = findLeaf(layout, lr.leafId) ?? layoutLeaves[0]}
          {@const i = leaf.tabIdx}
          <div
            class="editor-pane"
            style="left:{lr.x}%;top:{lr.y}%;width:{lr.width}%;height:{lr.height}%"
            on:mousedown={() => (activeLeafId = lr.leafId)}
            on:dragover={onPaneDragOver}
            on:drop={(e) => onPaneDrop(e, lr.leafId)}
          >
            {#if layoutLeaves.length > 1}
              <div class="pane-header">
                <button
                  class="pane-doc"
                  draggable="true"
                  title="Drag to another pane to move this document"
                  on:dragstart={(e) => onTabDragStart(e, tabIds[i])}
                  on:dragend={onTabDragEnd}
                >
                  <span class="tab-dirty" class:dirty={dirtyFlags[i]}></span>
                  <span class="pane-doc-name">{tabTitles[i]}</span>
                </button>
                {#if dirtyFlags[i]}
                  <button
                    class="pane-save"
                    title="Quick save to disk (Ctrl+S)"
                    on:click|stopPropagation={() => void saveToDisk(i)}>💾</button
                  >
                {/if}
              </div>
            {/if}
            <div class="editor-wrapper">
              {#if previewTabInfo.has(tabIds[i])}
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
                  onClose={() => closeTab(tabIds[i])}
                />
              {:else}
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
            <span class="requests-title">Requests</span>
            <div class="requests-proxy">
              <span
                class="req-label"
                title="CORS proxy: used as fallback when a direct request fails">🛡 Proxy</span
              >
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
            <span class="req-spacer"></span>
            <button
              class="problems-close"
              on:click={() => (showRequests = false)}
              title="Close requests panel">×</button
            >
          </div>

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
              placeholder="https://api.example.com/items"
              bind:value={reqUrl}
              on:input={onUrlInput}
              on:keydown={(e) => {
                if (e.key === 'Enter') void sendRequest()
              }}
            />
            <datalist id="req-url-history">
              {#each urlSuggestions as suggestion}<option value={suggestion}></option>{/each}
            </datalist>
            <button
              class="sb-btn-status req-send"
              disabled={reqSending}
              title="Send (Enter in the URL field)"
              on:click={() => void sendRequest()}>{reqSending ? 'Sending…' : 'Send'}</button
            >
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

          <!-- Chain (collapsible) -->
          <div class="req-chain">
            <div
              class="req-section-head"
              role="button"
              tabindex="0"
              on:click={() => ($chainOpen = !$chainOpen)}
              on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') $chainOpen = !$chainOpen
              }}
            >
              <span class="req-caret">{$chainOpen ? '▾' : '▸'}</span>
              <span class="req-label"
                >Chain{#if chainItems.length > 0}
                  ({chainItems.length}){/if}</span
              >
              <span class="req-spacer"></span>
              <button
                class="sb-btn-status"
                disabled={chainRunning || chainItems.length === 0}
                title="Run the chain"
                on:click|stopPropagation={() => void runChain()}
                >{chainRunning ? 'Running…' : '▶ Run'}</button
              >
            </div>
            {#if $chainOpen}
              <div class="req-chain-body">
                {#if chainItems.length === 0}
                  <div class="req-chain-empty">
                    <p class="req-note">
                      The chain runs several requests in sequence. Add the current request as a
                      step, then press Run.
                    </p>
                    <button
                      class="sb-btn-status"
                      title="Load a ready-to-run example chain: uses baseUrl from the environment and captures id into charId"
                      on:click={loadExampleChain}>⛓ Load example chain</button
                    >
                  </div>
                {:else}
                  <table class="req-rows req-chain-table">
                    <thead>
                      <tr><th>#</th><th>Method</th><th>URL</th><th>Capture</th><th></th></tr>
                    </thead>
                    <tbody>
                      {#each chainItems as item, ci (ci)}
                        <tr
                          class="req-chain-row"
                          class:editing={ci === editingChainIndex}
                          class:running={ci === chainRunningIndex}
                        >
                          <td>{ci + 1}</td>
                          <td><span class="req-method-tag">{item.method}</span></td>
                          <td class="req-chain-url">{item.url}</td>
                          <td>
                            {#if itemCaptureNames(item)}
                              <span class="req-capture-badge">→ {itemCaptureNames(item)}</span>
                            {:else}—{/if}
                          </td>
                          <td class="req-chain-actions">
                            <button
                              class="req-mini-btn"
                              title="Move step up"
                              disabled={ci === 0}
                              on:click={() => moveChainItem(ci, -1)}>↑</button
                            >
                            <button
                              class="req-mini-btn"
                              title="Move step down"
                              disabled={ci === chainItems.length - 1}
                              on:click={() => moveChainItem(ci, 1)}>↓</button
                            >
                            <button
                              class="req-mini-btn"
                              title="Edit this step (loads it into the form)"
                              on:click={() => editChainItem(ci)}>✎</button
                            >
                            <button
                              class="req-mini-btn"
                              title="Remove from chain"
                              on:click={() => removeFromChain(ci)}>×</button
                            >
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
                <div class="req-chain-toolbar">
                  {#if editingChainIndex >= 0}
                    <span class="req-note">Editing step {editingChainIndex + 1}:</span>
                    <input
                      class="req-capture"
                      type="text"
                      placeholder="capture paths (data.token, data.id)"
                      bind:value={capturePath}
                    />
                    <span class="req-arrow">→</span>
                    <input
                      class="req-capture req-var"
                      type="text"
                      placeholder="vars (token, userId)"
                      bind:value={captureVar}
                    />
                    <button class="sb-btn-status" title="Save this step" on:click={addToChain}
                      >✎ Update step</button
                    >
                    <button class="req-mini-btn" title="Stop editing" on:click={cancelChainEdit}
                      >Cancel</button
                    >
                  {:else}
                    <span class="req-note">Capture (optional):</span>
                    <input
                      class="req-capture"
                      type="text"
                      placeholder="capture paths (data.token, data.id)"
                      bind:value={capturePath}
                    />
                    <span class="req-arrow">→</span>
                    <input
                      class="req-capture req-var"
                      type="text"
                      placeholder="vars (token, userId)"
                      bind:value={captureVar}
                    />
                    <button
                      class="sb-btn-status"
                      title="Add current request to the execution chain"
                      on:click={addToChain}>⛓ Add step</button
                    >
                  {/if}
                  {#if chainItems.length > 0}
                    <button class="req-mini-btn" title="Clear chain" on:click={clearChain}
                      >Clear</button
                    >
                  {/if}
                </div>
                <p class="req-note">
                  Capture: save values from the step's JSON response into the environment — path in
                  the response (e.g. <code>data.token</code>) → variable name (e.g.
                  <code>token</code>).
                </p>
                {#each chainResults as result (result.method + result.url + result.durationMs)}
                  <span
                    class="req-chain-result"
                    class:ok={typeof result.status === 'number' && result.status < 400}
                    class:bad={result.status === 'error' ||
                      (typeof result.status === 'number' && result.status >= 400)}
                  >
                    {result.method}
                    {result.status} · {result.durationMs} ms{#if result.captured}
                      → {result.captured} ✓{/if}
                  </span>
                {/each}
              </div>
            {/if}
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

  {#if tabMenu}
    <TabContextMenu
      x={tabMenu.x}
      y={tabMenu.y}
      items={buildTabMenuItems(tabMenu.tabId)}
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

  .tab-bar {
    display: flex;
    align-items: center;
    background: $bg2;
    border-bottom: 1px solid $b;
    flex-shrink: 0;
    height: 34px;
    overflow-x: auto;
    user-select: none;
    &::-webkit-scrollbar {
      height: 3px;
    }
    &::-webkit-scrollbar-thumb {
      background: #555;
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
  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 0.5;
  }
  .tab-add {
    font-size: 16px;
    padding: 0 10px;
    color: $td;
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
    max-width: 100%;
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
    padding: 2px 8px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
  .requests-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: $td;
  }
  .requests-form {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    flex-shrink: 0;
  }
  .req-method {
    flex-shrink: 0;
  }
  .req-url {
    flex: 1;
    padding: 3px 6px;
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
  .req-send {
    flex-shrink: 0;
    &:disabled {
      opacity: 0.6;
      cursor: default;
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
