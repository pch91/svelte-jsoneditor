<script lang="ts">
  import { onMount } from 'svelte'

  export let samplesOpen = false
  export let onToggleSamples: () => void

  let containerEl: HTMLElement | null = null

  // Panel heights in percentages (or pixels)
  let filesHeight = 35 // percent
  let workspacesHeight = 55 // percent
  let samplesHeight = 10 // percent

  let filesCollapsed = false
  let workspacesCollapsed = false

  // Dragging state
  let activeSplitter: 1 | 2 | null = null
  let startY = 0
  let startFilesH = 0
  let startWsH = 0
  let startSamplesH = 0

  onMount(() => {
    try {
      const saved = localStorage.getItem('svelte-jsoneditor-sidebar-panel-heights')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.files && parsed.workspaces) {
          filesHeight = parsed.files
          workspacesHeight = parsed.workspaces
          samplesHeight = parsed.samples ?? 10
        }
      }
    } catch {
      // fallback to defaults
    }
  })

  function saveHeights() {
    try {
      localStorage.setItem(
        'svelte-jsoneditor-sidebar-panel-heights',
        JSON.stringify({
          files: filesHeight,
          workspaces: workspacesHeight,
          samples: samplesHeight
        })
      )
    } catch {
      // ignore
    }
  }

  function startDrag(splitterIndex: 1 | 2, e: MouseEvent) {
    activeSplitter = splitterIndex
    startY = e.clientY
    startFilesH = filesHeight
    startWsH = workspacesHeight
    startSamplesH = samplesHeight

    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', stopDrag)
    e.preventDefault()
  }

  function onDrag(e: MouseEvent) {
    if (!activeSplitter || !containerEl) return
    const totalHeight = containerEl.clientHeight
    if (totalHeight <= 0) return

    const deltaPx = e.clientY - startY
    const deltaPercent = (deltaPx / totalHeight) * 100

    if (activeSplitter === 1) {
      // Resizing Files vs Workspaces
      let newFiles = Math.max(10, Math.min(75, startFilesH + deltaPercent))
      let newWs = Math.max(15, startWsH - (newFiles - startFilesH))
      filesHeight = Math.round(newFiles)
      workspacesHeight = Math.round(newWs)
    } else if (activeSplitter === 2) {
      // Resizing Workspaces vs Samples
      let newWs = Math.max(15, Math.min(80, startWsH + deltaPercent))
      let newSamples = Math.max(5, startSamplesH - (newWs - startWsH))
      workspacesHeight = Math.round(newWs)
      samplesHeight = Math.round(newSamples)
    }
  }

  function stopDrag() {
    if (activeSplitter !== null) {
      activeSplitter = null
      window.removeEventListener('mousemove', onDrag)
      window.removeEventListener('mouseup', stopDrag)
      saveHeights()
    }
  }

  export let onContextMenuFiles: ((e: MouseEvent) => void) | undefined = undefined
  export let onContextMenuWorkspaces: ((e: MouseEvent) => void) | undefined = undefined
  export let onContextMenuSamples: ((e: MouseEvent) => void) | undefined = undefined

  function handleFilesContextMenu(e: MouseEvent) {
    if (onContextMenuFiles) {
      e.preventDefault()
      onContextMenuFiles(e)
    }
  }

  function handleWorkspacesContextMenu(e: MouseEvent) {
    if (onContextMenuWorkspaces) {
      e.preventDefault()
      onContextMenuWorkspaces(e)
    }
  }

  function handleSamplesContextMenu(e: MouseEvent) {
    if (onContextMenuSamples) {
      e.preventDefault()
      onContextMenuSamples(e)
    }
  }
</script>

<div class="sidebar-panels-container" bind:this={containerEl}>
  <!-- AREA 1: FILES & FOLDERS -->
  <div
    class="sidebar-panel panel-files"
    style={filesCollapsed ? 'flex: 0 0 auto;' : `flex: ${filesHeight} 1 0px;`}
    on:contextmenu={handleFilesContextMenu}
    role="region"
    aria-label="Files and folders"
  >
    <div
      class="panel-header"
      on:click={() => (filesCollapsed = !filesCollapsed)}
      role="button"
      tabindex="0"
      on:keydown={(e) => e.key === 'Enter' && (filesCollapsed = !filesCollapsed)}
    >
      <span class="panel-caret">{filesCollapsed ? '▸' : '▾'}</span>
      <span class="panel-icon">📁</span>
      <span class="panel-title">FILES & FOLDERS</span>
    </div>
    {#if !filesCollapsed}
      <div class="panel-content">
        <slot name="files" />
      </div>
    {/if}
  </div>

  {#if !filesCollapsed && !workspacesCollapsed}
    <!-- SPLITTER 1 -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="panel-splitter"
      class:dragging={activeSplitter === 1}
      on:mousedown={(e) => startDrag(1, e)}
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize Files and Workspaces panels"
    >
      <div class="splitter-line"></div>
    </div>
  {/if}

  <!-- AREA 2: WORKSPACES & SPATIAL FLOWS -->
  <div
    class="sidebar-panel panel-workspaces"
    style={workspacesCollapsed ? 'flex: 0 0 auto;' : `flex: ${workspacesHeight} 1 0px;`}
    on:contextmenu={handleWorkspacesContextMenu}
    role="region"
    aria-label="Workspaces and Spatial Flows"
  >
    <div
      class="panel-header"
      on:click={() => (workspacesCollapsed = !workspacesCollapsed)}
      role="button"
      tabindex="0"
      on:keydown={(e) => e.key === 'Enter' && (workspacesCollapsed = !workspacesCollapsed)}
    >
      <span class="panel-caret">{workspacesCollapsed ? '▸' : '▾'}</span>
      <span class="panel-icon">🗂</span>
      <span class="panel-title">WORKSPACES & SPATIAL FLOWS</span>
    </div>
    {#if !workspacesCollapsed}
      <div class="panel-content">
        <slot name="workspaces" />
      </div>
    {/if}
  </div>

  {#if samplesOpen && !workspacesCollapsed}
    <!-- SPLITTER 2 -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="panel-splitter"
      class:dragging={activeSplitter === 2}
      on:mousedown={(e) => startDrag(2, e)}
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize Workspaces and Samples panels"
    >
      <div class="splitter-line"></div>
    </div>
  {/if}

  <!-- AREA 3: SAMPLES (Minimizado por padrão) -->
  <div
    class="sidebar-panel panel-samples"
    style={!samplesOpen ? 'flex: 0 0 auto;' : `flex: ${samplesHeight} 1 0px;`}
    on:contextmenu={handleSamplesContextMenu}
    role="region"
    aria-label="Samples"
  >
    <div
      class="panel-header"
      on:click={onToggleSamples}
      role="button"
      tabindex="0"
      on:keydown={(e) => e.key === 'Enter' && onToggleSamples()}
    >
      <span class="panel-caret">{samplesOpen ? '▾' : '▸'}</span>
      <span class="panel-icon">🧪</span>
      <span class="panel-title">SAMPLES</span>
      <span class="panel-badge-subtle">{samplesOpen ? 'Expanded' : 'Collapsed'}</span>
    </div>
    {#if samplesOpen}
      <div class="panel-content">
        <slot name="samples" />
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .sidebar-panels-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--theme-bg-chrome, #181818);
    user-select: none;
  }

  .sidebar-panel {
    display: flex;
    flex-direction: column;
    min-height: 28px;
    overflow: hidden;
    position: relative;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    background: var(--theme-bg-chrome, #181818);
    border-bottom: 1px solid var(--theme-b-subtle, #282828);
    color: var(--theme-t-muted, #9d9d9d);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.1s,
      color 0.1s;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.05));
      color: var(--theme-t-bright, #ffffff);
    }
  }

  .panel-caret {
    font-size: 10px;
    width: 10px;
    text-align: center;
    flex-shrink: 0;
  }

  .panel-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .panel-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-badge-subtle {
    font-size: 9px;
    font-weight: 500;
    color: var(--theme-t-muted, #9d9d9d);
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    /* Custom elegant scrollbar */
    &::-webkit-scrollbar {
      width: 5px;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--theme-b-input, rgba(255, 255, 255, 0.15));
      border-radius: 4px;
    }
    &::-webkit-scrollbar-thumb:hover {
      background: var(--theme-b-input-hover, rgba(255, 255, 255, 0.28));
    }
  }

  .panel-splitter {
    height: 6px;
    flex-shrink: 0;
    cursor: row-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--theme-bg-chrome, #181818);
    transition: background 0.12s;
    position: relative;
    z-index: 10;
    &:hover,
    &.dragging {
      background: var(--theme-ac, #0078d4);
      .splitter-line {
        background: #ffffff;
      }
    }
  }

  .splitter-line {
    width: 32px;
    height: 2px;
    background: var(--theme-b-subtle, #333333);
    border-radius: 1px;
    transition: background 0.12s;
  }
</style>
