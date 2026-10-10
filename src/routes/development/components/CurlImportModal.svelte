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
  /* Matches the svelte-jsoneditor native modal (e.g. Transform): blue header, light body */
  .curl-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .curl-modal {
    width: 640px;
    max-width: 95vw;
    max-height: 90vh;
    background: #f5f5f5;
    border-radius: 4px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: #4d4d4d;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
  }
  .curl-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 38px;
    background: #3883fa;
    color: #ffffff;
    user-select: none;
  }
  .curl-modal-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-modal-icon {
    display: none;
  }
  .curl-modal-title {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
  }
  .curl-modal-badge {
    font-size: 10px;
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .curl-modal-close {
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
    cursor: pointer;
    border-radius: 3px;
  }
  .curl-modal-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .curl-modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
  }
  .curl-modal-desc {
    margin: 0;
    font-size: 13px;
    color: #4d4d4d;
    line-height: 1.45;
  }
  .curl-modal-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-tool-btn {
    background: #e8e8e8;
    color: #4d4d4d;
    border: 1px solid #d0d0d0;
    border-radius: 3px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .curl-tool-btn:hover {
    background: #dcdcdc;
  }
  .curl-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-family: 'dejavu sans mono', 'droid sans mono', consolas, monaco, 'lucida console',
      'courier new', courier, monospace, sans-serif;
    font-size: 13px;
    background: #ffffff;
    color: #4d4d4d;
    border: 1px solid #d8dbdf;
    border-radius: 3px;
    outline: none;
    resize: vertical;
    min-height: 140px;
    line-height: 1.45;
  }
  .curl-textarea:focus {
    border-color: #3883fa;
  }
  .curl-textarea::placeholder {
    color: #9a9a9a;
  }
  .curl-preview {
    background: #ffffff;
    border: 1px solid #d8dbdf;
    border-radius: 3px;
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
    font-size: 12px;
    font-weight: 700;
    color: #4d4d4d;
  }
  .curl-preview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .curl-method-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
    color: #ffffff;
    background: #6c757d;
  }
  .method-get {
    background: #1e9e6a;
  }
  .method-post {
    background: #3883fa;
  }
  .method-put {
    background: #e58e26;
  }
  .method-patch {
    background: #8a6df0;
  }
  .method-delete {
    background: #e0443e;
  }
  .curl-preview-url {
    font-family: 'dejavu sans mono', consolas, monospace;
    font-size: 12px;
    color: #4d4d4d;
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
    font-size: 11px;
    padding: 2px 8px;
    background: #e8e8e8;
    color: #4d4d4d;
    border-radius: 3px;
  }
  .curl-tag-body {
    background: #d9f2e6;
    color: #1a7a4f;
  }
  .curl-tag-auth {
    background: #fdebd0;
    color: #a65f0b;
  }
  .curl-invalid-hint {
    font-size: 12px;
    color: #b3261e;
    background: #fdecea;
    padding: 6px 10px;
    border-radius: 3px;
    border: 1px solid #f5c2be;
  }
  .curl-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 14px;
  }
  .curl-shortcut-hint {
    font-size: 12px;
    color: #8a8a8a;
  }
  .curl-footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-btn {
    padding: 8px 18px;
    font-size: 14px;
    border-radius: 3px;
    cursor: pointer;
    border: none;
  }
  .curl-btn-cancel {
    background: #e8e8e8;
    color: #4d4d4d;
    border: 1px solid #d0d0d0;
  }
  .curl-btn-cancel:hover {
    background: #dcdcdc;
  }
  .curl-btn-primary {
    background: #3883fa;
    color: #ffffff;
    font-weight: 500;
  }
  .curl-btn-primary:hover:not(:disabled) {
    background: #2f72dd;
  }
  .curl-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
