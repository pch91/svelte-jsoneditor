import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { tabScrollStrip } from './tabScrollAction.js'
import fs from 'node:fs'
import path from 'node:path'

describe('tabScrollAction', () => {
  let container: HTMLDivElement
  let nav: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    container.className = 'tab-bar-strip tab-bar-strip-l1'
    nav = document.createElement('nav')
    nav.className = 'tab-bar tab-bar-l1'
    container.appendChild(nav)
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('attaches scroll buttons to the tab strip', () => {
    const action = tabScrollStrip(container, { level: 1 })
    const leftBtn = container.querySelector('.tab-scroll-left')
    const rightBtn = container.querySelector('.tab-scroll-right')

    expect(leftBtn).not.toBeNull()
    expect(rightBtn).not.toBeNull()
    expect(leftBtn?.classList.contains('tab-scroll-l1')).toBe(true)
    expect(rightBtn?.classList.contains('tab-scroll-l1')).toBe(true)

    action.destroy()
    expect(container.querySelector('.tab-scroll-left')).toBeNull()
    expect(container.querySelector('.tab-scroll-right')).toBeNull()
  })

  it('toggles visible class based on overflow state', () => {
    const action = tabScrollStrip(container, { level: 1 })
    const leftBtn = container.querySelector<HTMLButtonElement>('.tab-scroll-left')!
    const rightBtn = container.querySelector<HTMLButtonElement>('.tab-scroll-right')!

    // Initially no overflow (clientWidth == scrollWidth == 0 in jsdom)
    expect(leftBtn.classList.contains('visible')).toBe(false)
    expect(rightBtn.classList.contains('visible')).toBe(false)

    // Mock overflow: scrollWidth > clientWidth
    Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 600 })
    Object.defineProperty(nav, 'scrollLeft', { configurable: true, value: 0, writable: true })

    // Trigger scroll event to recalculate
    nav.dispatchEvent(new Event('scroll'))

    expect(leftBtn.classList.contains('visible')).toBe(false)
    expect(rightBtn.classList.contains('visible')).toBe(true)

    // Now scroll halfway to the right
    nav.scrollLeft = 150
    nav.dispatchEvent(new Event('scroll'))
    expect(leftBtn.classList.contains('visible')).toBe(true)
    expect(rightBtn.classList.contains('visible')).toBe(true)

    // Scroll to the end
    nav.scrollLeft = 300
    nav.dispatchEvent(new Event('scroll'))
    expect(leftBtn.classList.contains('visible')).toBe(true)
    expect(rightBtn.classList.contains('visible')).toBe(false)

    action.destroy()
  })

  it('supports updating tab level options', () => {
    const action = tabScrollStrip(container, { level: 1 })
    const leftBtn = container.querySelector('.tab-scroll-left')!
    expect(leftBtn.classList.contains('tab-scroll-l1')).toBe(true)

    action.update({ level: 2 })
    expect(leftBtn.classList.contains('tab-scroll-l2')).toBe(true)

    action.destroy()
  })
})

describe('CompareMode CSS & Layout Rules Verification', () => {
  const compareModeFile = path.resolve(
    process.cwd(),
    'src/lib/components/modes/comparemode/CompareMode.svelte'
  )
  const content = fs.readFileSync(compareModeFile, 'utf-8')

  it('verifies standard diff-row and diff-cell min-height is 70px', () => {
    expect(content).toContain('.diff-row {')
    expect(content).toMatch(/\.diff-row\s*\{[^}]*min-height:\s*70px;/)
    expect(content).toMatch(/\.diff-cell\s*\{[^}]*min-height:\s*70px;/)
  })

  it('verifies boxes with textareas and multiline chunks have min-height 200px as required', () => {
    expect(content).toMatch(/&.has-multiline\s*\{\s*min-height:\s*200px;/)
    expect(content).toMatch(/\.has-multiline\s*&\s*\{\s*min-height:\s*200px;/)
    expect(content).toMatch(/&.is-multiline\s*\{\s*min-height:\s*200px;/)
  })

  it('verifies textareas have max-height 110px with vertical overflow auto', () => {
    // Both .is-multiline .card-val and .custom-textarea must respect max-height: 110px
    expect(content).toMatch(/\.is-multiline\s+\.card-val\s*\{[^}]*max-height:\s*110px;/)
    expect(content).toMatch(/\.is-multiline\s+\.card-val\s*\{[^}]*overflow-y:\s*auto;/)
    expect(content).toMatch(/\.custom-textarea\s*\{[^}]*max-height:\s*110px;/)
    expect(content).toMatch(/\.custom-textarea\s*\{[^}]*overflow-y:\s*auto;/)
  })

  it('verifies diff-card and card-body allow dynamic line wrapping without truncation', () => {
    expect(content).toMatch(/\.card-val\s*\{[^}]*white-space:\s*pre-wrap;/)
    expect(content).toMatch(/\.card-val\s*\{[^}]*word-break:\s*break-word;/)
    expect(content).toMatch(/\.card-val\s*\{[^}]*overflow-wrap:\s*anywhere;/)
  })
})
