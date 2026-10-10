<script lang="ts">
  import { tick } from 'svelte'

  interface PaletteAction {
    id: string
    label: string
    group: string
    hint?: string
    run: () => void
  }

  export let open = false
  export let actions: PaletteAction[] = []

  let query = ''
  let activeIndex = 0
  let prevOpen = false
  let inputEl: HTMLInputElement | undefined

  $: filtered =
    query.trim() === ''
      ? actions
      : actions.filter((a) => `${a.group} ${a.label}`.toLowerCase().includes(query.toLowerCase()))

  $: if (open !== prevOpen) {
    prevOpen = open
    if (open) {
      query = ''
      activeIndex = 0
      void tick().then(() => inputEl?.focus())
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length > 0) activeIndex = (activeIndex + 1) % filtered.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length > 0) activeIndex = (activeIndex - 1 + filtered.length) % filtered.length
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault()
      run(filtered[activeIndex])
    }
  }

  function run(action: PaletteAction) {
    open = false
    action.run()
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="palette-backdrop" on:click={() => (open = false)}>
    <div class="palette" role="dialog" aria-modal="true">
      <input
        bind:this={inputEl}
        bind:value={query}
        class="palette-input"
        placeholder="Type a command or search…"
        spellcheck="false"
        on:keydown={onKeydown}
      />
      <div class="palette-list">
        {#if filtered.length === 0}
          <div class="palette-empty">No matching commands</div>
        {/if}
        {#each filtered as action, i (action.id)}
          {@const showGroup = i === 0 || filtered[i - 1].group !== action.group}
          {#if showGroup}<div class="palette-group">{action.group}</div>{/if}
          <button
            type="button"
            class="palette-item"
            class:active={i === activeIndex}
            on:mousedown|preventDefault
            on:mouseenter={() => (activeIndex = i)}
            on:click={() => run(action)}
          >
            <span class="palette-label">{action.label}</span>
            {#if action.hint}<span class="palette-hint">{action.hint}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: var(--theme-bg-overlay, rgba(0, 0, 0, 0.45));
    z-index: 1000;
  }
  .palette {
    position: fixed;
    top: 15vh;
    left: 50%;
    transform: translateX(-50%);
    width: 540px;
    max-width: 92vw;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, #454545);
    border-radius: 8px;
    box-shadow: var(--theme-shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.45));
    overflow: hidden;
  }
  .palette-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    font-size: 14px;
    background: var(--theme-bg-input, #333338);
    color: var(--theme-t-bright, #e8e8e8);
    border: none;
    border-bottom: 1px solid var(--theme-b-subtle, #454545);
    outline: none;
  }
  .palette-input::placeholder {
    color: var(--theme-t-muted, #888888);
  }
  .palette-list {
    max-height: 46vh;
    overflow-y: auto;
    padding: 4px 0;
  }
  .palette-group {
    padding: 6px 12px 2px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--theme-t-muted, #777777);
  }
  .palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 7px 12px;
    border: none;
    background: transparent;
    color: var(--theme-t-main, #cccccc);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;

    &:hover:not(.active) {
      background: var(--theme-bg-hover, rgba(128, 128, 128, 0.08));
    }
  }
  .palette-item.active {
    background: var(--theme-bg-selected, #04395e);
    color: var(--theme-t-bright, #ffffff);
  }
  .palette-hint {
    font-size: 11px;
    color: var(--theme-t-muted, #888888);
  }
  .palette-item.active .palette-hint {
    color: var(--theme-accent-text, #9cdcfe);
  }
  .palette-empty {
    padding: 12px;
    color: var(--theme-t-muted, #888888);
    font-size: 12px;
  }
</style>
