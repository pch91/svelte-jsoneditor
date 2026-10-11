<script context="module" lang="ts">
  export interface TabMenuItem {
    label: string
    disabled?: boolean
    separator?: boolean
    icon?: string
    action?: () => void
  }
</script>

<script lang="ts">
  export let x = 0
  export let y = 0
  export let items: TabMenuItem[] = []
  export let onClose: () => void = () => {}

  function clampX(value: number): string {
    const maxX = typeof window === 'undefined' ? 0 : window.innerWidth - 220
    return `${Math.max(0, Math.min(value, maxX))}px`
  }

  function clampY(value: number): string {
    const maxY = typeof window === 'undefined' ? 0 : window.innerHeight - 340
    return `${Math.max(0, Math.min(value, maxY))}px`
  }

  function run(item: TabMenuItem) {
    if (item.disabled || item.separator) return
    onClose()
    if (item.action) item.action()
  }
</script>

<svelte:window on:mousedown={onClose} on:blur={onClose} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tab-menu" style="left:{clampX(x)}; top:{clampY(y)}" on:mousedown|stopPropagation>
  {#each items as item, i (item.label + i)}
    {#if item.separator}
      <div class="tab-menu-separator"></div>
    {:else}
      <button
        type="button"
        class="tab-menu-item"
        disabled={item.disabled}
        on:click={() => run(item)}
      >
        {#if item.icon}
          <span class="tab-menu-icon">{item.icon}</span>
        {/if}
        <span class="tab-menu-label">{item.label}</span>
      </button>
    {/if}
  {/each}
</div>

<style lang="scss">
  .tab-menu {
    position: fixed;
    z-index: 1200;
    min-width: 190px;
    background: var(--theme-bg-chrome, #252526);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    padding: 4px;
    user-select: none;
  }
  .tab-menu-separator {
    height: 1px;
    background: var(--theme-b-subtle, rgba(255, 255, 255, 0.1));
    margin: 4px 6px;
  }
  .tab-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: var(--theme-t-main, #cccccc);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition:
      background 0.08s,
      color 0.08s;
    &:hover {
      background: var(--theme-ac, #0078d4);
      color: #ffffff;
    }
    &:disabled {
      color: var(--theme-t-muted, #666666);
      cursor: default;
      &:hover {
        background: transparent;
      }
    }
  }
  .tab-menu-icon {
    font-size: 13px;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .tab-menu-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
