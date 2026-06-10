/**
 * features — canonical per-tenant feature registry for the SaaS tiers.
 *
 * A tenant's enabled features live in `tenants.features` (JSONB). A feature is
 * treated as ON unless explicitly set to `false` (see useTenant().hasFeature),
 * so existing installs keep every feature until an admin tiers them down.
 *
 * Used by: feature gating in the UI (Phase 2) and the admin console toggles
 * (Phase 6) + featuresForPlan() when creating/upgrading a tenant.
 */

export const FEATURES = [
  { key: 'aiScan',        label: 'סריקת AI',             group: 'core',      plans: ['basic', 'pro'] },
  { key: 'manualEntry',   label: 'הוספה ידנית',          group: 'core',      plans: ['basic', 'pro'] },
  { key: 'pdfUpload',     label: 'העלאת PDF',            group: 'scan',      plans: ['pro'] },
  { key: 'multiPageScan', label: 'סריקת כמה עמודים',     group: 'scan',      plans: ['pro'] },
  { key: 'rescan',        label: 'סריקה חוזרת (דיוק)',   group: 'scan',      plans: ['pro'] },
  { key: 'dashboard',     label: 'דשבורד',               group: 'analytics', plans: ['basic', 'pro'] },
  { key: 'drilldown',     label: 'ניתוח מעמיק',          group: 'analytics', plans: ['pro'] },
  { key: 'vendorCompare', label: 'השוואת ספקים',         group: 'analytics', plans: ['pro'] },
  { key: 'export',        label: 'ייצוא לרו"ח',          group: 'export',    plans: ['basic', 'pro'] },
  { key: 'monthlyExport', label: 'תזכורת ייצוא חודשית',  group: 'export',    plans: ['pro'] },
  { key: 'backup',        label: 'גיבוי ושחזור',         group: 'data',      plans: ['pro'] },
  { key: 'pwaInstall',    label: 'התקנת אפליקציה',       group: 'core',      plans: ['basic', 'pro'] },
]

export const PLANS = {
  basic: { label: 'בסיסי',  features: FEATURES.filter(f => f.plans.includes('basic')).map(f => f.key) },
  pro:   { label: 'מקצועי', features: FEATURES.map(f => f.key) },
}

/** The features map ({ key: bool }) for a plan — used when creating/upgrading a tenant. */
export function featuresForPlan(plan) {
  const keys = PLANS[plan]?.features || PLANS.pro.features
  return Object.fromEntries(FEATURES.map(f => [f.key, keys.includes(f.key)]))
}
