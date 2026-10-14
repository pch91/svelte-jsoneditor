<script lang="ts">
  import type { CaptureRule } from '../tabUtils.js'
  import { extractValueByPath } from '../requestsUtils.js'

  export let captures: CaptureRule[] = []
  export let sampleJsonText = ''
  export let compact = false

  let testResults: Record<number, { found: boolean; preview: string }> = {}

  function addRow() {
    captures = [...captures, { path: '', name: '', enabled: true }]
  }

  function removeRow(index: number) {
    captures = captures.filter((_, i) => i !== index)
    delete testResults[index]
  }

  function testCaptures() {
    testResults = {}
    if (!sampleJsonText.trim()) return

    try {
      const parsed: unknown = JSON.parse(sampleJsonText)
      captures.forEach((rule, idx) => {
        if (!rule.enabled || !rule.path.trim()) return
        const val = extractValueByPath(parsed, rule.path.trim())
        if (val !== undefined) {
          testResults[idx] = {
            found: true,
            preview:
              typeof val === 'object' ? JSON.stringify(val).slice(0, 30) : String(val).slice(0, 30)
          }
        } else {
          testResults[idx] = {
            found: false,
            preview: 'Not found'
          }
        }
      })
    } catch {
      // Ignore JSON parse errors during test
    }
  }
</script>

<div class="captures-container" class:compact>
  <div class="captures-header">
    <div class="captures-title">
      <span class="captures-icon">🎯</span>
      <span>Response Captures (Capture Paths)</span>
      <span class="captures-badge">{captures.length}</span>
    </div>
    <div class="captures-actions">
      {#if sampleJsonText.trim()}
        <button
          type="button"
          class="cap-btn cap-btn-test"
          title="Test paths against the last response received"
          on:click={testCaptures}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Test on Response
        </button>
      {/if}
      <button
        type="button"
        class="cap-btn cap-btn-add"
        title="Add new capture rule"
        on:click={addRow}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Add Rule
      </button>
    </div>
  </div>

  {#if captures.length === 0}
    <div class="captures-empty">
      <span class="empty-icon">🎯</span>
      <p class="empty-text">
        No capture rules defined. Extract values from the JSON response into environment variables
        (e.g. <code>data.token</code> → <code>authToken</code>).
      </p>
      <button type="button" class="cap-btn cap-btn-add" on:click={addRow}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Add First Rule
      </button>
    </div>
  {:else}
    <div class="captures-table-wrapper">
      <table class="captures-table">
        <thead>
          <tr>
            <th class="col-check" title="Enable/disable">✓</th>
            <th class="col-path">JSON Path</th>
            <th class="col-arrow"></th>
            <th class="col-var">Environment Variable</th>
            <th class="col-preview">Preview / Test</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each captures as rule, idx (idx)}
            <tr>
              <td class="col-check">
                <input type="checkbox" title="Enable this rule" bind:checked={rule.enabled} />
              </td>
              <td class="col-path">
                <input
                  type="text"
                  placeholder="e.g. data.token or id or items[0].name"
                  bind:value={rule.path}
                  spellcheck="false"
                />
              </td>
              <td class="col-arrow">→</td>
              <td class="col-var">
                <input
                  type="text"
                  placeholder="e.g. authToken or charId"
                  bind:value={rule.name}
                  spellcheck="false"
                />
              </td>
              <td class="col-preview">
                {#if testResults[idx]}
                  {#if testResults[idx].found}
                    <span class="preview-badge found" title={testResults[idx].preview}>
                      ✓ {testResults[idx].preview}
                    </span>
                  {:else}
                    <span class="preview-badge not-found"> ⚠ Not found </span>
                  {/if}
                {:else}
                  <span class="preview-placeholder">—</span>
                {/if}
              </td>
              <td class="col-actions">
                <button
                  type="button"
                  class="req-delete-btn cap-del-btn"
                  title="Remove rule"
                  on:click={() => removeRow(idx)}
                >
                  <svg
                    class="req-del-icon"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style lang="scss">
  .captures-container {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 12px;
    box-shadow: var(--theme-shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.08));
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;

    &.compact {
      padding: 6px 8px;
      gap: 6px;
      background: transparent;
      border: none;
      box-shadow: none;
    }
  }

  .captures-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
  }

  .captures-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--theme-t-bright, #e2e8f0);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .captures-badge {
    background: var(--theme-ac-subtle, rgba(0, 120, 212, 0.12));
    color: var(--theme-ac, #0078d4);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
  }

  .captures-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cap-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 500;
    border-radius: 5px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s ease;

    svg {
      flex-shrink: 0;
    }
  }

  .cap-btn-test {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);

    &:hover {
      background: rgba(16, 185, 129, 0.22);
      border-color: #10b981;
    }
  }

  :global(.jse-theme-default) .cap-btn-test,
  :global(.jse-theme-light) .cap-btn-test {
    background: rgba(16, 185, 129, 0.1);
    color: #047857;
    border-color: rgba(16, 185, 129, 0.35);

    &:hover {
      background: rgba(16, 185, 129, 0.2);
      border-color: #047857;
      color: #065f46;
    }
  }

  .cap-btn-add {
    background: var(--theme-ac, #0078d4);
    color: #ffffff;
    border: 1px solid transparent;

    &:hover {
      background: var(--theme-ac-hover, #0067b8);
      box-shadow: 0 2px 6px rgba(0, 120, 212, 0.25);
    }
  }

  :global(.jse-theme-dark) .cap-btn-add {
    background: rgba(59, 130, 246, 0.25);
    color: #93c5fd;
    border-color: rgba(59, 130, 246, 0.45);

    &:hover {
      background: rgba(59, 130, 246, 0.38);
      border-color: #93c5fd;
      color: #ffffff;
    }
  }

  .captures-empty {
    width: 100%;
    box-sizing: border-box;
    padding: 24px 16px;
    text-align: center;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 12px;
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.04));
    border-radius: 6px;
    border: 1px dashed var(--theme-b-subtle, #cbd5e1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;

    .empty-icon {
      font-size: 24px;
      opacity: 0.8;
    }

    .empty-text {
      margin: 0;
      max-width: 440px;
      line-height: 1.5;
    }

    code {
      background: var(--theme-bg-hover, rgba(0, 0, 0, 0.06));
      border: 1px solid var(--theme-b-subtle, transparent);
      padding: 1px 5px;
      border-radius: 3px;
      color: var(--theme-ac, #0078d4);
      font-family: Consolas, monospace;
      font-size: 11px;
    }
  }

  .captures-table-wrapper {
    overflow-x: auto;
  }

  .captures-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 11px;

    th {
      text-align: left;
      color: var(--theme-t-muted, #64748b);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    }

    td {
      padding: 4px 4px;
      vertical-align: middle;
    }

    tbody tr {
      transition: background-color 0.1s ease;
      &:hover {
        background: var(--theme-bg-hover, rgba(255, 255, 255, 0.03));
      }
    }
  }

  :global(.jse-theme-default) .captures-table th,
  :global(.jse-theme-light) .captures-table th {
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }

  .col-check {
    width: 36px;
    text-align: center;

    input {
      accent-color: var(--theme-ac, #0078d4);
      cursor: pointer;
      width: 14px;
      height: 14px;
      margin: 0;
    }
  }

  .col-path {
    width: 40%;
    min-width: 160px;
  }

  .col-path input,
  .col-var input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
    font-family: Consolas, monospace;
    background: var(--theme-bg-input, #ffffff);
    color: var(--theme-t-bright, #0f172a);
    border: 1px solid var(--theme-b-input, #cbd5e1);
    border-radius: 4px;
    outline: none;
    transition: all 0.12s ease;
    box-sizing: border-box;

    &:focus {
      border-color: var(--theme-ac, #0078d4);
      box-shadow: 0 0 0 2px var(--theme-ac-subtle, rgba(0, 120, 212, 0.2));
    }

    &::placeholder {
      color: var(--theme-t-muted, #94a3b8);
      opacity: 0.7;
    }
  }

  .col-arrow {
    width: 26px;
    text-align: center;
    color: var(--theme-t-muted, #64748b);
    font-weight: bold;
    user-select: none;
  }

  .col-var {
    width: 34%;
    min-width: 150px;
  }

  .col-preview {
    width: 22%;
    min-width: 110px;
    padding: 0 6px;
  }

  .preview-badge {
    display: inline-block;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-family: Consolas, monospace;

    &.found {
      background: rgba(16, 185, 129, 0.14);
      color: #047857;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }

    &.not-found {
      background: rgba(239, 68, 68, 0.12);
      color: #b91c1c;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
  }

  :global(.jse-theme-dark) .preview-badge.found {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border-color: rgba(16, 185, 129, 0.4);
  }

  :global(.jse-theme-dark) .preview-badge.not-found {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.4);
  }

  .preview-placeholder {
    color: var(--theme-t-muted, #64748b);
  }

  .col-actions {
    width: 38px;
    text-align: center;
  }

  .cap-del-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    background: transparent;
    color: var(--theme-t-muted, #94a3b8);
    border-radius: 5px;
    cursor: pointer;
    line-height: 1;
    transition: all 0.14s ease;

    .req-del-icon {
      width: 13px;
      height: 13px;
      display: block;
      pointer-events: none;
      transition: transform 0.12s ease;
    }

    &:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.35);
      color: #ef4444;
      transform: scale(1.05);

      .req-del-icon {
        transform: scale(1.08);
      }
    }

    &:active {
      transform: scale(0.95);
      background: rgba(239, 68, 68, 0.25);
    }
  }

  :global(.jse-theme-default) .cap-del-btn,
  :global(.jse-theme-light) .cap-del-btn {
    color: #64748b;
    &:hover {
      background: #fee2e2;
      border-color: #fca5a5;
      color: #dc2626;
    }
  }
</style>
