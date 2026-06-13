/**
 * rescanReceipts — re-runs the AI scan on every stored receipt image to correct
 * rounded/inaccurate prices AND mis-read dates (Israeli day-first DD/MM/YYYY).
 * Preserves the user's vendor/category. Throttled for Gemini limits.
 */
import { supabase } from './supabase'
import { downscaleForUpload } from './imageUtils'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const r2 = (n) => Math.round(n * 100) / 100
// A valid ISO date string (YYYY-MM-DD) that is also a real calendar date.
const isValidISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s))

export async function rescanAllReceipts(user, vatRate = 18, { onProgress, signal } = {}) {
  const { data, error } = await supabase
    .from('receipts')
    .select('id, amount, receipt_date, receipt_image, items, ai_summary, vendor_name')
    .eq('user_id', user.id)
    .order('receipt_date', { ascending: false })
  if (error) throw error

  // Only receipts that have a stored image can be re-scanned.
  const list = (data || []).filter(r => (r.receipt_image || '').startsWith('data:'))
  let done = 0, fixed = 0, failed = 0
  const changes = []

  onProgress?.({ done, total: list.length, fixed, failed })

  for (const r of list) {
    if (signal?.aborted) break
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const uploadUrl = await downscaleForUpload(r.receipt_image)
      const res = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ imageBase64: uploadUrl.split(',')[1], mimeType: 'image/jpeg', vatRate }),
      })
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
          const patch = {
            amount: t,
            items: newItems,
            ...(isValidISODate(newDate) ? { receipt_date: newDate } : {}),
            ai_summary: { ...(r.ai_summary || {}), total: t, before_vat: before, vat_amount: vat, vat_rate: vatRate, rescanned_at: new Date().toISOString(),
              ...(fx ? { currency: result.currency, fx_rate: fx.rate, fx_date: fx.date, fx_source: fx.source, original_total: tOrig, is_fx_estimate: true } : {}) },
          }
          const vatCols = { amount_before_vat: before, vat_amount: vat, vat_rate: vatRate }
          let { error: upErr } = await supabase.from('receipts').update({ ...patch, ...vatCols }).eq('id', r.id)
          if (upErr && /amount_before_vat|vat_amount|vat_rate/.test(upErr.message || '')) {
            ;({ error: upErr } = await supabase.from('receipts').update(patch).eq('id', r.id))
          }
          if (upErr) failed++
          else if (diff > 0.005 || dateChanged) { fixed++; changes.push({ id: r.id, vendor: r.vendor_name || '', old: oldT, new: t, oldDate: r.receipt_date, newDate: dateChanged ? newDate : undefined }) }
        } else { failed++ }
      } else { failed++ }
    } catch { failed++ }
    done++
    onProgress?.({ done, total: list.length, fixed, failed })
    await sleep(900)  // throttle so the free Gemini tier doesn't rate-limit (429)
  }

  return { total: list.length, fixed, failed, changes }
}
