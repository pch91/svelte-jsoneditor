import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { previewWindows } from './previewWindows.js'

function openFirst(): string {
  return previewWindows.openWindow('/a', '"hello"', ['a'])
}

describe('previewWindows store', () => {
  beforeEach(() => {
    // close all windows to reset global state
    get(previewWindows).windows.forEach((w) => previewWindows.closeWindow(w.id))
  })

  it('opens multiple windows at cascading positions', () => {
    const id1 = previewWindows.openWindow('/a', '1', ['a'])
    const id2 = previewWindows.openWindow('/b', '2', ['b'])

    const { windows } = get(previewWindows)
    expect(windows).toHaveLength(2)
    expect(windows.map((w) => w.id)).toEqual([id1, id2])
    expect(windows[0].minimized).toBe(false)
    expect(windows[0].maximized).toBe(false)
    expect(windows[1].x).toBeGreaterThan(windows[0].x)
  })

  it('moves and resizes a window', () => {
    const id = openFirst()
    previewWindows.moveWindow(id, 300, 200)
    previewWindows.resizeWindow(id, 640, 480, 300, 200)

    const win = get(previewWindows).windows[0]
    expect(win).toMatchObject({ x: 300, y: 200, width: 640, height: 480 })
  })

  it('maximizes and restores to the previous rect', () => {
    const id = openFirst()
    previewWindows.moveWindow(id, 123, 45)
    previewWindows.resizeWindow(id, 777, 555, 123, 45)

    previewWindows.maximizeWindow(id)
    let win = get(previewWindows).windows[0]
    expect(win.maximized).toBe(true)
    expect(win.maximizedRect).toEqual({ x: 123, y: 45, width: 777, height: 555 })

    previewWindows.restoreWindow(id)
    win = get(previewWindows).windows[0]
    expect(win.maximized).toBe(false)
    expect(win.minimized).toBe(false)
    expect(win.maximizedRect).toBeUndefined()
    expect(win).toMatchObject({ x: 123, y: 45, width: 777, height: 555 })
  })

  it('minimizes and restores from the bar', () => {
    const id = openFirst()
    previewWindows.minimizeWindow(id)
    expect(get(previewWindows).windows[0].minimized).toBe(true)

    previewWindows.restoreWindow(id)
    const win = get(previewWindows).windows[0]
    expect(win.minimized).toBe(false)
    expect(win.zIndex).toBeGreaterThanOrEqual(100)
  })

  it('restoring a minimized maximized window brings it back floating', () => {
    const id = openFirst()
    previewWindows.maximizeWindow(id)
    previewWindows.minimizeWindow(id)

    previewWindows.restoreWindow(id)
    const win = get(previewWindows).windows[0]
    expect(win.minimized).toBe(false)
    expect(win.maximized).toBe(false)
    expect(win.maximizedRect).toBeUndefined()
  })

  it('focusing a window raises its z-index above others', () => {
    const id1 = openFirst()
    const id2 = previewWindows.openWindow('/b', '2', ['b'])
    previewWindows.focusWindow(id1)

    const { windows } = get(previewWindows)
    const z1 = windows.find((w) => w.id === id1)!.zIndex
    const z2 = windows.find((w) => w.id === id2)!.zIndex
    expect(z1).toBeGreaterThan(z2)
  })

  it('closing a window removes it and keeps the others', () => {
    const id1 = openFirst()
    const id2 = previewWindows.openWindow('/b', '2', ['b'])
    previewWindows.closeWindow(id1)

    const { windows } = get(previewWindows)
    expect(windows).toHaveLength(1)
    expect(windows[0].id).toBe(id2)
  })
})
