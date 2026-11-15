import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { MODULE_LABELS } from './moduleLabels'
import { PAYMENT_METHODS, paymentLabel, CLIENT_STATUSES, statusLabel, featureTotal, monthlyRevenue, cleanFeatures } from '../../lib/clientAccounts'
import toast from 'react-hot-toast'
import { Users, RefreshCw, ChevronDown, Save, Phone, Mail } from 'lucide-react'

const fmtILS = (n) => `₪${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL')}`

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

const inp = {
  width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--panel)', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-main)', boxSizing: 'border-box',
}
const lbl = { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 4 }

const STATUS_COLORS = { active: '#16a34a', trial: 'var(--accent)', paused: '#d97706', churned: '#dc2626' }

/**
 * ClientManager — the operator's client console (15.11.26): per customer-org —
 * who the client is, the monthly price, the features they bought (and each
 * feature's price), and how they pay. Saving also aligns the org's module
 * flags with the purchased features via /api/admin/clients.
 */
export default function ClientManager() {
  const [data, setData] = useState(null)      // { orgs, clients, modules }
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState(null)    // the edited record of the open org
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try { setData(await authFetch('/api/admin/clients')) }
    catch (e) { toast.error('טעינת הלקוחות נכשלה: ' + e.message) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const clientOf = (orgId) => (data?.clients || []).find(c => c.org_id === orgId)
  const revenue = useMemo(() => monthlyRevenue(data?.clients), [data])

  function openOrg(org) {
    if (openId === org.id) { setOpenId(null); setDraft(null); return }
    const c = clientOf(org.id) || {}
    setOpenId(org.id)
    setDraft({
      contact_name: c.contact_name || '', contact_phone: c.contact_phone || '', contact_email: c.contact_email || '',
      monthly_price: c.monthly_price ?? 0,
      features: { ...(c.features || {}) },
      payment_method: c.payment_method || '', payment_notes: c.payment_notes || '',
      status: c.status || 'active', started_at: c.started_at || '',
      notes: c.notes || '',
    })
  }

  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const toggleFeature = (key) => setDraft(d => {
    const features = { ...d.features }
    if (key in features) delete features[key]
    else features[key] = { price: 0 }
    return { ...d, features }
  })
  const setFeaturePrice = (key, price) => setDraft(d => ({
    ...d, features: { ...d.features, [key]: { price } },
  }))

  async function save(orgId) {
    setSaving(true)
    try {
      const record = {
        ...draft,
        monthly_price: parseFloat(draft.monthly_price) || 0,
        features: cleanFeatures(draft.features),
        payment_method: draft.payment_method || null,
        started_at: draft.started_at || null,
      }
      const out = await authFetch('/api/admin/clients', 'POST', { orgId, record })
      const flips = (out.flagChanges || []).length
      toast.success(`כרטיס הלקוח נשמר${flips ? ` · עודכנו ${flips} מתגי מודולים` : ''}`)
      setOpenId(null); setDraft(null)
      await load()
    } catch (e) { toast.error('השמירה נכשלה: ' + e.message) }
    finally { setSaving(false) }
  }

  const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }

  return (
    <div style={card}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Users size={17} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>ניהול לקוחות</span>
        <span style={{ fontSize: 13, color: 'var(--text-mute)' }}>
          · {(data?.orgs || []).length} לקוחות · הכנסה חודשית (פעילים): <strong style={{ color: '#16a34a' }}>{fmtILS(revenue)}</strong>
        </span>
        <button onClick={load} disabled={busy} title="רענן" style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', display: 'flex', padding: 4 }}>
          <RefreshCw size={16} style={{ animation: busy ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!data ? <div style={{ fontSize: 14, color: 'var(--text-mute)' }}>טוען…</div>
          : (data.orgs || []).length === 0 ? <div style={{ fontSize: 14, color: 'var(--text-mute)' }}>אין לקוחות עדיין.</div>
          : data.orgs.map(org => {
            const c = clientOf(org.id)
            const isOpen = openId === org.id
            const feats = Object.keys(c?.features || {})
            return (
              <div key={org.id} style={{ border: `1px solid ${isOpen ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, overflow: 'hidden' }}>
                {/* Summary row */}
                <button onClick={() => openOrg(org)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--panel-2)', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text)', flexShrink: 0 }}>{org.business_name || org.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: STATUS_COLORS[c?.status || 'active'], borderRadius: 999, padding: '2px 9px', flexShrink: 0 }}>
                    {statusLabel(c?.status || 'active')}
                  </span>
                  {c?.contact_name && <span style={{ fontSize: 13, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contact_name}</span>}
                  <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>{feats.length} פיצ׳רים</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>{paymentLabel(c?.payment_method)}</span>
                    <strong style={{ fontSize: 15, color: '#16a34a' }}>{fmtILS(c?.monthly_price)} / חודש</strong>
                    <ChevronDown size={16} style={{ color: 'var(--text-mute)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                  </span>
                </button>

                {/* Edit panel */}
                {isOpen && draft && (
                  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Who the client is */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      <div><label style={lbl}>איש קשר</label>
                        <input style={inp} value={draft.contact_name} onChange={e => setField('contact_name', e.target.value)} /></div>
                      <div><label style={lbl}><Phone size={11} style={{ verticalAlign: -1 }} /> טלפון</label>
                        <input style={inp} dir="ltr" value={draft.contact_phone} onChange={e => setField('contact_phone', e.target.value)} /></div>
                      <div><label style={lbl}><Mail size={11} style={{ verticalAlign: -1 }} /> אימייל</label>
                        <input style={inp} dir="ltr" value={draft.contact_email} onChange={e => setField('contact_email', e.target.value)} /></div>
                      <div><label style={lbl}>סטטוס</label>
                        <select style={inp} value={draft.status} onChange={e => setField('status', e.target.value)}>
                          {CLIENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select></div>
                      <div><label style={lbl}>תחילת התקשרות</label>
                        <input style={inp} type="date" value={draft.started_at} onChange={e => setField('started_at', e.target.value)} /></div>
                    </div>

                    {/* What they pay, and how */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      <div><label style={lbl}>מחיר חודשי (₪)</label>
                        <input style={inp} type="number" min="0" step="0.01" value={draft.monthly_price} onChange={e => setField('monthly_price', e.target.value)} /></div>
                      <div><label style={lbl}>אופן תשלום</label>
                        <select style={inp} value={draft.payment_method} onChange={e => setField('payment_method', e.target.value)}>
                          <option value="">— לא הוגדר —</option>
                          {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>פרטי תשלום (חשבון, יום חיוב...)</label>
                        <input style={inp} value={draft.payment_notes} onChange={e => setField('payment_notes', e.target.value)} /></div>
                    </div>

                    {/* Which features they bought, and at what price */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <label style={{ ...lbl, marginBottom: 0 }}>פיצ׳רים שנרכשו</label>
                        <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                          סה"כ פיצ׳רים: <strong>{fmtILS(featureTotal(draft.features))}</strong> · שמירה מעדכנת גם את מתגי המודולים
                        </span>
                      </div>
                      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                        {(data.modules || []).map((key, i) => {
                          const bought = key in draft.features
                          return (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                              borderBottom: i < data.modules.length - 1 ? '1px solid var(--border)' : 'none',
                              background: bought ? 'var(--accent-bg)' : 'transparent' }}>
                              <input type="checkbox" checked={bought} onChange={() => toggleFeature(key)}
                                style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                              <span style={{ fontSize: 13.5, fontWeight: bought ? 700 : 500, color: 'var(--text)', flex: 1 }}>{MODULE_LABELS[key] || key}</span>
                              {bought && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>₪/חודש</span>
                                  <input type="number" min="0" step="0.01" value={draft.features[key]?.price ?? 0}
                                    onChange={e => setFeaturePrice(key, e.target.value)}
                                    style={{ ...inp, width: 90, height: 30, fontSize: 13 }} />
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div><label style={lbl}>הערות</label>
                      <textarea value={draft.notes} onChange={e => setField('notes', e.target.value)} rows={2}
                        style={{ ...inp, height: 'auto', padding: '8px 10px', resize: 'vertical' }} /></div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => save(org.id)} disabled={saving}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: saving ? 'var(--border)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                        <Save size={15} /> {saving ? 'שומר…' : 'שמירת כרטיס לקוח'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
