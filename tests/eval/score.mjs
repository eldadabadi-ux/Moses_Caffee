/**
 * score — grade one extraction against a fixture's known-correct answer.
 *
 * Pure: no network, no model, no I/O. That is deliberate — the scorer is the
 * part that decides whether a model upgrade is an improvement, so it has to be
 * unit-tested itself rather than trusted.
 *
 * Every field is graded on its own and reported by name. A single blended score
 * hides the thing you actually need to know: WHICH capability regressed. A model
 * that reads dates better but truncates long item lists should show exactly that.
 */
import { normalizeVendor, vendorSimilarity } from '../../functions/api/_lib/supplierMatch.js'
import { normalizeUnit } from '../../functions/api/_lib/units.js'
import { totalsOf } from './fixtures.mjs'

const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol
const digits = (s) => String(s ?? '').replace(/\D+/g, '').replace(/^0+/, '')

/** One graded field. `weight` reflects how much a wrong answer actually costs. */
const field = (name, ok, weight, detail) => ({ name, ok: !!ok, weight, detail })

/**
 * @param {object} fx  fixture from fixtures.mjs
 * @param {object} got the extraction result under test
 * @returns {{ id, fields, score, max, failures }}
 */
export function scoreOne(fx, got) {
  const want = fx.expect
  const t = totalsOf(fx)
  const items = Array.isArray(got?.items) ? got.items : []
  const fields = []

  // ── vendor: a different spelling of the same name is CORRECT ──────────────
  if (want.vendor_name) {
    const exact = normalizeVendor(got?.vendor_name) === normalizeVendor(want.vendor_name)
    const close = vendorSimilarity(got?.vendor_name, want.vendor_name) >= 0.92
    fields.push(field('vendor', exact || close, 3,
      exact ? '' : `got "${got?.vendor_name ?? ''}" want "${want.vendor_name}"`))
  }

  // ── date: exact, and the day-first reading is the whole point ─────────────
  if (want.receipt_date) {
    const ok = String(got?.receipt_date || '') === want.receipt_date
    fields.push(field('date', ok, 3, ok ? '' : `got "${got?.receipt_date ?? ''}" want "${want.receipt_date}"`))
  }

  // ── money: to the agora, never "about right" ──────────────────────────────
  const wantTotal = want.total_amount ?? t.total
  const gotTotal = Number(got?.total_amount)
  fields.push(field('total', near(gotTotal, wantTotal, 0.011), 3,
    near(gotTotal, wantTotal, 0.011) ? '' : `got ${gotTotal} want ${wantTotal}`))

  if (want.total_amount == null) {
    const gotNet = Number(got?.amount_before_vat)
    fields.push(field('before_vat', near(gotNet, t.before_vat, 0.02), 1,
      near(gotNet, t.before_vat, 0.02) ? '' : `got ${gotNet} want ${t.before_vat}`))
  }

  // ── document classification ───────────────────────────────────────────────
  if (want.doc_type) {
    const ok = String(got?.doc_type || 'receipt') === want.doc_type
    fields.push(field('doc_type', ok, 2, ok ? '' : `got "${got?.doc_type ?? ''}" want "${want.doc_type}"`))
  }
  if (want.doc_number) {
    const ok = digits(got?.doc_number) === digits(want.doc_number)
    fields.push(field('doc_number', ok, 1, ok ? '' : `got "${got?.doc_number ?? ''}" want "${want.doc_number}"`))
  }
  if (want.doc_refs) {
    const g = (got?.doc_refs || []).map(digits).sort()
    const w = want.doc_refs.map(digits).sort()
    fields.push(field('doc_refs', JSON.stringify(g) === JSON.stringify(w), 2,
      `got [${g}] want [${w}]`))
  }

  // ── line items: count first, because truncation shows up here ─────────────
  if (want.item_count != null) {
    const ok = items.length === want.item_count
    fields.push(field('item_count', ok, 3, ok ? '' : `got ${items.length} want ${want.item_count}`))
  }

  if (want.currency) {
    const ok = String(got?.currency || 'ILS').toUpperCase() === want.currency
    fields.push(field('currency', ok, 2, ok ? '' : `got "${got?.currency ?? ''}" want "${want.currency}"`))
  }

  // ── units: the printed spelling may differ; the canonical unit may not ────
  if (want.units) {
    const gotUnits = items.map(i => normalizeUnit(i?.unit)?.unit || null)
    const ok = want.units.every((u, i) => gotUnits[i] === u)
    fields.push(field('units', ok, 2, ok ? '' : `got [${gotUnits}] want [${want.units}]`))
  }

  // A base unit may be derived from a pack size in the name, so grade the
  // pipeline's output rather than the raw printed unit.
  if (want.base_units) {
    const gotBase = items.map(i => i?.base_unit || null)
    const ok = want.base_units.every((u, i) => gotBase[i] === u)
    fields.push(field('base_units', ok, 2, ok ? '' : `got [${gotBase}] want [${want.base_units}]`))
  }

  // "Any unit at all, inferred sensibly" — for receipts that print none.
  if (want.units_inferred_as) {
    const gotUnits = items.map(i => normalizeUnit(i?.unit)?.unit || null)
    const ok = gotUnits.length > 0 && gotUnits.every(u => u === want.units_inferred_as)
    fields.push(field('unit_inference', ok, 2, ok ? '' : `got [${gotUnits}] want all "${want.units_inferred_as}"`))
  }

  // ── exact unit prices — the "rounded amounts" complaint ───────────────────
  if (want.unit_prices) {
    const gotPrices = items.map(i => Number(i?.unit_price))
    const ok = want.unit_prices.every((p, i) => near(gotPrices[i], p, 0.0001))
    fields.push(field('unit_prices_exact', ok, 3, ok ? '' : `got [${gotPrices}] want [${want.unit_prices}]`))
  }

  const max = fields.reduce((s, f) => s + f.weight, 0)
  const score = fields.reduce((s, f) => s + (f.ok ? f.weight : 0), 0)
  return { id: fx.id, why: fx.why, fields, score, max, failures: fields.filter(f => !f.ok) }
}

/** Aggregate a run: overall percentage plus per-field accuracy across fixtures. */
export function summarize(results) {
  const score = results.reduce((s, r) => s + r.score, 0)
  const max = results.reduce((s, r) => s + r.max, 0)
  const byField = {}
  for (const r of results) {
    for (const f of r.fields) {
      const b = (byField[f.name] ||= { name: f.name, pass: 0, total: 0 })
      b.total++; if (f.ok) b.pass++
    }
  }
  return {
    score, max,
    pct: max ? Math.round((score / max) * 1000) / 10 : 0,
    perfect: results.filter(r => r.score === r.max).length,
    total: results.length,
    byField: Object.values(byField).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/**
 * Compare two runs field by field. A model is only an upgrade if nothing it used
 * to get right has started failing — a higher total with new regressions is not
 * an improvement, it is a trade.
 */
export function compareRuns(baseResults, candResults) {
  const byId = Object.fromEntries(baseResults.map(r => [r.id, r]))
  const regressions = [], fixes = []
  for (const cand of candResults) {
    const base = byId[cand.id]
    if (!base) continue
    for (const cf of cand.fields) {
      const bf = base.fields.find(f => f.name === cf.name)
      if (!bf) continue
      if (bf.ok && !cf.ok) regressions.push({ id: cand.id, field: cf.name, detail: cf.detail })
      if (!bf.ok && cf.ok) fixes.push({ id: cand.id, field: cf.name })
    }
  }
  const b = summarize(baseResults), c = summarize(candResults)
  return {
    base: b, candidate: c,
    delta: Math.round((c.pct - b.pct) * 10) / 10,
    regressions, fixes,
    verdict: regressions.length === 0 && c.pct > b.pct ? 'upgrade'
           : regressions.length === 0 && c.pct === b.pct ? 'no change'
           : regressions.length ? 'has regressions' : 'worse',
  }
}
