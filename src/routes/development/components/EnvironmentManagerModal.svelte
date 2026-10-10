<script lang="ts">
  export let open = false
  export let environments: Record<string, Record<string, string>> = {}
  export let globalEnvironment: Record<string, string> = {}
  export let activeEnvName = ''
  export let onClose: () => void = () => {}
  export let onOpenInEditor: ((title: string, text: string) => void) | undefined = undefined

  // Selected tab in manager: 'globals' or env name
  let selectedTab: 'globals' | string = 'globals'

  $: if (open && selectedTab !== 'globals' && !environments[selectedTab]) {
    selectedTab = activeEnvName && environments[activeEnvName] ? activeEnvName : 'globals'
  }

  // Active table rows for selected tab
  interface VarRow {
    key: string
    value: string
    enabled: boolean
  }

  let rows: VarRow[] = []
  let currentEditingEnvName = ''
  let activeTabLoaded = ''
  let wasOpen = false

  function loadRowsForTab(tab: string) {
    if (tab === 'globals') {
      rows = Object.entries(globalEnvironment).map(([key, value]) => ({
        key,
        value,
        enabled: true
      }))
      currentEditingEnvName = 'Globals'
    } else if (environments[tab]) {
      rows = Object.entries(environments[tab]).map(([key, value]) => ({
        key,
        value,
        enabled: true
      }))
      currentEditingEnvName = tab
    } else {
      rows = []
      currentEditingEnvName = ''
    }
  }

  $: if (open && (!wasOpen || selectedTab !== activeTabLoaded)) {
    wasOpen = open
    activeTabLoaded = selectedTab
    loadRowsForTab(selectedTab)
  }
  $: if (!open) {
    wasOpen = false
    activeTabLoaded = ''
  }

  function syncRowsToStore() {
    const obj: Record<string, string> = {}
    rows.forEach((r) => {
      if (r.key.trim()) {
        obj[r.key.trim()] = r.value
      }
    })

    if (selectedTab === 'globals') {
      globalEnvironment = { ...obj }
    } else if (environments[selectedTab]) {
      environments[selectedTab] = { ...obj }
      environments = { ...environments }
    }
  }

  function addRow() {
    rows = [...rows, { key: '', value: '', enabled: true }]
  }

  function removeRow(idx: number) {
    rows = rows.filter((_, i) => i !== idx)
    syncRowsToStore()
  }

  function updateRow() {
    syncRowsToStore()
  }

  function createNewEnvironment() {
    const baseName = `Environment ${Object.keys(environments).length + 1}`
    environments = {
      ...environments,
      [baseName]: { baseUrl: '' }
    }
    selectedTab = baseName
    if (!activeEnvName) {
      activeEnvName = baseName
    }
  }

  function renameCurrentEnvironment() {
    if (selectedTab === 'globals') return
    const newName = currentEditingEnvName.trim()
    if (!newName || newName === selectedTab) return
    if (environments[newName]) {
      alert('An environment with this name already exists!')
      currentEditingEnvName = selectedTab
      return
    }

    const currentData = environments[selectedTab]
    const updated = { ...environments }
    delete updated[selectedTab]
    updated[newName] = currentData
    environments = updated

    if (activeEnvName === selectedTab) {
      activeEnvName = newName
    }
    selectedTab = newName
    activeTabLoaded = newName
  }

  function deleteEnvironment(name: string) {
    if (confirm(`Tem certeza que deseja excluir o ambiente "${name}"?`)) {
      const updated = { ...environments }
      delete updated[name]
      environments = updated
      if (activeEnvName === name) {
        activeEnvName = Object.keys(environments)[0] ?? ''
      }
      if (selectedTab === name) {
        selectedTab = 'globals'
      }
    }
  }

  function setActive(name: string) {
    activeEnvName = name
  }

  function openCurrentInEditor() {
    if (!onOpenInEditor) return
    if (selectedTab === 'globals') {
      onOpenInEditor('globals.json', JSON.stringify(globalEnvironment, null, 2))
    } else if (environments[selectedTab]) {
      onOpenInEditor(`${selectedTab}.json`, JSON.stringify(environments[selectedTab], null, 2))
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="env-modal-backdrop" on:click={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="env-modal-dialog" on:click|stopPropagation>
      <!-- Modal Header (Sistema Standard: azul #3883fa) -->
      <div class="env-modal-header">
        <div class="env-modal-title">
          <span class="env-header-title">Manage Environments (Postman Style)</span>
        </div>
        <button type="button" class="env-modal-close" on:click={onClose} title="Close modal">
          ×
        </button>
      </div>

      <!-- Modal Body (Sidebar + Content) -->
      <div class="env-modal-body">
        <!-- Sidebar -->
        <aside class="env-sidebar">
          <div class="env-sidebar-section">
            <span class="env-sidebar-heading">GENERAL</span>
            <button
              type="button"
              class="env-sidebar-item"
              class:active={selectedTab === 'globals'}
              on:click={() => (selectedTab = 'globals')}
            >
              <span class="item-icon">🌐</span>
              <span class="item-name">Globals</span>
              <span class="item-badge">{Object.keys(globalEnvironment).length}</span>
            </button>
          </div>

          <div class="env-sidebar-section">
            <div class="env-sidebar-heading-row">
              <span class="env-sidebar-heading">ENVIRONMENTS</span>
              <button
                type="button"
                class="env-add-btn"
                title="Create new environment"
                on:click={createNewEnvironment}
              >
                ＋ New
              </button>
            </div>

            {#if Object.keys(environments).length === 0}
              <div class="env-empty-hint">No environments yet.</div>
            {:else}
              <div class="env-list">
                {#each Object.keys(environments) as envName (envName)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="env-sidebar-item"
                    class:active={selectedTab === envName}
                    on:click={() => (selectedTab = envName)}
                  >
                    <button
                      type="button"
                      class="env-radio-btn"
                      class:is-active={activeEnvName === envName}
                      title={activeEnvName === envName ? 'Active environment' : 'Set as active'}
                      on:click|stopPropagation={() => setActive(envName)}
                    >
                      {activeEnvName === envName ? '●' : '○'}
                    </button>
                    <span class="item-name" title={envName}>{envName}</span>
                    <button
                      type="button"
                      class="env-del-btn"
                      title="Delete environment"
                      on:click|stopPropagation={() => deleteEnvironment(envName)}
                    >
                      ×
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </aside>

        <!-- Main Workspace -->
        <main class="env-content">
          {#if selectedTab === 'globals'}
            <div class="env-content-header">
              <div class="content-title-wrap">
                <div class="title-badge-row">
                  <span class="content-badge">GLOBAL</span>
                  <h2>Global Variables</h2>
                </div>
                <p class="content-subtitle">These variables are available to ALL requests in any environment.</p>
              </div>
              <div class="content-header-actions">
                {#if onOpenInEditor}
                  <button type="button" class="env-tool-btn" on:click={openCurrentInEditor}>
                    ↗ Abrir no Editor JSON
                  </button>
                {/if}
              </div>
            </div>
          {:else}
            <div class="env-content-header">
              <div class="content-title-wrap">
                <div class="env-rename-box">
                  <span class="content-badge">ENVIRONMENT</span>
                  <input
                    type="text"
                    class="env-name-input"
                    bind:value={currentEditingEnvName}
                    on:blur={renameCurrentEnvironment}
                    placeholder="Environment name..."
                  />
                </div>
                <p class="content-subtitle">Variables specific to this environment. Duplicates take priority over Globals.</p>
              </div>
              <div class="content-header-actions">
                <button
                  type="button"
                  class="env-set-active-btn"
                  class:already-active={activeEnvName === selectedTab}
                  on:click={() => setActive(selectedTab)}
                >
                  {activeEnvName === selectedTab ? '✓ Ativo' : '★ Definir como Ativo'}
                </button>
                {#if onOpenInEditor}
                  <button type="button" class="env-tool-btn" on:click={openCurrentInEditor}>
                    ↗ Editor JSON
                  </button>
                {/if}
                <button
                  type="button"
                  class="env-tool-btn env-tool-danger"
                  on:click={() => deleteEnvironment(selectedTab)}
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          {/if}

          <!-- Variables Table -->
          <div class="env-table-container">
            <div class="env-table-header">
              <span class="col-var">Variable Name</span>
              <span class="col-val">Current Value</span>
              <span class="col-act"></span>
            </div>
            {#if rows.length === 0}
              <div class="env-table-empty">
                No variables in this environment.
              </div>
            {:else}
              <div class="env-table-scroll">
                {#each rows as row, rIdx}
                  <div class="env-table-row">
                    <div class="col-var">
                      <input
                        type="text"
                        placeholder="Name (e.g. baseUrl, apiKey)"
                        bind:value={row.key}
                        on:input={updateRow}
                      />
                    </div>
                    <div class="col-val">
                      <input
                        type="text"
                        placeholder="Variable value"
                        bind:value={row.value}
                        on:input={updateRow}
                      />
                    </div>
                    <div class="col-act">
                      <button
                        type="button"
                        class="row-del-btn"
                        title="Delete variable"
                        on:click={() => removeRow(rIdx)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="env-table-footer">
            <button type="button" class="env-add-row-btn" on:click={addRow}>
              ＋ Add Variable
            </button>
          </div>
        </main>
      </div>

      <!-- Modal Footer -->
      <div class="env-modal-footer">
        <div class="env-footer-info">
          <span>Active Environment: <strong>{activeEnvName || '(None)'}</strong></span>
          {#if activeEnvName}
            <span class="env-active-meta">({Object.keys(environments[activeEnvName] ?? {}).length} variables + {Object.keys(globalEnvironment).length} globals)</span>
          {/if}
        </div>
        <button type="button" class="env-modal-done-btn jse-primary" on:click={onClose}>
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .env-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }
  .env-modal-dialog {
    display: flex;
    flex-direction: column;
    width: 880px;
    height: 580px;
    max-width: 95vw;
    max-height: 90vh;
    background: #ffffff;
    border-radius: 4px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    color: #333333;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }

  /* Header (svelte-jsoneditor standard: azul #3883fa) */
  .env-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 38px;
    background: #3883fa;
    color: #ffffff;
    user-select: none;
  }
  .env-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .env-header-title {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
  }
  .env-modal-close {
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 20px;
    line-height: 1;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .env-modal-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Body */
  .env-modal-body {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    background: #ffffff;
    overflow: hidden;
  }

  /* Sidebar */
  .env-sidebar {
    width: 220px;
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    padding: 12px 10px;
    gap: 16px;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .env-sidebar-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .env-sidebar-heading {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .env-add-btn {
    background: transparent;
    border: none;
    color: #3883fa;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    transition: background 0.15s;
  }
  .env-add-btn:hover {
    background: #e0edff;
  }
  .env-empty-hint {
    font-size: 11px;
    color: #94a3b8;
    font-style: italic;
    padding: 4px;
  }
  .env-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .env-sidebar-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: #334155;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: all 0.12s ease;
    box-sizing: border-box;
  }
  .env-sidebar-item:hover {
    background: #f1f5f9;
  }
  .env-sidebar-item.active {
    background: #e0edff;
    color: #1d4ed8;
    font-weight: 600;
  }
  .item-icon {
    font-size: 14px;
  }
  .item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-badge {
    background: #e2e8f0;
    color: #475569;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 8px;
  }
  .env-sidebar-item.active .item-badge {
    background: #bfdbfe;
    color: #1d4ed8;
  }
  .env-radio-btn {
    background: transparent;
    border: none;
    font-size: 12px;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
    padding: 0;
  }
  .env-radio-btn.is-active {
    color: #10b981;
    font-weight: bold;
  }
  .env-del-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 14px;
    cursor: pointer;
    padding: 0 4px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }
  .env-sidebar-item:hover .env-del-btn {
    opacity: 1;
  }
  .env-del-btn:hover {
    color: #ef4444;
  }

  /* Main Workspace */
  .env-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 14px 18px;
    min-height: 0;
    min-width: 0;
    background: #ffffff;
    box-sizing: border-box;
  }
  .env-content-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 12px;
    gap: 12px;
  }
  .content-title-wrap {
    flex: 1;
  }
  .title-badge-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .content-badge {
    background: #e0edff;
    color: #1d4ed8;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
  }
  .content-title-wrap h2 {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
  }
  .content-subtitle {
    font-size: 11px;
    color: #64748b;
    margin: 4px 0 0 0;
  }
  .env-rename-box {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .env-name-input {
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 3px 8px;
    outline: none;
    transition: border-color 0.15s;
  }
  .env-name-input:focus {
    border-color: #3883fa;
    box-shadow: 0 0 0 2px rgba(56, 131, 250, 0.2);
  }
  .content-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .env-set-active-btn {
    background: #10b981;
    color: #ffffff;
    border: none;
    font-size: 11px;
    font-weight: 600;
    padding: 5px 10px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .env-set-active-btn:hover {
    background: #059669;
  }
  .env-set-active-btn.already-active {
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #a7f3d0;
  }
  .env-tool-btn {
    background: #ffffff;
    border: 1px solid #d1d5db;
    color: #334155;
    font-size: 11px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .env-tool-btn:hover {
    background: #f8fafc;
    border-color: #94a3b8;
  }
  .env-tool-btn.env-tool-danger {
    color: #dc2626;
    border-color: #fecaca;
  }
  .env-tool-btn.env-tool-danger:hover {
    background: #fef2f2;
    border-color: #f87171;
  }

  /* Variables Table */
  .env-table-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    background: #ffffff;
    overflow: hidden;
  }
  .env-table-header {
    display: flex;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    letter-spacing: 0.3px;
  }
  .col-var {
    flex: 4;
  }
  .col-val {
    flex: 5;
    margin-left: 10px;
  }
  .col-act {
    width: 28px;
    text-align: center;
  }
  .env-table-scroll {
    flex: 1;
    overflow-y: auto;
  }
  .env-table-empty {
    padding: 30px;
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
  }
  .env-table-row {
    display: flex;
    align-items: center;
    padding: 4px 10px;
    border-bottom: 1px solid #f1f5f9;
  }
  .env-table-row:hover {
    background: #f8fafc;
  }
  .env-table-row input {
    width: 100%;
    font-size: 12px;
    color: #1e293b;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    padding: 4px 8px;
    outline: none;
    box-sizing: border-box;
    font-family: Consolas, Menlo, Monaco, monospace;
  }
  .env-table-row input:focus {
    border-color: #3883fa;
    box-shadow: 0 0 0 2px rgba(56, 131, 250, 0.15);
  }
  .row-del-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 16px;
    cursor: pointer;
    border-radius: 3px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .row-del-btn:hover {
    color: #ef4444;
    background: #fee2e2;
  }
  .env-table-footer {
    padding: 8px 0;
  }
  .env-add-row-btn {
    background: #ffffff;
    border: 1px dashed #3883fa;
    color: #3883fa;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .env-add-row-btn:hover {
    background: #eff6ff;
  }

  /* Modal Footer */
  .env-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    height: 44px;
    box-sizing: border-box;
  }
  .env-footer-info {
    font-size: 11px;
    color: #475569;
  }
  .env-footer-info strong {
    color: #1d4ed8;
  }
  .env-active-meta {
    color: #64748b;
    margin-left: 6px;
  }
  .env-modal-done-btn {
    background: #3883fa;
    border: none;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 18px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .env-modal-done-btn:hover {
    background: #2563eb;
  }
</style>
