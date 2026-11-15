/**
 * clientAccounts — pure helpers for the operator's client-management console
 * (15.11.26): payment-method vocabulary, feature-price totals and the monthly
 * revenue roll-up. No I/O — the client_accounts rows come from /api/admin/clients.
 */

export const PAYMENT_METHODS = [
  { value: 'bank_transfer',  label: 'העברה בנקאית' },
  { value: 'standing_order', label: 'הוראת קבע' },
  { value: 'bit',            label: 'ביט' },
  { value: 'credit_card',    label: 'כרטיס אשראי' },
  { value: 'check',          label: "צ'ק" },
  { value: 'other',          label: 'אחר' },
]
export const paymentLabel = (v) => PAYMENT_METHODS.find(m => m.value === v)?.label || v || '—'

export const CLIENT_STATUSES = [
  { value: 'active',  label: 'פעיל' },
  { value: 'trial',   label: 'ניסיון' },
  { value: 'paused',  label: 'מושהה' },
  { value: 'churned', label: 'עזב' },
]
export const statusLabel = (v) => CLIENT_STATUSES.find(s => s.value === v)?.label || v || '—'

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n) => Math.round(num(n) * 100) / 100

/** Sum of the purchased features' prices ({ key: { price } } → ₪). */
export function featureTotal(features) {
  return r2(Object.values(features || {}).reduce((s, f) => s + num(f?.price), 0))
}

/** Monthly recurring revenue across client records — paying statuses only. */
export function monthlyRevenue(records) {
  return r2((records || [])
    .filter(c => c.status === 'active')
    .reduce((s, c) => s + num(c.monthly_price), 0))
}

/** Normalize a features object for saving: drop unpurchased keys, numeric prices. */
export function cleanFeatures(features) {
  const out = {}
  for (const [key, f] of Object.entries(features || {})) {
    if (!f) continue
    out[key] = { price: r2(f.price) }
  }
  return out
}
