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
          ⚡ Test on Response
        </button>
      {/if}
      <button
        type="button"
        class="cap-btn cap-btn-add"
        title="Add new capture rule"
        on:click={addRow}
      >
        ＋ Add Rule
      </button>
    </div>
  </div>

  {#if captures.length === 0}
    <div class="captures-empty">
      <p>
        No captures configured. Extract values from the JSON response into environment variables
        (ex: <code>data.token</code> → <code>token</code>).
      </p>
      <button type="button" class="cap-btn-link" on:click={addRow}>＋ Add first capture</button>
    </div>
  {:else}
    <div class="captures-table-wrapper">
      <table class="captures-table">
        <thead>
          <tr>
            <th class="col-check" title="Ativar/desativar">✓</th>
            <th class="col-path">Caminho no JSON (JSON Path)</th>
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
                <input type="checkbox" title="Habilitar esta regra" bind:checked={rule.enabled} />
              </td>
              <td class="col-path">
                <input
                  type="text"
                  placeholder="ex: data.token ou id ou items[0].name"
                  bind:value={rule.path}
                />
              </td>
              <td class="col-arrow">→</td>
              <td class="col-var">
                <input type="text" placeholder="ex: authToken ou charId" bind:value={rule.name} />
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
                  class="cap-del-btn"
                  title="Remove rule"
                  on:click={() => removeRow(idx)}>×</button
                >
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
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 10px 12px;
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
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.1));
    color: var(--theme-t-muted, #94a3b8);
    border: 1px solid var(--theme-b-subtle, rgba(255, 255, 255, 0.08));
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 10px;
  }

  .captures-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cap-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 500;
    border-radius: 5px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .cap-btn-test {
    background: rgba(16, 185, 129, 0.14);
    color: #10b981;
    border-color: rgba(16, 185, 129, 0.35);

    &:hover {
      background: rgba(16, 185, 129, 0.24);
      border-color: #10b981;
    }
  }

  :global(.jse-theme-default) .cap-btn-test,
  :global(.jse-theme-light) .cap-btn-test {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
    border-color: rgba(16, 185, 129, 0.4);

    &:hover {
      background: rgba(16, 185, 129, 0.22);
      border-color: #047857;
      color: #065f46;
    }
  }

  .cap-btn-add {
    background: var(--theme-ac, #0078d4);
    color: #ffffff;
    border-color: transparent;

    &:hover {
      background: var(--theme-ac-hover, #0067b8);
    }
  }

  :global(.jse-theme-dark) .cap-btn-add {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.4);

    &:hover {
      background: rgba(59, 130, 246, 0.3);
      border-color: #60a5fa;
    }
  }

  .captures-empty {
    padding: 14px;
    text-align: center;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 11px;
    background: var(--theme-bg-panel, rgba(0, 0, 0, 0.04));
    border-radius: 6px;
    border: 1px dashed var(--theme-b-main, #cbd5e1);

    code {
      background: var(--theme-bg-hover, rgba(0, 0, 0, 0.06));
      border: 1px solid var(--theme-b-subtle, transparent);
      padding: 2px 5px;
      border-radius: 3px;
      color: var(--theme-accent-text, #0078d4);
      font-family: Consolas, monospace;
    }
  }

  .cap-btn-link {
    margin-top: 6px;
    background: none;
    border: none;
    color: var(--theme-ac, #0078d4);
    cursor: pointer;
    font-size: 11px;
    text-decoration: underline;

    &:hover {
      color: var(--theme-ac-hover, #0067b8);
    }
  }

  .captures-table-wrapper {
    overflow-x: auto;
  }

  .captures-table {
    width: 100%;
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
    }
  }

  :global(.jse-theme-default) .captures-table th,
  :global(.jse-theme-light) .captures-table th {
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }

  .col-check {
    width: 28px;
    text-align: center;

    input {
      accent-color: var(--theme-ac, #0078d4);
      cursor: pointer;
    }
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
    width: 20px;
    text-align: center;
    color: var(--theme-t-muted, #64748b);
    font-weight: bold;
  }

  .col-preview {
    min-width: 120px;
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
    width: 28px;
    text-align: right;
  }

  .cap-del-btn {
    background: transparent;
    border: none;
    color: var(--theme-t-muted, #94a3b8);
    font-size: 14px;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: all 0.12s ease;

    &:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
  }
</style>
