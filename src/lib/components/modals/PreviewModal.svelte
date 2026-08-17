<script lang="ts">
  /**
   * PreviewModal - modal for editing a value with real-time preview,
   * with the same layout as the other modals (Sort, Transform, Edit nested).
   * Left panel: editable textarea
   * Right panel: rendered preview based on selected format
   */
  import { onMount } from 'svelte'
  import Icon from 'svelte-awesome'
  import { faSave } from '@fortawesome/free-solid-svg-icons'
  import Header from './Header.svelte'
  import Modal from './Modal.svelte'
  import {
    renderText,
    renderHtml,
    renderMarkdown,
    renderMath,
    renderImage,
    renderUrl,
    renderHex,
    renderBinary,
    renderCsv,
    renderCode,
    detectPreviewFormat,
    CODE_LANGUAGES
  } from '$lib/utils/previewRenderers.js'
  import { previewWindows } from '$lib/stores/previewWindows.js'

  export let windowId: string = ''
  export let pathLabel: string = ''
  export let onClose: () => void = () => {}
  export let renderValue: string = ''
  export let onChangeRenderValue: (value: string) => void = () => {}
  export let inline: boolean = false
  export let onSave: ((value: string) => void) | undefined = undefined

  // Format selection
  type PreviewFormat =
    | 'markdown'
    | 'math'
    | 'html'
    | 'text'
    | 'image'
    | 'url'
    | 'csv'
    | 'code'
    | 'hex'
    | 'binary'

  let selectedFormat: PreviewFormat = 'text'
  let codeLanguage: string = 'javascript'
  let fullscreen = false

  const formats: { value: PreviewFormat; label: string }[] = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'math', label: 'Math' },
    { value: 'html', label: 'HTML' },
    { value: 'text', label: 'Text' },
    { value: 'image', label: 'Image' },
    { value: 'url', label: 'URL' },
    { value: 'csv', label: 'CSV' },
    { value: 'code', label: 'Code' },
    { value: 'hex', label: 'Hexadecimal' },
    { value: 'binary', label: 'Binary' }
  ]

  // Auto-detect the best preview format for the value when the editor opens
  onMount(() => {
    selectedFormat = detectPreviewFormat(renderValue) as PreviewFormat
  })

  let windowTitle = ''
  $: windowTitle = pathLabel ? `Edit with preview: ${pathLabel}` : 'Edit with preview'

  // Debounce for live preview updates
  let debounceTimer: ReturnType<typeof setTimeout>
  let previewHtml = ''

  // Local edit value (so cursor position is preserved)
  let editValue = renderValue

  // Sync external value changes to local edit value
  $: if (renderValue !== editValue) {
    // Only sync from external if the user didn't just type it
    // This is a one-way sync: external → internal
  }

  // Sync local edits to parent store (for live preview)
  $: {
    onChangeRenderValue(editValue)
  }

  // Initial render
  $: {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      previewHtml = renderPreview(editValue, selectedFormat, codeLanguage)
    }, 50)
  }

  function renderPreview(value: string, format: PreviewFormat, lang: string): string {
    switch (format) {
      case 'markdown':
        return renderMarkdown(value)
      case 'math':
        return renderMath(value)
      case 'html':
        return renderHtml(value)
      case 'text':
        return renderText(value)
      case 'image':
        return renderImage(value)
      case 'url':
        return renderUrl(value)
      case 'hex':
        return renderHex(value)
      case 'binary':
        return renderBinary(value)
      case 'csv':
        return renderCsv(value)
      case 'code':
        return renderCode(value, lang)
      default:
        return renderText(value)
    }
  }

  function handleFormatChange(event: Event) {
    const target = event.target as HTMLSelectElement
    selectedFormat = target.value as PreviewFormat
  }

  function handleCodeLanguageChange(event: Event) {
    const target = event.target as HTMLSelectElement
    codeLanguage = target.value
  }

  function handleSave() {
    if (onSave) {
      onSave(editValue)
      return
    }
    previewWindows.saveWindow(windowId)
  }

  function focus(element: HTMLElement) {
    element.focus()
  }
</script>

{#snippet contents()}
  <div class="jse-modal-wrapper">
    <Header title={windowTitle} fullScreenButton={!inline} bind:fullscreen {onClose} />

    <div class="jse-modal-contents">
      <!-- Toolbar -->
      <div class="jse-preview-toolbar">
        <div class="jse-preview-format-group">
          <label for="jse-format-select-{pathLabel}">Format:</label>
          <select
            id="jse-format-select-{pathLabel}"
            class="jse-preview-select"
            bind:value={selectedFormat}
            on:change={handleFormatChange}
          >
            {#each formats as fmt}
              <option value={fmt.value}>{fmt.label}</option>
            {/each}
          </select>
        </div>

        {#if selectedFormat === 'code'}
          <div class="jse-preview-format-group">
            <label for="jse-code-lang-{pathLabel}">Language:</label>
            <select
              id="jse-code-lang-{pathLabel}"
              class="jse-preview-select"
              bind:value={codeLanguage}
              on:change={handleCodeLanguageChange}
            >
              {#each CODE_LANGUAGES as lang}
                <option value={lang.value}>{lang.label}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div class="jse-preview-spacer"></div>
      </div>

      <!-- Split panels -->
      <div class="jse-preview-panels">
        <!-- Left: Editor -->
        <div class="jse-preview-editor-panel">
          <div class="jse-preview-panel-header">Value</div>
          <textarea
            class="jse-preview-textarea"
            bind:value={editValue}
            spellcheck="false"
            placeholder="Enter value to preview..."
          ></textarea>
        </div>

        <!-- Right: Preview -->
        <div class="jse-preview-render-panel">
          <div class="jse-preview-panel-header">Preview</div>
          <div class="jse-preview-render-content">
            {#if previewHtml}
              {@html previewHtml}
            {:else}
              <div class="jse-preview-empty">Enter a value to preview</div>
            {/if}
          </div>
        </div>
      </div>

      <div class="jse-actions">
        <button
          type="button"
          class="jse-primary"
          on:click={handleSave}
          use:focus
          title="Save the value back to the JSON document"
        >
          <Icon data={faSave} scale={0.7} />
          Save
        </button>
      </div>
    </div>
  </div>
{/snippet}

{#if inline}
  <div class="jse-preview-inline">
    {@render contents()}
  </div>
{:else}
  <Modal {onClose} className="jse-preview-modal" bind:fullscreen>
    {@render contents()}
  </Modal>
{/if}

<style lang="scss">
  @use '../../themes/defaults.scss';
  @use '../../styles.scss';

  $border: var(--jse-main-border, 1px solid #d7d7d7);
  $border-color: var(--jse-panel-border-color, #d7d7d7);

  .jse-preview-inline {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  .jse-modal-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;

    .jse-modal-contents {
      @include styles.jse-modal-contents;

      .jse-preview-toolbar {
        display: flex;
        align-items: center;
        gap: 16px;
        padding-bottom: defaults.$padding;
        flex-shrink: 0;
        flex-wrap: wrap;
        min-height: 34px;
      }

      .jse-preview-format-group {
        display: flex;
        align-items: center;
        gap: 6px;

        label {
          font-size: 12px;
          color: defaults.$text-color;
          white-space: nowrap;
        }
      }

      .jse-preview-select {
        padding: 2px 6px;
        font-size: 12px;
        border: defaults.$main-border;
        border-radius: 4px;
        background: defaults.$background-color;
        color: defaults.$text-color;
        cursor: pointer;

        &:focus {
          outline: 2px solid defaults.$theme-color;
          outline-offset: 1px;
        }
      }

      .jse-preview-spacer {
        flex: 1;
      }

      .jse-preview-panels {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-height: 0;
        border: defaults.$main-border;
        border-radius: styles.$border-radius;
      }

      .jse-preview-editor-panel,
      .jse-preview-render-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
      }

      .jse-preview-editor-panel {
        border-right: defaults.$main-border;
      }

      .jse-preview-panel-header {
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: defaults.$text-color;
        opacity: 0.7;
        background: defaults.$panel-background;
        border-bottom: defaults.$main-border;
        flex-shrink: 0;
      }

      .jse-preview-textarea {
        flex: 1;
        width: 100%;
        border: none;
        padding: 10px;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.5;
        resize: none;
        outline: none;
        background: defaults.$background-color;
        color: defaults.$text-color;
        overflow-y: auto;
        tab-size: 2;

        &::placeholder {
          color: defaults.$text-color;
          opacity: 0.4;
        }
      }

      .jse-preview-render-content {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        background: defaults.$background-color;
        color: defaults.$text-color;
      }

      .jse-preview-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: defaults.$text-color;
        opacity: 0.4;
        font-style: italic;
        font-size: 13px;
      }
    }
  }

  // Markdown styles
  :global(.jse-preview-markdown) {
    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      margin-top: 0;
      margin-bottom: 8px;
      font-weight: 600;
      line-height: 1.3;
    }

    h1 {
      font-size: 1.8em;
      border-bottom: 1px solid $border-color;
      padding-bottom: 6px;
    }
    h2 {
      font-size: 1.5em;
      border-bottom: 1px solid $border-color;
      padding-bottom: 4px;
    }
    h3 {
      font-size: 1.25em;
    }
    h4 {
      font-size: 1.1em;
    }
    h5 {
      font-size: 1em;
    }
    h6 {
      font-size: 0.9em;
      opacity: 0.8;
    }

    p {
      margin: 0 0 8px 0;
    }

    ul,
    ol {
      margin: 0 0 8px 0;
      padding-left: 24px;
    }

    li {
      margin-bottom: 2px;
    }

    code {
      background: rgba(128, 128, 128, 0.15);
      padding: 2px 5px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
    }

    pre {
      background: rgba(128, 128, 128, 0.1);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 0 0 8px 0;

      code {
        background: none;
        padding: 0;
        border-radius: 0;
      }
    }

    blockquote {
      border-left: 3px solid $border-color;
      margin: 0 0 8px 0;
      padding: 4px 12px;
      opacity: 0.85;
    }

    a {
      color: #4a9eff;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    img {
      max-width: 100%;
      border-radius: 4px;
    }

    hr {
      border: none;
      border-top: 1px solid $border-color;
      margin: 12px 0;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 8px;

      th,
      td {
        border: 1px solid $border-color;
        padding: 4px 8px;
        text-align: left;
        font-size: 0.9em;
      }

      th {
        background: rgba(128, 128, 128, 0.1);
        font-weight: 600;
      }
    }
  }

  // Math styles
  :global(.jse-preview-math-display) {
    display: block;
    text-align: center;
    padding: 12px 0;
    font-family: 'Times New Roman', serif;
    font-style: italic;
    font-size: 1.15em;
    overflow-x: auto;
  }

  :global(.jse-preview-math-inline) {
    font-family: 'Times New Roman', serif;
    font-style: italic;
  }

  // HTML styles (minimal reset for embedded HTML)
  :global(.jse-preview-html) {
    // Inherit from parent
  }

  // Text styles
  :global(.jse-preview-text) {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.5;
  }

  // Image styles
  :global(.jse-preview-image) {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100px;

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
    }
  }

  :global(.jse-preview-error) {
    color: #e81123;
    font-style: italic;
  }

  // CSV table styles
  :global(.jse-preview-csv) {
    overflow-x: auto;

    .jse-csv-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;

      th,
      td {
        border: 1px solid $border-color;
        padding: 4px 8px;
        text-align: left;
        white-space: nowrap;
      }

      th {
        background: rgba(128, 128, 128, 0.15);
        font-weight: 600;
        position: sticky;
        top: 0;
      }
    }
  }

  // Code syntax highlighting
  :global(.jse-preview-code) {
    margin: 0;
    padding: 10px;
    background: rgba(128, 128, 128, 0.08);
    border-radius: 4px;
    overflow-x: auto;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre;
    tab-size: 2;

    code {
      font-family: inherit;
      font-size: inherit;
    }
  }

  // URL (site) preview
  :global(.jse-preview-url) {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;

    .jse-url-frame {
      flex: 1;
      width: 100%;
      border: 1px solid $border-color;
      border-radius: 4px;
      background: white;
      min-height: 200px;
    }

    .jse-url-link {
      margin: 8px 0 0 0;
      font-size: 12px;

      a {
        color: #4a9eff;
        text-decoration: none;
        word-break: break-all;

        &:hover {
          text-decoration: underline;
        }
      }
    }
  }

  // Hexadecimal preview
  :global(.jse-preview-hex) {
    .jse-hex-pairs {
      margin: 0;
      padding: 10px;
      background: rgba(128, 128, 128, 0.08);
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      color: #569cd6;
    }

    .jse-hex-ascii {
      margin: 8px 0 0 0;
      padding: 10px;
      background: rgba(128, 128, 128, 0.05);
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
    }
  }

  // Binary preview
  :global(.jse-preview-binary) {
    .jse-binary-bits {
      margin: 0;
      padding: 10px;
      background: rgba(128, 128, 128, 0.08);
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      color: #6a9955;
    }
  }

  :global(.jse-string) {
    color: #ce9178;
  }
  :global(.jse-keyword) {
    color: #569cd6;
    font-weight: bold;
  }
  :global(.jse-number) {
    color: #b5cea8;
  }
  :global(.jse-comment) {
    color: #6a9955;
    font-style: italic;
  }
  :global(.jse-boolean) {
    color: #569cd6;
  }
  :global(.jse-tag) {
    color: #569cd6;
  }
  :global(.jse-attr) {
    color: #9cdcfe;
  }
  :global(.jse-property) {
    color: #dcdcaa;
  }
  :global(.jse-value) {
    color: #ce9178;
  }
  :global(.jse-selector) {
    color: #d7ba7d;
  }
</style>
