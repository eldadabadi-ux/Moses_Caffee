import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../hooks/useTenant'
import { FEATURES, PLANS, featuresForPlan } from '../lib/features'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { Building2, Plus, Check, Globe, RefreshCw, UserPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'

const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '')
const randPass = () => Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + '!' + Math.floor(Math.random() * 90 + 10)

export default function AdminPage() {
  const { isSuperAdmin } = useTenant()
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [migrationMissing, setMigrationMissing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ businessName: '', slug: '', plan: 'pro', ownerEmail: '', password: randPass() })
  const [slugEdited, setSlugEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    if (error) { setMigrationMissing(true); setTenants([]) }
    else { setMigrationMissing(false); setTenants(data || []) }
    setLoading(false)
  }

  if (!isSuperAdmin) return <Navigate to="/" replace />

  async function onboard(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ...form, features: featuresForPlan(form.plan) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        const msg = json.error === 'slug_taken' ? 'הכתובת (slug) כבר תפוסה'
          : json.error === 'email_taken' ? 'האימייל כבר רשום'
          : json.error === 'forbidden' ? 'אין הרשאה (התחבר כ-SuperAdmin)'
          : json.error || `שגיאת שרת ${res.status}`
        toast.error(msg); return
      }
      toast.success('הלקוח חובר בהצלחה!')
      setResult({ tenant: json.tenant, email: form.ownerEmail, password: form.password })
      setForm({ businessName: '', slug: '', plan: 'pro', ownerEmail: '', password: randPass() }); setSlugEdited(false)
      setShowForm(false)
      load()
    } catch (err) { toast.error('שגיאה: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  async function updateTenant(id, patch) {
    const { error } = await supabase.from('tenants').update(patch).eq('id', id)
    if (error) { toast.error('שגיאה בעדכון'); return }
    setTenants(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }
  const toggleFeature = (t, key) => updateTenant(t.id, { features: { ...(t.features || {}), [key]: (t.features?.[key] === false) } })
  const setPlan = (t, plan) => updateTenant(t.id, { plan, features: featuresForPlan(plan) })

  const FS = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-main)' }

  return (
    <div className="animate-fade-in" dir="rtl" style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={24} color="var(--accent)" /> ניהול לקוחות (SuperAdmin)
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--text-mute)' }}>{tenants.length} עסקים מחוברים</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} title="רענן" style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', cursor: 'pointer' }}><RefreshCw size={17} /></button>
          <button onClick={() => { setShowForm(v => !v); setResult(null) }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 16px', height: 40, borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            <UserPlus size={17} /> חבר לקוח חדש
          </button>
        </div>
      </div>

      {migrationMissing && (
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--warn-tint-1)', border: '1px solid var(--warn-tint-border)', fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
          ⚠️ טבלאות ה-tenant עוד לא קיימות. הרץ קודם את <strong>supabase/migrations/20260609_multi_tenant.sql</strong> ב-Supabase, ואז רענן.
        </div>
      )}

      {/* Onboarding result */}
      {result && (
        <div style={{ padding: 16, borderRadius: 12, background: 'var(--success-tint-1)', border: '1px solid var(--success-tint-border)' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>✅ {result.tenant?.name} חובר! פרטי הכניסה ללקוח:</div>
          <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.9, fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'left' }}>
            <div>URL: https://moses-caffee.pages.dev</div>
            <div>Email: {result.email}</div>
            <div>Password: {result.password}</div>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-mute)' }}>העתק ושלח ללקוח. דומיין ייעודי — בשלב הדומיינים.</p>
        </div>
      )}

      {/* Onboard form */}
      {showForm && (
        <form onSubmit={onboard} style={{ padding: 18, borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LB}>שם העסק</label>
              <input value={form.businessName} required onChange={e => { const v = e.target.value; setForm(f => ({ ...f, businessName: v, slug: slugEdited ? f.slug : slugify(v) })) }} style={FS} placeholder="קפה הבוקר" />
            </div>
            <div>
              <label style={LB}>כתובת (slug)</label>
              <input value={form.slug} required onChange={e => { setSlugEdited(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })) }} style={{ ...FS, direction: 'ltr', textAlign: 'left' }} placeholder="kafe-haboker" />
            </div>
            <div>
              <label style={LB}>אימייל הלקוח (כניסה)</label>
              <input type="email" value={form.ownerEmail} required onChange={e => setForm(f => ({ ...f, ownerEmail: e.target.value }))} style={{ ...FS, direction: 'ltr', textAlign: 'left' }} placeholder="owner@biz.co.il" />
            </div>
            <div>
              <label style={LB}>סיסמה זמנית</label>
              <input value={form.password} required minLength={8} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ ...FS, direction: 'ltr', textAlign: 'left' }} />
            </div>
          </div>
          <div>
            <label style={LB}>תוכנית</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(PLANS).map(([k, p]) => (
                <button type="button" key={k} onClick={() => setForm(f => ({ ...f, plan: k }))}
                  style={{ flex: 1, padding: '10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-main)', fontWeight: form.plan === k ? 700 : 500,
                    border: `1.5px solid ${form.plan === k ? 'var(--accent)' : 'var(--border)'}`, background: form.plan === k ? 'var(--accent-bg)' : 'var(--panel-2)', color: form.plan === k ? 'var(--accent)' : 'var(--text-dim)' }}>
                  {p.label} <span style={{ fontSize: 12, opacity: .7 }}>({p.features.length} פיצ'רים)</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowForm(false)} style={{ padding: '11px 18px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'var(--font-main)' }}>ביטול</button>
            <button type="submit" disabled={busy} style={{ padding: '11px 22px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .7 : 1, fontFamily: 'var(--font-main)' }}>{busy ? 'מחבר…' : 'חבר לקוח'}</button>
          </div>
        </form>
      )}

      {loading ? <LoadingSpinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tenants.map(t => (
            <div key={t.id} style={{ padding: 16, borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{t.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 5, direction: 'ltr' }}>
                    <Globe size={12} /> {t.slug}.moses-caffee.pages.dev
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <select value={t.plan || 'pro'} onChange={e => setPlan(t, e.target.value)} style={{ height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontFamily: 'var(--font-main)', fontSize: 13, padding: '0 8px' }}>
                    {Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </select>
                  <button onClick={() => updateTenant(t.id, { subscription_status: t.subscription_status === 'active' ? 'canceled' : 'active' })}
                    style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', border: '1px solid', borderColor: t.subscription_status === 'active' ? 'var(--ok)' : 'var(--danger)', background: 'transparent', color: t.subscription_status === 'active' ? 'var(--ok)' : 'var(--danger)' }}>
                    {t.subscription_status === 'active' ? 'פעיל' : 'מושהה'}
                  </button>
                </div>
              </div>
              {/* Feature toggles */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {FEATURES.map(f => {
                  const on = t.features?.[f.key] !== false
                  return (
                    <button key={f.key} onClick={() => toggleFeature(t, f.key)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-main)',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-bg)' : 'var(--panel-2)', color: on ? 'var(--accent)' : 'var(--text-mute)', fontWeight: on ? 600 : 400 }}>
                      {on ? <Check size={12} /> : <X size={12} />} {f.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {!tenants.length && !migrationMissing && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-mute)' }}>
              <Plus size={36} style={{ opacity: .3, margin: '0 auto 10px', display: 'block' }} />
              עדיין אין לקוחות. לחץ "חבר לקוח חדש".
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const LB = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }
