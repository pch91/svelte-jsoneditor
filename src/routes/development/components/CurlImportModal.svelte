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
  /* Matches the svelte-jsoneditor modal standard with dark IDE theme by default */
  .curl-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .curl-modal {
    width: 640px;
    max-width: 95vw;
    max-height: 90vh;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 6px;
    box-shadow: var(--theme-shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.65));
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: var(--theme-t-main, #cccccc);
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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
    color: #999999;
    line-height: 1.45;
  }
  .curl-modal-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .curl-tool-btn {
    background: var(--theme-bg-panel, #323233);
    color: var(--theme-t-main, #cccccc);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 3px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .curl-tool-btn:hover {
    background: var(--theme-bg-hover, #3c3c3d);
    color: var(--theme-t-bright, #ffffff);
  }
  .curl-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-family:
      'dejavu sans mono', 'droid sans mono', consolas, monaco, 'lucida console', 'courier new',
      courier, monospace, sans-serif;
    font-size: 13px;
    background: var(--theme-bg-input, #1e1e1e);
    color: var(--theme-t-bright, #cccccc);
    border: 1px solid var(--theme-b-input, #3e3e42);
    border-radius: 3px;
    outline: none;
    resize: vertical;
    min-height: 140px;
    line-height: 1.45;
    transition: border-color 0.12s ease;
  }
  .curl-textarea:focus {
    border-color: var(--theme-ac, #0078d4);
  }
  .curl-textarea::placeholder {
    color: var(--theme-t-muted, #666666);
  }
  .curl-preview {
    background: var(--theme-bg-input, #1e1e1e);
    border: 1px solid var(--theme-b-subtle, #3e3e42);
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
    color: #cccccc;
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
    color: #cccccc;
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
    background: #323233;
    color: #cccccc;
    border-radius: 3px;
  }
  .curl-tag-body {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
  }
  .curl-tag-auth {
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
  }
  .curl-invalid-hint {
    font-size: 12px;
    color: #f87171;
    background: rgba(239, 68, 68, 0.15);
    padding: 6px 10px;
    border-radius: 3px;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .curl-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--theme-b-subtle, #3e3e42);
  }
  .curl-shortcut-hint {
    font-size: 12px;
    color: var(--theme-t-muted, #777777);
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
    transition: all 0.12s ease;
  }
  .curl-btn-cancel {
    background: var(--theme-bg-panel, #323233);
    color: var(--theme-t-main, #cccccc);
    border: 1px solid var(--theme-b-input, #3e3e42);
  }
  .curl-btn-cancel:hover {
    background: var(--theme-bg-hover, #3c3c3d);
    color: var(--theme-t-bright, #ffffff);
  }
  .curl-btn-primary {
    background: var(--theme-ac, #3883fa);
    color: #ffffff;
    font-weight: 500;
  }
  .curl-btn-primary:hover:not(:disabled) {
    background: var(--theme-ac-hover, #2f72dd);
  }
  .curl-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Optional override when theme is explicitly set to Default (light) */
  :global(.jse-theme-default) .curl-modal {
    background: #f5f5f5;
    border-color: #d0d0d0;
    color: #4d4d4d;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
  }
  :global(.jse-theme-default) .curl-modal-desc {
    color: #4d4d4d;
  }
  :global(.jse-theme-default) .curl-tool-btn {
    background: #e8e8e8;
    color: #4d4d4d;
    border-color: #d0d0d0;
  }
  :global(.jse-theme-default) .curl-tool-btn:hover {
    background: #dcdcdc;
    color: #333333;
  }
  :global(.jse-theme-default) .curl-textarea {
    background: #ffffff;
    color: #4d4d4d;
    border-color: #d8dbdf;
  }
  :global(.jse-theme-default) .curl-textarea:focus {
    border-color: #3883fa;
  }
  :global(.jse-theme-default) .curl-textarea::placeholder {
    color: #9a9a9a;
  }
  :global(.jse-theme-default) .curl-preview {
    background: #ffffff;
    border-color: #d8dbdf;
  }
  :global(.jse-theme-default) .curl-preview-label {
    color: #4d4d4d;
  }
  :global(.jse-theme-default) .curl-preview-url {
    color: #4d4d4d;
  }
  :global(.jse-theme-default) .curl-tag {
    background: #e8e8e8;
    color: #4d4d4d;
  }
  :global(.jse-theme-default) .curl-tag-body {
    background: #d9f2e6;
    color: #1a7a4f;
  }
  :global(.jse-theme-default) .curl-tag-auth {
    background: #fdebd0;
    color: #a65f0b;
  }
  :global(.jse-theme-default) .curl-invalid-hint {
    background: #fdecea;
    color: #b3261e;
    border-color: #f5c2be;
  }
  :global(.jse-theme-default) .curl-modal-footer {
    border-top-color: transparent;
  }
  :global(.jse-theme-default) .curl-shortcut-hint {
    color: #8a8a8a;
  }
  :global(.jse-theme-default) .curl-btn-cancel {
    background: #e8e8e8;
    color: #4d4d4d;
    border-color: #d0d0d0;
  }
  :global(.jse-theme-default) .curl-btn-cancel:hover {
    background: #dcdcdc;
    color: #333333;
  }
</style>
