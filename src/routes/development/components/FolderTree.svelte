<script lang="ts">
  import type { FileEntry } from '../filesystem.js'

  export let entries: FileEntry[] = []
  export let onOpen: (entry: FileEntry) => void = () => {}
  export let depth = 0

  function toggle(entry: FileEntry) {
    entry.expanded = !entry.expanded
    entries = [...entries]
  }
</script>

{#each entries as entry (entry.path)}
  <div class="ft-item" style="padding-left: {4 + depth * 12}px">
    {#if entry.kind === 'dir'}
      <button type="button" class="ft-row" on:click={() => toggle(entry)}>
        <span class="ft-caret">{entry.expanded ? '▾' : '▸'}</span>
        <span class="ft-name ft-dir">📁 {entry.name}</span>
      </button>
      {#if entry.expanded}
        <svelte:self entries={entry.children ?? []} {onOpen} depth={depth + 1} />
      {/if}
    {:else}
      <button type="button" class="ft-row ft-file" on:click={() => onOpen(entry)}>
        <span class="ft-caret"></span>
        <span class="ft-name" title={entry.path}>📄 {entry.name}</span>
      </button>
    {/if}
  </div>
{/each}

<style lang="scss">
  .ft-item {
    font-size: 11px;
  }
  .ft-row {
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: var(--theme-t-main, #cccccc);
    text-align: left;
    cursor: pointer;
    border-radius: 2px;
    &:hover {
      background: var(--theme-bg-hover, rgba(128, 128, 128, 0.1));
    }
  }
  .ft-caret {
    width: 10px;
    font-size: 8px;
    color: var(--theme-t-muted, #888);
    flex-shrink: 0;
  }
  .ft-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ft-dir {
    color: var(--theme-t-bright, #dcdcaa);
    font-weight: 600;
  }
  .ft-file {
    padding-left: 14px;
  }
</style>
