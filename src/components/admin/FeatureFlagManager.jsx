import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { FLAG_DEFAULTS } from '../../lib/flags'
import toast from 'react-hot-toast'
import { ToggleLeft, RefreshCw } from 'lucide-react'

// Hebrew labels for the sellable modules (keys come from /api/admin/flags).
const MODULE_LABELS = {
  bot_tools: 'עוזר חכם', events_book: 'ספר אירועים', reconciliation: 'התאמות',
  product_compare: 'השוואת מוצרים', insights: 'תובנות', price_alerts: 'התראות מחיר',
}

async function authFetch(path, method = 'GET', body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out?.message || out?.error || `שגיאה ${res.status}`)
  return out
}

const STATES = [
  { v: 'default', label: 'ברירת מחדל' },
  { v: 'on', label: 'פעיל' },
  { v: 'off', label: 'כבוי' },
]

/**
 * FeatureFlagManager — owner-only console to switch sellable modules on/off per
 * customer (client request #10). Each module has three states: default (fall back
 * to the global/code default), on, off. Writes go through /api/admin/flags
 * (service-role); the matrix reflects the stored overrides.
 */
export default function FeatureFlagManager() {
  const [data, setData] = useState(null)   // { orgs, overrides, globals, modules }
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    try { setData(await authFetch('/api/admin/flags')) }
    catch (e) { toast.error('טעינת הפיצ׳רים נכשלה: ' + e.message) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const overrideOf = (orgId, key) => (data?.overrides || []).find(o => o.org_id === orgId && o.key === key)
  const globalOf = (key) => {
    const g = (data?.globals || []).find(x => x.key === key)
    return g ? g.enabled : FLAG_DEFAULTS[key]
  }
  const stateOf = (orgId, key) => {
    const o = overrideOf(orgId, key)
    return o ? (o.enabled ? 'on' : 'off') : 'default'
  }

  async function setState(orgId, key, state) {
    const tag = `${orgId}:${key}`
    setSaving(tag)
    const enabled = state === 'default' ? null : state === 'on'
    try {
      await authFetch('/api/admin/flags', 'POST', { orgId, key, enabled })
      await load()
    } catch (e) { toast.error('העדכון נכשל: ' + e.message) }
    finally { setSaving('') }
  }

  const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }

  return (
    <div style={card}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ToggleLeft size={17} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>פיצ׳רים ללקוחות</span>
        <button onClick={load} disabled={busy} title="רענן" style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', display: 'flex', padding: 4 }}>
          <RefreshCw size={16} style={{ animation: busy ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          הדלקה/כיבוי של מודול נמכר לכל לקוח. "ברירת מחדל" = המודול נוהג לפי ההגדרה הכללית.
        </p>
        {!data ? <div style={{ fontSize: 14, color: 'var(--text-mute)' }}>טוען…</div>
          : (data.orgs || []).length === 0 ? <div style={{ fontSize: 14, color: 'var(--text-mute)' }}>אין ארגונים.</div>
          : data.orgs.map(org => (
            <div key={org.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'var(--panel-2)', fontWeight: 700, fontSize: 14.5, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {org.business_name || org.name}
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mute)' }}>· {org.plan || 'pilot'}</span>
              </div>
              <div style={{ padding: '6px 14px' }}>
                {(data.modules || []).map((key, i) => {
                  const cur = stateOf(org.id, key)
                  const tag = `${org.id}:${key}`
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < data.modules.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 600 }}>{MODULE_LABELS[key] || key}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>(כללי: {globalOf(key) ? 'פעיל' : 'כבוי'})</span>
                      <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 4, background: 'var(--panel-2)', borderRadius: 8, padding: 3, opacity: saving === tag ? 0.5 : 1 }}>
                        {STATES.map(s => (
                          <button key={s.v} onClick={() => cur !== s.v && setState(org.id, key, s.v)} disabled={saving === tag}
                            style={{ padding: '5px 11px', borderRadius: 6, border: 'none', cursor: cur === s.v ? 'default' : 'pointer', fontFamily: 'var(--font-main)', fontSize: 12.5, fontWeight: 700,
                              background: cur === s.v ? (s.v === 'off' ? '#dc2626' : s.v === 'on' ? '#16a34a' : 'var(--accent)') : 'transparent',
                              color: cur === s.v ? 'white' : 'var(--text-dim)' }}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
