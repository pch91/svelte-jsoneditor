<script lang="ts">
  export let open = false
  export let readOnly = false
  export let mainMenuBar = true
  export let navigationBar = true
  export let statusBar = true
  export let askToFormat = true
  export let validateDoc = true
  export let customRenderer = true
  export let diffMode = false
  export let escapeCtrl = false
  export let escapeUni = false
  export let flatten = true
  export let multiQuery = true

  export let onClose: () => void = () => {}

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      onClose()
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="popover-backdrop" on:mousedown={onClose}>
    <div
      class="popover-panel"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Editor Settings"
      on:mousedown|stopPropagation
    >
      <header class="popover-header">
        <div class="header-left">
          <span class="header-icon">⚙</span>
          <div>
            <h2 class="header-title">Editor Settings & Preferences</h2>
            <p class="header-subtitle">Configure layout, chrome, validation, and encoding</p>
          </div>
        </div>
        <button
          type="button"
          class="popover-close-btn"
          title="Close Settings (Esc)"
          aria-label="Close"
          on:click={onClose}
        >
          ✕
        </button>
      </header>

      <div class="popover-body">
        <!-- VIEW & CHROME -->
        <section class="settings-group">
          <h3 class="group-title">View & Chrome</h3>
          <div class="settings-list">
            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Main Menu Bar</span>
                <span class="setting-desc">Top menu bar inside the editor panes</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Main Menu Bar"
                aria-checked={mainMenuBar}
                class="ide-toggle-switch"
                class:is-checked={mainMenuBar}
                on:click={() => (mainMenuBar = !mainMenuBar)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Breadcrumb Navigation</span>
                <span class="setting-desc">Show JSON path of the selected element</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Breadcrumb Navigation"
                aria-checked={navigationBar}
                class="ide-toggle-switch"
                class:is-checked={navigationBar}
                on:click={() => (navigationBar = !navigationBar)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Status Bar</span>
                <span class="setting-desc">Bottom bar with cursor position and stats</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Status Bar"
                aria-checked={statusBar}
                class="ide-toggle-switch"
                class:is-checked={statusBar}
                on:click={() => (statusBar = !statusBar)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>
          </div>
        </section>

        <!-- BEHAVIOR -->
        <section class="settings-group">
          <h3 class="group-title">Behavior</h3>
          <div class="settings-list">
            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Read Only</span>
                <span class="setting-desc">Lock active documents from accidental edits</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Read Only mode"
                aria-checked={readOnly}
                class="ide-toggle-switch"
                class:is-checked={readOnly}
                on:click={() => (readOnly = !readOnly)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Ask to Format</span>
                <span class="setting-desc">Confirm before formatting document</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Ask to Format"
                aria-checked={askToFormat}
                class="ide-toggle-switch"
                class:is-checked={askToFormat}
                on:click={() => (askToFormat = !askToFormat)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>
          </div>
        </section>

        <!-- VALIDATION & RENDERING -->
        <section class="settings-group">
          <h3 class="group-title">Validation & Rendering</h3>
          <div class="settings-list">
            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">JSON Schema</span>
                <span class="setting-desc">Validate against configured schema</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle JSON Schema validation"
                aria-checked={validateDoc}
                class="ide-toggle-switch"
                class:is-checked={validateDoc}
                on:click={() => (validateDoc = !validateDoc)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Custom Renderer</span>
                <span class="setting-desc">Color pickers, link decorators, and tags</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Custom Renderer"
                aria-checked={customRenderer}
                class="ide-toggle-switch"
                class:is-checked={customRenderer}
                on:click={() => (customRenderer = !customRenderer)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Compare Panes (Diff)</span>
                <span class="setting-desc">Highlight differences across split panes</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Compare Panes"
                aria-checked={diffMode}
                class="ide-toggle-switch"
                class:is-checked={diffMode}
                on:click={() => (diffMode = !diffMode)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>
          </div>
        </section>

        <!-- ENCODING & TABLE -->
        <section class="settings-group">
          <h3 class="group-title">Encoding & Options</h3>
          <div class="settings-list">
            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Escape Control Characters</span>
                <span class="setting-desc">Render \n, \t explicitly in text</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Escape Control Characters"
                aria-checked={escapeCtrl}
                class="ide-toggle-switch"
                class:is-checked={escapeCtrl}
                on:click={() => (escapeCtrl = !escapeCtrl)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Escape Unicode Characters</span>
                <span class="setting-desc">Render \uXXXX sequences</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Escape Unicode Characters"
                aria-checked={escapeUni}
                class="ide-toggle-switch"
                class:is-checked={escapeUni}
                on:click={() => (escapeUni = !escapeUni)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Flatten Columns</span>
                <span class="setting-desc">Flatten nested columns in Table mode</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Flatten Columns"
                aria-checked={flatten}
                class="ide-toggle-switch"
                class:is-checked={flatten}
                on:click={() => (flatten = !flatten)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>

            <label class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Multi Query</span>
                <span class="setting-desc">Allow multiple query languages simultaneously</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle Multi Query"
                aria-checked={multiQuery}
                class="ide-toggle-switch"
                class:is-checked={multiQuery}
                on:click={() => (multiQuery = !multiQuery)}
              >
                <span class="ide-toggle-knob"></span>
              </button>
            </label>
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 60px;
  }

  .popover-panel {
    width: 480px;
    max-width: 95vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: var(--theme-bg-card, #252526);
    color: var(--theme-t-main, #cccccc);
    border: 1px solid var(--theme-b-main, #3c3c3c);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--theme-b-main, #3c3c3c);
    background: var(--theme-bg-panel, #202021);

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-icon {
      font-size: 18px;
      color: var(--theme-ac, #0078d4);
    }

    .header-title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--theme-t-main, #e2e8f0);
    }

    .header-subtitle {
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--theme-t-sub, #888888);
    }
  }

  .popover-close-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-sub, #888888);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;

    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
      color: var(--theme-t-main, #ffffff);
    }
  }

  .popover-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .group-title {
    margin: 0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--theme-ac, #0078d4);
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--theme-bg-editor, #1e1e1e);
    border: 1px solid var(--theme-b-main, #3c3c3c);
    border-radius: 6px;
    padding: 2px;
  }

  .setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;

    &:hover {
      background: var(--theme-bg-hover, rgba(255, 255, 255, 0.04));
    }
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--theme-t-main, #cccccc);
  }

  .setting-desc {
    font-size: 10px;
    color: var(--theme-t-sub, #888888);
  }

  /* MODERN TOGGLE SWITCH */
  .ide-toggle-switch {
    width: 34px;
    height: 18px;
    border-radius: 9999px;
    background: var(--theme-bg-chrome, #181818);
    border: 1px solid var(--theme-b-main, #444444);
    position: relative;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition:
      background 0.18s ease,
      border-color 0.18s ease;

    &.is-checked {
      background: var(--theme-ac, #0078d4);
      border-color: var(--theme-ac, #0078d4);

      .ide-toggle-knob {
        transform: translateX(16px);
        background: #ffffff;
      }
    }

    .ide-toggle-knob {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--theme-t-sub, #888888);
      position: absolute;
      top: 1px;
      left: 1px;
      transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
    }
  }
</style>
