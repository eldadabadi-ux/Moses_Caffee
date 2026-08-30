/**
 * rescanReceipts — re-runs the AI scan on every stored receipt image to correct
 * rounded/inaccurate prices AND mis-read dates (Israeli day-first DD/MM/YYYY).
 * Preserves the user's vendor/category. Throttled for Gemini limits.
 *
 * Image source is resolved through `receiptImage.js` (SSOT), so a receipt whose
 * pixels moved from an inline base64 column to the Storage bucket (audit C1) is
 * still re-scannable. The bulk query deliberately does NOT select the heavy
 * `receipt_image` column — it only FILTERS on it, and the one legacy row that
 * needs it is fetched by id inside the throttled loop.
 */
import { supabase } from './supabase'
import { receiptScanImage } from './receiptImage'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// /api/scan-receipt allows 30 requests per minute per user (see its
// checkRateLimit call). At the old 900ms pace a bulk rescan ran at ~66/min, so
// everything after the first 30 came back 429 and was silently counted as a
// failure. Stay just inside the server's own limit.
const THROTTLE_MS = 2100
const r2 = (n) => Math.round(n * 100) / 100
// A valid ISO date string (YYYY-MM-DD) that is also a real calendar date.
const isValidISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s))

export async function rescanAllReceipts(user, vatRate = 18, { onProgress, signal } = {}) {
  const { data, error } = await supabase
    .from('receipts')
    .select('id, amount, receipt_date, storage_path, items, ai_summary, vendor_name')
    .eq('user_id', user.id)
    // Only rows that have pixels SOMEWHERE — in the bucket or still inline.
    .or('storage_path.not.is.null,receipt_image.not.is.null')
    .order('receipt_date', { ascending: false })
  if (error) throw error

  const list = data || []
  let done = 0, fixed = 0, failed = 0, skipped = 0
  const changes = []

  onProgress?.({ done, total: list.length, fixed, failed })

  for (const r of list) {
    if (signal?.aborted) break
    try {
      // Resolve the image (bucket original, or the legacy inline column by id).
      const uploadUrl = await receiptScanImage(r)
      if (!uploadUrl) { skipped++; done++; onProgress?.({ done, total: list.length, fixed, failed }); continue }

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const body = JSON.stringify({ imageBase64: uploadUrl.split(',')[1], mimeType: 'image/jpeg', vatRate })
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

      // A 429 means "too fast", not "broken" — wait out the window and retry a
      // bounded number of times rather than counting it as a failed receipt.
      let res = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        res = await fetch('/api/scan-receipt', { method: 'POST', headers, body })
        if (res.status !== 429 || attempt === 3) break
        const retryAfter = parseInt(res.headers.get('retry-after') || '', 10)
        await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter, 60) * 1000 : 20000)
        if (signal?.aborted) break
      }
      if (signal?.aborted) break

      if (res.ok) {
        const result = await res.json()
        const fx = result.fx   // foreign currency → convert to ILS with the official rate
        const tOrig = Number(result.total_amount) || 0
        if (tOrig > 0) {
          // All stored amounts are in ILS (converted for foreign receipts).
          const t = fx ? (Number(result.total_ils) || r2(tOrig * fx.rate)) : tOrig
          const before = fx ? (Number(result.before_vat_ils) || r2(t / (1 + vatRate / 100)))
                            : (Number(result.amount_before_vat) || r2(t / (1 + vatRate / 100)))
          const vat = fx ? (Number(result.vat_ils) || r2(t - before))
                         : (Number(result.vat_amount) || r2(t - before))
          const oldT = parseFloat(r.amount) || 0
          const diff = Math.abs(t - oldT)
          // Correct the date too (now read day-first). Only overwrite with a valid date.
          const newDate = (result.receipt_date || '').trim()
          const dateChanged = isValidISODate(newDate) && newDate !== (r.receipt_date || '')
          let newItems = r.items
          if (Array.isArray(result.items) && result.items.length) {
            newItems = result.items.map(it => {
              const { price_ils, unit_price_ils, ...rest } = it
              if (!fx) return rest
              const op = parseFloat(rest.price) || 0
              const oup = (rest.unit_price != null && rest.unit_price !== '') ? parseFloat(rest.unit_price) : null
              return { ...rest, price: price_ils != null ? price_ils : r2(op * fx.rate),
                       unit_price: unit_price_ils != null ? unit_price_ils : (oup != null ? r2(oup * fx.rate) : rest.unit_price),
                       orig_price: op, orig_unit_price: oup, currency: result.currency }
            })
          }
          // The scan endpoint resolves the vendor to a canonical supplier; a
          // confident match is worth keeping, otherwise the rescan would create
          // suppliers server-side and link none of them.
          const supplierPatch = result.supplier?.supplier_id
            ? { supplier_id: result.supplier.supplier_id } : {}
          const patch = {
            amount: t,
            items: newItems,
            ...supplierPatch,
            ...(isValidISODate(newDate) ? { receipt_date: newDate } : {}),
            amount_before_vat: before, vat_amount: vat, vat_rate: vatRate,
            ai_summary: { ...(r.ai_summary || {}), total: t, before_vat: before, vat_amount: vat, vat_rate: vatRate, rescanned_at: new Date().toISOString(),
              ...(fx ? { currency: result.currency, fx_rate: fx.rate, fx_date: fx.date, fx_source: fx.source, original_total: tOrig, is_fx_estimate: true } : {}) },
          }
          const { error: upErr } = await supabase.from('receipts').update(patch).eq('id', r.id)
          if (upErr) failed++
          else if (diff > 0.005 || dateChanged) { fixed++; changes.push({ id: r.id, vendor: r.vendor_name || '', old: oldT, new: t, oldDate: r.receipt_date, newDate: dateChanged ? newDate : undefined }) }
        } else { failed++ }
      } else { failed++ }
    } catch { failed++ }
    done++
    onProgress?.({ done, total: list.length, fixed, failed })
    await sleep(THROTTLE_MS)
  }

  return { total: list.length, fixed, failed, skipped, changes }
}
