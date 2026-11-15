/**
 * clientAccounts — the operator's client-console math: feature totals, the
 * monthly-revenue roll-up (paying statuses only) and feature normalization.
 * Run: node --test tests/unit/clientAccounts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { featureTotal, monthlyRevenue, cleanFeatures, paymentLabel, PAYMENT_METHODS } from '../../src/lib/clientAccounts.js'
import { MODULE_LABELS } from '../../src/components/admin/moduleLabels.js'
import { MODULE_FLAGS } from '../../functions/api/_lib/flags.js'

test('feature prices sum to the package total', () => {
  assert.equal(featureTotal({ bot_tools: { price: 120 }, insights: { price: 79.5 } }), 199.5)
  assert.equal(featureTotal({}), 0)
  assert.equal(featureTotal(null), 0)
  assert.equal(featureTotal({ x: { price: 'לא מספר' } }), 0)   // garbage price counts as 0
})

test('monthly revenue counts ACTIVE clients only', () => {
  const rows = [
    { status: 'active', monthly_price: 300 },
    { status: 'active', monthly_price: 199.9 },
    { status: 'trial', monthly_price: 500 },     // not paying yet
    { status: 'paused', monthly_price: 400 },    // not paying now
    { status: 'churned', monthly_price: 900 },   // gone
  ]
  assert.equal(monthlyRevenue(rows), 499.9)
  assert.equal(monthlyRevenue([]), 0)
})

test('cleanFeatures keeps only real entries with rounded numeric prices', () => {
  const out = cleanFeatures({ a: { price: '12.345' }, b: null, c: { price: 7 } })
  assert.deepEqual(out, { a: { price: 12.35 }, c: { price: 7 } })
})

test('every sellable module has a Hebrew label, and vice versa', () => {
  for (const key of MODULE_FLAGS) assert.ok(MODULE_LABELS[key], `missing label: ${key}`)
  for (const key of Object.keys(MODULE_LABELS)) assert.ok(MODULE_FLAGS.includes(key), `label for unknown module: ${key}`)
})

test('every payment method has a label', () => {
  for (const m of PAYMENT_METHODS) assert.ok(m.label && paymentLabel(m.value) === m.label)
  assert.equal(paymentLabel(null), '—')
})
