import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useSettings'
import toast from 'react-hot-toast'

/**
 * Completes the "forgot password" flow. The reset email links here with a
 * recovery token. Because the Supabase client is created with
 * detectSessionInUrl:false, we establish the session manually (covering the
 * implicit, PKCE, and token_hash link formats), then let the user set a new
 * password.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [phase, setPhase]   = useState('verifying') // verifying | ready | invalid
  const [pw, setPw]         = useState('')
  const [pw2, setPw2]       = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function establish() {
      try {
        const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
        const query = new URLSearchParams(window.location.search || '')
        const access_token = hash.get('access_token')
        const refresh_token = hash.get('refresh_token')
        const code = query.get('code')
        const token_hash = hash.get('token_hash') || query.get('token_hash')
        const type = hash.get('type') || query.get('type') || 'recovery'

        let ok = false
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          ok = !error
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          ok = !error
        } else if (token_hash) {
          const { error } = await supabase.auth.verifyOtp({ type, token_hash })
          ok = !error
        } else {
          // Maybe the SDK already has a recovery session from a prior step.
          const { data } = await supabase.auth.getSession()
          ok = !!data?.session
        }

        if (cancelled) return
        if (ok) {
          // Clean the token out of the URL bar.
          try { window.history.replaceState({}, '', '/reset-password') } catch {}
          setPhase('ready')
        } else {
          setPhase('invalid')
        }
      } catch {
        if (!cancelled) setPhase('invalid')
      }
    }
    establish()
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (pw.length < 8) { toast.error('הסיסמה חייבת להיות לפחות 8 תווים'); return }
    if (pw !== pw2)    { toast.error('הסיסמאות אינן תואמות'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw error
      toast.success('הסיסמה עודכנה ✓')
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(err?.message || 'עדכון הסיסמה נכשל')
    } finally {
      setSaving(false)
    }
  }

  const FS = {
    display: 'block', width: '100%', height: '44px', padding: '0 14px', borderRadius: '10px',
    border: '1.5px solid var(--border)', background: 'var(--panel)', color: 'var(--text)',
    fontSize: '17px', fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div dir="rtl" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '16px', fontFamily: 'var(--font-main)' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          {settings.logo ? (
            <img src={settings.logo} alt="לוגו" style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', margin: '0 auto 16px', display: 'block', border: '3px solid var(--panel)', boxShadow: '0 8px 28px rgba(0,0,0,0.18)' }} />
          ) : (
            <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 8px 28px rgba(37,99,235,0.30)' }}>
              <span style={{ color: 'white', fontSize: '40px', fontWeight: 700 }}>₪</span>
            </div>
          )}
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>איפוס סיסמה</h1>
        </div>

        {phase === 'verifying' && (
          <p style={{ textAlign: 'center', fontSize: '16px', color: 'var(--text-mute)' }}>מאמת את הקישור…</p>
        )}

        {phase === 'invalid' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '16px', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '20px' }}>
              הקישור לאיפוס אינו תקין או שפג תוקפו. בקש קישור חדש ממסך הכניסה.
            </p>
            <button onClick={() => navigate('/login', { replace: true })}
              style={{ height: '48px', width: '100%', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '17px', fontWeight: 700, fontFamily: 'var(--font-main)', cursor: 'pointer' }}>
              חזרה לכניסה
            </button>
          </div>
        )}

        {phase === 'ready' && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '7px' }}>סיסמה חדשה</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="לפחות 8 תווים" autoComplete="new-password" style={FS}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'} onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '7px' }}>אימות סיסמה</label>
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="הקלד שוב" autoComplete="new-password" style={FS}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'} onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </div>
            <button type="submit" disabled={saving}
              style={{ height: '50px', background: saving ? 'var(--panel-2)' : 'var(--accent)', color: saving ? 'var(--text-mute)' : 'white', border: 'none', borderRadius: '10px', fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-main)', cursor: saving ? 'not-allowed' : 'pointer', marginTop: '4px' }}>
              {saving ? 'שומר…' : 'עדכן סיסמה'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
