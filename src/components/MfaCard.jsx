/**
 * MfaCard — self-service TOTP two-factor setup (A.5.17). Enroll shows a QR to
 * scan in an authenticator app, then verifies a 6-digit code. Once verified,
 * the account requires a code at each login (enforced by MfaGate + server).
 * Requires MFA (TOTP) to be enabled on the Supabase project.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { ShieldCheck, ShieldOff, Loader2 } from 'lucide-react'

export default function MfaCard() {
  const [loading, setLoading]   = useState(true)
  const [factor, setFactor]     = useState(null)   // verified TOTP factor or null
  const [enrolling, setEnrolling] = useState(null) // { id, qr, secret, uri } during setup
  const [code, setCode]         = useState('')
  const [busy, setBusy]         = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) { setUnavailable(true); return }
      setFactor((data?.totp || []).find(f => f.status === 'verified') || null)
    } catch { setUnavailable(true) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function startEnroll() {
    if (busy) return
    setBusy(true)
    try {
      // Clean up any half-finished unverified factor first.
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of (list?.totp || [])) if (f.status !== 'verified') { try { await supabase.auth.mfa.unenroll({ factorId: f.id }) } catch {} }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `totp-${Date.now()}` })
      if (error) { toast.error(/not enabled|disabled/i.test(error.message) ? 'יש להפעיל MFA בפרויקט Supabase תחילה' : error.message); setUnavailable(/not enabled|disabled/i.test(error.message)); return }
      setEnrolling({ id: data.id, qr: data.totp?.qr_code || '', secret: data.totp?.secret || '', uri: data.totp?.uri || '' })
    } catch (err) { toast.error(err?.message || 'שגיאה') }
    finally { setBusy(false) }
  }

  async function verifyEnroll(e) {
    e?.preventDefault()
    if (busy || code.trim().length < 6 || !enrolling) return
    setBusy(true)
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.trim() })
      if (error) { toast.error('קוד שגוי — נסה שוב'); return }
      toast.success('אימות דו-שלבי הופעל ✓')
      setEnrolling(null); setCode(''); await refresh()
    } catch (err) { toast.error(err?.message || 'שגיאה') }
    finally { setBusy(false) }
  }

  async function disable() {
    if (busy || !factor) return
    if (!window.confirm('לכבות אימות דו-שלבי? החשבון יהיה פחות מאובטח.')) return
    setBusy(true)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (error) { toast.error(error.message); return }
      toast.success('אימות דו-שלבי כובה')
      await refresh()
    } catch (err) { toast.error(err?.message || 'שגיאה') }
    finally { setBusy(false) }
  }

  const card = { background:'var(--panel)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', boxShadow:'var(--shadow-card)' }
  const head = { padding:'15px 20px', borderBottom:'1px solid var(--border)', background:'var(--panel-2)', display:'flex', alignItems:'center', gap:8 }

  return (
    <div id="set-mfa" style={card} dir="rtl">
      <div style={head}>
        <ShieldCheck size={17} color="var(--accent)" />
        <span style={{ fontWeight:700, fontSize:16, color:'var(--text)' }}>אימות דו-שלבי (2FA)</span>
        {factor && <span style={{ marginInlineStart:'auto', fontSize:12, fontWeight:700, color:'var(--ok)', background:'var(--success-tint-1)', border:'1px solid var(--success-tint-border)', borderRadius:6, padding:'2px 8px' }}>פעיל ✓</span>}
      </div>
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
        {loading ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--text-mute)', fontSize:14 }}><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> טוען…</div>
        ) : unavailable ? (
          <p style={{ margin:0, fontSize:13.5, color:'var(--text-mute)', lineHeight:1.7 }}>
            כדי להשתמש באימות דו-שלבי יש להפעיל MFA (TOTP) בפרויקט Supabase (Authentication → Providers → MFA).
          </p>
        ) : factor ? (
          <>
            <p style={{ margin:0, fontSize:14, color:'var(--text-dim)', lineHeight:1.7 }}>
              החשבון מוגן באימות דו-שלבי. בכל כניסה תתבקש להזין קוד מאפליקציית האימות.
            </p>
            <button onClick={disable} disabled={busy}
              style={{ alignSelf:'flex-start', display:'flex', alignItems:'center', gap:7, padding:'9px 16px', borderRadius:10, border:'1px solid var(--danger)', background:'var(--panel)', color:'var(--danger)', fontSize:14, fontWeight:600, cursor: busy ? 'default' : 'pointer', fontFamily:'var(--font-main)' }}>
              <ShieldOff size={15} /> כבה 2FA
            </button>
          </>
        ) : enrolling ? (
          <>
            <p style={{ margin:0, fontSize:14, color:'var(--text-dim)', lineHeight:1.7 }}>סרוק את הקוד באפליקציית אימות (Google Authenticator / Authy), ואז הזן את הקוד בן 6 הספרות:</p>
            <div style={{ display:'flex', justifyContent:'center' }}>
              {enrolling.qr?.startsWith('<svg')
                ? <div style={{ width:180, height:180, background:'#fff', borderRadius:10, padding:8 }} dangerouslySetInnerHTML={{ __html: enrolling.qr }} />
                : enrolling.qr ? <img src={enrolling.qr} alt="QR" style={{ width:180, height:180, background:'#fff', borderRadius:10, padding:8 }} /> : null}
            </div>
            {enrolling.secret && <p style={{ margin:0, fontSize:12, color:'var(--text-mute)', textAlign:'center' }}>קוד ידני: <code dir="ltr" style={{ userSelect:'all' }}>{enrolling.secret}</code></p>}
            <form onSubmit={verifyEnroll} style={{ display:'flex', gap:10 }}>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" placeholder="000000" dir="ltr"
                style={{ flex:1, height:46, textAlign:'center', letterSpacing:6, fontSize:20, fontWeight:700, borderRadius:10, border:'1.5px solid var(--border)', background:'var(--panel-2)', color:'var(--text)', fontFamily:'var(--font-main)', outline:'none' }} />
              <button type="submit" disabled={busy || code.length < 6}
                style={{ padding:'0 18px', borderRadius:10, border:'none', background:(busy||code.length<6)?'var(--panel-2)':'var(--accent)', color:(busy||code.length<6)?'var(--text-mute)':'white', fontSize:15, fontWeight:700, cursor:(busy||code.length<6)?'default':'pointer', fontFamily:'var(--font-main)' }}>
                {busy ? 'מאמת…' : 'אמת'}
              </button>
            </form>
            <button onClick={() => { setEnrolling(null); setCode('') }} style={{ alignSelf:'flex-start', background:'none', border:'none', color:'var(--text-mute)', fontSize:13, cursor:'pointer', fontFamily:'var(--font-main)' }}>ביטול</button>
          </>
        ) : (
          <>
            <p style={{ margin:0, fontSize:14, color:'var(--text-dim)', lineHeight:1.7 }}>
              הוסף שכבת הגנה נוספת: קוד חד-פעמי מאפליקציית אימות בכל כניסה. מומלץ במיוחד לחשבון הבעלים.
            </p>
            <button onClick={startEnroll} disabled={busy}
              style={{ alignSelf:'flex-start', display:'flex', alignItems:'center', gap:7, padding:'10px 18px', borderRadius:10, border:'none', background:'var(--accent)', color:'white', fontSize:14.5, fontWeight:700, cursor: busy ? 'default' : 'pointer', fontFamily:'var(--font-main)' }}>
              <ShieldCheck size={16} /> {busy ? 'מכין…' : 'הפעל אימות דו-שלבי'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
