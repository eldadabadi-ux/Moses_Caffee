import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Building2, UserPlus, ShieldCheck, Check, Copy } from 'lucide-react'
import toast from 'react-hot-toast'

const SUPERADMIN = 'eldadabadi@gmail.com'

/**
 * Owner-only console to onboard a new customer (creates their login + org +
 * owner membership via /api/admin/onboard). The new customer logs in at the
 * same URL and is routed to their own organization by membership (RLS-isolated).
 */
export default function AdminPage() {
  const { user } = useAuth()
  const [businessName, setBusinessName] = useState('')
  const [ownerEmail, setOwnerEmail]     = useState('')
  const [password, setPassword]         = useState('')
  const [busy, setBusy]                 = useState(false)
  const [created, setCreated]           = useState([])

  if (user && (user.email || '').toLowerCase() !== SUPERADMIN) return <Navigate to="/" replace />

  async function onboard(e) {
    e.preventDefault()
    if (busy) return
    if (!businessName.trim() || !ownerEmail.trim() || password.length < 8) {
      toast.error('מלא שם עסק, אימייל, וסיסמה (8+ תווים)'); return
    }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ businessName: businessName.trim(), ownerEmail: ownerEmail.trim(), password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = body?.error === 'email_taken' ? 'האימייל כבר רשום'
          : body?.error === 'forbidden' ? 'אין הרשאה'
          : (body?.message || body?.detail || 'ההקמה נכשלה')
        throw new Error(msg)
      }
      toast.success('הלקוח הוקם בהצלחה ✓')
      setCreated(prev => [{ business: businessName.trim(), email: ownerEmail.trim(), password, org: body?.org }, ...prev])
      setBusinessName(''); setOwnerEmail(''); setPassword('')
    } catch (err) {
      toast.error(err?.message || 'שגיאה')
    } finally { setBusy(false) }
  }

  const FS = { display:'block', width:'100%', boxSizing:'border-box', height:46, padding:'0 14px', borderRadius:'var(--r-btn)', border:'1.5px solid var(--border)', background:'var(--panel)', color:'var(--text)', fontSize:16, fontFamily:'var(--font-main)', outline:'none' }

  return (
    <div className="animate-fade-in" dir="rtl" style={{ maxWidth: 560, margin:'0 auto', display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <h1 style={{ margin:0, fontSize:26, fontWeight:700, color:'var(--text)', display:'flex', alignItems:'center', gap:8 }}>
          <ShieldCheck size={24} color="var(--accent)" /> ניהול לקוחות
        </h1>
        <p style={{ margin:'4px 0 0', fontSize:15, color:'var(--text-mute)' }}>הקמת חשבון לעסק חדש (אדמין בלבד)</p>
      </div>

      <form onSubmit={onboard} style={{ background:'var(--panel)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', boxShadow:'var(--shadow-card)' }}>
        <div style={{ padding:'15px 20px', borderBottom:'1px solid var(--border)', background:'var(--panel-2)', display:'flex', alignItems:'center', gap:8 }}>
          <UserPlus size={17} color="var(--accent)" />
          <span style={{ fontWeight:700, fontSize:16, color:'var(--text)' }}>לקוח חדש</span>
        </div>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:14.5, fontWeight:600, color:'var(--text-dim)', marginBottom:7 }}><Building2 size={15} /> שם העסק</label>
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="קפה של דנה" style={FS} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:14.5, fontWeight:600, color:'var(--text-dim)', marginBottom:7 }}>אימייל הכניסה של הלקוח</label>
            <input type="email" dir="ltr" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="owner@business.co.il" style={FS} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:14.5, fontWeight:600, color:'var(--text-dim)', marginBottom:7 }}>סיסמה ראשונית (8+ תווים)</label>
            <input dir="ltr" value={password} onChange={e => setPassword(e.target.value)} placeholder="לפחות 8 תווים" style={FS} />
          </div>
          <button type="submit" disabled={busy}
            style={{ alignSelf:'flex-start', display:'flex', alignItems:'center', gap:8, padding:'11px 22px', borderRadius:10, border:'none', background: busy ? 'var(--panel-2)' : 'var(--accent)', color: busy ? 'var(--text-mute)' : 'white', fontSize:15, fontWeight:700, cursor: busy ? 'default' : 'pointer', fontFamily:'var(--font-main)' }}>
            <UserPlus size={16} /> {busy ? 'מקים…' : 'הקם לקוח'}
          </button>
        </div>
      </form>

      {created.length > 0 && (
        <div style={{ background:'var(--panel)', border:'1px solid var(--border)', borderRadius:16, padding:18 }}>
          <p style={{ margin:'0 0 12px', fontSize:14, color:'var(--text-mute)' }}>הוקמו בהפעלה זו — שלח ללקוח את פרטי הכניסה:</p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {created.map((c, i) => {
              const creds = `אתר: https://moses-caffee.pages.dev\nאימייל: ${c.email}\nסיסמה: ${c.password}`
              return (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--success-tint-1)', border:'1px solid var(--success-tint-border)', borderRadius:10 }}>
                  <Check size={16} color="var(--ok)" style={{ flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0, fontSize:13.5, color:'var(--text)' }}>
                    <strong>{c.business}</strong> · <span dir="ltr">{c.email}</span> · <span dir="ltr">{c.password}</span>
                  </div>
                  <button onClick={() => { navigator.clipboard?.writeText(creds); toast.success('הועתק') }} title="העתק פרטי כניסה"
                    style={{ flexShrink:0, padding:7, borderRadius:7, border:'1px solid var(--border)', background:'var(--panel)', color:'var(--text-mute)', cursor:'pointer', display:'flex' }}>
                    <Copy size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
