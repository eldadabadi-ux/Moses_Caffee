import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const { user, signIn } = useAuth()
  const { settings } = useSettings()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)

  if (user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) { toast.error('נא למלא אימייל וסיסמה'); return }
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err) {
      toast.error(err.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : err.message || 'שגיאת כניסה')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div dir="rtl" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '16px', fontFamily: 'var(--font-main)' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>

        {/* Logo — large round business logo, or ₪ placeholder */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          {settings.logo ? (
            <img
              src={settings.logo}
              alt="לוגו"
              style={{ width: '110px', height: '110px', borderRadius: '50%', objectFit: 'cover', margin: '0 auto 18px', display: 'block', border: '3px solid var(--panel)', boxShadow: '0 8px 28px rgba(0,0,0,0.18)' }}
            />
          ) : (
            <div style={{ width: '110px', height: '110px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', boxShadow: '0 8px 28px rgba(37,99,235,0.30)' }}>
              <span style={{ color: 'white', fontSize: '46px', fontWeight: 700 }}>₪</span>
            </div>
          )}
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{settings.businessName || 'מנהל קבלות'}</h1>
          <p style={{ fontSize: '16px', color: 'var(--text-mute)', marginTop: '8px' }}>כניסה לחשבון</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '16px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '7px' }}>אימייל</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              dir="ltr"
              autoComplete="email"
              style={{ display: 'block', width: '100%', height: '44px', padding: '0 14px', borderRadius: '10px', border: '1.5px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '17px', fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '16px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '7px' }}>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{ display: 'block', width: '100%', height: '44px', padding: '0 14px', borderRadius: '10px', border: '1.5px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '17px', fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{ height: '50px', background: loading ? 'var(--panel-2)' : 'var(--accent)', color: loading ? 'var(--text-mute)' : 'white', border: 'none', borderRadius: '10px', fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-main)', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '4px', transition: 'background 140ms' }}
          >
            {loading ? 'נכנס...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  )
}
