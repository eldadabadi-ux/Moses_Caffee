import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Cookie } from 'lucide-react'

const KEY = 'moses_cookie_notice_v1'

/**
 * Essential-storage notice. The app uses ONLY essential cookies + localStorage
 * (auth + preferences) — no analytics or tracking — so this is an informational
 * acknowledgement, not a consent gate. If non-essential trackers are ever added,
 * replace this with a granular opt-in banner (see israeli-privacy-shield).
 */
export default function CookieConsent() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try { if (localStorage.getItem(KEY) !== '1') setShow(true) } catch { setShow(true) }
  }, [])

  function dismiss() {
    try { localStorage.setItem(KEY, '1') } catch {}
    setShow(false)
  }

  if (!show) return null

  return (
    <div dir="rtl" role="region" aria-label="הודעת עוגיות"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200,
        background: 'var(--panel)', borderTop: '1px solid var(--border)',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.10)',
        padding: 'calc(14px) 16px calc(14px + env(safe-area-inset-bottom))',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        justifyContent: 'center', fontFamily: 'var(--font-main)',
      }}>
      <Cookie size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, flex: '1 1 320px', minWidth: 0 }}>
        אנו משתמשים בעוגיות ובאחסון מקומי <strong>חיוניים בלבד</strong> — להתחברות ולשמירת העדפותיך.
        אין מעקב, אנליטיקה או פרסום. פרטים ב<Link to="/privacy" style={{ color: 'var(--accent)', fontWeight: 600 }}>מדיניות הפרטיות</Link>.
      </p>
      <button onClick={dismiss}
        style={{ flexShrink: 0, padding: '9px 22px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
        הבנתי
      </button>
    </div>
  )
}
