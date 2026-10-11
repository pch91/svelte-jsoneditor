<script lang="ts">
  import type { WorkspaceFlowGroup } from '../flowTypes.js'

  export let open = false
  export let title = 'Save Spatial Flow'
  export let initialName = 'My Spatial Flow'
  export let groups: WorkspaceFlowGroup[] = []
  export let selectedGroupId = ''
  export let onSave: (name: string, groupId: string, newGroupName?: string) => void
  export let onClose: () => void

  let flowName = ''
  let chosenGroupId = ''
  let creatingNewGroup = false
  let newGroupName = ''
  let errorMsg = ''

  $: if (open) {
    flowName = initialName.trim() || 'My Spatial Flow'
    chosenGroupId = selectedGroupId || (groups[0]?.id ?? 'new')
    creatingNewGroup = groups.length === 0 || chosenGroupId === 'new'
    newGroupName = ''
    errorMsg = ''
  }

  function handleGroupSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value
    if (val === '__new__') {
      creatingNewGroup = true
    } else {
      creatingNewGroup = false
      chosenGroupId = val
    }
  }

  function handleSubmit() {
    errorMsg = ''
    const trimmedName = flowName.trim()
    if (!trimmedName) {
      errorMsg = 'Please provide a name for the Spatial Flow.'
      return
    }

    if (creatingNewGroup) {
      const trimmedGroup = newGroupName.trim()
      if (!trimmedGroup) {
        errorMsg = 'Please provide a name for the new Group.'
        return
      }
      onSave(trimmedName, '', trimmedGroup)
    } else {
      onSave(trimmedName, chosenGroupId, undefined)
    }
    onClose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !creatingNewGroup)) {
      handleSubmit()
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div class="modal-backdrop" on:click={onClose} role="dialog" aria-modal="true" tabindex="-1">
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-dialog" on:click|stopPropagation on:keydown={handleKeydown}>
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-icon">💾</span>
          <h2 class="modal-title">{title}</h2>
        </div>
        <button class="modal-close-btn" on:click={onClose} title="Close (Esc)">✕</button>
      </div>

      <div class="modal-body">
        {#if errorMsg}
          <div class="modal-error-banner">{errorMsg}</div>
        {/if}

        <label class="modal-field">
          <span class="modal-label">Flow Name</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            class="modal-input"
            bind:value={flowName}
            placeholder="e.g. Auth & Token Refresh Flow"
            autofocus
          />
        </label>

        <label class="modal-field">
          <span class="modal-label">Target Group</span>
          <select class="modal-select" on:change={handleGroupSelect} value={creatingNewGroup ? '__new__' : chosenGroupId}>
            {#each groups as g}
              <option value={g.id}>📁 {g.name}</option>
            {/each}
            <option value="__new__">＋ Create new Group…</option>
          </select>
        </label>

        {#if creatingNewGroup}
          <label class="modal-field">
            <span class="modal-label">New Group Name</span>
            <input
              type="text"
              class="modal-input"
              bind:value={newGroupName}
              placeholder="e.g. Authentication, Billing, Cart…"
            />
          </label>
        {/if}
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" on:click={onClose}>Cancel</button>
        <button type="button" class="btn btn-primary" on:click={handleSubmit}>Save Flow</button>
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-dialog {
    background: var(--theme-bg-panel, #202021);
    color: var(--theme-t-main, #d4d4d4);
    border: 1px solid var(--theme-b-main, #333333);
    border-radius: 8px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: popIn 0.15s ease-out;
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--theme-bg-chrome, #181818);
    border-bottom: 1px solid var(--theme-b-subtle, #282828);
  }

  .modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .modal-icon {
    font-size: 16px;
  }

  .modal-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--theme-t-bright, #ffffff);
  }

  .modal-close-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #9d9d9d);
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    &:hover {
      color: var(--theme-t-bright, #ffffff);
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
    }
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .modal-error-banner {
    padding: 8px 12px;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    font-size: 12px;
  }

  .modal-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .modal-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theme-t-muted, #9d9d9d);
  }

  .modal-input,
  .modal-select {
    padding: 7px 10px;
    font-size: 13px;
    background: var(--theme-bg-input, #202022);
    color: var(--theme-t-bright, #ffffff);
    border: 1px solid var(--theme-b-input, #3c3c3c);
    border-radius: 4px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    &:focus {
      border-color: var(--theme-ac, #0078d4);
      box-shadow: 0 0 0 1px var(--theme-ac, #0078d4);
    }
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    background: var(--theme-bg-chrome, #181818);
    border-top: 1px solid var(--theme-b-subtle, #282828);
  }

  .btn {
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .btn-secondary {
    background: transparent;
    color: var(--theme-t-main, #d4d4d4);
    border: 1px solid var(--theme-b-main, #333333);
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--theme-t-bright, #ffffff);
    }
  }

  .btn-primary {
    background: var(--theme-ac, #0078d4);
    color: #ffffff;
    border: 1px solid var(--theme-ac-hover, #1177bb);
    &:hover {
      background: var(--theme-ac-hover, #1177bb);
    }
  }
</style>
