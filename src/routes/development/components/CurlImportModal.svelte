<script lang="ts">
  import { tick } from 'svelte'
  import { parseCurlCommand, type ParsedCurl } from '../requestsUtils.js'

  export let open = false
  export let onImport: (curlText: string) => void
  export let onClose: () => void

  let curlText = ''
  let textareaEl: HTMLTextAreaElement | undefined
  let prevOpen = false
  let parsed: ParsedCurl | null = null

  $: if (open !== prevOpen) {
    prevOpen = open
    if (open) {
      curlText = ''
      parsed = null
      void tick().then(() => textareaEl?.focus())
    }
  }

  $: parsed = curlText.trim() ? parseCurlCommand(curlText) : null

  function handleImport() {
    if (!parsed) return
    onImport(curlText)
    onClose()
  }

  async function pasteClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        curlText = text
      }
    } catch {
      // clipboard access might be blocked by browser permissions
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (parsed) {
        e.preventDefault()
        handleImport()
      }
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="curl-modal-backdrop" on:click={onClose}>
    <div
      class="curl-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="curl-modal-title"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown={handleKeydown}
    >
      <div class="curl-modal-header">
        <div class="curl-modal-title-row">
          <span class="curl-modal-icon">📥</span>
          <span id="curl-modal-title" class="curl-modal-title">Import cURL Request</span>
          <span class="curl-modal-badge">Postman Compatible</span>
        </div>
        <button class="curl-modal-close" on:click={onClose} title="Close (Escape)">×</button>
      </div>

      <div class="curl-modal-body">
        <p class="curl-modal-desc">
          Paste a cURL command copied from Postman, browser DevTools, or terminal. Method, URL,
          query parameters, headers, authentication, and body will be extracted automatically.
        </p>

        <div class="curl-modal-toolbar">
          <button
            type="button"
            class="curl-tool-btn"
            on:click={pasteClipboard}
            title="Paste from clipboard"
          >
            📋 Paste from clipboard
          </button>
          {#if curlText.trim()}
            <button
              type="button"
              class="curl-tool-btn"
              on:click={() => (curlText = '')}
              title="Clear text"
            >
              Clear
            </button>
          {/if}
        </div>

        <textarea
          bind:this={textareaEl}
          bind:value={curlText}
          class="curl-textarea"
          rows="8"
          placeholder="curl --location 'https://api.example.com/v1/users?page=1' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <token>' \
--data '&#123;
  &quot;name&quot;: &quot;Example&quot;
&#125;'"
          spellcheck="false"
        ></textarea>

        {#if parsed}
          <div class="curl-preview">
            <div class="curl-preview-header">
              <span class="curl-preview-label">Parsed Request Preview</span>
            </div>
            <div class="curl-preview-row">
              <span class="curl-method-badge method-{parsed.method.toLowerCase()}">
                {parsed.method}
              </span>
              <span class="curl-preview-url" title={parsed.url}>{parsed.url}</span>
            </div>
            <div class="curl-preview-tags">
              {#if parsed.headerRows.length > 0}
                <span class="curl-tag">
                  {parsed.headerRows.length} header{parsed.headerRows.length === 1 ? '' : 's'}
                </span>
              {/if}
              {#if parsed.params.length > 0}
                <span class="curl-tag">
                  {parsed.params.length} query param{parsed.params.length === 1 ? '' : 's'}
                </span>
              {/if}
              {#if parsed.bodyType !== 'none'}
                <span class="curl-tag curl-tag-body">
                  Body: {parsed.bodyType.toUpperCase()} ({parsed.body.length} chars)
                </span>
              {/if}
              {#if parsed.auth}
                <span class="curl-tag curl-tag-auth">
                  Auth: {parsed.auth.type === 'bearer' ? 'Bearer token' : 'Basic auth'}
                </span>
              {/if}
            </div>
          </div>
        {:else if curlText.trim()}
          <div class="curl-invalid-hint">
            ⚠ Could not extract a valid request. Ensure the command includes a URL or starts with
            "curl".
          </div>
        {/if}
      </div>

      <div class="curl-modal-footer">
        <span class="curl-shortcut-hint">Tip: Ctrl+Enter to import</span>
        <div class="curl-footer-actions">
          <button type="button" class="curl-btn curl-btn-cancel" on:click={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="curl-btn curl-btn-primary"
            disabled={!parsed}
            on:click={handleImport}
          >
            Import Request
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .curl-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }
  .curl-modal {
    width: 620px;
    max-width: 94vw;
    background: #1e1e1e;
    border: 1px solid #3c3c3c;
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: #cccccc;
    font-size: 13px;
  }
  .curl-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #252526;
    border-bottom: 1px solid #333333;
  }
  .curl-modal-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-modal-icon {
    font-size: 15px;
  }
  .curl-modal-title {
    font-size: 13px;
    font-weight: 600;
    color: #e0e0e0;
  }
  .curl-modal-badge {
    font-size: 10px;
    background: rgba(9, 132, 227, 0.2);
    color: #4fa3ff;
    padding: 2px 6px;
    border-radius: 10px;
    border: 1px solid rgba(9, 132, 227, 0.35);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .curl-modal-close {
    background: transparent;
    border: none;
    color: #888888;
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
    padding: 0 4px;
    border-radius: 3px;
    &:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
    }
  }
  .curl-modal-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .curl-modal-desc {
    margin: 0;
    font-size: 12px;
    color: #999999;
    line-height: 1.4;
  }
  .curl-modal-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-tool-btn {
    background: #2d2d30;
    color: #cccccc;
    border: 1px solid #3e3e42;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.1s;
    &:hover {
      background: #3e3e42;
      color: #ffffff;
    }
  }
  .curl-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
    background: #181818;
    color: #e2e2e2;
    border: 1px solid #3c3c3c;
    border-radius: 5px;
    outline: none;
    resize: vertical;
    min-height: 120px;
    line-height: 1.45;
    &:focus {
      border-color: #0e639c;
    }
    &::placeholder {
      color: #666666;
    }
  }
  .curl-preview {
    background: #252526;
    border: 1px solid #383838;
    border-radius: 5px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .curl-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .curl-preview-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #888888;
  }
  .curl-preview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .curl-method-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.4px;
    flex-shrink: 0;
  }
  .method-get {
    background: rgba(78, 201, 176, 0.2);
    color: #4ec9b0;
    border: 1px solid rgba(78, 201, 176, 0.4);
  }
  .method-post {
    background: rgba(9, 132, 227, 0.2);
    color: #4fa3ff;
    border: 1px solid rgba(9, 132, 227, 0.4);
  }
  .method-put {
    background: rgba(229, 142, 38, 0.2);
    color: #e58e26;
    border: 1px solid rgba(229, 142, 38, 0.4);
  }
  .method-patch {
    background: rgba(162, 155, 254, 0.2);
    color: #a29bfe;
    border: 1px solid rgba(162, 155, 254, 0.4);
  }
  .method-delete {
    background: rgba(241, 76, 76, 0.2);
    color: #f14c4c;
    border: 1px solid rgba(241, 76, 76, 0.4);
  }
  .method-head,
  .method-options {
    background: rgba(180, 180, 180, 0.2);
    color: #dcdcdc;
    border: 1px solid rgba(180, 180, 180, 0.4);
  }
  .curl-preview-url {
    font-family: Consolas, monospace;
    font-size: 12px;
    color: #dcdcdc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .curl-preview-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .curl-tag {
    font-size: 10px;
    padding: 2px 6px;
    background: #333333;
    color: #aaaaaa;
    border-radius: 3px;
  }
  .curl-tag-body {
    background: rgba(38, 162, 105, 0.2);
    color: #89d185;
  }
  .curl-tag-auth {
    background: rgba(230, 126, 34, 0.2);
    color: #f39c12;
  }
  .curl-invalid-hint {
    font-size: 11px;
    color: #f48771;
    background: rgba(244, 135, 113, 0.1);
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid rgba(244, 135, 113, 0.25);
  }
  .curl-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #252526;
    border-top: 1px solid #333333;
  }
  .curl-shortcut-hint {
    font-size: 11px;
    color: #777777;
  }
  .curl-footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-btn {
    padding: 5px 12px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    border: none;
    transition: background 0.1s;
  }
  .curl-btn-cancel {
    background: #2d2d30;
    color: #cccccc;
    border: 1px solid #3e3e42;
    &:hover {
      background: #3e3e42;
      color: #ffffff;
    }
  }
  .curl-btn-primary {
    background: #0e639c;
    color: #ffffff;
    font-weight: 500;
    &:hover:not(:disabled) {
      background: #1177bb;
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
</style>
