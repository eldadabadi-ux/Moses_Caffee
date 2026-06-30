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

/**
 * MailConnectCard — connect a Gmail mailbox so receipts arriving by email are
 * auto-imported (as "pending" for review). Talks only to /api/mail/* — the
 * browser never sees tokens.
 */
export default function MailConnectCard() {
  const [state, setState] = useState(null)   // { connected, configured, email, status, last_scan_at }
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)

  async function refresh() {
    try { setState(await authFetch('/api/mail/status')) } catch { setState({ connected: false, configured: false }) }
  }

  useEffect(() => {
    // Toast the OAuth-redirect outcome and strip the ?mail= param.
    const p = new URLSearchParams(window.location.search)
    const m = p.get('mail')
    if (m && MSG[m]) { const [t, kind] = MSG[m]; kind === 'success' ? toast.success(t) : toast.error(t); const u = new URL(window.location.href); u.searchParams.delete('mail'); window.history.replaceState({}, '', u.toString()) }
    refresh()
  }, [])

  async function connect() {
    setBusy(true)
    try { const { url } = await authFetch('/api/mail/connect', 'POST'); window.location.href = url }
    catch (e) { toast.error(e.message); setBusy(false) }
  }
  async function disconnect() {
    setBusy(true)
    try { await authFetch('/api/mail/disconnect', 'POST'); toast.success('המייל נותק'); await refresh() }
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

  if (state && state.configured === false && !state.connected) return null   // integration not set up on the server yet

  const connected = state?.connected
  const btn = (extra) => ({ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 8, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', border: 'none', ...extra })

  return (
    <div id="set-mail" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mail size={17} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>קליטת קבלות מהמייל</span>
      </div>
      <div style={{ padding: 20 }} dir="rtl">
        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          חבר את תיבת ה-Gmail שלך — המערכת תסרוק מיילים עם קבלות (PDF/תמונה), תחלץ את הנתונים אוטומטית, ותכניס אותן כקבלות <strong>הממתינות לאישור</strong>. גישה לקריאה בלבד, והנתונים שלך נשארים פרטיים.
        </p>

        {connected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: state.status === 'error' ? '#fef2f2' : 'var(--accent-bg)', border: `1px solid ${state.status === 'error' ? 'var(--danger)' : 'var(--accent)'}` }}>
              {state.status === 'error' ? <AlertTriangle size={16} color="var(--danger)" /> : <Check size={16} color="var(--ok)" />}
              <span style={{ fontSize: 14, color: 'var(--text)' }}>מחובר: <strong>{state.email || 'Gmail'}</strong></span>
            </div>
            {state.status === 'error' && state.last_error && (
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--danger)' }}>החיבור צריך חידוש — נתק וחבר מחדש. ({state.last_error})</p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={scanNow} disabled={scanning} style={btn({ background: 'var(--accent)', color: '#fff', opacity: scanning ? 0.7 : 1 })}>
                <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'סורק…' : 'סרוק עכשיו'}
              </button>
              <button onClick={disconnect} disabled={busy} style={btn({ background: 'var(--panel)', color: 'var(--text-dim)', border: '1px solid var(--border)' })}>
                <X size={15} /> נתק
              </button>
            </div>
          </>
        ) : (
          <button onClick={connect} disabled={busy} style={btn({ background: 'var(--accent)', color: '#fff', padding: '12px 20px', fontSize: 15.5, opacity: busy ? 0.7 : 1 })}>
            <Plug size={17} /> {busy ? 'מתחבר…' : 'חבר את Gmail'}
          </button>
        )}
      </div>
    </div>
  )
}
