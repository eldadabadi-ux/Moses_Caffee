import { saveToDir, hasDir } from './saveFolder'

export async function downloadFile({ blob, filename }) {
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)

  // 1. If the user picked a persistent save folder (desktop), write there silently.
  try {
    if (!isMobile && await hasDir()) {
      const ok = await saveToDir(blob, filename)
      if (ok) return
      // permission denied / error → fall through to Save-As
    }
  } catch { /* fall through */ }

  // 2. Desktop Save-As dialog (File System Access API).
  if (!isMobile && typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = filename.split('.').pop().toLowerCase()
      const typeMap = {
        xlsx: { description: 'Excel Spreadsheet', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
        zip:  { description: 'ZIP Archive',        accept: { 'application/zip': ['.zip'] } },
        html: { description: 'HTML Document',      accept: { 'text/html': ['.html'] } },
        json: { description: 'JSON File',          accept: { 'application/json': ['.json'] } },
      }
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: typeMap[ext] ? [typeMap[ext]] : undefined,
      })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }

  // 3. Fallback: anchor-click download (mobile + all other browsers).
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
