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
        const t = Number(result.total_amount) || 0
        if (t > 0) {
          const before = Number(result.amount_before_vat) || r2(t / (1 + vatRate / 100))
          const vat = Number(result.vat_amount) || r2(t - before)
          const oldT = parseFloat(r.amount) || 0
          const diff = Math.abs(t - oldT)
          // Correct the date too (now read day-first). Only overwrite with a valid date.
          const newDate = (result.receipt_date || '').trim()
          const dateChanged = isValidISODate(newDate) && newDate !== (r.receipt_date || '')
          const patch = {
            amount: t,
            items: Array.isArray(result.items) && result.items.length ? result.items : r.items,
            ...(isValidISODate(newDate) ? { receipt_date: newDate } : {}),
            ai_summary: { ...(r.ai_summary || {}), total: t, before_vat: before, vat_amount: vat, vat_rate: vatRate, rescanned_at: new Date().toISOString() },
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
