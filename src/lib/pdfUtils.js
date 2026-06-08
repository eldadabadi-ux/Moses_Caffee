/**
 * pdfUtils — render PDF receipts to JPEG images (one per page) so the rest of the
 * pipeline (AI scan, multi-page combine, thumbnail, lightbox, export) treats them
 * exactly like photos. pdf.js is lazy-loaded so it stays out of the main bundle.
 */

export function isPdf(file) {
  return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))
}

let _pdfjs = null
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs
  const pdfjs = await import('pdfjs-dist')
  // Bundle the worker with Vite (?url) so the API and worker versions always match.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  _pdfjs = pdfjs
  return pdfjs
}

/**
 * Convert a PDF File to an array of JPEG data URLs (one per page).
 * @returns {Promise<string[]>}
 */
export async function pdfToImages(file, { scale = 2, maxPages = 12, quality = 0.9 } = {}) {
  const pdfjs = await loadPdfjs()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const count = Math.min(pdf.numPages || 1, maxPages)
  const out = []
  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    // PDFs can be transparent — paint white so the receipt reads correctly.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    out.push(canvas.toDataURL('image/jpeg', quality))
    page.cleanup?.()
  }
  try { await pdf.cleanup?.(); pdf.destroy?.() } catch {}
  return out
}
