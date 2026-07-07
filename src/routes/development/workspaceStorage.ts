/**
 * Workspace persistence layer.
 *
 * The app is 100% static and runs entirely in the browser, so documents and
 * the workspace layout are persisted in IndexedDB (survives reloads, larger
 * quota than localStorage).
 */

import type { SerializedLayoutNode } from './splitLayout.js'

const DB_NAME = 'svelte-jsoneditor-workspace'
const DB_VERSION = 3
const STORE_NAME = 'workspace'
const WORKSPACE_KEY = 'default'

export const DB_STORE_FILE_HANDLES = 'file-handles'
export const DB_STORE_DIRECTORY = 'directory'
export const DB_STORE_REQUESTS = 'request-history'

export interface StoredWorkspaceTab {
  id: number
  title: string
  text: string
  mode: string
}

export interface StoredWorkspace {
  version: 1 | 2
  tabs: StoredWorkspaceTab[]
  /** v1 only: flat pane list (migrated to `layout` on load). */
  panes?: { id: number; tabIdx: number }[]
  /** v2: tree-based split layout. */
  layout?: SerializedLayoutNode
  nextTabId: number
  nextPaneId?: number
  nextNodeId?: number
  splitDir?: 'vertical' | 'horizontal'
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(DB_STORE_FILE_HANDLES)) {
        db.createObjectStore(DB_STORE_FILE_HANDLES)
      }
      if (!db.objectStoreNames.contains(DB_STORE_DIRECTORY)) {
        db.createObjectStore(DB_STORE_DIRECTORY)
      }
      if (!db.objectStoreNames.contains(DB_STORE_REQUESTS)) {
        db.createObjectStore(DB_STORE_REQUESTS)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveWorkspace(workspace: StoredWorkspace): Promise<void> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(workspace, WORKSPACE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('Failed to save workspace', err)
  }
}

export async function loadWorkspace(): Promise<StoredWorkspace | undefined> {
  try {
    const db = await openDatabase()
    const workspace = await new Promise<StoredWorkspace | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get(WORKSPACE_KEY)
      request.onsuccess = () => resolve(request.result as StoredWorkspace | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return workspace
  } catch (err) {
    console.warn('Failed to load workspace', err)
    return undefined
  }
}
