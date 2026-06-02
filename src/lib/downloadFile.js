export async function downloadFile({ blob, filename }) {
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)

  if (!isMobile && typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = filename.split('.').pop().toLowerCase()
      const typeMap = {
        xlsx: { description: 'Excel Spreadsheet', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
        zip:  { description: 'ZIP Archive',        accept: { 'application/zip': ['.zip'] } },
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

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
