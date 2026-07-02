<script lang="ts">
  /**
   * FloatingWindow - A draggable, resizable, minimizable window component.
   * Used as the base for preview modals.
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import { faTimes, faWindowMinimize, faWindowMaximize, faWindowRestore } from '@fortawesome/free-solid-svg-icons'
  import Icon from 'svelte-awesome'

  export let title: string = ''
  export let x: number = 100
  export let y: number = 100
  export let width: number = 800
  export let height: number = 500
  export let minWidth: number = 400
  export let minHeight: number = 250
  export let minimized: boolean = false
  export let maximized: boolean = false
  export let zIndex: number = 100

  const dispatch = createEventDispatcher<{
    close: void
    minimize: void
    maximize: void
    restore: void
    focus: void
    move: { x: number; y: number }
    resize: { width: number; height: number; x: number; y: number }
  }>()

  // Saved state before maximize
  let savedState = { x: 100, y: 100, width: 800, height: 500 }

  // Dragging state
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let windowStartX = 0
  let windowStartY = 0

  // Resizing state
  let resizing = false
  let resizeEdge: 'bottom' | 'right' | 'bottom-right' = 'bottom-right'
  let resizeStartX = 0
  let resizeStartY = 0
  let resizeStartWidth = 0
  let resizeStartHeight = 0
  let resizeStartWindowX = 0
  let resizeStartWindowY = 0

  let windowEl: HTMLDivElement

  function handleDragStart(event: MouseEvent) {
    if (maximized) return
    event.preventDefault()
    dragging = true
    dragStartX = event.clientX
    dragStartY = event.clientY
    windowStartX = x
    windowStartY = y

    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', handleDragEnd)
    dispatch('focus')
  }

  function handleDragMove(event: MouseEvent) {
    if (!dragging) return
    const newX = windowStartX + (event.clientX - dragStartX)
    const newY = Math.max(0, windowStartY + (event.clientY - dragStartY))
    dispatch('move', { x: newX, y: newY })
  }

  function handleDragEnd() {
    dragging = false
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', handleDragEnd)
  }

  function handleResizeStart(event: MouseEvent, edge: 'bottom' | 'right' | 'bottom-right') {
    event.preventDefault()
    event.stopPropagation()
    resizing = true
    resizeEdge = edge
    resizeStartX = event.clientX
    resizeStartY = event.clientY
    resizeStartWidth = width
    resizeStartHeight = height
    resizeStartWindowX = x
    resizeStartWindowY = y

    window.addEventListener('mousemove', handleResizeMove)
    window.addEventListener('mouseup', handleResizeEnd)
  }

  function handleResizeMove(event: MouseEvent) {
    if (!resizing) return

    let newWidth = resizeStartWidth
    let newHeight = resizeStartHeight
    let newX = resizeStartWindowX
    let newY = resizeStartWindowY

    const deltaX = event.clientX - resizeStartX
    const deltaY = event.clientY - resizeStartY

    if (resizeEdge === 'right' || resizeEdge === 'bottom-right') {
      newWidth = Math.max(minWidth, resizeStartWidth + deltaX)
    }

    if (resizeEdge === 'bottom' || resizeEdge === 'bottom-right') {
      newHeight = Math.max(minHeight, resizeStartHeight + deltaY)
    }

    dispatch('resize', { width: newWidth, height: newHeight, x: newX, y: newY })
  }

  function handleResizeEnd() {
    resizing = false
    window.removeEventListener('mousemove', handleResizeMove)
    window.removeEventListener('mouseup', handleResizeEnd)
  }

  function handleMinimize() {
    dispatch('minimize')
  }

  function handleMaximize() {
    if (maximized) {
      dispatch('restore')
    } else {
      savedState = { x, y, width, height }
      dispatch('maximize')
    }
  }

  function handleClose() {
    dispatch('close')
  }

  function handleFocus() {
    dispatch('focus')
  }

  onDestroy(() => {
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', handleDragEnd)
    window.removeEventListener('mousemove', handleResizeMove)
    window.removeEventListener('mouseup', handleResizeEnd)
  })
</script>

{#if !minimized}
  <div
    class="jse-floating-window"
    class:jse-maximized={maximized}
    bind:this={windowEl}
    style="
      left: {maximized ? '0' : x + 'px'};
      top: {maximized ? '0' : y + 'px'};
      width: {maximized ? '100vw' : width + 'px'};
      height: {maximized ? '100vh' : height + 'px'};
      z-index: {zIndex};
    "
    on:mousedown={handleFocus}
    role="dialog"
    aria-label={title}
  >
    <!-- Header -->
    <div class="jse-floating-header" on:mousedown={handleDragStart}>
      <span class="jse-floating-title">{title}</span>
      <div class="jse-floating-actions">
        <button
          type="button"
          class="jse-floating-btn"
          on:click={handleMinimize}
          on:mousedown|stopPropagation
          title="Minimize"
          tabindex="0"
        >
          <Icon data={faWindowMinimize} scale={0.7} />
        </button>
        <button
          type="button"
          class="jse-floating-btn"
          on:click={handleMaximize}
          on:mousedown|stopPropagation
          title={maximized ? 'Restore' : 'Maximize'}
          tabindex="0"
        >
          <Icon data={maximized ? faWindowRestore : faWindowMaximize} scale={0.7} />
        </button>
        <button
          type="button"
          class="jse-floating-btn jse-floating-close"
          on:click={handleClose}
          on:mousedown|stopPropagation
          title="Close"
          tabindex="0"
        >
          <Icon data={faTimes} scale={0.7} />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="jse-floating-content">
      <slot />
    </div>

    <!-- Resize handles -->
    {#if !maximized}
      <div
        class="jse-resize-handle jse-resize-right"
        on:mousedown={(e) => handleResizeStart(e, 'right')}
      />
      <div
        class="jse-resize-handle jse-resize-bottom"
        on:mousedown={(e) => handleResizeStart(e, 'bottom')}
      />
      <div
        class="jse-resize-handle jse-resize-bottom-right"
        on:mousedown={(e) => handleResizeStart(e, 'bottom-right')}
      />
    {/if}
  </div>
{/if}

<style lang="scss">
  @use '../../themes/defaults.scss';

  $border: var(--jse-main-border, 1px solid #d7d7d7);

  .jse-floating-window {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: defaults.$background-color;
    border: defaults.$main-border;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    min-width: 300px;
    min-height: 200px;

    &.jse-maximized {
      border-radius: 0;
      border: none;
    }
  }

  .jse-floating-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: defaults.$panel-background;
    border-bottom: defaults.$main-border;
    cursor: move;
    user-select: none;
    flex-shrink: 0;
    min-height: 34px;

    &:active {
      cursor: grabbing;
    }
  }

  .jse-floating-title {
    font-size: 13px;
    font-weight: 600;
    color: defaults.$text-color;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .jse-floating-actions {
    display: flex;
    gap: 2px;
    margin-left: 8px;
    flex-shrink: 0;
  }

  .jse-floating-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    border: none;
    background: transparent;
    color: defaults.$text-color;
    cursor: pointer;
    border-radius: 4px;
    padding: 0;

    &:hover {
      background: rgba(128, 128, 128, 0.2);
    }

    &.jse-floating-close:hover {
      background: #e81123;
      color: white;
    }
  }

  .jse-floating-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  // Resize handles
  .jse-resize-handle {
    position: absolute;
    z-index: 10;

    &.jse-resize-right {
      top: 0;
      right: 0;
      width: 5px;
      height: 100%;
      cursor: ew-resize;
    }

    &.jse-resize-bottom {
      bottom: 0;
      left: 0;
      width: 100%;
      height: 5px;
      cursor: ns-resize;
    }

    &.jse-resize-bottom-right {
      bottom: 0;
      right: 0;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
    }
  }
</style>
