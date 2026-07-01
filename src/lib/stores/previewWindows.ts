import { writable, get } from 'svelte/store'
import type { JSONPath } from 'immutable-json-patch'

export interface PreviewWindowState {
  id: string
  pathLabel: string
  value: string
  path: JSONPath
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
}

interface PreviewWindowsStore {
  windows: PreviewWindowState[]
  nextZIndex: number
  counter: number
}

/** Map of save callbacks, keyed by window id */
const saveCallbacks = new Map<string, (newValue: string) => void>()

function createPreviewWindowsStore() {
  const initialState: PreviewWindowsStore = {
    windows: [],
    nextZIndex: 100,
    counter: 0
  }

  const store = writable<PreviewWindowsStore>(initialState)
  const { subscribe, update } = store

  function openWindow(pathLabel: string, value: string, path: JSONPath): string {
    let id = ''
    update((state) => {
      id = `preview-${state.counter++}`
      const offset = (state.windows.length % 10) * 30
      const newWindow: PreviewWindowState = {
        id,
        pathLabel,
        value,
        path,
        x: 80 + offset,
        y: 60 + offset,
        width: 900,
        height: 500,
        zIndex: state.nextZIndex,
        minimized: false
      }

      return {
        windows: [...state.windows, newWindow],
        nextZIndex: state.nextZIndex + 1,
        counter: state.counter
      }
    })
    return id
  }

  function registerSaveCallback(id: string, callback: (newValue: string) => void) {
    saveCallbacks.set(id, callback)
  }

  function saveWindow(id: string) {
    const callback = saveCallbacks.get(id)
    if (!callback) {
      console.warn('[previewWindows] No save callback registered for window:', id)
      return
    }

    const state = get(store)
    const win = state.windows.find((w) => w.id === id)
    if (win) {
      callback(win.value)
    } else {
      console.warn('[previewWindows] Window not found for save:', id)
    }
  }

  function closeWindow(id: string) {
    saveCallbacks.delete(id)
    update((state) => ({
      ...state,
      windows: state.windows.filter((w) => w.id !== id)
    }))
  }

  function minimizeWindow(id: string) {
    update((state) => ({
      ...state,
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w
      )
    }))
  }

  function restoreWindow(id: string) {
    update((state) => ({
      ...state,
      windows: state.windows.map((w) =>
        w.id === id
          ? { ...w, minimized: false, zIndex: state.nextZIndex }
          : w
      ),
      nextZIndex: state.nextZIndex + 1
    }))
  }

  function focusWindow(id: string) {
    update((state) => ({
      ...state,
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, zIndex: state.nextZIndex } : w
      ),
      nextZIndex: state.nextZIndex + 1
    }))
  }

  function moveWindow(id: string, x: number, y: number) {
    update((state) => ({
      ...state,
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, x, y } : w
      )
    }))
  }

  function resizeWindow(id: string, width: number, height: number, x: number, y: number) {
    update((state) => ({
      ...state,
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, width, height, x, y } : w
      )
    }))
  }

  function updateWindowValue(id: string, value: string) {
    update((state) => ({
      ...state,
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, value } : w
      )
    }))
  }

  return {
    subscribe,
    openWindow,
    registerSaveCallback,
    saveWindow,
    closeWindow,
    minimizeWindow,
    restoreWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    updateWindowValue
  }
}

export const previewWindows = createPreviewWindowsStore()
