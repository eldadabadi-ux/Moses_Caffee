/**
 * backfill-units — annotate every EXISTING receipt line item with its canonical
 * unit and price per base unit (audit R3, client request #12).
 *
 * New scans get this at extraction time; this brings the history up to the same
 * shape so comparisons, insights and supplier reports cover all of it.
 *
 * Uses the SAME pure module as the scan pipeline (functions/api/_lib/units.js) —
 * there is no second implementation of the unit rules.
 *
 * Safety:
 *   - DRY-RUN by default; pass --apply to write.
 *   - Purely ADDITIVE: only adds unit_canonical / unit_dimension /
 *     price_per_base_unit / base_unit / base_quantity / unit_confidence to each
 *     item. No existing field is changed or removed, so re-running is a no-op
 *     and the change is reversible.
 *   - Skips a receipt whose items would come out identical.
 *
 * Run:
 *   node --env-file=.env.test scripts/backfill-units.mjs            # dry-run
 *   node --env-file=.env.test scripts/backfill-units.mjs --apply    # execute
 */
import { createClient } from '@supabase/supabase-js'
import { withUnitPricing } from '../functions/api/_lib/units.js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')
if (!URL || !SERVICE) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.test).'); process.exit(1) }

const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const log = (...a) => console.log(...a)

const { data: rows, error } = await sb
  .from('receipts')
  .select('id, vendor_name, items')
  .not('items', 'is', null)
  .order('id', { ascending: true })
  .limit(100000)
if (error) { console.error('load failed:', error.message); process.exit(1) }

log(`\n${APPLY ? '🟢 APPLY' : '🔵 DRY-RUN'} — ${rows.length} receipts with items\n`)

let receiptsChanged = 0, itemsAnnotated = 0, itemsPriced = 0, failed = 0
const byBase = {}, byConfidence = {}

for (const r of rows) {
  const items = Array.isArray(r.items) ? r.items : []
  if (!items.length) continue

  const next = items.map(withUnitPricing)
  for (const it of next) {
    itemsAnnotated++
    if (it.price_per_base_unit != null) {
      itemsPriced++
      byBase[it.base_unit] = (byBase[it.base_unit] || 0) + 1
      byConfidence[it.unit_confidence] = (byConfidence[it.unit_confidence] || 0) + 1
    }
  }
  if (JSON.stringify(next) === JSON.stringify(items)) continue   // already done
  receiptsChanged++

  if (!APPLY) continue
  const { error: ue } = await sb.from('receipts').update({ items: next }).eq('id', r.id)
  if (ue) { log(`  ✗ ${r.id} (${r.vendor_name || '-'}): ${ue.message}`); failed++ }
}

log('── summary ─────────────────────────────────────')
log(`receipts ${APPLY ? 'updated' : 'to update'}: ${receiptsChanged}${failed ? ` · ${failed} failed` : ''}`)
log(`line items annotated: ${itemsAnnotated} · priced per base unit: ${itemsPriced}`)
log(`by base unit:  ${Object.entries(byBase).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}`)
log(`by confidence: ${Object.entries(byConfidence).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}`)
log(APPLY ? '\n✅ done\n' : '\n(dry-run only — nothing changed. Re-run with --apply.)\n')
