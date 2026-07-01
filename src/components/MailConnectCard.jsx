import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Mail, RefreshCw, Check, X, AlertTriangle, Plug } from 'lucide-react'
import toast from 'react-hot-toast'

async function authFetch(path, method = 'GET') {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { method, headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message || body.error || `שגיאה ${res.status}`)
  return body
}

const MSG = {
  connected: ['תיבת המייל חוברה ✓', 'success'],
  denied:    ['ההרשאה בוטלה', 'error'],
  norefresh: ['החיבור נכשל — נסה שוב ואשר גישה לא-מקוונת', 'error'],
  error:     ['שגיאה בחיבור המייל', 'error'],
}
const LABEL = { gmail: 'Gmail', outlook: 'Outlook' }

/**
 * MailConnectCard — connect Gmail and/or Outlook so receipts arriving by email
 * are auto-imported (as "pending" for review). Talks only to /api/mail/* — the
 * browser never sees tokens.
 */
export default function MailConnectCard() {
  const [state, setState] = useState(null)   // { connections:[{provider,email,status,...}], providers:{gmail,outlook} }
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)

  async function refresh() {
    try { setState(await authFetch('/api/mail/status')) } catch { setState({ connections: [], providers: {} }) }
  }

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const m = p.get('mail')
    if (m && MSG[m]) { const [t, kind] = MSG[m]; kind === 'success' ? toast.success(t) : toast.error(t); const u = new URL(window.location.href); u.searchParams.delete('mail'); window.history.replaceState({}, '', u.toString()) }
    refresh()
  }, [])

  async function connect(provider) {
    setBusy(true)
    try { const { url } = await authFetch(`/api/mail/connect?provider=${provider}`, 'POST'); window.location.href = url }
    catch (e) { toast.error(e.message); setBusy(false) }
  }
  async function disconnect(provider) {
    setBusy(true)
    try { await authFetch(`/api/mail/disconnect?provider=${provider}`, 'POST'); toast.success('המייל נותק'); await refresh() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  async function scanNow() {
    setScanning(true)
    try {
      const r = await authFetch('/api/mail/scan', 'POST')
      toast.success(r.imported > 0 ? `נמצאו ${r.imported} קבלות חדשות — ממתינות לאישור` : 'לא נמצאו קבלות חדשות')
      await refresh()
    } catch (e) { toast.error(e.message) } finally { setScanning(false) }
  }

  if (!state) return null
  const providers = Object.entries(state.providers || {}).filter(([, on]) => on).map(([p]) => p)
  const connections = state.connections || []
  if (providers.length === 0 && connections.length === 0) return null   // integration not configured yet
  const connOf = (p) => connections.find(c => c.provider === p)

  const btn = (extra) => ({ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', border: 'none', ...extra })

  return (
    <div id="set-mail" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mail size={17} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>קליטת קבלות מהמייל</span>
      </div>
      <div style={{ padding: 20 }} dir="rtl">
        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          חבר את תיבת המייל שלך — המערכת תסרוק מיילים עם קבלות (PDF/תמונה), תחלץ את הנתונים אוטומטית, ותכניס אותן כקבלות <strong>הממתינות לאישור</strong>. גישה לקריאה בלבד, והנתונים שלך נשארים פרטיים.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {providers.map(p => {
            const c = connOf(p)
            return c ? (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: c.status === 'error' ? '#fef2f2' : 'var(--accent-bg)', border: `1px solid ${c.status === 'error' ? 'var(--danger)' : 'var(--accent)'}`, flexWrap: 'wrap' }}>
                {c.status === 'error' ? <AlertTriangle size={16} color="var(--danger)" /> : <Check size={16} color="var(--ok)" />}
                <span style={{ fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0 }}>{LABEL[p]}: <strong>{c.email || 'מחובר'}</strong>{c.status === 'error' && ' — צריך חידוש'}</span>
                <button onClick={() => disconnect(p)} disabled={busy} style={btn({ background: 'var(--panel)', color: 'var(--text-dim)', border: '1px solid var(--border)', padding: '7px 12px' })}><X size={14} /> נתק</button>
              </div>
            ) : (
              <button key={p} onClick={() => connect(p)} disabled={busy} style={btn({ background: 'var(--accent)', color: '#fff', width: 'fit-content' })}>
                <Plug size={16} /> חבר את {LABEL[p]}
              </button>
            )
          })}
        </div>

        {connections.length > 0 && (
          <button onClick={scanNow} disabled={scanning} style={{ ...btn({ background: 'var(--panel)', color: 'var(--accent)', border: '1px solid var(--accent)' }), marginTop: 14 }}>
            <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'סורק…' : 'סרוק עכשיו'}
          </button>
        )}
      </div>
    </div>
  )
}
