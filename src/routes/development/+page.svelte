<script lang="ts">
  import {
    type Content, type ContextMenuItem, createAjvValidator, EditableValue,
    isJSONContent, isTextContent, javascriptQueryLanguage, jmespathQueryLanguage,
    jsonQueryLanguage, jsonpathQueryLanguage, JSONEditor, type JSONEditorSelection,
    type JSONParser, lodashQueryLanguage, type MenuItem, Mode, type OnChangeStatus,
    ReadonlyValue, type RenderMenuContext, renderValue,
    type RenderValueComponentDescription, type RenderValueProps
  } from 'svelte-jsoneditor'
  import { useLocalStorage } from '$lib/utils/localStorageUtils.js'
  import { range } from 'lodash-es'
  import { mount } from 'svelte'
  import { parse, stringify } from 'lossless-json'
  import { parseJSONPath, stringifyJSONPath } from '$lib/utils/pathUtils.js'
  import { compileJSONPointer, parseJSONPointer, type JSONPath } from 'immutable-json-patch'

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
    { value: 2, label: '2' }, { value: 4, label: '4' }, { value: '\t', label: 'Tab' }
  ]
  interface ParserOption { id: string; value: JSONParser; label: string }
  const parsers: ParserOption[] = [
    { id: 'JSON', value: JSON, label: 'JSON' },
    { id: 'LosslessJSON', value: LosslessJSON, label: 'LosslessJSON' }
  ]
  const pathParsers = [
    { id: 'JSONPath', value: { parse: parseJSONPath, stringify: stringifyJSONPath }, label: 'JSONPath' },
    { id: 'JSONPointer', value: { parse: parseJSONPointer, stringify: compileJSONPointer }, label: 'JSONPointer' }
  ]
  const schema = {
    title: 'Employee', type: 'object',
    properties: { boolean: { type: 'boolean' }, array: { type: 'array', items: { type: 'number', minimum: 10 } } },
    required: ['foo']
  }
  const validator = createAjvValidator({ schema })

  // ============================================================
  // TAB + PANE STATE
  // ============================================================
  interface EditorTab {
    id: number; title: string; content: Content; mode: Mode
    selection: JSONEditorSelection | undefined; ref: JSONEditor | undefined
    revision: number
  }
  interface Pane {
    id: number; activeTabId: number
  }

  let tabIdCounter = 0
  let paneIdCounter = 0

  let tabs: EditorTab[] = [{
    id: tabIdCounter++, title: 'Editor 1',
    content: { text: defaultJson, json: undefined },
    mode: Mode.tree, selection: undefined, ref: undefined, revision: 0
  }]
  let panes: Pane[] = [{ id: paneIdCounter++, activeTabId: tabs[0].id }]
  let splitDir: 'vertical' | 'horizontal' = 'vertical'

  function getTab(id: number) { return tabs.find(t => t.id === id)! }

  // ---- Pane operations ----
  function addPane() {
    if (panes.length >= 4) return
    // Find a tab not currently active in any pane
    const usedIds = new Set(panes.map(p => p.activeTabId))
    const nextTab = tabs.find(t => !usedIds.has(t.id))
    const activeTabId = nextTab
      ? nextTab.id
      : (() => { // Create new empty tab
          const t: EditorTab = {
            id: tabIdCounter++, title: `Editor ${tabs.length + 1}`,
            content: { text: '{}', json: undefined },
            mode: Mode.tree, selection: undefined, ref: undefined, revision: 0
          }
          tabs = [...tabs, t]
          return t.id
        })()
    panes = [...panes, { id: paneIdCounter++, activeTabId }]
  }

  function removeLastPane() {
    if (panes.length <= 1) return
    panes = panes.slice(0, -1)
  }

  function toggleSplitDir() {
    splitDir = splitDir === 'vertical' ? 'horizontal' : 'vertical'
  }

  // ---- Tab operations ----
  function addTab() {
    const t: EditorTab = {
      id: tabIdCounter++, title: `Editor ${tabs.length + 1}`,
      content: { text: '{}', json: undefined },
      mode: Mode.tree, selection: undefined, ref: undefined, revision: 0
    }
    tabs = [...tabs, t]
    // Make it active in the first pane
    panes[0].activeTabId = t.id
    panes = [...panes]
  }

  function closeTab(tabId: number) {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex(t => t.id === tabId)
    tabs = tabs.filter(t => t.id !== tabId)
    // Update any pane that had this tab active
    panes = panes.map(p => {
      if (p.activeTabId === tabId) {
        // Find another tab (prefer adjacent)
        const newIdx = Math.min(idx, tabs.length - 1)
        return { ...p, activeTabId: tabs[newIdx]?.id ?? p.activeTabId }
      }
      return p
    })
  }

  function renameTab(id: number, title: string) {
    tabs = tabs.map(t => t.id === id ? { ...t, title } : t)
  }

  // ---- Drag tab between panes ----
  function onTabDragStart(e: DragEvent, tabId: number) {
    e.dataTransfer!.setData('text/plain', String(tabId))
    e.dataTransfer!.effectAllowed = 'move'
  }

  function onPaneDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
  }

  function onPaneDrop(e: DragEvent, paneId: number) {
    e.preventDefault()
    const tabId = Number(e.dataTransfer!.getData('text/plain'))
    if (!tabId || !tabs.find(t => t.id === tabId)) return
    panes = panes.map(p => p.id === paneId ? { ...p, activeTabId: tabId } : p)
  }

  // ---- Settings ----
  const showSidebar = useLocalStorage('svelte-jsoneditor-demo-sidebar', true)
  const selectedTheme = useLocalStorage('svelte-jsoneditor-demo-theme', themes[0].value)
  const selectedIndent = useLocalStorage('svelte-jsoneditor-demo-indentation', indentations[0].value)
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
    ? [jsonQueryLanguage, jmespathQueryLanguage, jsonpathQueryLanguage, javascriptQueryLanguage, lodashQueryLanguage]
    : [jsonQueryLanguage]
  let queryLangId = jsonQueryLanguage.id
  $: selParser = parsers.find(p => p.id === $selectedParserId)?.value ?? JSON
  $: selPath = pathParsers.find(p => p.id === $selectedPathId)?.value ?? pathParsers[0].value
  $: selValidator = $validateDoc ? validator : undefined

  function refresh() { tabs.forEach(t => t.ref?.refresh()) }

  function customRenderValue(props: RenderValueProps): RenderValueComponentDescription[] {
    return props.isEditing ? [{ component: EditableValue, props }] : [{ component: ReadonlyValue, props }]
  }

  function onRenderMenu(items: MenuItem[]) { return items }
  function onRenderContextMenu(items: ContextMenuItem[]) { return items }
  function onChangeQueryLanguage(id: string) { queryLangId = id }

  // ---- Diff / Compare ----
  let diffMode = false

  function bumpRevision(tabId: number) {
    tabs = tabs.map(t => t.id === tabId ? { ...t, revision: t.revision + 1 } : t)
  }

  function touched(tabId: number): number {
    return tabs.find(t => t.id === tabId)?.revision ?? 0
  }

  $: diffRevision = touched(panes[0]?.activeTabId ?? 0) + touched(panes[1]?.activeTabId ?? 0)
  $: diffPaths = diffMode && panes.length >= 2 && diffRevision
    ? computeDiff(
        getTab(panes[0].activeTabId)?.content,
        getTab(panes[1].activeTabId)?.content
      )
    : new Set<string>()

  // Auto-switch to tree mode when comparing (so highlights are visible)
  $: if (diffMode && panes.length >= 2) {
    const t0 = getTab(panes[0].activeTabId)
    const t1 = getTab(panes[1].activeTabId)
    if (t0?.mode === Mode.text || t1?.mode === Mode.text) {
      tabs = tabs.map(t => {
        if ((t.id === t0?.id || t.id === t1?.id) && t.mode === Mode.text) {
          return { ...t, mode: Mode.tree }
        }
        return t
      })
    }
  }

  function computeDiff(a: Content | undefined, b: Content | undefined): Set<string> {
    const paths = new Set<string>()
    if (!a || !b) return paths
    const ja = isJSONContent(a) ? a.json : (() => { try { return JSON.parse(a.text ?? '') } catch { return a.text } })()
    const jb = isJSONContent(b) ? b.json : (() => { try { return JSON.parse(b.text ?? '') } catch { return b.text } })()
    diffObjects(ja, jb, '', paths)
    return paths
  }

  function diffObjects(a: unknown, b: unknown, prefix: string, paths: Set<string>) {
    if (a === b) return
    if (a === undefined || b === undefined) { paths.add(prefix); return }
    if (typeof a !== typeof b) { paths.add(prefix); return }
    if (typeof a !== 'object' || a === null || b === null) { paths.add(prefix); return }
    if (Array.isArray(a) !== Array.isArray(b)) { paths.add(prefix); return }

    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])

    for (const key of allKeys) {
      const childPath = prefix ? `${prefix}/${key}` : `/${key}`
      if (!(key in aObj)) { paths.add(childPath); continue }
      if (!(key in bObj)) { paths.add(childPath); continue }
      diffObjects(aObj[key], bObj[key], childPath, paths)
    }
  }

  function onClassNameDiff(path: JSONPath, _value: unknown): string | undefined {
    if (!diffMode || diffPaths.size === 0) return undefined
    const pathStr = '/' + path.map((p: string | number) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
    // Check exact path and parent paths
    for (const dp of diffPaths) {
      if (pathStr === dp || pathStr.startsWith(dp + '/') || dp.startsWith(pathStr + '/')) {
        return 'jse-diff-changed'
      }
    }
    return undefined
  }

  // ---- File operations ----
  function handleOpenFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      if (!e.target) return
      const tab = getTab(panes[0].activeTabId)
      tab.content = { text: String(e.target.result), json: undefined }
      tabs = [...tabs]
    }
    reader.readAsText(file)
  }

  function downloadJson() {
    const tab = getTab(panes[0].activeTabId)
    const text = isJSONContent(tab.content)
      ? (selParser.stringify(tab.content.json, null, $selectedIndent as number) ?? '')
      : tab.content.text ?? ''
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${tab.title.replace(/\s+/g, '_')}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  function openInWindow() {
    const tab = getTab(panes[0].activeTabId)
    const w = window.open('', '_blank', 'width=900,height=700,left=100,top=50')
    if (!w) return
    w.document.title = `${tab.title} — JSON Editor`

    // Copy all stylesheets and styles from main document to popup
    const mainDoc = document
    for (const node of Array.from(mainDoc.querySelectorAll('link[rel="stylesheet"], style'))) {
      w.document.head.appendChild(node.cloneNode(true))
    }
    // Ensure body fills viewport
    w.document.body.className = $selectedTheme
    const style = w.document.createElement('style')
    style.textContent = 'body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}'
    w.document.head.appendChild(style)

    mount(JSONEditor, {
      target: w.document.body,
      props: {
        content: tab.content,
        mode: tab.mode,
        mainMenuBar: true, navigationBar: true, statusBar: true
      }
    })
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
    const tab = getTab(panes[0].activeTabId)
    tab.content = s; tabs = [...tabs]
  }
</script>

<svelte:head><title>JSON Editor — Dev</title></svelte:head>

<div class="app-shell {$selectedTheme}">
  <!-- TOOLBAR -->
  <header class="toolbar">
    <button class="tb-btn" on:click={() => ($showSidebar = !$showSidebar)} title="Sidebar">☰</button>
    <span class="tb-brand">JSON Editor</span>
    <div class="tb-group">
      <label class="tb-label">Theme</label>
      <select class="tb-select" bind:value={$selectedTheme} on:change={refresh}>{#each themes as t}<option value={t.value}>{t.label}</option>{/each}</select>
    </div>
    <div class="tb-group">
      <label class="tb-label">Indent</label>
      <select class="tb-select" bind:value={$selectedIndent}>{#each indentations as i}<option value={i.value}>{i.label}</option>{/each}</select>
    </div>
    <div class="tb-group">
      <label class="tb-label">Parser</label>
      <select class="tb-select" bind:value={$selectedParserId}>{#each parsers as p}<option value={p.id}>{p.label}</option>{/each}</select>
    </div>
    <div class="tb-spacer" />
    <div class="tb-group">
      <button class="tb-btn" on:click={addPane} title="Split pane">▦{panes.length}</button>
      <button class="tb-btn" on:click={removeLastPane} title="Remove split">◫</button>
      <button class="tb-btn" on:click={toggleSplitDir} title="Toggle direction">{splitDir === 'vertical' ? '⬍' : '⬌'}</button>
    </div>
    <button class="tb-btn" on:click={openInWindow} title="Popout">↗</button>
    <button class="tb-btn" on:click={downloadJson} title="Download JSON">⬇</button>
    <label class="tb-btn" title="Open file">📂<input type="file" on:change={handleOpenFile} style="display:none" /></label>
  </header>

  <!-- MAIN -->
  <div class="main-area">
    {#if $showSidebar}
      <aside class="sidebar">
        <section class="sb-section">
          <h3 class="sb-title">Editor</h3>
          <label class="sb-check"><input type="checkbox" bind:checked={$readOnly} /> Read only</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$mainMenuBar} /> Main menu</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$navigationBar} /> Navigation</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$statusBar} /> Status bar</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$askToFormat} /> Ask to format</label>
        </section>
        <section class="sb-section">
          <h3 class="sb-title">Validation</h3>
          <label class="sb-check"><input type="checkbox" bind:checked={$validateDoc} /> JSON Schema</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$customRenderer} /> Custom renderer</label>
          <label class="sb-check"><input type="checkbox" bind:checked={diffMode} /> Compare panes (diff)</label>
        </section>
        <section class="sb-section">
          <h3 class="sb-title">Text</h3>
          <label class="sb-check"><input type="checkbox" bind:checked={$escapeCtrl} /> Escape ctrl</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$escapeUni} /> Escape unicode</label>
          <label class="sb-check"><input type="checkbox" bind:checked={$flatten} /> Flatten cols</label>
          <div class="sb-row"><label>Tab size</label><input class="sb-input" type="number" bind:value={$tabSz} min="1" max="8" /></div>
          <div class="sb-row" style="margin-top:4px"><label>Multi query</label><input type="checkbox" bind:checked={$multiQuery} /></div>
        </section>
        <section class="sb-section">
          <h3 class="sb-title">Load Sample</h3>
          <button class="sb-btn" on:click={() => loadSample('array')}>Array</button>
          <button class="sb-btn" on:click={() => loadSample('object')}>Object</button>
          <button class="sb-btn" on:click={() => loadSample('long')}>Long Array</button>
          <button class="sb-btn" on:click={() => loadSample('empty')}>Empty Text</button>
          <button class="sb-btn" on:click={() => loadSample('invalid')}>Invalid JSON</button>
        </section>
      </aside>
    {/if}

    <div class="editor-area">
      <!-- TAB BAR -->
      <nav class="tab-bar">
        {#each tabs as tab}
          <button
            class="tab" class:active={panes.some(p => p.activeTabId === tab.id)}
            on:click={() => { panes = panes.map((p, i) => i === 0 ? { ...p, activeTabId: tab.id } : p) }}
            on:dblclick={() => { const n = prompt('Rename:', tab.title); if (n) renameTab(tab.id, n) }}
            draggable="true"
            on:dragstart={(e) => onTabDragStart(e, tab.id)}
          >
            <span class="tab-label">{tab.title}</span>
            {#if tabs.length > 1}
              <span class="tab-close" on:click|stopPropagation={() => closeTab(tab.id)}>×</span>
            {/if}
          </button>
        {/each}
        <button class="tab tab-add" on:click={addTab} title="New tab">+</button>
        <div class="tab-mode">
          {#each Object.values(Mode) as m}
            {@const active = getTab(panes[0].activeTabId)}
            <button class="mode-btn" class:active={active?.mode === m}
              on:click={() => { if (active) { tabs = tabs.map(t => t.id === active.id ? { ...t, mode: m } : t) } }}>{m}</button>
          {/each}
        </div>
      </nav>

      <!-- PANES -->
      <div class="editor-panes" class:split-h={splitDir === 'horizontal' && panes.length > 1} class:split-v={splitDir === 'vertical' && panes.length > 1}>
        {#each panes as pane (pane.id)}
          {@const tab = getTab(pane.activeTabId)}
          <div class="editor-pane"
            on:dragover={onPaneDragOver}
            on:drop={(e) => onPaneDrop(e, pane.id)}
          >
            {#if panes.length > 1}
              <div class="pane-tab-strip">
                {#each tabs as t}
                  <button class="pane-tab" class:active={t.id === pane.activeTabId}
                    on:click={() => { panes = panes.map(p => p.id === pane.id ? { ...p, activeTabId: t.id } : p) }}
                  >{t.title}</button>
                {/each}
              </div>
            {/if}
            <div class="editor-wrapper">
              {#if tab}
                <form novalidate action="/" class="editor-form">
                  <JSONEditor
                    bind:this={tab.ref} bind:content={tab.content}
                    bind:selection={tab.selection} mode={tab.mode}
                    mainMenuBar={$mainMenuBar} navigationBar={$navigationBar}
                    statusBar={$statusBar} askToFormat={$askToFormat}
                    escapeControlCharacters={$escapeCtrl}
                    escapeUnicodeCharacters={$escapeUni}
                    flattenColumns={$flatten} readOnly={$readOnly}
                    indentation={$selectedIndent} tabSize={$tabSz}
                    parser={selParser} pathParser={selPath}
                    validator={selValidator}
                    queryLanguages={queryLangs} bind:queryLanguageId={queryLangId}
                    onRenderValue={$customRenderer ? customRenderValue : renderValue}
                    onClassName={diffMode ? onClassNameDiff : undefined}
                    onChange={() => bumpRevision(tab.id)}
                    onChangeMode={(m: Mode) => { tabs = tabs.map(t => t.id === tab.id ? { ...t, mode: m } : t) }}
                    {onRenderMenu} {onRenderContextMenu} {onChangeQueryLanguage}
                  />
                </form>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- STATUS -->
      <footer class="status-bar">
        <span>{getTab(panes[0].activeTabId)?.mode ?? '—'}</span>
        <span>{queryLangId}</span>
        <span class="sb-spacer"></span>
        <span>Tabs: {tabs.length} · Panes: {panes.length}</span>
      </footer>
    </div>
  </div>
</div>

{#if false}<slot />{/if}

<style lang="scss">
  @import '../../lib/themes/jse-theme-dark.css';
  @import '../themes/jse-theme-big.css';

  $bg: #1e1e1e; $bg2: #252526; $bg3: #323233; $b: #3e3e42;
  $t: #cccccc; $td: #888; $ac: #0078d4;

  .app-shell { position:fixed;inset:0;display:flex;flex-direction:column;background:$bg;color:$t;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;overflow:hidden; }

  .toolbar { display:flex;align-items:center;gap:6px;padding:4px 8px;background:$bg3;border-bottom:1px solid $b;flex-shrink:0;height:36px;user-select:none; }
  .tb-brand { font-weight:700;font-size:13px;color:#fff;margin-right:12px;letter-spacing:-0.3px; }
  .tb-group { display:flex;align-items:center;gap:3px; }
  .tb-label { font-size:10px;color:$td;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap; }
  .tb-select { padding:1px 4px;font-size:11px;background:$bg;color:$t;border:1px solid $b;border-radius:3px;outline:none;&:focus{border-color:$ac;} }
  .tb-btn { display:flex;align-items:center;justify-content:center;width:28px;height:26px;border:none;background:transparent;color:$t;font-size:14px;cursor:pointer;border-radius:3px;&:hover{background:rgba(255,255,255,0.08);} }
  .tb-spacer { flex:1; }

  .main-area { flex:1;display:flex;overflow:hidden;min-height:0; }
  .sidebar { width:190px;flex-shrink:0;background:$bg2;border-right:1px solid $b;overflow-y:auto;padding:8px 0;&::-webkit-scrollbar{width:6px;}&::-webkit-scrollbar-thumb{background:#555;border-radius:3px;} }
  .sb-section { padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.04);&:last-child{border-bottom:none;} }
  .sb-title { font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:$td;margin:0 0 6px 0;font-weight:600; }
  .sb-check { display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;cursor:pointer;input{accent-color:$ac;} }
  .sb-row { display:flex;align-items:center;justify-content:space-between;padding:2px 0;font-size:12px;gap:6px; }
  .sb-input { width:50px;padding:2px 4px;font-size:11px;background:$bg;color:$t;border:1px solid $b;border-radius:3px;text-align:center; }
  .sb-btn { display:block;width:100%;padding:3px 8px;margin:2px 0;font-size:11px;background:transparent;color:$t;border:1px solid $b;border-radius:3px;cursor:pointer;text-align:left;&:hover{background:rgba(255,255,255,0.06);} }

  .editor-area { flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0; }

  .tab-bar { display:flex;align-items:center;background:$bg2;border-bottom:1px solid $b;flex-shrink:0;height:34px;overflow-x:auto;user-select:none;&::-webkit-scrollbar{height:3px;}&::-webkit-scrollbar-thumb{background:#555;} }
  .tab { display:flex;align-items:center;gap:4px;padding:0 12px;height:100%;border:none;background:#2d2d2d;color:$td;font-size:12px;cursor:pointer;border-right:1px solid $b;white-space:nowrap;flex-shrink:0;transition:background 0.1s;
    &.active { background:#1e1e1e;color:#fff;border-bottom:2px solid $ac; }
    &:hover:not(.active) { background:#353535; }
  }
  .tab-label { max-width:140px;overflow:hidden;text-overflow:ellipsis; }
  .tab-close { font-size:14px;opacity:0.4;width:16px;text-align:center;border-radius:2px;&:hover{opacity:1;background:rgba(255,255,255,0.1);} }
  .tab-add { font-size:16px;padding:0 10px;color:$td;&:hover{color:#fff;} }
  .tab-mode { display:flex;margin-left:auto;padding-right:8px;gap:1px;flex-shrink:0; }
  .mode-btn { padding:2px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;border:1px solid $b;background:transparent;color:$td;cursor:pointer;border-radius:2px;&:first-child{border-radius:3px 0 0 3px;}&:last-child{border-radius:0 3px 3px 0;}
    &.active { background:$ac;color:#fff;border-color:$ac; }
    &:hover:not(.active) { background:rgba(255,255,255,0.05); }
  }

  .editor-panes { flex:1;display:flex;overflow:hidden;min-height:0;&.split-h{flex-direction:row;}&.split-v{flex-direction:column;} }
  .editor-pane { flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid $b;&:last-child{border-right:none;} }
  .pane-tab-strip { display:flex;background:#1a1a1a;border-bottom:1px solid $b;flex-shrink:0;height:28px;overflow-x:auto;&::-webkit-scrollbar{height:2px;} }
  .pane-tab { padding:0 10px;height:100%;border:none;background:transparent;color:$td;font-size:11px;cursor:pointer;border-right:1px solid $b;white-space:nowrap;flex-shrink:0;
    &.active { background:$bg;color:#fff; }
    &:hover:not(.active) { background:rgba(255,255,255,0.04); }
  }
  .editor-wrapper { flex:1;display:flex;min-width:0;min-height:0; }
  .editor-form { flex:1;display:flex;min-width:0;min-height:0; }

  .status-bar { display:flex;align-items:center;padding:0 10px;height:22px;background:$ac;color:#fff;font-size:11px;flex-shrink:0;gap:16px; }
  .sb-spacer { flex:1; }

  // Diff highlighting
  :global(.jse-diff-changed) {
    background: rgba(255, 200, 0, 0.15) !important;
    border-left: 3px solid #ffc800 !important;
  }
</style>
