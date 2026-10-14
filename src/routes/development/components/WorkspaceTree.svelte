<script lang="ts">
  import type { PrimaryTabState } from '../tabUtils.js'
  import type { WorkspaceSpatialFlow } from '../flowTypes.js'
  import type { TabMenuItem } from './TabContextMenu.svelte'

  export let primaryTabs: PrimaryTabState[] = []
  export let activePrimaryId: number = 0

  export let onSelectFlow: (primaryTabId: number, flowId: string) => void
  export let onCreateGroup: (primaryTabId: number) => void
  export let onRenameGroup: (primaryTabId: number, groupId: string, currentName: string) => void
  export let onDeleteGroup: (primaryTabId: number, groupId: string) => void
  export let onCreateFlow: (primaryTabId: number, groupId: string) => void
  export let onRenameFlow: (primaryTabId: number, flowId: string, currentName: string) => void
  export let onDeleteFlow: (primaryTabId: number, flowId: string) => void
  export let onExportFlow: (flow: WorkspaceSpatialFlow) => void
  export let onImportFlow: (primaryTabId: number, groupId: string) => void

  export let onSaveWorkspace: ((primaryId: number) => void) | undefined = undefined
  export let onExportWorkspace: ((primaryId: number) => void) | undefined = undefined
  export let onRenameWorkspace: ((primaryId: number, currentName: string) => void) | undefined =
    undefined
  export let onDuplicateWorkspace: ((primaryId: number) => void) | undefined = undefined
  export let onDeleteWorkspace: ((primaryId: number) => void) | undefined = undefined
  export let onDuplicateFlow: ((primaryId: number, flowId: string) => void) | undefined = undefined
  export let onContextMenu: ((e: MouseEvent, items: TabMenuItem[]) => void) | undefined = undefined

  // Collapse states for workspaces and groups
  let collapsedWorkspaces: Record<number, boolean> = {}
  let collapsedGroups: Record<string, boolean> = {}

  function toggleWorkspace(id: number) {
    collapsedWorkspaces[id] = !collapsedWorkspaces[id]
  }

  function toggleGroup(key: string) {
    collapsedGroups[key] = !collapsedGroups[key]
  }
</script>

<div class="ws-tree-root">
  {#if primaryTabs.length === 0}
    <div class="ws-empty">No active workspaces open</div>
  {:else}
    {#each primaryTabs as pt, ptIndex}
      {@const isCurrentPrimary = pt.id === activePrimaryId}
      {@const isWsCollapsed = !!collapsedWorkspaces[pt.id]}
      {@const groups = pt.flowGroups ?? [{ id: 'group-1', name: 'General' }]}
      {@const flows = pt.spatialFlows ?? []}

      <div class="ws-node" class:ws-active-primary={isCurrentPrimary}>
        <!-- Workspace Header (Level 1 Tab) -->
        <div
          class="ws-head"
          on:click={() => toggleWorkspace(pt.id)}
          on:contextmenu|preventDefault|stopPropagation={(e) => {
            if (onContextMenu) {
              onContextMenu(e, [
                {
                  icon: '💾',
                  label: `Save Workspace ("${pt.title}")`,
                  action: () => onSaveWorkspace && onSaveWorkspace(pt.id)
                },
                {
                  icon: '⬇',
                  label: `Export Workspace ("${pt.title}") (.jsew)`,
                  action: () => onExportWorkspace && onExportWorkspace(pt.id)
                },
                { separator: true, label: 'sep-1' },
                { icon: '📁', label: 'New Flow Group', action: () => onCreateGroup(pt.id) },
                {
                  icon: '🔀',
                  label: 'New Spatial Flow',
                  action: () => onCreateFlow(pt.id, pt.flowGroups?.[0]?.id ?? 'group-1')
                },
                { separator: true, label: 'sep-2' },
                {
                  icon: '✏️',
                  label: 'Rename Workspace…',
                  action: () => onRenameWorkspace && onRenameWorkspace(pt.id, pt.title)
                },
                {
                  icon: '📋',
                  label: 'Duplicate Workspace',
                  action: () => onDuplicateWorkspace && onDuplicateWorkspace(pt.id)
                },
                { separator: true, label: 'sep-3' },
                {
                  icon: '🗑️',
                  label: 'Close / Remove Workspace',
                  disabled: primaryTabs.length <= 1,
                  action: () => onDeleteWorkspace && onDeleteWorkspace(pt.id)
                }
              ])
            }
          }}
          role="button"
          tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && toggleWorkspace(pt.id)}
        >
          <span class="ws-caret">{isWsCollapsed ? '▸' : '▾'}</span>
          <span class="ws-icon">🗂</span>
          {#if isCurrentPrimary}
            <span class="ws-active-dot" title="Active workspace"></span>
          {/if}
          <span class="ws-title" title={`Workspace: ${pt.title}`}>{pt.title}</span>
          <div class="ws-head-actions" on:click|stopPropagation role="none">
            {#if onSaveWorkspace}
              <button
                class="ws-icon-btn"
                title="Save this workspace (.jsew)"
                on:click={() => onSaveWorkspace(pt.id)}>💾</button
              >
            {/if}
            {#if onExportWorkspace}
              <button
                class="ws-icon-btn"
                title="Export this workspace (.jsew)"
                on:click={() => onExportWorkspace(pt.id)}>⬇</button
              >
            {/if}
            <button
              class="ws-icon-btn ws-add-group-btn"
              title="Add new Group to this Workspace"
              on:click={() => onCreateGroup(pt.id)}>＋</button
            >
            {#if onDeleteWorkspace && primaryTabs.length > 1}
              <button
                class="ws-icon-btn ws-btn-danger"
                title="Close this Workspace"
                on:click={() => onDeleteWorkspace(pt.id)}>✕</button
              >
            {/if}
          </div>
        </div>

        <!-- Groups within Workspace -->
        {#if !isWsCollapsed}
          <div class="ws-groups-list">
            {#if groups.length === 0}
              <div class="ws-empty-sub">No flow groups created yet.</div>
            {/if}

            {#each groups as group}
              {@const groupKey = `${pt.id}-${group.id}`}
              {@const isGrpCollapsed = !!collapsedGroups[groupKey]}
              {@const groupFlows = flows.filter((f) => f.groupId === group.id)}

              <div class="ws-group-node">
                <!-- Group Header -->
                <div
                  class="ws-group-head"
                  on:click={() => toggleGroup(groupKey)}
                  on:contextmenu|preventDefault|stopPropagation={(e) => {
                    if (onContextMenu) {
                      onContextMenu(e, [
                        {
                          icon: '🔀',
                          label: `New Spatial Flow in "${group.name}"`,
                          action: () => onCreateFlow(pt.id, group.id)
                        },
                        {
                          icon: '📥',
                          label: 'Import Flow (.flow.json) into this group',
                          action: () => onImportFlow(pt.id, group.id)
                        },
                        { separator: true, label: 'sep-1' },
                        {
                          icon: '✏️',
                          label: 'Rename Group…',
                          action: () => onRenameGroup(pt.id, group.id, group.name)
                        },
                        { separator: true, label: 'sep-2' },
                        {
                          icon: '🗑️',
                          label: 'Delete Group',
                          disabled: (pt.flowGroups?.length ?? 0) <= 1,
                          action: () => onDeleteGroup(pt.id, group.id)
                        }
                      ])
                    }
                  }}
                  role="button"
                  tabindex="0"
                  on:keydown={(e) => e.key === 'Enter' && toggleGroup(groupKey)}
                >
                  <span class="ws-caret">{isGrpCollapsed ? '▸' : '▾'}</span>
                  <span class="ws-group-icon">📁</span>
                  <span class="ws-group-name" title={group.name}>{group.name}</span>
                  <span class="ws-count-badge">{groupFlows.length}</span>

                  <div class="ws-group-actions" on:click|stopPropagation role="none">
                    <button
                      class="ws-icon-btn"
                      title="New Spatial Flow in this group"
                      on:click={() => onCreateFlow(pt.id, group.id)}>＋</button
                    >
                    <button
                      class="ws-icon-btn"
                      title="Import Spatial Flow (.json) into this group"
                      on:click={() => onImportFlow(pt.id, group.id)}>📥</button
                    >
                    <button
                      class="ws-icon-btn"
                      title="Rename group"
                      on:click={() => onRenameGroup(pt.id, group.id, group.name)}>✏️</button
                    >
                    {#if groups.length > 1}
                      <button
                        class="ws-icon-btn ws-btn-danger"
                        title="Delete group"
                        on:click={() => onDeleteGroup(pt.id, group.id)}>🗑️</button
                      >
                    {/if}
                  </div>
                </div>

                <!-- Flows in Group -->
                {#if !isGrpCollapsed}
                  <div class="ws-flows-list">
                    {#if groupFlows.length === 0}
                      <div class="ws-empty-sub">
                        <span>Empty group.</span>
                        <button class="ws-link-btn" on:click={() => onCreateFlow(pt.id, group.id)}
                          >+ Add Flow</button
                        >
                      </div>
                    {/if}

                    {#each groupFlows as flow}
                      {@const isFlowActive = isCurrentPrimary && pt.activeSpatialFlowId === flow.id}
                      <div
                        class="ws-flow-item"
                        class:ws-flow-active={isFlowActive}
                        on:click={() => onSelectFlow(pt.id, flow.id)}
                        on:contextmenu|preventDefault|stopPropagation={(e) => {
                          if (onContextMenu) {
                            onContextMenu(e, [
                              {
                                icon: '🔀',
                                label: `Load "${flow.name}" into Canvas`,
                                action: () => onSelectFlow(pt.id, flow.id)
                              },
                              {
                                icon: '⬇',
                                label: `Export "${flow.name}" (.flow.json)`,
                                action: () => onExportFlow(flow)
                              },
                              { separator: true, label: 'sep-1' },
                              {
                                icon: '✏️',
                                label: 'Rename Spatial Flow…',
                                action: () => onRenameFlow(pt.id, flow.id, flow.name)
                              },
                              {
                                icon: '📋',
                                label: 'Duplicate Spatial Flow',
                                action: () => onDuplicateFlow && onDuplicateFlow(pt.id, flow.id)
                              },
                              { separator: true, label: 'sep-2' },
                              {
                                icon: '🗑️',
                                label: 'Delete Spatial Flow',
                                disabled: (pt.spatialFlows?.length ?? 0) <= 1,
                                action: () => onDeleteFlow(pt.id, flow.id)
                              }
                            ])
                          }
                        }}
                        role="button"
                        tabindex="0"
                        on:keydown={(e) => e.key === 'Enter' && onSelectFlow(pt.id, flow.id)}
                        title={`Click to load "${flow.name}" into Spatial Flow canvas`}
                      >
                        <span class="ws-flow-icon">🔀</span>
                        <span class="ws-flow-name">{flow.name}</span>
                        {#if isFlowActive}
                          <span class="ws-flow-status-dot" title="Loaded in canvas">●</span>
                        {/if}

                        <div class="ws-flow-actions" on:click|stopPropagation role="none">
                          <button
                            class="ws-icon-btn"
                            title="Export / Download Spatial Flow (.json)"
                            on:click={() => onExportFlow(flow)}>⬇</button
                          >
                          <button
                            class="ws-icon-btn"
                            title="Rename Spatial Flow"
                            on:click={() => onRenameFlow(pt.id, flow.id, flow.name)}>✏️</button
                          >
                          {#if flows.length > 1}
                            <button
                              class="ws-icon-btn ws-btn-danger"
                              title="Delete Spatial Flow"
                              on:click={() => onDeleteFlow(pt.id, flow.id)}>🗑️</button
                            >
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if ptIndex < primaryTabs.length - 1}
        <div class="ws-separator"></div>
      {/if}
    {/each}
  {/if}
</div>

<style lang="scss">
  .ws-tree-root {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    user-select: none;
  }

  .ws-empty {
    padding: 12px;
    font-size: 11px;
    color: var(--theme-t-muted, #9d9d9d);
    text-align: center;
  }

  .ws-empty-sub {
    padding: 4px 8px 4px 28px;
    font-size: 11px;
    color: var(--theme-t-muted, #9d9d9d);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ws-link-btn {
    background: none;
    border: none;
    color: var(--theme-ac, #0078d4);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    &:hover {
      text-decoration: underline;
    }
  }

  .ws-node {
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    transition: background 0.12s;
  }

  .ws-active-primary {
    background: rgba(0, 120, 212, 0.05);
  }

  .ws-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-bright, #ffffff);
    background: var(--theme-bg-chrome, #181818);
    border: 1px solid var(--theme-b-subtle, #282828);
    border-radius: 4px;
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
      .ws-head-actions {
        opacity: 1;
      }
    }
  }

  .ws-caret {
    font-size: 10px;
    width: 12px;
    text-align: center;
    color: var(--theme-t-muted, #9d9d9d);
  }

  .ws-icon {
    font-size: 13px;
  }

  .ws-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-active-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #0ea5e9;
    box-shadow: 0 0 6px rgba(14, 165, 233, 0.8);
    flex-shrink: 0;
  }

  .ws-head-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0.85;
    transition: opacity 0.12s;
  }

  .ws-add-group-btn {
    font-size: 13px;
    font-weight: 700;
    width: 20px;
    height: 20px;
    color: var(--theme-t-muted, #9d9d9d);
    border-radius: 3px;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.12));
      color: #38bdf8;
    }
  }

  .ws-groups-list {
    display: flex;
    flex-direction: column;
    padding-left: 8px;
    margin-top: 3px;
    gap: 2px;
  }

  .ws-group-node {
    display: flex;
    flex-direction: column;
  }

  .ws-group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--theme-t-main, #d4d4d4);
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.1s;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.06));
      color: var(--theme-t-bright, #ffffff);
      .ws-group-actions {
        opacity: 1;
      }
    }
  }

  .ws-group-icon {
    font-size: 12px;
  }

  .ws-group-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-count-badge {
    font-size: 10px;
    color: var(--theme-t-muted, #9d9d9d);
    background: rgba(255, 255, 255, 0.06);
    padding: 0 4px;
    border-radius: 8px;
  }

  .ws-group-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }

  .ws-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #9d9d9d);
    font-size: 11px;
    width: 18px;
    height: 18px;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.12));
      color: var(--theme-t-bright, #ffffff);
    }
  }

  .ws-btn-danger:hover {
    color: #f87171 !important;
  }

  .ws-flows-list {
    display: flex;
    flex-direction: column;
    padding-left: 14px;
    margin-top: 1px;
    gap: 1px;
  }

  .ws-flow-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 11px;
    color: var(--theme-t-muted, #9d9d9d);
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.12s;
    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--theme-t-bright, #ffffff);
      .ws-flow-actions {
        opacity: 1;
      }
    }
  }

  .ws-flow-active {
    background: rgba(0, 120, 212, 0.16) !important;
    color: var(--theme-accent-text, #38bdf8) !important;
    font-weight: 600;
    border-left: 2px solid var(--theme-ac, #0078d4);
  }

  .ws-flow-icon {
    font-size: 11px;
  }

  .ws-flow-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-flow-status-dot {
    font-size: 8px;
    color: var(--theme-ac, #0078d4);
  }

  .ws-flow-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }

  .ws-separator {
    height: 1px;
    background: var(--theme-b-subtle, #282828);
    margin: 6px 0;
  }
</style>
