/**
 * File System Access API glue: open files/folders with write-back support,
 * persist handles in IndexedDB (so saving still works after a reload), and
 * enumerate folder contents for the sidebar tree.
 */
import { openDatabase, DB_STORE_FILE_HANDLES, DB_STORE_DIRECTORY } from './workspaceStorage.js'

/** FileSystemFileHandle + permission methods missing from older lib.dom typings. */
export type FileHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

/** FileSystemDirectoryHandle + permission/entries methods missing from older lib.dom typings. */
export type DirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

export interface FileEntry {
  name: string
  kind: 'file' | 'dir'
  path: string
  handle: FileHandle | DirectoryHandle
  children?: FileEntry[]
  expanded?: boolean
}

export interface OpenedFile {
  name: string
  text: string
  handle: FileHandle
}

interface FileSystemAccessWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<FileHandle[]>
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>
}

function fsWindow(): FileSystemAccessWindow | undefined {
  if (typeof window === 'undefined') return undefined
  return window as FileSystemAccessWindow
}

export function isFileSystemAccessSupported(): boolean {
  return typeof fsWindow()?.showOpenFilePicker === 'function'
}

/** Open one or more files using the native picker (grants write-back permission). */
export async function openFilesFromDisk(): Promise<OpenedFile[]> {
  const win = fsWindow()
  if (!win?.showOpenFilePicker) return []

  const handles = await win.showOpenFilePicker({
    multiple: true,
    types: [{ description: 'JSON documents', accept: { 'application/json': ['.json'] } }]
  })

  const opened: OpenedFile[] = []
  for (const handle of handles) {
    const file = await handle.getFile()
    opened.push({ name: handle.name, text: await file.text(), handle })
  }
  return opened
}

export async function pickDirectoryHandle(): Promise<DirectoryHandle> {
  const win = fsWindow()
  if (!win?.showDirectoryPicker) throw new Error('File System Access API not supported')
  return win.showDirectoryPicker({ mode: 'readwrite' })
}

export async function readHandleText(handle: FileHandle): Promise<string> {
  const file = await handle.getFile()
  return file.text()
}

export async function writeHandleText(handle: FileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

/** Make sure the handle has readwrite permission (must be called from a user gesture). */
export async function ensureWritePermission(handle: FileHandle): Promise<boolean> {
  const current = await handle.queryPermission({ mode: 'readwrite' })
  if (current === 'granted') return true
  const requested = await handle.requestPermission({ mode: 'readwrite' })
  return requested === 'granted'
}

const MAX_DEPTH = 6
const MAX_FILES = 500

interface EnumerationContext {
  count: number
}

/** Recursively list the contents of a directory (dirs first, then files, sorted). */
export async function enumerateDirectory(
  dirHandle: DirectoryHandle,
  depth = 0,
  context: EnumerationContext = { count: 0 },
  parentPath = ''
): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  if (depth > MAX_DEPTH || context.count >= MAX_FILES) return entries

  for await (const [name, handle] of dirHandle.entries()) {
    if (context.count >= MAX_FILES) break

    const isDir = handle.kind === 'directory'
    const path = parentPath ? `${parentPath}/${name}` : name

    if (isDir) {
      const dirHandle = handle as DirectoryHandle
      const children = await enumerateDirectory(dirHandle, depth + 1, context, path)
      entries.push({ name, kind: 'dir', path, handle: dirHandle, children, expanded: false })
    } else {
      context.count++
      entries.push({ name, kind: 'file', path, handle: handle as FileHandle })
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

// ---------------------------------------------------------------------------
// Persistence of handles in IndexedDB
// ---------------------------------------------------------------------------

type StoredHandles = Array<{ tabId: number; handle: FileHandle }>

export async function saveFileHandles(map: Map<number, FileHandle>): Promise<void> {
  try {
    const entries: StoredHandles = [...map].map(([tabId, handle]) => ({ tabId, handle }))
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_FILE_HANDLES, 'readwrite')
      tx.objectStore(DB_STORE_FILE_HANDLES).put(entries, 'all')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('Failed to persist file handles', err)
  }
}

export async function loadFileHandles(): Promise<Map<number, FileHandle>> {
  const map = new Map<number, FileHandle>()
  try {
    const db = await openDatabase()
    const entries = await new Promise<StoredHandles | undefined>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_FILE_HANDLES, 'readonly')
      const request = tx.objectStore(DB_STORE_FILE_HANDLES).get('all')
      request.onsuccess = () => resolve(request.result as StoredHandles | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    entries?.forEach(({ tabId, handle }) => map.set(tabId, handle))
  } catch (err) {
    console.warn('Failed to load file handles', err)
  }
  return map
}

export async function removeFileHandle(tabId: number): Promise<void> {
  const map = await loadFileHandles()
  if (map.delete(tabId)) await saveFileHandles(map)
}

export async function saveDirectoryHandle(handle: DirectoryHandle | undefined): Promise<void> {
  if (!handle) return
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_DIRECTORY, 'readwrite')
      tx.objectStore(DB_STORE_DIRECTORY).put(handle, 'current')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('Failed to persist directory handle', err)
  }
}

export async function loadDirectoryHandle(): Promise<DirectoryHandle | undefined> {
  try {
    const db = await openDatabase()
    const handle = await new Promise<DirectoryHandle | undefined>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_DIRECTORY, 'readonly')
      const request = tx.objectStore(DB_STORE_DIRECTORY).get('current')
      request.onsuccess = () => resolve(request.result as DirectoryHandle | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return handle
  } catch (err) {
    console.warn('Failed to load directory handle', err)
    return undefined
  }
}
