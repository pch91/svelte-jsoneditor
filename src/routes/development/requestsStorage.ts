import { openDatabase, DB_STORE_REQUESTS } from './workspaceStorage.js'

export interface RequestHistoryEntry {
  id: number
  method: string
  url: string
  headers: string
  body: string
  status: number | 'error'
  statusText: string
  durationMs: number
  sizeBytes: number
  timestamp: number
  /** Response body (truncated to a max size), so history clicks can reopen it. */
  responseText?: string
}

const KEY = 'recent'
const MAX_ENTRIES = 20

export async function loadRequestHistory(): Promise<RequestHistoryEntry[]> {
  try {
    const db = await openDatabase()
    const entries = await new Promise<RequestHistoryEntry[] | undefined>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_REQUESTS, 'readonly')
      const request = tx.objectStore(DB_STORE_REQUESTS).get(KEY)
      request.onsuccess = () => resolve(request.result as RequestHistoryEntry[] | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return entries ?? []
  } catch (err) {
    console.warn('Failed to load request history', err)
    return []
  }
}

export async function saveRequestHistory(entries: RequestHistoryEntry[]): Promise<void> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_REQUESTS, 'readwrite')
      tx.objectStore(DB_STORE_REQUESTS).put(entries.slice(0, MAX_ENTRIES), KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('Failed to save request history', err)
  }
}
