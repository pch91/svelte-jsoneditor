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
  // TAB + PANE STATE — flat parallel arrays for reliable Svelte bind:
  // ============================================================
  interface Pane { id: number; tabIdx: number }

  let tabIds: number[] = [1]
  let tabTitles: string[] = ['Editor 1']
  let tabContents: Content[] = [{ text: defaultJson, json: undefined }]
  let tabModes: Mode[] = [Mode.tree]
  let tabSelections: (JSONEditorSelection | undefined)[] = [undefined]
  let tabRefs: (JSONEditor | undefined)[] = [undefined]
  let tabRevisions: number[] = [0]
  let nextTabId = 2

  let panes: Pane[] = [{ id: 1, tabIdx: 0 }]
  let nextPaneId = 2
  let splitDir: 'vertical' | 'horizontal' = 'vertical'

  function getTabIdx(tabId: number): number { return tabIds.indexOf(tabId) }

  // ---- Pane operations ----
  function addPane() {
    if (panes.length >= 4) return
    const used = new Set(panes.map(p => p.tabIdx))
    let idx = tabIds.findIndex((_, i) => !used.has(i))
    if (idx === -1) { addTab(); idx = tabIds.length - 1 }
    panes = [...panes, { id: nextPaneId++, tabIdx: idx }]
  }
  function removeLastPane() { if (panes.length > 1) panes = panes.slice(0, -1) }
  function toggleSplitDir() { splitDir = splitDir === 'vertical' ? 'horizontal' : 'vertical' }

  // ---- Tab operations ----
  function addTab() {
    tabIds = [...tabIds, nextTabId++]
    tabTitles = [...tabTitles, `Editor ${tabIds.length}`]
    tabContents = [...tabContents, { text: '{}', json: undefined }]
    tabModes = [...tabModes, Mode.tree]
    tabSelections = [...tabSelections, undefined]
    tabRefs = [...tabRefs, undefined]
    tabRevisions = [...tabRevisions, 0]
    panes = panes.map((p, i) => i === 0 ? { ...p, tabIdx: tabIds.length - 1 } : p)
  }

  function closeTab(tabId: number) {
    const idx = getTabIdx(tabId)
    if (idx === -1 || tabIds.length <= 1) return
    tabIds = tabIds.filter((_, i) => i !== idx)
    tabTitles = tabTitles.filter((_, i) => i !== idx)
    tabContents = tabContents.filter((_, i) => i !== idx)
    tabModes = tabModes.filter((_, i) => i !== idx)
    tabSelections = tabSelections.filter((_, i) => i !== idx)
    tabRefs = tabRefs.filter((_, i) => i !== idx)
    tabRevisions = tabRevisions.filter((_, i) => i !== idx)
    panes = panes.map(p => ({ ...p, tabIdx: p.tabIdx > idx ? p.tabIdx - 1 : p.tabIdx === idx ? Math.min(idx, tabIds.length - 1) : p.tabIdx }))
  }

  function renameTab(tabId: number, title: string) {
    const idx = getTabIdx(tabId)
    if (idx === -1) return
    tabTitles[idx] = title; tabTitles = [...tabTitles]
  }

  // ---- Drag tab between panes ----
  function onTabDragStart(e: DragEvent, tabId: number) {
    e.dataTransfer!.setData('text/plain', String(tabId))
    e.dataTransfer!.effectAllowed = 'move'
  }
  function onPaneDragOver(e: DragEvent) { e.preventDefault(); e.dataTransfer!.dropEffect = 'move' }
  function onPaneDrop(e: DragEvent, paneId: number) {
    e.preventDefault()
    const tabId = Number(e.dataTransfer!.getData('text/plain'))
    const idx = getTabIdx(tabId)
    if (idx === -1) return
    panes = panes.map(p => p.id === paneId ? { ...p, tabIdx: idx } : p)
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

  function refresh() { tabRefs.forEach(r => r?.refresh()) }

  function customRenderValue(props: RenderValueProps): RenderValueComponentDescription[] {
    return props.isEditing ? [{ component: EditableValue, props }] : [{ component: ReadonlyValue, props }]
  }

  function onRenderMenu(items: MenuItem[]) { return items }
  function onRenderContextMenu(items: ContextMenuItem[]) { return items }
  function onChangeQueryLanguage(id: string) { queryLangId = id }

  // ---- Diff / Compare ----
  let diffMode = false

  function bumpRevision(tabIdx: number) {
    tabRevisions[tabIdx]++; tabRevisions = [...tabRevisions]
  }

  $: diffRevision = tabRevisions[panes[0]?.tabIdx ?? 0] + tabRevisions[panes[1]?.tabIdx ?? 0]
  $: diffPaths = diffMode && panes.length >= 2 && diffRevision
    ? computeDiff(tabContents[panes[0].tabIdx], tabContents[panes[1].tabIdx])
    : new Set<string>()

  // Auto-switch to tree mode when comparing
  $: if (diffMode && panes.length >= 2) {
    for (const pane of panes.slice(0, 2)) {
      if (tabModes[pane.tabIdx] === Mode.text) {
        tabModes[pane.tabIdx] = Mode.tree; tabModes = [...tabModes]
      }
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
      const i = panes[0].tabIdx
      tabContents[i] = { text: String(e.target.result), json: undefined }; tabContents = [...tabContents]
    }
    reader.readAsText(file)
  }

  function downloadJson() {
    const i = panes[0].tabIdx
    const c = tabContents[i]
    const text = isJSONContent(c) ? (selParser.stringify(c.json, null, $selectedIndent as number) ?? '') : c.text ?? ''
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${tabTitles[i].replace(/\s+/g, '_')}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  function openInWindow() {
    const i = panes[0].tabIdx
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
    mount(JSONEditor, { target: w.document.body, props: { content: tabContents[i], mode: tabModes[i], mainMenuBar: true, navigationBar: true, statusBar: true } })
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
    const s = samples[name]; if (!s) return
    const i = panes[0].tabIdx
    tabContents[i] = s; tabContents = [...tabContents]
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
        {#each tabIds as id, i (id)}
          <button
            class="tab" class:active={panes.some(p => p.tabIdx === i)}
            on:click={() => { panes = panes.map((p, j) => j === 0 ? { ...p, tabIdx: i } : p) }}
            on:dblclick={() => { const n = prompt('Rename:', tabTitles[i]); if (n) renameTab(id, n) }}
            draggable="true"
            on:dragstart={(e) => onTabDragStart(e, id)}
          >
            <span class="tab-label">{tabTitles[i]}</span>
            {#if tabIds.length > 1}
              <span class="tab-close" on:click|stopPropagation={() => closeTab(id)}>×</span>
            {/if}
          </button>
        {/each}
        <button class="tab tab-add" on:click={addTab} title="New tab">+</button>
        <div class="tab-mode">
          {#each Object.values(Mode) as m}
            <button class="mode-btn" class:active={tabModes[panes[0].tabIdx] === m}
              on:click={() => { tabModes[panes[0].tabIdx] = m; tabModes = [...tabModes] }}>{m}</button>
          {/each}
        </div>
      </nav>

      <!-- PANES -->
      <div class="editor-panes" class:split-h={splitDir === 'horizontal' && panes.length > 1} class:split-v={splitDir === 'vertical' && panes.length > 1}>
        {#each panes as pane (pane.id)}
          {@const i = pane.tabIdx}
          <div class="editor-pane"
            on:dragover={onPaneDragOver}
            on:drop={(e) => onPaneDrop(e, pane.id)}
          >
            {#if panes.length > 1}
              <div class="pane-tab-strip">
                {#each tabIds as tid, j (tid)}
                  <button class="pane-tab" class:active={j === i}
                    on:click={() => { panes = panes.map(p => p.id === pane.id ? { ...p, tabIdx: j } : p) }}
                  >{tabTitles[j]}</button>
                {/each}
              </div>
            {/if}
            <div class="editor-wrapper">
              <form novalidate action="/" class="editor-form">
                <JSONEditor
                  bind:this={tabRefs[i]} bind:content={tabContents[i]}
                  bind:selection={tabSelections[i]} mode={tabModes[i]}
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
                  onChange={() => bumpRevision(i)}
                  onChangeMode={(m: Mode) => { tabModes[i] = m; tabModes = [...tabModes] }}
                  {onRenderMenu} {onRenderContextMenu} {onChangeQueryLanguage}
                />
              </form>
            </div>
          </div>
        {/each}
      </div>

      <!-- STATUS -->
      <footer class="status-bar">
        <span>{tabModes[panes[0].tabIdx]}</span>
        <span>{queryLangId}</span>
        <span class="sb-spacer"></span>
        <span>Tabs: {tabIds.length} · Panes: {panes.length}</span>
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
