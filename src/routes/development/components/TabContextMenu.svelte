<script lang="ts">
  interface TabMenuItem {
    label: string
    disabled?: boolean
    action: () => void
  }

  export let x = 0
  export let y = 0
  export let items: TabMenuItem[] = []
  export let onClose: () => void = () => {}

  function clampX(value: number): string {
    const maxX = typeof window === 'undefined' ? 0 : window.innerWidth - 190
    return `${Math.max(0, Math.min(value, maxX))}px`
  }

  function clampY(value: number): string {
    const maxY = typeof window === 'undefined' ? 0 : window.innerHeight - 240
    return `${Math.max(0, Math.min(value, maxY))}px`
  }

  function run(item: TabMenuItem) {
    onClose()
    item.action()
  }
</script>

<svelte:window on:mousedown={onClose} on:blur={onClose} />

<div class="tab-menu" style="left:{clampX(x)}; top:{clampY(y)}" on:mousedown|stopPropagation>
  {#each items as item (item.label)}
    <button type="button" class="tab-menu-item" disabled={item.disabled} on:click={() => run(item)}
      >{item.label}</button
    >
  {/each}
</div>

<style>
  .tab-menu {
    position: fixed;
    z-index: 1100;
    min-width: 170px;
    background: #2d2d30;
    border: 1px solid #454545;
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    padding: 3px;
  }
  .tab-menu-item {
    display: block;
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: #cccccc;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    &:hover {
      background: #04395e;
      color: #fff;
    }
    &:disabled {
      color: #666;
      cursor: default;
      &:hover {
        background: transparent;
      }
    }
  }
</style>
