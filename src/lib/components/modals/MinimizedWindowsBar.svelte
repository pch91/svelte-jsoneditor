<script lang="ts">
  /**
   * MinimizedWindowsBar - A bar at the bottom of the screen showing minimized preview windows.
   * Similar to LinkedIn's chat minimized windows bar.
   */
  import { previewWindows, type PreviewWindowState } from '$lib/stores/previewWindows.js'
  import { faWindowMaximize, faTimes } from '@fortawesome/free-solid-svg-icons'
  import Icon from 'svelte-awesome'

  let windows: PreviewWindowState[] = []

  previewWindows.subscribe((state) => {
    windows = state.windows
  })

  $: minimizedWindows = windows.filter((w) => w.minimized)

  function handleRestore(id: string) {
    previewWindows.restoreWindow(id)
  }

  function handleClose(id: string, event: MouseEvent) {
    event.stopPropagation()
    previewWindows.closeWindow(id)
  }
</script>

{#if minimizedWindows.length > 0}
  <div class="jse-minimized-bar">
    <div class="jse-minimized-list">
      {#each minimizedWindows as win (win.id)}
        <button
          class="jse-minimized-item"
          on:click={() => handleRestore(win.id)}
          title="Restore: {win.pathLabel}"
        >
          <span class="jse-minimized-label">{win.pathLabel || 'Preview'}</span>
          <span
            class="jse-minimized-close"
            on:click={(e) => handleClose(win.id, e)}
            title="Close"
          >
            <Icon data={faTimes} scale={0.6} />
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style lang="scss">
  @use '../../themes/defaults.scss';

  .jse-minimized-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
    padding: 0 12px 2px 12px;
  }

  .jse-minimized-list {
    display: flex;
    gap: 4px;
    pointer-events: auto;
  }

  .jse-minimized-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: defaults.$panel-background;
    border: defaults.$main-border;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    font-size: 12px;
    color: defaults.$text-color;
    max-width: 180px;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.15);
    transition: background 0.15s;

    &:hover {
      background: rgba(128, 128, 128, 0.15);
    }
  }

  .jse-minimized-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .jse-minimized-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    flex-shrink: 0;
    opacity: 0.5;

    &:hover {
      opacity: 1;
      background: #e81123;
      color: white;
    }
  }
</style>
