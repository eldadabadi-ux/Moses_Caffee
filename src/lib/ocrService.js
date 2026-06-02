let tesseractWorker = null

async function getWorker() {
  if (tesseractWorker) return tesseractWorker
  const { createWorker } = await import('tesseract.js')
  tesseractWorker = await createWorker('heb+eng', 1, { logger: () => {} })
  return tesseractWorker
}

export async function extractReceiptData(imageDataUrl) {
  const worker = await getWorker()
  const { data: { text } } = await worker.recognize(imageDataUrl)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  let amount = ''
  const amountPatterns = [
    /(?:סה"כ|סהכ|total|amount|לתשלום|לחיוב)[:\s]*(\d{1,6}(?:[.,]\d{1,2})?)/i,
    /(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:₪|ש"ח|שח|nis|ils)/i,
    /(?:₪|ש"ח)\s*(\d{1,6}(?:[.,]\d{1,2})?)/i,
  ]
  for (const pattern of amountPatterns) {
    const match = text.match(pattern)
    if (match) { amount = match[1].replace(',', '.'); break }
  }
  if (!amount) {
    const allNumbers = [...text.matchAll(/\b(\d{2,6}(?:\.\d{1,2})?)\b/g)]
    if (allNumbers.length > 0) {
      const vals = allNumbers.map(m => parseFloat(m[1])).filter(v => v >= 5 && v <= 99999)
      if (vals.length > 0) amount = String(Math.max(...vals))
    }
  }

  let receipt_date = new Date().toISOString().slice(0, 10)
  const datePatterns = [
    /(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/,
    /(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/,
  ]
  for (const pattern of datePatterns) {
    const match = text.match(pattern)
    if (match) {
      const [, a, b, c] = match
      if (a.length === 4) {
        receipt_date = `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`
      } else {
        const year = c.length === 2 ? `20${c}` : c
        receipt_date = `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
      }
      break
    }
  }

  const skipWords = /(?:תאריך|date|קבלה|receipt|חשבונית|invoice|מספר|tel|phone|fax|www|http|\d{5,})/i
  const vendor_name = lines.find(l => l.length > 2 && l.length < 60 && !skipWords.test(l)) || ''

  return { amount, vendor_name: vendor_name.slice(0, 100), receipt_date }
}

export async function terminateOCR() {
  if (tesseractWorker) { await tesseractWorker.terminate(); tesseractWorker = null }
}
