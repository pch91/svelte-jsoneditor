import { describe, expect, it } from 'vitest'
import {
  CODE_LANGUAGES,
  detectPreviewFormat,
  renderBinary,
  renderHex,
  renderImage,
  renderUrl
} from './previewRenderers.js'

// 1x1 transparent PNG
const RAW_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('CODE_LANGUAGES', () => {
  it('does not include JSON anymore', () => {
    expect(CODE_LANGUAGES.some((l) => l.value === 'json')).toBe(false)
  })
})

describe('renderImage', () => {
  it('accepts raw base64 without the data:image prefix', () => {
    const html = renderImage(RAW_PNG_BASE64)
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain(RAW_PNG_BASE64.slice(0, 20))
  })

  it('still accepts full data URLs and https URLs', () => {
    expect(renderImage('data:image/png;base64,' + RAW_PNG_BASE64)).toContain('<img')
    expect(renderImage('https://example.com/photo.png')).toContain('<img')
  })

  it('shows an error for non-image values', () => {
    expect(renderImage('hello world')).toContain('jse-preview-error')
  })
})

describe('renderUrl', () => {
  it('renders an iframe for a valid URL', () => {
    const html = renderUrl('https://example.com')
    expect(html).toContain('<iframe')
    expect(html).toContain('https://example.com')
    expect(html).toContain('jse-preview-url')
  })

  it('shows an error for invalid URLs', () => {
    const html = renderUrl('not a url')
    expect(html).toContain('jse-preview-error')
    expect(html).not.toContain('<iframe')
  })
})

describe('renderHex', () => {
  it('converts the value to uppercase hex pairs', () => {
    const html = renderHex('Hi')
    // H = 0x48, i = 0x69
    expect(html).toContain('48 69')
  })

  it('shows a decoded ascii line', () => {
    const html = renderHex('AB')
    expect(html).toContain('jse-hex-ascii')
    expect(html).toContain('AB')
  })
})

describe('renderBinary', () => {
  it('converts the value to 8-bit binary strings', () => {
    const html = renderBinary('A')
    // A = 65 = 01000001
    expect(html).toContain('01000001')
    expect(html).toContain('jse-preview-binary')
  })
})

describe('detectPreviewFormat', () => {
  it('detects image URLs', () => {
    expect(detectPreviewFormat('https://example.com/photo.png')).toBe('image')
  })

  it('detects regular URLs', () => {
    expect(detectPreviewFormat('https://example.com')).toBe('url')
  })

  it('detects raw base64 images', () => {
    expect(detectPreviewFormat(RAW_PNG_BASE64)).toBe('image')
  })

  it('detects binary-looking values', () => {
    expect(detectPreviewFormat('01001000 01101001')).toBe('binary')
  })

  it('detects hex-looking values', () => {
    expect(detectPreviewFormat('48 69 21')).toBe('hex')
  })

  it('detects csv', () => {
    expect(detectPreviewFormat('a,b\n1,2')).toBe('csv')
  })

  it('detects markdown', () => {
    expect(detectPreviewFormat('# Heading')).toBe('markdown')
  })

  it('detects math', () => {
    expect(detectPreviewFormat('formula $x^2$ here')).toBe('math')
  })

  it('detects html', () => {
    expect(detectPreviewFormat('<b>bold</b>')).toBe('html')
  })

  it('falls back to text', () => {
    expect(detectPreviewFormat('plain value')).toBe('text')
    expect(detectPreviewFormat('')).toBe('text')
  })
})
