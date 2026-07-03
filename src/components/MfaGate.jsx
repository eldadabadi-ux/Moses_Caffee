/**
 * MfaGate — enforces MFA step-up (A.5.17 / A.8.5). Inert for users without a
 * verified TOTP factor: it only blocks the app when the session is at AAL1 but
 * a factor requires AAL2 (i.e. the owner enrolled 2FA but hasn't entered a code
 * this session). Renders nothing otherwise, so regular users never see it.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { ShieldCheck, LogOut } from 'lucide-react'

export default function MfaGate() {
  const { user, signOut } = useAuth()
  const [needsStepUp, setNeedsStepUp] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    if (!user) { setNeedsStepUp(false); return }
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) { setNeedsStepUp(false); return }        // MFA not enabled → inert
      setNeedsStepUp(data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2')
    } catch { setNeedsStepUp(false) }
  }, [user])

  useEffect(() => { check() }, [check])

  async function verify(e) {
    e?.preventDefault()
    if (busy || code.trim().length < 6) return
    setBusy(true)
    try {
      const { data: fData } = await supabase.auth.mfa.listFactors()
      const totp = (fData?.totp || []).find(f => f.status === 'verified') || fData?.totp?.[0]
      if (!totp) { toast.error('לא נמצא גורם 2FA'); return }
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim() })
      if (error) { toast.error('קוד שגוי — נסה שוב'); return }
      setCode('')
      await check()
      toast.success('אומת בהצלחה ✓')
    } catch (err) {
      toast.error(err?.message || 'שגיאת אימות')
    } finally { setBusy(false) }
  }

  if (!needsStepUp) return null

  return (
    <div dir="rtl" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'var(--font-main)' }}>
      <div style={{ width: '100%', maxWidth: 380, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 18, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ShieldCheck size={24} color="var(--accent)" />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>אימות דו-שלבי</h2>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 14.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          הזן את הקוד בן 6 הספרות מאפליקציית האימות שלך (Google Authenticator / Authy) כדי להשלים את הכניסה.
        </p>
        <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus
            placeholder="000000" dir="ltr"
            style={{ height: 52, textAlign: 'center', letterSpacing: 8, fontSize: 24, fontWeight: 700, borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontFamily: 'var(--font-main)', outline: 'none' }} />
          <button type="submit" disabled={busy || code.length < 6}
            style={{ height: 48, border: 'none', borderRadius: 12, background: (busy || code.length < 6) ? 'var(--panel-2)' : 'var(--accent)', color: (busy || code.length < 6) ? 'var(--text-mute)' : 'white', fontSize: 16, fontWeight: 700, cursor: (busy || code.length < 6) ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
            {busy ? 'מאמת…' : 'אמת והמשך'}
          </button>
        </form>
        <button onClick={() => signOut()} style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
          <LogOut size={14} /> התנתק
        </button>
      </div>
    </div>
  )
}
