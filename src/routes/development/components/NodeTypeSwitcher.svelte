<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { FlowNodeType, FlowNode } from '../flowTypes.js'
  import { variantsOf, categoryOf } from '../flowNodeRegistry.js'

  export let node: FlowNode
  export let alignLeft = false
  export let alignBottom = false

  const dispatch = createEventDispatcher<{ select: FlowNodeType }>()

  $: category = categoryOf(node.type)
  $: variants = variantsOf(category)

  function onSelect(t: FlowNodeType) {
    dispatch('select', t)
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="node-type-switcher"
  class:align-left={alignLeft}
  class:align-bottom={alignBottom}
  on:click|stopPropagation
>
  {#each variants as variant}
    <button
      type="button"
      class="variant-btn"
      class:active={node.type === variant.type}
      style="--variant-color: {variant.accent};"
      title="{variant.label}{variant.status === 'future' ? ' (Em breve / Future)' : ''}"
      on:click|stopPropagation={() => onSelect(variant.type)}
    >
      <span class="variant-icon">{variant.icon}</span>
      <span class="variant-name">{variant.label}</span>
      {#if variant.status === 'future'}
        <span class="variant-soon">soon</span>
      {/if}
    </button>
  {/each}
</div>

<style lang="scss">
  .node-type-switcher {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 20px;
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--theme-bg-panel, #1e1e1e);
    border: 1px solid var(--theme-b-main, rgba(255, 255, 255, 0.16));
    box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(0, 0, 0, 0.1);
    border-radius: 20px;
    padding: 4px 6px;
    white-space: nowrap;
    z-index: 100;
    pointer-events: auto;
    cursor: default;

    &::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 15px;
      border-width: 5px;
      border-style: solid;
      border-color: var(--theme-b-main, rgba(255, 255, 255, 0.16)) transparent transparent
        transparent;
    }

    &.align-left {
      left: 0;

      &::after {
        left: 20px;
      }
    }

    &.align-bottom {
      bottom: auto;
      top: calc(100% + 10px);

      &::after {
        top: auto;
        bottom: 100%;
        border-color: transparent transparent var(--theme-b-main, rgba(255, 255, 255, 0.16))
          transparent;
      }
    }

    .variant-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 8px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--theme-t-sub, #94a3b8);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;

      &:hover {
        background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
        color: var(--theme-t-main, #f1f5f9);
      }

      &.active {
        background: rgba(255, 255, 255, 0.12);
        color: var(--theme-t-main, #fff);
        border-color: var(--variant-color);
        box-shadow: 0 0 8px rgba(0, 0, 0, 0.2);

        .variant-icon {
          transform: scale(1.15);
        }
      }

      .variant-icon {
        font-size: 11px;
        transition: transform 0.12s ease;
      }

      .variant-name {
        line-height: 1;
      }

      .variant-soon {
        font-size: 8.5px;
        text-transform: uppercase;
        font-weight: 600;
        padding: 1px 4px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        letter-spacing: 0.4px;
      }
    }
  }

  :global(.jse-theme-default) .node-type-switcher,
  :global(.jse-theme-light) .node-type-switcher {
    background: #ffffff;
    border-color: rgba(0, 0, 0, 0.15);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);

    &::after {
      border-color: rgba(0, 0, 0, 0.15) transparent transparent transparent;
    }

    &.align-bottom::after {
      border-color: transparent transparent rgba(0, 0, 0, 0.15) transparent;
    }

    .variant-btn {
      color: #64748b;

      &:hover {
        background: rgba(0, 0, 0, 0.05);
        color: #0f172a;
      }

      &.active {
        background: #f1f5f9;
        color: #0f172a;
      }

      .variant-soon {
        background: #e2e8f0;
        color: #64748b;
      }
    }
  }
</style>
