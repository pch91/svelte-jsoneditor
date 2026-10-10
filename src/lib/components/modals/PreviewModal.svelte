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
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
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

<style src="./PreviewModal.scss"></style>
