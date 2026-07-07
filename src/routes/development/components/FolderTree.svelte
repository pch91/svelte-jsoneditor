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
        <span class="ft-caret" />
        <span class="ft-name" title={entry.path}>📄 {entry.name}</span>
      </button>
    {/if}
  </div>
{/each}

<style>
  .ft-item {
    font-size: 11px;
  }
  .ft-row {
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    padding: 1px 4px;
    border: none;
    background: transparent;
    color: #cccccc;
    text-align: left;
    cursor: pointer;
    border-radius: 2px;
    &:hover {
      background: rgba(255, 255, 255, 0.06);
    }
  }
  .ft-caret {
    width: 10px;
    font-size: 8px;
    color: #888;
    flex-shrink: 0;
  }
  .ft-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ft-dir {
    color: #dcdcaa;
  }
  .ft-file {
    padding-left: 14px;
  }
</style>
