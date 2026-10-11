<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    Content,
    JSONParser,
    JSONPatchResult,
    OnChange,
    OnChangeMode,
    OnRenderMenuInternal,
    MenuItem,
    CompareDocumentItem
  } from '$lib/types.js'
  import Menu from '../../controls/Menu.svelte'
  import { isJSONContent } from '$lib/utils/jsonUtils.js'
  import {
    computeSemanticDiffReport,
    applyMergeChunk,
    contentToValue,
    computeInlineDiff,
    formatValuePreview,
    type DiffChunk,
    type DiffReport,
    type InlineDiffPart
  } from '$lib/logic/diffUtils.js'

  export let externalContent: Content
  export let readOnly = false
  export let mainMenuBar = true
  export let parser: JSONParser = JSON
  export let indentation: number | string = 2
  export let compareDocuments: CompareDocumentItem[] = []
  export let compareTargetId: number | string | undefined = undefined
  export let onSelectTargetDocument: ((targetId: number | string) => void) | undefined = undefined
  export let draggedSubTabId: number | undefined = undefined
  export let onChange: OnChange = () => {}
  export let onChangeMode: OnChangeMode = () => {}
  export let onRenderMenu: OnRenderMenuInternal = (items) => items
  export let onUpdateTargetDocument: (
    targetId: number | string,
    newContent: Content
  ) => void = () => {}

  $: void onChangeMode

  // Compare Target selection
  let selectedTargetId: number | string = compareTargetId ?? compareDocuments[0]?.id ?? ''
  let customTargetText = ''
  let isCustomTarget = false

  $: if (compareTargetId !== undefined && compareTargetId !== selectedTargetId) {
    selectedTargetId = compareTargetId
  }

  function selectTarget(targetId: number | string) {
    selectedTargetId = targetId
    compareTargetId = targetId
    onSelectTargetDocument?.(targetId)
  }

  onMount(() => {
    if (selectedTargetId !== '' && selectedTargetId !== undefined) {
      onSelectTargetDocument?.(selectedTargetId)
    }
  })

  $: {
    if (selectedTargetId === '__custom__') {
      isCustomTarget = true
    } else {
      isCustomTarget = false
      if (!selectedTargetId && compareDocuments.length > 0) {
        selectedTargetId = compareDocuments[0].id
        onSelectTargetDocument?.(selectedTargetId)
      }
    }
  }

  $: targetDoc = compareDocuments.find((d) => String(d.id) === String(selectedTargetId))

  // Target Drop & Selection State
  let isHeaderDropOver = false
  let isToolbarDropOver = false
  let targetDropFeedback: { type: 'success' | 'error'; message: string } | null = null
  let targetDropFeedbackTimer: ReturnType<typeof setTimeout> | undefined

  function showDropFeedback(type: 'success' | 'error', message: string) {
    if (targetDropFeedbackTimer) clearTimeout(targetDropFeedbackTimer)
    targetDropFeedback = { type, message }
    targetDropFeedbackTimer = setTimeout(() => {
      targetDropFeedback = null
    }, 2800)
  }

  $: isDraggingSubTab = draggedSubTabId !== undefined
  $: isDraggedValid =
    draggedSubTabId !== undefined &&
    compareDocuments.some((d) => String(d.id) === String(draggedSubTabId))

  function handleToolbarDragOver(e: DragEvent) {
    if (draggingChunk) return
    e.preventDefault()
    isToolbarDropOver = true
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  function handleToolbarDragLeave() {
    isToolbarDropOver = false
  }

  function handleHeaderDragOver(e: DragEvent) {
    if (draggingChunk) return
    e.preventDefault()
    isHeaderDropOver = true
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  function handleHeaderDragLeave() {
    isHeaderDropOver = false
  }

  function handleTargetDrop(e: DragEvent) {
    if (draggingChunk) return
    e.preventDefault()
    e.stopPropagation()
    isHeaderDropOver = false
    isToolbarDropOver = false

    const rawId =
      e.dataTransfer?.getData('application/x-subtab-id') ||
      e.dataTransfer?.getData('text/plain') ||
      (draggedSubTabId !== undefined ? String(draggedSubTabId) : '')

    if (!rawId) return

    const matchedDoc = compareDocuments.find((d) => String(d.id) === String(rawId))
    if (matchedDoc) {
      selectTarget(matchedDoc.id)
      showDropFeedback('success', `Comparing with "${matchedDoc.title}" ✓`)
    } else {
      showDropFeedback(
        'error',
        'Cannot compare: only sub-tabs in the same group (Level 1) can be compared.'
      )
    }
  }

  // Resizable columns
  let splitPercent = 50
  let isResizing = false
  let viewportEl: HTMLElement

  function startGutterResize(e: MouseEvent) {
    e.preventDefault()
    isResizing = true

    function onMouseMove(moveEvent: MouseEvent) {
      if (!viewportEl) return
      const rect = viewportEl.getBoundingClientRect()
      const newPercent = ((moveEvent.clientX - rect.left) / rect.width) * 100
      splitPercent = Math.max(20, Math.min(80, Math.round(newPercent * 10) / 10))
    }

    function onMouseUp() {
      isResizing = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // Diff Options
  let ignoreKeyOrder = true
  let matchById = true
  let filterType: 'all' | 'diffs' | 'added' | 'removed' | 'modified' | 'reordered' = 'all'
  let searchQuery = ''

  // Drag-and-drop state
  let draggingChunk: DiffChunk | null = null
  let dragOrigin: 'source' | 'target' | null = null

  // Values
  $: sourceVal = contentToValue(externalContent)
  $: targetVal = isCustomTarget ? parseText(customTargetText) : contentToValue(targetDoc?.content)

  function parseText(text: string): unknown {
    try {
      return parser.parse(text)
    } catch {
      return text
    }
  }

  function valueToContent(val: unknown): Content {
    if (val === undefined) return { text: '' }
    if (isJSONContent(externalContent)) {
      return { json: val }
    }
    try {
      return { text: JSON.stringify(val, null, indentation) }
    } catch {
      return { text: String(val) }
    }
  }

  // Reactive diff report
  let report: DiffReport
  $: report = computeSemanticDiffReport(sourceVal, targetVal, { ignoreKeyOrder, matchById })

  // Filtered chunks
  $: filteredChunks = report.chunks.filter((chunk) => {
    if (
      filterType === 'diffs' &&
      chunk.type === 'modified' &&
      JSON.stringify(chunk.sourceValue) === JSON.stringify(chunk.targetValue)
    ) {
      return false
    }
    if (filterType !== 'all' && filterType !== 'diffs' && chunk.type !== filterType) {
      return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const pathMatch =
        chunk.path.toLowerCase().includes(q) ||
        (chunk.sourcePath ? chunk.sourcePath.toLowerCase().includes(q) : false) ||
        (chunk.targetPath ? chunk.targetPath.toLowerCase().includes(q) : false)
      const keyMatch = String(chunk.keyOrIndex).toLowerCase().includes(q)
      const summaryMatch = chunk.summary.toLowerCase().includes(q)
      return pathMatch || keyMatch || summaryMatch
    }
    return true
  })

  // Merge chunk actions
  function handleMergeSingle(chunk: DiffChunk, direction: 'sourceToTarget' | 'targetToSource') {
    if (direction === 'targetToSource') {
      // Pulling from target into current file
      if (readOnly) return
      const merged = applyMergeChunk(sourceVal, chunk, 'targetToSource')
      const newContent = valueToContent(merged)
      if (onChange) {
        onChange(newContent, externalContent, { contentErrors: undefined, patchResult: undefined })
      }
    } else if (direction === 'sourceToTarget') {
      // Pushing from current file into target
      if (targetDoc) {
        const merged = applyMergeChunk(targetVal, chunk, 'sourceToTarget')
        const newTargetContent = valueToContent(merged)
        targetDoc.content = newTargetContent
        onUpdateTargetDocument(targetDoc.id, newTargetContent)
      }
    }
  }

  function handleMergeAll(direction: 'sourceToTarget' | 'targetToSource') {
    if (report.chunks.length === 0) return
    if (direction === 'targetToSource') {
      if (readOnly) return
      let currentRoot = sourceVal
      for (const chunk of report.chunks) {
        currentRoot = applyMergeChunk(currentRoot, chunk, 'targetToSource')
      }
      const newContent = valueToContent(currentRoot)
      if (onChange) {
        onChange(newContent, externalContent, { contentErrors: undefined, patchResult: undefined })
      }
    } else if (direction === 'sourceToTarget') {
      if (targetDoc) {
        let currentRoot = targetVal
        for (const chunk of report.chunks) {
          currentRoot = applyMergeChunk(currentRoot, chunk, 'sourceToTarget')
        }
        const newTargetContent = valueToContent(currentRoot)
        targetDoc.content = newTargetContent
        onUpdateTargetDocument(targetDoc.id, newTargetContent)
      }
    }
  }

  function handleNormalizeStructure(
    action: 'wrapTarget' | 'unwrapSource' | 'wrapSource' | 'unwrapTarget'
  ) {
    if (!report.structuralInfo) return
    const key = report.structuralInfo.envelopeKey

    if (action === 'wrapTarget') {
      if (!targetDoc) return
      const wrapped = { [key]: targetVal }
      const newTargetContent = valueToContent(wrapped)
      targetDoc.content = newTargetContent
      onUpdateTargetDocument(targetDoc.id, newTargetContent)
    } else if (action === 'unwrapSource') {
      if (readOnly) return
      const unwrapped = (sourceVal as Record<string, unknown>)?.[key]
      const newContent = valueToContent(unwrapped)
      if (onChange) {
        onChange(newContent, externalContent, { contentErrors: undefined, patchResult: undefined })
      }
    } else if (action === 'wrapSource') {
      if (readOnly) return
      const wrapped = { [key]: sourceVal }
      const newContent = valueToContent(wrapped)
      if (onChange) {
        onChange(newContent, externalContent, { contentErrors: undefined, patchResult: undefined })
      }
    } else if (action === 'unwrapTarget') {
      if (!targetDoc) return
      const unwrapped = (targetVal as Record<string, unknown>)?.[key]
      const newTargetContent = valueToContent(unwrapped)
      targetDoc.content = newTargetContent
      onUpdateTargetDocument(targetDoc.id, newTargetContent)
    }
  }

  function isMultiline(val: unknown): boolean {
    if (typeof val === 'object' && val !== null) return true
    if (typeof val === 'string') {
      if (val.includes('\n')) return true
      const trimmed = val.trim()
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          JSON.parse(trimmed)
          return true
        } catch {
          return false
        }
      }
    }
    return false
  }

  const inlineDiffCache = new WeakMap<
    DiffChunk,
    { sourceParts: InlineDiffPart[]; targetParts: InlineDiffPart[] }
  >()

  function getInlineDiff(chunk: DiffChunk): {
    sourceParts: InlineDiffPart[]
    targetParts: InlineDiffPart[]
  } {
    if (inlineDiffCache.has(chunk)) {
      return inlineDiffCache.get(chunk)!
    }
    const strA = formatValuePreview(chunk.sourceValue)
    const strB = formatValuePreview(chunk.targetValue)
    const res = computeInlineDiff(strA, strB)
    inlineDiffCache.set(chunk, res)
    return res
  }

  function isShortValue(val: unknown): boolean {
    if (val === null || val === undefined) return true
    if (typeof val === 'string') return val.length <= 35 && !val.includes('\n')
    if (typeof val === 'number' || typeof val === 'boolean') return true
    return false
  }

  function formatShort(val: unknown): string {
    if (val === undefined) return 'undefined'
    if (val === null) return 'null'
    if (typeof val === 'string') return `"${val}"`
    return String(val)
  }

  function onDragStartChunk(chunk: DiffChunk, origin: 'source' | 'target') {
    draggingChunk = chunk
    dragOrigin = origin
  }

  function onDragEnd() {
    draggingChunk = null
    dragOrigin = null
  }

  function onDropOnSource(event: DragEvent) {
    event.preventDefault()
    if (draggingChunk && dragOrigin === 'target') {
      handleMergeSingle(draggingChunk, 'targetToSource')
    }
    onDragEnd()
  }

  function onDropOnTarget(event: DragEvent) {
    event.preventDefault()
    if (draggingChunk && dragOrigin === 'source') {
      handleMergeSingle(draggingChunk, 'sourceToTarget')
      onDragEnd()
      return
    }
    if (!draggingChunk) {
      handleTargetDrop(event)
    }
    onDragEnd()
  }

  // Public methods expected by JSONEditorRoot
  export function patch(): JSONPatchResult {
    return { json: sourceVal, previousJson: sourceVal, undo: [], redo: [] }
  }
  export function validate() {
    return []
  }
  export function expand() {}
  export function collapse() {}
  export function openTransformModal() {}
  export function scrollTo() {}
  export function findElement() {
    return null
  }
  export function accept() {}
  export function refresh() {}
  export function focus() {}

  let emptyMenuItems: MenuItem[] = []
</script>

<div class="jse-compare-mode" class:is-resizing={isResizing}>
  {#if mainMenuBar}
    <Menu items={onRenderMenu(emptyMenuItems)} />
  {/if}

  <!-- COMPARE SUB-TOOLBAR (INLINE) -->
  <div class="jse-compare-toolbar">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="toolbar-left"
      class:is-drop-over={isToolbarDropOver}
      class:is-drop-valid={isToolbarDropOver && isDraggedValid}
      class:is-drop-invalid={isToolbarDropOver && isDraggingSubTab && !isDraggedValid}
      on:dragover={handleToolbarDragOver}
      on:dragleave={handleToolbarDragLeave}
      on:drop={handleTargetDrop}
    >
      <span class="compare-flag">Comparing with:</span>

      <div class="target-selection-group">
        <!-- QUICK DOCUMENT PILLS -->
        {#if compareDocuments.length > 0 && compareDocuments.length <= 4}
          <div class="target-quick-pills">
            {#each compareDocuments as doc (doc.id)}
              <button
                type="button"
                class="target-pill-btn"
                class:active={String(selectedTargetId) === String(doc.id)}
                title={`Select "${doc.title}" for comparison`}
                on:click={() => selectTarget(doc.id)}
              >
                <span class="pill-dot"></span>
                <span class="pill-name">{doc.title}</span>
              </button>
            {/each}
            <button
              type="button"
              class="target-pill-btn pill-custom"
              class:active={selectedTargetId === '__custom__'}
              title="Custom JSON Scratchpad"
              on:click={() => selectTarget('__custom__')}
            >
              <span>+ Custom</span>
            </button>
          </div>
        {:else}
          <select
            value={selectedTargetId}
            on:change={(e) => selectTarget(e.currentTarget.value)}
            class="jse-select-target"
          >
            {#each compareDocuments as doc (doc.id)}
              <option value={doc.id}>{doc.title}</option>
            {/each}
            <option value="__custom__">Custom JSON / Scratchpad…</option>
          </select>
        {/if}

        <!-- DROP TARGET INDICATOR PILL -->
        <div
          class="target-drop-zone"
          class:is-dragging={isDraggingSubTab}
          class:is-valid={isDraggingSubTab && isDraggedValid}
          class:is-invalid={isDraggingSubTab && !isDraggedValid}
          class:is-hover={isToolbarDropOver}
          title="Drag and drop any Level-2 sub-tab from the same group here to compare"
        >
          <span class="drop-icon">
            {#if isToolbarDropOver}
              📥
            {:else if isDraggingSubTab}
              {isDraggedValid ? '⇥' : '🚫'}
            {:else}
              ⇥
            {/if}
          </span>
          <span class="drop-text">
            {#if isToolbarDropOver}
              {isDraggedValid ? 'Release to compare' : 'Different group 🚫'}
            {:else if isDraggingSubTab}
              {isDraggedValid ? 'Drop sub-tab here' : 'Same group only'}
            {:else}
              Drop Level-2 tab here
            {/if}
          </span>
        </div>
      </div>

      <!-- FEEDBACK NOTIFICATION IF ANY -->
      {#if targetDropFeedback}
        <div class="target-drop-feedback {targetDropFeedback.type}">
          <span>{targetDropFeedback.message}</span>
        </div>
      {/if}

      <!-- SIMILARITY BADGE -->
      <div
        class="sim-badge"
        class:high={report.stats.similarityPercent >= 90}
        class:medium={report.stats.similarityPercent >= 70 && report.stats.similarityPercent < 90}
        class:low={report.stats.similarityPercent < 70}
        title="AST Semantic Similarity Score"
      >
        <span class="sim-dot"></span>
        <span>{report.stats.similarityPercent}% Match</span>
      </div>
    </div>

    <div class="toolbar-right">
      <!-- BATCH ACTIONS -->
      <div class="batch-actions">
        <button
          type="button"
          class="jse-batch-btn"
          disabled={report.chunks.length === 0 || readOnly}
          title="Pull all differences into this file (Accept Left)"
          on:click={() => handleMergeAll('targetToSource')}
        >
          ⮜ Accept All Left
        </button>
        <button
          type="button"
          class="jse-batch-btn"
          disabled={report.chunks.length === 0 || !targetDoc}
          title="Push all differences into the target file (Accept Right)"
          on:click={() => handleMergeAll('sourceToTarget')}
        >
          Accept All Right ⮞
        </button>
      </div>
    </div>
  </div>

  <!-- METRICS CHIPS & FILTER BAR -->
  <div class="jse-compare-subbar">
    <div class="chips-list">
      <button
        type="button"
        class="chip-btn chip-all"
        class:active={filterType === 'all'}
        on:click={() => (filterType = 'all')}
      >
        All ({report.chunks.length})
      </button>

      <button
        type="button"
        class="chip-btn chip-diffs"
        class:active={filterType === 'diffs'}
        on:click={() => (filterType = 'diffs')}
      >
        Diffs ({report.stats.totalDifferences})
      </button>

      <button
        type="button"
        class="chip-btn chip-added"
        class:active={filterType === 'added'}
        on:click={() => (filterType = 'added')}
      >
        + Added ({report.stats.added})
      </button>

      <button
        type="button"
        class="chip-btn chip-removed"
        class:active={filterType === 'removed'}
        on:click={() => (filterType = 'removed')}
      >
        - Removed ({report.stats.removed})
      </button>

      <button
        type="button"
        class="chip-btn chip-modified"
        class:active={filterType === 'modified'}
        on:click={() => (filterType = 'modified')}
      >
        ~ Modified ({report.stats.modified})
      </button>

      {#if report.stats.reordered > 0}
        <button
          type="button"
          class="chip-btn chip-reordered"
          class:active={filterType === 'reordered'}
          on:click={() => (filterType = 'reordered')}
        >
          ⤭ Reordered ({report.stats.reordered})
        </button>
      {/if}
    </div>

    <div class="filter-options">
      <div class="search-box">
        <input
          type="text"
          placeholder="Filter property paths…"
          bind:value={searchQuery}
          class="jse-search-filter"
        />
        {#if searchQuery}
          <button type="button" class="clear-btn" on:click={() => (searchQuery = '')}>×</button>
        {/if}
      </div>

      <label class="opt-label" title="Ignore property declaration order when comparing objects">
        <input type="checkbox" bind:checked={ignoreKeyOrder} />
        Ignore Key Order
      </label>

      <label class="opt-label" title="Match array items by entity id, uuid, or key">
        <input type="checkbox" bind:checked={matchById} />
        Match by ID
      </label>
    </div>
  </div>

  {#if isCustomTarget}
    <div class="custom-target-input">
      <span class="custom-target-label">Paste JSON to compare against:</span>
      <textarea
        bind:value={customTargetText}
        placeholder={`{\n  "paste": "json here"\n}`}
        class="custom-textarea"
        rows="3"
      ></textarea>
    </div>
  {/if}

  <!-- STRUCTURAL ENVELOPE MISMATCH NOTICE & NORMALIZATION ACTIONS -->
  {#if report.structuralInfo}
    <div class="jse-structure-banner">
      <div class="structure-info">
        <span class="structure-icon">⚡</span>
        <div class="structure-details">
          <div class="structure-title">Structural Asymmetry Detected</div>
          <div class="structure-desc">
            {report.structuralInfo.description}
            Items were matched intelligently by ID and structure.
          </div>
        </div>
      </div>
      <div class="structure-actions">
        {#if report.structuralInfo.envelopeSide === 'source'}
          <button
            type="button"
            class="btn-normalize-action btn-primary"
            disabled={!targetDoc}
            title={`Normalize target structure: wrap raw array in {"${report.structuralInfo.envelopeKey}": ...}`}
            on:click={() => handleNormalizeStructure('wrapTarget')}
          >
            Wrap Right with <code>"{report.structuralInfo.envelopeKey}"</code>
          </button>
          <button
            type="button"
            class="btn-normalize-action btn-secondary"
            disabled={readOnly}
            title="Normalize source structure: unwrap to a flat array"
            on:click={() => handleNormalizeStructure('unwrapSource')}
          >
            Unwrap Left to Array
          </button>
        {:else}
          <button
            type="button"
            class="btn-normalize-action btn-primary"
            disabled={readOnly}
            title={`Normalize source structure: wrap raw array in {"${report.structuralInfo.envelopeKey}": ...}`}
            on:click={() => handleNormalizeStructure('wrapSource')}
          >
            Wrap Left with <code>"{report.structuralInfo.envelopeKey}"</code>
          </button>
          <button
            type="button"
            class="btn-normalize-action btn-secondary"
            disabled={!targetDoc}
            title="Normalize target structure: unwrap to a flat array"
            on:click={() => handleNormalizeStructure('unwrapTarget')}
          >
            Unwrap Right to Array
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- SIDE-BY-SIDE ALIGNED AST DIFF CONTAINER WITH RESIZABLE COLUMNS -->
  <div
    class="jse-compare-viewport"
    bind:this={viewportEl}
    style="--split-left: {splitPercent}%; --split-right: {100 - splitPercent}%;"
  >
    <div class="viewport-header">
      <div class="header-col col-left">
        <span class="col-tag">This File</span>
        <span class="col-title">Source</span>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="header-gutter-resizer"
        title="Drag left/right to resize comparison columns"
        on:mousedown={startGutterResize}
      >
        <span class="gutter-drag-handle">⋮</span>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="header-col col-right"
        class:is-drop-over={isHeaderDropOver}
        class:is-drop-valid={isHeaderDropOver && isDraggedValid}
        class:is-drop-invalid={isHeaderDropOver && isDraggingSubTab && !isDraggedValid}
        class:is-subtab-dragging={isDraggingSubTab}
        on:dragover={handleHeaderDragOver}
        on:dragleave={handleHeaderDragLeave}
        on:drop={handleTargetDrop}
      >
        <span class="col-tag">Target File</span>
        <span class="col-title"
          >{targetDoc?.title || (isCustomTarget ? 'Custom Scratchpad' : 'Target')}</span
        >
        <div
          class="col-drop-pill"
          class:is-active={isHeaderDropOver || isDraggingSubTab}
          title="Drag and drop a Level-2 sub-tab here to set as target"
        >
          <span class="drop-pill-icon">📥</span>
          <span class="drop-pill-label">
            {#if isHeaderDropOver}
              {isDraggedValid ? 'Drop to compare' : 'Different group 🚫'}
            {:else if isDraggingSubTab}
              {isDraggedValid ? 'Drop target here' : 'Same group only'}
            {:else}
              Drop tab here
            {/if}
          </span>
        </div>
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="viewport-rows" on:dragover|preventDefault>
      {#if filteredChunks.length === 0}
        <div class="diff-empty-msg">
          <span class="empty-icon">✓</span>
          <h4>
            {report.chunks.length === 0
              ? 'Both documents are structurally identical!'
              : 'No differences match current filter.'}
          </h4>
          <p>
            {report.chunks.length === 0
              ? 'All keys, types, and values match under current alignment rules.'
              : 'Try clearing filters or search query.'}
          </p>
        </div>
      {:else}
        {#each filteredChunks as chunk (chunk.id)}
          {@const isLeftMulti = isMultiline(chunk.sourceValue)}
          {@const isRightMulti = isMultiline(chunk.targetValue)}
          {@const hasMultiline = isLeftMulti || isRightMulti}
          <div
            class="diff-row"
            class:has-multiline={hasMultiline}
            class:is-reordered={chunk.type === 'reordered'}
          >
            <!-- LEFT CELL (THIS FILE) -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="diff-cell cell-left" on:dragover|preventDefault on:drop={onDropOnSource}>
              {#if chunk.type === 'added'}
                <!-- Missing in left document -> ghost spacer -->
                <div class="jse-diff-spacer" title="Missing in this file">
                  <span class="spacer-text">— missing in this file —</span>
                </div>
              {:else}
                <!-- Present in left document -->
                <div
                  class="diff-card chunk-{chunk.type}"
                  class:is-multiline={isLeftMulti}
                  draggable="true"
                  on:dragstart={() => onDragStartChunk(chunk, 'source')}
                  on:dragend={onDragEnd}
                >
                  <div class="card-meta">
                    <span class="card-badge badge-{chunk.type}">{chunk.type}</span>
                    <code class="card-path">{chunk.sourcePath || chunk.path}</code>
                    {#if chunk.type === 'modified'}
                      {#if chunk.deltaSummary?.typeChanged}
                        <span class="card-type-chip" title="Data type changed">
                          {chunk.deltaSummary.sourceType} ➔ {chunk.deltaSummary.targetType}
                        </span>
                      {/if}
                      {#if chunk.deltaSummary?.transitionText}
                        <span
                          class="card-diff-change"
                          title={`Value change:\nBefore: ${formatShort(chunk.sourceValue)}\nAfter: ${formatShort(chunk.targetValue)}`}
                        >
                          <span class="val-transition">{chunk.deltaSummary.transitionText}</span>
                        </span>
                      {:else if isShortValue(chunk.sourceValue) && isShortValue(chunk.targetValue)}
                        <span class="card-diff-change" title="Value transition">
                          <span class="val-old">{formatShort(chunk.sourceValue)}</span>
                          <span class="val-arrow">➔</span>
                          <span class="val-new">{formatShort(chunk.targetValue)}</span>
                        </span>
                      {/if}
                    {/if}
                  </div>
                  <div class="card-body">
                    <span class="card-key">{chunk.keyOrIndex}:</span>
                    {#if chunk.type === 'modified' && chunk.targetValue !== undefined}
                      {@const diff = getInlineDiff(chunk)}
                      <pre class="card-val">{#each diff.sourceParts as part}<span
                            class="diff-char diff-{part.type}">{part.value}</span
                          >{/each}</pre>
                      {#if !diff.sourceParts.some((p) => p.type === 'removed') && chunk.deltaSummary?.addedSummary}
                        <span class="diff-hint-badge hint-added" title="Added in target">
                          +{chunk.deltaSummary.addedSummary} in target
                        </span>
                      {/if}
                    {:else}
                      <pre class="card-val">{formatValuePreview(chunk.sourceValue)}</pre>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>

            <!-- CENTRAL MERGE GUTTER (FIXED 2-SLOT ALIGNMENT) -->
            <div class="diff-gutter">
              <div class="gutter-slots">
                <!-- SLOT 1 (LEFT): PUSH TO TARGET -->
                {#if chunk.type === 'removed' || chunk.type === 'modified'}
                  <button
                    type="button"
                    class="gutter-btn btn-push"
                    title="Push left value to right file (⮞)"
                    on:click={() => handleMergeSingle(chunk, 'sourceToTarget')}
                  >
                    ⮞
                  </button>
                {:else}
                  <div class="gutter-slot-empty"></div>
                {/if}

                <!-- SLOT 2 (RIGHT): PULL FROM TARGET -->
                {#if (chunk.type === 'added' || chunk.type === 'modified') && !readOnly}
                  <button
                    type="button"
                    class="gutter-btn btn-pull"
                    title="Pull right value into this file (⮜)"
                    on:click={() => handleMergeSingle(chunk, 'targetToSource')}
                  >
                    ⮜
                  </button>
                {:else}
                  <div class="gutter-slot-empty"></div>
                {/if}
              </div>
            </div>

            <!-- RIGHT CELL (TARGET FILE) -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="diff-cell cell-right" on:dragover|preventDefault on:drop={onDropOnTarget}>
              {#if chunk.type === 'removed'}
                <!-- Missing in target -> ghost spacer -->
                <div class="jse-diff-spacer" title="Missing in target">
                  <span class="spacer-text">— missing in target —</span>
                </div>
              {:else}
                <!-- Present in target -->
                <div
                  class="diff-card chunk-{chunk.type}"
                  class:is-multiline={isRightMulti}
                  draggable="true"
                  on:dragstart={() => onDragStartChunk(chunk, 'target')}
                  on:dragend={onDragEnd}
                >
                  <div class="card-meta">
                    <span class="card-badge badge-{chunk.type}">{chunk.type}</span>
                    <code class="card-path">{chunk.targetPath || chunk.path}</code>
                    {#if chunk.type === 'modified'}
                      {#if chunk.deltaSummary?.typeChanged}
                        <span class="card-type-chip" title="Data type changed">
                          {chunk.deltaSummary.sourceType} ➔ {chunk.deltaSummary.targetType}
                        </span>
                      {/if}
                      {#if chunk.deltaSummary?.transitionText}
                        <span
                          class="card-diff-change"
                          title={`Value change:\nBefore: ${formatShort(chunk.sourceValue)}\nAfter: ${formatShort(chunk.targetValue)}`}
                        >
                          <span class="val-transition">{chunk.deltaSummary.transitionText}</span>
                        </span>
                      {:else if isShortValue(chunk.sourceValue) && isShortValue(chunk.targetValue)}
                        <span class="card-diff-change" title="Value transition">
                          <span class="val-old">{formatShort(chunk.sourceValue)}</span>
                          <span class="val-arrow">➔</span>
                          <span class="val-new">{formatShort(chunk.targetValue)}</span>
                        </span>
                      {/if}
                    {/if}
                  </div>
                  <div class="card-body">
                    <span class="card-key">{chunk.keyOrIndex}:</span>
                    {#if chunk.type === 'modified' && chunk.sourceValue !== undefined}
                      {@const diff = getInlineDiff(chunk)}
                      <pre class="card-val">{#each diff.targetParts as part}<span
                            class="diff-char diff-{part.type}">{part.value}</span
                          >{/each}</pre>
                      {#if !diff.targetParts.some((p) => p.type === 'added') && chunk.deltaSummary?.removedSummary}
                        <span class="diff-hint-badge hint-removed" title="Removed from source">
                          -{chunk.deltaSummary.removedSummary} from source
                        </span>
                      {/if}
                    {:else}
                      <pre class="card-val">{formatValuePreview(chunk.targetValue)}</pre>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .jse-compare-mode {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    font-family:
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;

    /* Theme adaptive tokens (Default Light) */
    --diff-bg-root: var(--jse-background-color, var(--theme-bg-editor, #ffffff));
    --diff-bg-toolbar: var(--theme-bg-panel, var(--jse-panel-background, #f8fafc));
    --diff-bg-subbar: var(--theme-bg-chrome, var(--jse-navigation-bar-background, #f1f5f9));
    --diff-border: var(--theme-b-main, var(--jse-main-border-color, #cbd5e1));
    --diff-text-main: var(--jse-text-color, var(--theme-t-main, #0f172a));
    --diff-text-muted: var(--theme-t-muted, var(--jse-text-readonly, #475569));
    --diff-key-color: #0369a1;
    --diff-path-color: #334155;

    --diff-card-bg: var(--theme-bg-card, #ffffff);
    --diff-code-bg: #f8fafc;
    --diff-code-border: #e2e8f0;

    --diff-added-bg: #f0fdf4;
    --diff-added-border: #22c55e;
    --diff-added-text: #15803d;
    --diff-added-hl: #bbf7d0;

    --diff-removed-bg: #fef2f2;
    --diff-removed-border: #ef4444;
    --diff-removed-text: #b91c1c;
    --diff-removed-hl: #fecaca;

    --diff-modified-bg: #fffbeb;
    --diff-modified-border: #f59e0b;
    --diff-modified-text: #b45309;
    --diff-modified-hl: #fde68a;

    --diff-reordered-bg: #eff6ff;
    --diff-reordered-border: #3b82f6;
    --diff-reordered-text: #1d4ed8;

    --diff-badge-bg: #e2e8f0;
    --diff-badge-border: #cbd5e1;
    --diff-badge-text: #0f172a;

    --diff-gutter-bg: var(--theme-bg-chrome, #f1f5f9);

    background: var(--diff-bg-root);
    color: var(--diff-text-main);

    &.is-resizing {
      cursor: col-resize;
      user-select: none;
    }
  }

  /* DARK THEME OVERRIDES */
  :global(.jse-theme-dark) .jse-compare-mode,
  :global(.app-shell:not(.jse-theme-default):not(.jse-theme-light)) .jse-compare-mode {
    --diff-bg-root: var(--theme-bg-editor, #1e1e1e);
    --diff-bg-toolbar: var(--theme-bg-panel, #202021);
    --diff-bg-subbar: var(--theme-bg-chrome, #181818);
    --diff-border: var(--theme-b-main, #3c3c3c);
    --diff-text-main: var(--theme-t-main, #f8fafc);
    --diff-text-muted: var(--theme-t-muted, #94a3b8);
    --diff-key-color: #60a5fa;
    --diff-path-color: #cbd5e1;

    --diff-card-bg: var(--theme-bg-card, #252526);
    --diff-code-bg: rgba(0, 0, 0, 0.3);
    --diff-code-border: #3c3c3c;

    --diff-added-bg: rgba(34, 197, 94, 0.14);
    --diff-added-border: #22c55e;
    --diff-added-text: #4ade80;
    --diff-added-hl: rgba(34, 197, 94, 0.35);

    --diff-removed-bg: rgba(239, 68, 68, 0.14);
    --diff-removed-border: #ef4444;
    --diff-removed-text: #f87171;
    --diff-removed-hl: rgba(239, 68, 68, 0.35);

    --diff-modified-bg: rgba(245, 158, 11, 0.14);
    --diff-modified-border: #f59e0b;
    --diff-modified-text: #fbbf24;
    --diff-modified-hl: rgba(245, 158, 11, 0.35);

    --diff-reordered-bg: rgba(59, 130, 246, 0.14);
    --diff-reordered-border: #3b82f6;
    --diff-reordered-text: #60a5fa;

    --diff-badge-bg: #18181b;
    --diff-badge-border: #3f3f46;
    --diff-badge-text: #f8fafc;

    --diff-gutter-bg: var(--theme-bg-chrome, #181818);
  }

  /* SUB-TOOLBAR */
  .jse-compare-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--diff-bg-toolbar);
    border-bottom: 1px solid var(--diff-border);
    flex-shrink: 0;
    gap: 12px;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    transition: all 0.2s ease;
    border-radius: 6px;
    padding: 2px 4px;

    &.is-drop-over {
      background: rgba(99, 102, 241, 0.1);
      outline: 2px dashed #6366f1;
    }
    &.is-drop-invalid {
      background: rgba(239, 68, 68, 0.1);
      outline: 2px dashed #ef4444;
    }
  }

  .compare-flag {
    font-size: 12px;
    font-weight: 600;
    color: var(--diff-text-muted);
    white-space: nowrap;
  }

  .target-selection-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .target-quick-pills {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--diff-code-bg);
    padding: 2px;
    border-radius: 5px;
    border: 1px solid var(--diff-border);
  }

  .target-pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: transparent;
    border: 1px solid transparent;
    color: var(--diff-text-muted);
    cursor: pointer;
    transition: all 0.12s ease;

    .pill-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--diff-text-muted);
      opacity: 0.6;
    }

    &:hover:not(.active) {
      background: rgba(0, 0, 0, 0.05);
      color: var(--diff-text-main);
    }

    &.active {
      background: var(--diff-card-bg);
      color: var(--diff-text-main);
      border-color: var(--diff-border);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);

      .pill-dot {
        background: #10b981;
        opacity: 1;
      }
    }

    &.pill-custom {
      font-style: italic;
      opacity: 0.85;
      &.active {
        color: #0284c7;
        .pill-dot {
          background: #0284c7;
        }
      }
    }
  }

  .target-drop-zone {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    border: 1px dashed var(--diff-border);
    background: transparent;
    color: var(--diff-text-muted);
    transition: all 0.15s ease;
    user-select: none;

    &.is-dragging {
      border-color: #6366f1;
      color: #6366f1;
      background: rgba(99, 102, 241, 0.06);
      animation: pulse 1.5s infinite;
    }

    &.is-invalid {
      border-color: #ef4444 !important;
      color: #ef4444 !important;
      background: rgba(239, 68, 68, 0.08) !important;
    }

    &.is-hover {
      background: rgba(99, 102, 241, 0.15);
      border-color: #6366f1;
      transform: scale(1.02);
    }
  }

  .target-drop-feedback {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    animation: fadeIn 0.2s ease;

    &.success {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    &.error {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.65;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .jse-select-target {
    background: var(--diff-card-bg);
    color: var(--diff-text-main);
    border: 1px solid var(--diff-border);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    outline: none;
    cursor: pointer;

    &:focus {
      border-color: var(--theme-ac, #0078d4);
    }
  }

  .sim-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;

    .sim-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }

    &.high {
      background: rgba(16, 185, 129, 0.18);
      color: #10b981;
      .sim-dot {
        background: #10b981;
      }
    }
    &.medium {
      background: rgba(245, 158, 11, 0.18);
      color: #d97706;
      .sim-dot {
        background: #d97706;
      }
    }
    &.low {
      background: rgba(239, 68, 68, 0.18);
      color: #ef4444;
      .sim-dot {
        background: #ef4444;
      }
    }
  }

  .batch-actions {
    display: flex;
    gap: 8px;
  }

  .jse-batch-btn {
    background: var(--diff-card-bg);
    color: var(--diff-text-main);
    border: 1px solid var(--diff-border);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;

    &:hover:not(:disabled) {
      background: var(--theme-ac, #0078d4);
      border-color: var(--theme-ac, #0078d4);
      color: #ffffff;
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }

  /* FILTER BAR */
  .jse-compare-subbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px;
    background: var(--diff-bg-subbar);
    border-bottom: 1px solid var(--diff-border);
    flex-shrink: 0;
    gap: 8px;
    overflow-x: auto;
  }

  .chips-list {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .chip-btn {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;

    &.chip-all {
      color: var(--diff-text-main);
    }
    &.chip-diffs {
      color: #0284c7;
    }
    &.chip-added {
      color: #16a34a;
    }
    &.chip-removed {
      color: #dc2626;
    }
    &.chip-modified {
      color: #d97706;
    }
    &.chip-reordered {
      color: #2563eb;
    }

    &:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    &.active {
      background: var(--diff-card-bg);
      border-color: currentColor;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
  }

  .filter-options {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 12px;
  }

  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  .jse-search-filter {
    background: var(--diff-card-bg);
    color: var(--diff-text-main);
    border: 1px solid var(--diff-border);
    border-radius: 4px;
    padding: 4px 24px 4px 8px;
    font-size: 12px;
    width: 160px;
    outline: none;

    &:focus {
      border-color: var(--theme-ac, #0078d4);
    }
  }

  .clear-btn {
    position: absolute;
    right: 4px;
    background: transparent;
    border: none;
    color: var(--diff-text-muted);
    cursor: pointer;
    padding: 0 2px;
    font-size: 13px;
  }

  .opt-label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    font-weight: 600;
    color: var(--diff-text-muted);

    input {
      margin: 0;
      accent-color: var(--theme-ac, #0078d4);
    }
  }

  .custom-target-input {
    padding: 8px 16px;
    background: var(--diff-bg-toolbar);
    border-bottom: 1px solid var(--diff-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .custom-target-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--diff-text-muted);
  }

  .custom-textarea {
    width: 100%;
    font-family: Consolas, monospace;
    font-size: 13px;
    padding: 8px;
    border-radius: 4px;
    background: var(--diff-code-bg);
    color: var(--diff-text-main);
    border: 1px solid var(--diff-border);
    max-height: 110px;
    overflow-y: auto;
    box-sizing: border-box;
  }

  /* STRUCTURAL ASYMMETRY BANNER */
  .jse-structure-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #f0f9ff;
    border-bottom: 1px solid #bae6fd;
    gap: 14px;
    flex-shrink: 0;
    flex-wrap: wrap;

    .structure-info {
      display: flex;
      align-items: center;
      gap: 10px;

      .structure-icon {
        font-size: 18px;
        color: #d97706;
        line-height: 1;
      }

      .structure-details {
        display: flex;
        flex-direction: column;
        gap: 3px;

        .structure-title {
          font-size: 13px;
          font-weight: 700;
          color: #0369a1;
        }

        .structure-desc {
          font-size: 12px;
          color: #475569;
        }
      }
    }

    .structure-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-normalize-action {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;

      code {
        background: rgba(0, 0, 0, 0.08);
        padding: 1px 4px;
        border-radius: 3px;
        font-family: monospace;
        font-size: 11px;
      }

      &.btn-primary {
        background: #0284c7;
        color: #ffffff;
        border: 1px solid #0369a1;

        &:hover:not(:disabled) {
          filter: brightness(1.15);
        }
      }

      &.btn-secondary {
        background: #ffffff;
        color: #0f172a;
        border: 1px solid #cbd5e1;

        &:hover:not(:disabled) {
          background: #f1f5f9;
        }
      }

      &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
    }
  }

  /* VIEWPORT */
  .jse-compare-viewport {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .viewport-header {
    display: grid;
    grid-template-columns: minmax(100px, var(--split-left, 50%)) 52px minmax(100px, 1fr);
    background: var(--diff-bg-toolbar);
    border-bottom: 1px solid var(--diff-border);
    font-size: 12px;
    font-weight: 700;
  }

  .header-col {
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .col-tag {
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
  }

  .col-left .col-tag {
    background: rgba(0, 120, 212, 0.18);
    color: #0284c7;
  }

  .col-right .col-tag {
    background: rgba(16, 185, 129, 0.18);
    color: #15803d;
  }

  .header-col.col-right {
    position: relative;
    transition: all 0.15s ease;

    &.is-drop-over {
      background: rgba(99, 102, 241, 0.14) !important;
      outline: 2px dashed #6366f1;
      outline-offset: -2px;
    }

    &.is-drop-invalid {
      background: rgba(239, 68, 68, 0.14) !important;
      outline: 2px dashed #ef4444;
      outline-offset: -2px;
    }

    .col-drop-pill {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      border: 1px dashed var(--diff-border);
      color: var(--diff-text-muted);
      opacity: 0.65;
      transition: all 0.15s ease;

      &.is-active {
        opacity: 1;
        border-color: #6366f1;
        color: #6366f1;
        background: rgba(99, 102, 241, 0.1);
      }
    }
  }

  .col-title {
    color: var(--diff-text-main);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-gutter-resizer {
    width: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--diff-text-muted);
    border-left: 1px solid var(--diff-border);
    border-right: 1px solid var(--diff-border);
    cursor: col-resize;
    user-select: none;
    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      background: rgba(0, 120, 212, 0.12);
      color: #0078d4;
    }
  }

  .gutter-drag-handle {
    letter-spacing: -2px;
    font-weight: bold;
  }

  .viewport-rows {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .diff-empty-msg {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
    text-align: center;

    .empty-icon {
      font-size: 32px;
      color: #16a34a;
      margin-bottom: 10px;
    }
    h4 {
      margin: 0 0 6px;
      font-size: 14px;
      font-weight: 700;
      color: var(--diff-text-main);
    }
    p {
      margin: 0;
      font-size: 12px;
      color: var(--diff-text-muted);
    }
  }

  /* ALIGNED ROW USING CSS GRID */
  .diff-row {
    display: grid;
    grid-template-columns: minmax(100px, var(--split-left, 50%)) 52px minmax(100px, 1fr);
    align-items: stretch;
    min-height: 70px;
    height: auto;
    transition: min-height 0.15s ease;

    &.has-multiline {
      min-height: 200px;
    }
  }

  .diff-cell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-height: 70px;
    height: 100%;
    min-width: 0;

    .has-multiline & {
      min-height: 200px;
    }
  }

  /* GHOST SPACER */
  .jse-diff-spacer {
    width: 100%;
    min-height: 70px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: repeating-linear-gradient(
      -45deg,
      rgba(0, 0, 0, 0.02),
      rgba(0, 0, 0, 0.02) 8px,
      rgba(0, 0, 0, 0.04) 8px,
      rgba(0, 0, 0, 0.04) 16px
    );
    border: 1px dashed var(--diff-border);
    border-radius: 6px;
    user-select: none;
    box-sizing: border-box;
    flex: 1 1 auto;

    .has-multiline & {
      min-height: 200px;
    }
  }

  .spacer-text {
    font-size: 12px;
    font-style: italic;
    font-weight: 600;
    color: var(--diff-text-muted);
  }

  /* DIFF CARD - SPACIOUS & COMFORTABLE TO READ */
  .diff-card {
    width: 100%;
    min-height: 70px;
    height: 100%;
    padding: 10px 14px;
    border-radius: 6px;
    background: var(--diff-card-bg);
    border: 1px solid var(--diff-border);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 8px;
    cursor: grab;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    box-sizing: border-box;
    overflow: hidden;
    flex: 1 1 auto;
    transition:
      box-shadow 0.15s,
      border-color 0.15s;

    .has-multiline & {
      min-height: 200px;
    }

    &.is-multiline {
      min-height: 200px;
    }

    &:active {
      cursor: grabbing;
    }

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    &.chunk-added {
      background: var(--diff-added-bg);
      border-color: var(--diff-added-border);
      border-left: 4px solid var(--diff-added-border);
    }
    &.chunk-removed {
      background: var(--diff-removed-bg);
      border-color: var(--diff-removed-border);
      border-left: 4px solid var(--diff-removed-border);
    }
    &.chunk-modified {
      background: var(--diff-modified-bg);
      border-color: var(--diff-modified-border);
      border-left: 4px solid var(--diff-modified-border);
    }
    &.chunk-reordered {
      background: var(--diff-reordered-bg);
      border-color: var(--diff-reordered-border);
      border-left: 4px solid var(--diff-reordered-border);
    }
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .card-badge {
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 3px;
    letter-spacing: 0.5px;

    &.badge-added {
      background: #16a34a;
      color: #ffffff;
    }
    &.badge-removed {
      background: #dc2626;
      color: #ffffff;
    }
    &.badge-modified {
      background: #d97706;
      color: #ffffff;
    }
    &.badge-reordered {
      background: #2563eb;
      color: #ffffff;
    }
  }

  .card-path {
    font-family: Consolas, monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--diff-path-color);
  }

  .card-body {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-family: Consolas, monospace;
    font-size: 13px;
    min-width: 0;
    width: 100%;
    flex: 0 0 auto;
    flex-wrap: wrap;
  }

  .is-multiline .card-body {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    flex: 0 0 auto;
    flex-wrap: nowrap;
  }

  .card-key {
    font-weight: 700;
    font-size: 13px;
    color: var(--diff-key-color);
    flex-shrink: 0;
    line-height: 1.5;
  }

  .card-val {
    margin: 0;
    font-family: Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
    color: var(--diff-text-main);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    flex: 1 1 auto;
    min-width: 0;
    height: auto;
  }

  /* MULTILINE EXPANDED BOX (Objects, Arrays, Long strings) - "textareas" */
  .is-multiline .card-val {
    width: 100%;
    padding: 8px 12px;
    background: var(--diff-code-bg);
    border: 1px solid var(--diff-code-border);
    border-radius: 6px;
    min-height: 48px;
    max-height: 110px;
    height: auto;
    box-sizing: border-box;
    overflow-y: auto;
    flex: 0 0 auto;
    scrollbar-width: thin;

    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(128, 128, 128, 0.35);
      border-radius: 4px;
    }
    &::-webkit-scrollbar-thumb:hover {
      background: rgba(128, 128, 128, 0.6);
    }
  }

  .card-type-chip {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(168, 85, 247, 0.15);
    color: #9333ea;
    border: 1px solid rgba(168, 85, 247, 0.4);
    font-family: Consolas, monospace;
  }

  .card-diff-change {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    background: var(--diff-badge-bg);
    border: 1px solid var(--diff-badge-border);
    color: var(--diff-badge-text);
    padding: 2px 8px;
    border-radius: 4px;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .val-transition {
      color: var(--diff-key-color);
      font-weight: 700;
    }
    .val-old {
      color: #dc2626;
      text-decoration: line-through;
    }
    .val-arrow {
      color: var(--diff-text-muted);
      font-size: 10px;
    }
    .val-new {
      color: #16a34a;
      font-weight: 700;
    }
  }

  .diff-hint-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: 8px;
    display: inline-flex;
    align-items: center;
    white-space: nowrap;

    &.hint-added {
      background: var(--diff-added-hl);
      color: var(--diff-added-text);
      border: 1px solid var(--diff-added-border);
    }
    &.hint-removed {
      background: var(--diff-removed-hl);
      color: var(--diff-removed-text);
      border: 1px solid var(--diff-removed-border);
    }
  }

  .diff-char {
    display: inline;
    border-radius: 3px;

    &.diff-removed {
      background: var(--diff-removed-hl);
      color: var(--diff-removed-text);
      text-decoration: line-through;
      text-decoration-color: currentColor;
      padding: 1px 4px;
      font-weight: 700;
    }

    &.diff-added {
      background: var(--diff-added-hl);
      color: var(--diff-added-text);
      padding: 1px 4px;
      font-weight: 700;
    }

    &.diff-same {
      color: inherit;
    }
  }

  /* CENTRAL MERGE GUTTER: FIXED 2-SLOT ALIGNMENT */
  .diff-gutter {
    width: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-left: 1px solid var(--diff-border);
    border-right: 1px solid var(--diff-border);
    background: var(--diff-gutter-bg);
  }

  .gutter-slots {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .gutter-slot-empty {
    width: 22px;
    height: 28px;
  }

  .gutter-btn {
    width: 22px;
    height: 28px;
    border-radius: 4px;
    border: none;
    font-size: 11px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 0.1s,
      opacity 0.15s;

    &:hover {
      transform: scale(1.15);
    }
  }

  .btn-push {
    background: #16a34a;
    color: #ffffff;
  }

  .btn-pull {
    background: #0078d4;
    color: #ffffff;
  }
</style>
