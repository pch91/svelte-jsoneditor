/**
 * Preview renderers for different content types.
 * Each renderer takes a string value and returns HTML string.
 */

/** Escape HTML entities */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Render as plain text */
export function renderText(value: string): string {
  return `<pre class="jse-preview-text">${escapeHtml(value)}</pre>`
}

/** Render as HTML (raw) */
export function renderHtml(value: string): string {
  return `<div class="jse-preview-html">${value}</div>`
}

/** Simple Markdown to HTML renderer */
export function renderMarkdown(value: string): string {
  let html = escapeHtml(value)

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    return `<pre><code${langClass}>${code}</code></pre>`
  })

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold (**...** or __...__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')

  // Italic (*...* or _..._)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')

  // Images (![alt](url))
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

  // Links ([text](url))
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // Headings
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^(---|\*\*\*|___)$/gm, '<hr />')

  // Unordered lists
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // Paragraphs: wrap lines that are not already wrapped in block elements
  html = html.replace(/^(?!<[a-z]|<\/?[a-z]|<hr|<ul|<ol|<li|<blockquote)(.+)$/gm, '<p>$1</p>')

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')

  // Clean up consecutive blockquotes
  html = html.replace(/((?:<blockquote>.*<\/blockquote>\n?)+)/g, (match) => {
    const inner = match.replace(/<\/?blockquote>/g, '')
    return `<blockquote>${inner}</blockquote>`
  })

  return `<div class="jse-preview-markdown">${html}</div>`
}

/** Render math formulas using KaTeX (loaded via CDN) */
export function renderMath(value: string): string {
  let html = escapeHtml(value)

  // Display math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => {
    const escaped = escapeHtml(formula.trim())
    return `<div class="jse-preview-math-display" data-math="${escaped}">\\[${escaped}\\]</div>`
  })

  // Inline math: $...$
  html = html.replace(/\$([^$]+)\$/g, (_match, formula) => {
    const escaped = escapeHtml(formula.trim())
    return `<span class="jse-preview-math-inline" data-math="${escaped}">\\(${escaped}\\)</span>`
  })

  return `<div class="jse-preview-math">${html}</div>`
}

/** Render as image */
export function renderImage(value: string): string {
  const trimmed = value.trim()

  // Check if it's a valid URL or base64 data URL
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return `<div class="jse-preview-image"><img src="${escapeHtml(trimmed)}" alt="Preview" onerror="this.parentElement.innerHTML='<p class=\\'jse-preview-error\\'>Invalid image URL or could not load image</p>'" /></div>`
  }

  return `<div class="jse-preview-image"><p class="jse-preview-error">Not a valid image URL. Provide a full URL (https://...) or a base64 data URL (data:image/...)</p></div>`
}

/** Parse CSV and render as HTML table */
export function renderCsv(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '<div class="jse-preview-csv"><p class="jse-preview-empty">Empty CSV</p></div>'
  }

  try {
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length === 0) {
      return '<div class="jse-preview-csv"><p class="jse-preview-empty">Empty CSV</p></div>'
    }

    const parseRow = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false

      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (inQuotes) {
          if (char === '"') {
            if (i + 1 < line.length && line[i + 1] === '"') {
              current += '"'
              i++
            } else {
              inQuotes = false
            }
          } else {
            current += char
          }
        } else {
          if (char === '"') {
            inQuotes = true
          } else if (char === ',') {
            result.push(current)
            current = ''
          } else {
            current += char
          }
        }
      }
      result.push(current)
      return result
    }

    const headerRow = parseRow(lines[0])
    const dataRows = lines.slice(1).map(parseRow)

    let table = '<table class="jse-csv-table"><thead><tr>'
    for (const cell of headerRow) {
      table += `<th>${escapeHtml(cell)}</th>`
    }
    table += '</tr></thead><tbody>'
    for (const row of dataRows) {
      table += '<tr>'
      for (const cell of row) {
        table += `<td>${escapeHtml(cell)}</td>`
      }
      table += '</tr>'
    }
    table += '</tbody></table>'

    return `<div class="jse-preview-csv">${table}</div>`
  } catch {
    return `<div class="jse-preview-csv"><p class="jse-preview-error">Failed to parse CSV</p></div>`
  }
}

/** Code syntax highlighting for multiple languages */
export function renderCode(value: string, language: string): string {
  const escaped = escapeHtml(value)

  if (!language || language === 'text') {
    return `<pre class="jse-preview-code"><code>${escaped}</code></pre>`
  }

  const highlighted = highlightCode(value, language)
  return `<pre class="jse-preview-code"><code class="language-${escapeHtml(language)}">${highlighted}</code></pre>`
}

/** Map of code language options */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'java', label: 'Java' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Plain Text' }
]

/** Simple syntax highlighting using regex */
function highlightCode(code: string, language: string): string {
  // First escape HTML, then apply highlighting
  const escaped = escapeHtml(code)

  // Define patterns for each language
  const patterns: Record<string, Array<{ regex: RegExp; className: string }>> = {
    javascript: [
      // Strings
      { regex: /(&quot;[^&]*&quot;|'[^']*'|`[^`]*`)/g, className: 'jse-string' },
      // Keywords
      {
        regex: /\b(import|export|from|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|super|try|catch|finally|throw|async|await|typeof|instanceof|in|of|default|yield|delete|void)\b/g,
        className: 'jse-keyword'
      },
      // Numbers
      { regex: /\b(\d+\.?\d*)\b/g, className: 'jse-number' },
      // Comments (single line)
      { regex: /(\/\/.*$)/gm, className: 'jse-comment' },
      // Comments (multi-line)
      { regex: /(\/\*[\s\S]*?\*\/)/g, className: 'jse-comment' },
      // Boolean & null
      { regex: /\b(true|false|null|undefined)\b/g, className: 'jse-boolean' }
    ],
    typescript: [
      { regex: /(&quot;[^&]*&quot;|'[^']*'|`[^`]*`)/g, className: 'jse-string' },
      {
        regex: /\b(import|export|from|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|super|try|catch|finally|throw|async|await|typeof|instanceof|in|of|default|yield|delete|void|type|interface|enum|implements|abstract|readonly|private|public|protected|static|as|is|keyof|infer|never|unknown|any|string|number|boolean|symbol|object)\b/g,
        className: 'jse-keyword'
      },
      { regex: /\b(\d+\.?\d*)\b/g, className: 'jse-number' },
      { regex: /(\/\/.*$)/gm, className: 'jse-comment' },
      { regex: /(\/\*[\s\S]*?\*\/)/g, className: 'jse-comment' },
      { regex: /\b(true|false|null|undefined)\b/g, className: 'jse-boolean' }
    ],
    html: [
      // Tags
      { regex: /(&lt;\/?\w+[\s\S]*?&gt;)/g, className: 'jse-tag' },
      // Attributes
      { regex: /\s(\w+)=&quot;/g, className: 'jse-attr' },
      // Comments
      { regex: /(&lt;!--[\s\S]*?--&gt;)/g, className: 'jse-comment' }
    ],
    css: [
      // Properties
      { regex: /([\w-]+)\s*:/g, className: 'jse-property' },
      // Values (colors, units)
      { regex: /(#[\w]+|rgb\([^)]+\)|\d+\.?\d*(px|em|rem|%|vh|vw|s|ms|deg)?)/g, className: 'jse-value' },
      // Selectors handled by tag class
      { regex: /(\.[\w-]+|#[\w-]+)/g, className: 'jse-selector' },
      // Comments
      { regex: /(\/\*[\s\S]*?\*\/)/g, className: 'jse-comment' },
      // Important
      { regex: /(!important)/g, className: 'jse-keyword' }
    ],
    java: [
      { regex: /(&quot;[^&]*&quot;|'[^']*')/g, className: 'jse-string' },
      {
        regex: /\b(import|package|public|private|protected|static|final|class|interface|extends|implements|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|void|int|long|double|float|boolean|char|byte|short|String|Object|List|Map|Set|null|true|false|this|super|abstract|synchronized|volatile|transient|native|enum|instanceof)\b/g,
        className: 'jse-keyword'
      },
      { regex: /\b(\d+\.?\d*[fLdD]?)\b/g, className: 'jse-number' },
      { regex: /(\/\/.*$)/gm, className: 'jse-comment' },
      { regex: /(\/\*[\s\S]*?\*\/)/g, className: 'jse-comment' },
      { regex: /\b(true|false|null)\b/g, className: 'jse-boolean' }
    ],
    json: [
      { regex: /(&quot;[^&]*&quot;)/g, className: 'jse-string' },
      { regex: /\b(\d+\.?\d*)\b/g, className: 'jse-number' },
      { regex: /\b(true|false|null)\b/g, className: 'jse-boolean' }
    ]
  }

  const langPatterns = patterns[language] || patterns['javascript']

  // Apply highlighting by wrapping matches in spans
  // We need to be careful not to highlight inside already-highlighted spans
  const highlighted = langPatterns.reduce((text, { regex, className }) => {
    return text.replace(regex, `<span class="${className}">$1</span>`)
  }, escaped)

  return highlighted
}
