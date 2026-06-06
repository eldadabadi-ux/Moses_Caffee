/**
 * saveFolder — persistent "save to this folder" using the File System Access API.
 *
 * Desktop Chromium only (showDirectoryPicker). The chosen FileSystemDirectoryHandle
 * is stored in IndexedDB (handles can't go in localStorage). On export we re-check
 * permission and write files directly into the folder. Mobile/Safari → not supported
 * (callers fall back to the normal download).
 */

const DB_NAME = 'moses_fs'
const STORE = 'handles'
const KEY = 'saveDir'

export function isFolderSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key) {
  const db = await idb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    tx.onsuccess = () => resolve(tx.result || null)
    tx.onerror = () => resolve(null)
  })
}

async function idbSet(key, val) {
  const db = await idb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key)
    tx.onsuccess = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

async function idbDel(key) {
  const db = await idb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key)
    tx.onsuccess = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

/** Prompt the user to choose a folder; persists the handle. Returns the folder name. */
export async function pickDir() {
  if (!isFolderSupported()) throw new Error('not-supported')
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await idbSet(KEY, handle)
  // remember the display name in localStorage for quick UI rendering
  try { localStorage.setItem('moses_save_dir_name', handle.name) } catch {}
  return handle.name
}

/** The saved folder's display name, or null. (Sync — from localStorage cache.) */
export function savedDirName() {
  try { return localStorage.getItem('moses_save_dir_name') } catch { return null }
}

/** Remove the saved folder. */
export async function clearDir() {
  await idbDel(KEY)
  try { localStorage.removeItem('moses_save_dir_name') } catch {}
}

async function ensurePermission(handle) {
  try {
    const opts = { mode: 'readwrite' }
    if ((await handle.queryPermission(opts)) === 'granted') return true
    if ((await handle.requestPermission(opts)) === 'granted') return true
  } catch {}
  return false
}

/**
 * Try to write a blob into the saved folder. Returns true on success.
 * Returns false if no folder is set, permission denied, or any error —
 * caller should then fall back to a normal download.
 */
export async function saveToDir(blob, filename) {
  if (!isFolderSupported()) return false
  const handle = await idbGet(KEY)
  if (!handle) return false
  if (!(await ensurePermission(handle))) return false
  try {
    const fileHandle = await handle.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  } catch {
    return false
  }
}

export async function hasDir() {
  if (!isFolderSupported()) return false
  return !!(await idbGet(KEY))
}
