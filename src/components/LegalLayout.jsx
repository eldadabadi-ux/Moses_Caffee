import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

/**
 * Shared shell for the public legal pages (privacy / terms / accessibility).
 * Standalone, RTL, readable column — reachable with or without a session so the
 * documents are accessible before sign-up.
 */
export default function LegalLayout({ title, updated, children }) {
  const navigate = useNavigate()
  const back = () => { if (window.history.length > 1) navigate(-1); else navigate('/') }

  const tab = (to, label) => (
    <Link to={to} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>{label}</Link>
  )

  return (
    <div dir="rtl" style={{ minHeight: '100dvh', background: 'var(--bg)', fontFamily: 'var(--font-main)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 18px 64px' }}>
        <button onClick={back}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-main)', padding: '4px 0', marginBottom: 12 }}>
          <ArrowRight size={17} /> חזרה
        </button>

        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>{title}</h1>
        {updated && <p style={{ margin: '0 0 24px', fontSize: 13.5, color: 'var(--text-mute)' }}>עודכן לאחרונה: {updated}</p>}

        <div className="legal-body" style={{ fontSize: 15.5, lineHeight: 1.8, color: 'var(--text-dim)' }}>
          {children}
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 40, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          {tab('/privacy', 'מדיניות פרטיות')}
          {tab('/terms', 'תקנון שימוש')}
          {tab('/accessibility', 'הצהרת נגישות')}
          {tab('/', 'חזרה לאפליקציה')}
        </div>
      </div>
    </div>
  )
}

// Shared building blocks so the three documents stay visually consistent.
export function Section({ n, title, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
        {n != null ? `${n}. ` : ''}{title}
      </h2>
      {children}
    </section>
  )
}

export function P({ children }) {
  return <p style={{ margin: '0 0 10px' }}>{children}</p>
}

export function UL({ children }) {
  return <ul style={{ margin: '0 0 10px', paddingInlineStart: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</ul>
}
