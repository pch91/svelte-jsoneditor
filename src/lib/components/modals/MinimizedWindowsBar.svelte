<script lang="ts">
  /**
   * MinimizedWindowsBar - A bar at the bottom of the screen showing minimized preview windows.
   * Similar to LinkedIn's chat minimized windows bar.
   */
  import { previewWindows, type PreviewWindowState } from '$lib/stores/previewWindows.js'
  import { faTimes } from '@fortawesome/free-solid-svg-icons'
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
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="jse-minimized-close" on:click={(e) => handleClose(win.id, e)} title="Close">
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
    bottom: 24px;
    left: 0;
    right: 0;
    z-index: 99999;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
    padding: 0 14px 0 14px;
  }

  .jse-minimized-list {
    display: flex;
    gap: 6px;
    pointer-events: auto;
  }

  .jse-minimized-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--jse-panel-background, var(--theme-bg-card, #252526));
    border: 1px solid var(--jse-panel-border, var(--theme-b-main, #3c3c3c));
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--jse-text-color, var(--theme-t-main, #d4d4d4));
    max-width: 200px;
    box-shadow: var(--theme-shadow-md, 0 -4px 12px rgba(0, 0, 0, 0.25));
    backdrop-filter: blur(8px);
    transition: all 0.15s ease;

    &:hover {
      background: var(--jse-panel-button-background-highlight, var(--theme-bg-hover, #37373d));
      color: var(--theme-t-bright, #ffffff);
      border-color: var(--theme-ac, #0078d4);
      transform: translateY(-1px);
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
    color: var(--theme-t-muted, #9d9d9d);
    transition: all 0.12s;

    &:hover {
      background: #e81123;
      color: white;
    }
  }
</style>
