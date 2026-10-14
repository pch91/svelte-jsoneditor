/**
 * tabScrollAction.ts
 *
 * Action that equips horizontal tab bars with prominent, high-contrast left/right scroll controls
 * (like in database IDEs such as MongoDB Compass, DataGrip, VS Code).
 *
 * Features:
 * - High-contrast, wide scroll buttons that prevent miss-clicks.
 * - Displays immediately when pane divider reduces view or on overflow.
 * - Smooth scrolling on click.
 * - Continuous smooth glide on press & hold (mousedown).
 * - Mouse-wheel horizontal scrolling support.
 * - Auto-scrolls active tab into view when changed.
 * - Actively monitors ResizeObserver on both nav and container.
 * - Completely hides buttons when tabs fit without overflow.
 */

export interface TabScrollStripOptions {
  level: 1 | 2
}

export function tabScrollStrip(node: HTMLElement, options: TabScrollStripOptions = { level: 1 }) {
  let isDestroyed = false
  let btnLeft: HTMLButtonElement | null = null
  let btnRight: HTMLButtonElement | null = null
  let nav: HTMLElement | null = null
  let strip: HTMLElement = node
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let holdInterval: ReturnType<typeof setInterval> | undefined

  function stopHold() {
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = undefined
    }
    if (holdInterval) {
      clearInterval(holdInterval)
      holdInterval = undefined
    }
  }

  function updateScrollButtons() {
    if (!nav || !btnLeft || !btnRight || isDestroyed) return
    const scrollWidth = nav.scrollWidth
    const clientWidth = nav.clientWidth
    const scrollLeft = nav.scrollLeft
    const hasOverflow = Math.ceil(scrollWidth) > Math.floor(clientWidth) + 1

    if (!hasOverflow) {
      btnLeft.classList.remove('visible')
      btnRight.classList.remove('visible')
      return
    }

    const canScrollLeft = scrollLeft > 1
    const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1

    btnLeft.classList.toggle('visible', canScrollLeft)
    btnRight.classList.toggle('visible', canScrollRight)
  }

  function startScroll(direction: -1 | 1) {
    if (!nav) return
    const step = 220 * direction
    nav.scrollBy({ left: step, behavior: 'smooth' })

    stopHold()
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(() => {
        if (nav) {
          nav.scrollLeft += 16 * direction
          updateScrollButtons()
        }
      }, 16)
    }, 220)
  }

  function setup() {
    if (isDestroyed) return
    nav = node.classList.contains('tab-bar')
      ? node
      : (node.querySelector<HTMLElement>('.tab-bar') ?? null)

    if (!nav) {
      // Retry on next frame if child nav isn't mounted yet
      requestAnimationFrame(setup)
      return
    }

    strip = node.classList.contains('tab-bar') ? node.parentElement || node : node

    const iconSize = options.level === 1 ? 14 : 12
    btnLeft = document.createElement('button')
    btnLeft.type = 'button'
    btnLeft.className = `tab-scroll-btn tab-scroll-left tab-scroll-l${options.level}`
    btnLeft.setAttribute('aria-label', 'Scroll tabs to the left')
    btnLeft.setAttribute('title', 'Scroll tabs to the left')
    btnLeft.setAttribute('tabindex', '-1')
    btnLeft.innerHTML = `
      <span class="tab-scroll-btn-inner">
        <svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>`

    btnRight = document.createElement('button')
    btnRight.type = 'button'
    btnRight.className = `tab-scroll-btn tab-scroll-right tab-scroll-l${options.level}`
    btnRight.setAttribute('aria-label', 'Scroll tabs to the right')
    btnRight.setAttribute('title', 'Scroll tabs to the right')
    btnRight.setAttribute('tabindex', '-1')
    btnRight.innerHTML = `
      <span class="tab-scroll-btn-inner">
        <svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </span>`

    strip.appendChild(btnLeft)
    strip.appendChild(btnRight)

    const onLeftDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      startScroll(-1)
    }
    const onRightDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      startScroll(1)
    }

    btnLeft.addEventListener('mousedown', onLeftDown)
    btnLeft.addEventListener('mouseup', stopHold)
    btnLeft.addEventListener('mouseleave', stopHold)

    btnRight.addEventListener('mousedown', onRightDown)
    btnRight.addEventListener('mouseup', stopHold)
    btnRight.addEventListener('mouseleave', stopHold)

    nav.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!nav) return
        if (e.deltaY !== 0 && nav.scrollWidth > nav.clientWidth) {
          e.preventDefault()
          nav.scrollLeft += e.deltaY
          updateScrollButtons()
        }
      },
      { passive: false }
    )

    nav.addEventListener('scroll', updateScrollButtons, { passive: true })

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateScrollButtons()
      })
      resizeObserver.observe(nav)
      if (strip !== nav) {
        resizeObserver.observe(strip)
      }
    }

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        updateScrollButtons()
        const activeTab = nav?.querySelector('.tab.active') as HTMLElement | null
        if (activeTab && nav) {
          const tabLeft = activeTab.offsetLeft
          const tabRight = tabLeft + activeTab.offsetWidth
          if (tabLeft < nav.scrollLeft || tabRight > nav.scrollLeft + nav.clientWidth) {
            activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
          }
        }
      })
      mutationObserver.observe(nav, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      })
    }

    window.addEventListener('resize', updateScrollButtons, { passive: true })

    updateScrollButtons()
    requestAnimationFrame(updateScrollButtons)
    setTimeout(updateScrollButtons, 50)
    setTimeout(updateScrollButtons, 200)
  }

  setup()

  return {
    update(newOptions: TabScrollStripOptions) {
      options = newOptions
      if (btnLeft && btnRight) {
        btnLeft.className = `tab-scroll-btn tab-scroll-left tab-scroll-l${newOptions.level} ${btnLeft.classList.contains('visible') ? 'visible' : ''}`
        btnRight.className = `tab-scroll-btn tab-scroll-right tab-scroll-l${newOptions.level} ${btnRight.classList.contains('visible') ? 'visible' : ''}`
      }
      updateScrollButtons()
    },
    destroy() {
      isDestroyed = true
      stopHold()
      window.removeEventListener('resize', updateScrollButtons)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      btnLeft?.remove()
      btnRight?.remove()
    }
  }
}
