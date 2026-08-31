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
  async function disconnect(provider, email) {
    setBusy(true)
    // The address says WHICH mailbox; without it the server refuses when several
    // of the same provider are connected, rather than dropping an arbitrary one.
    const q = `provider=${encodeURIComponent(provider)}${email ? `&email=${encodeURIComponent(email)}` : ''}`
    try { await authFetch(`/api/mail/disconnect?${q}`, 'POST'); toast.success('התיבה נותקה'); await refresh() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  async function scanNow() {
    setScanning(true)
    let total = 0, lastError = null, examined = 0, since = 0
    try {
      // Each call processes a small batch (Cloudflare subrequest limit); loop
      // until the mailbox backlog is drained, up to a safe number of rounds.
      for (let i = 0; i < 15; i++) {
        const r = await authFetch('/api/mail/scan', 'POST')
        total += r.imported || 0
        examined += r.scanned || 0
        if (!since && r.since) since = r.since
        if (r.error) { lastError = r.error; break }   // stop on error (e.g. OCR quota) — don't hammer the API
        if (!r.more) break
      }
      if (lastError && total === 0) toast.error(`שגיאה בסריקה: ${lastError}`)
      else if (total > 0) toast.success(`נמצאו ${total} קבלות חדשות — ממתינות לאישור`)
      else {
        const sinceTxt = since > 0 ? new Date(since).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '30 יום אחורה'
        toast(`לא נמצאו קבלות חדשות (נבדקו ${examined} הודעות, מ-${sinceTxt})`, { icon: 'ℹ️', duration: 6000 })
      }
      await refresh()
    } catch (e) { toast.error(e.message) } finally { setScanning(false) }
  }

  if (!state) return null
  const providers = Object.entries(state.providers || {}).filter(([, on]) => on).map(([p]) => p)
  const connections = state.connections || []
  if (providers.length === 0 && connections.length === 0) return null   // integration not configured yet
  // Several mailboxes per provider are supported (client request #14), so this
  // returns a LIST — picking "the" connection silently hid the others.
  const connsOf = (p) => connections.filter(c => c.provider === p)
  const brokenDays = (c) => (c.error_since
    ? Math.max(0, Math.floor((Date.now() - new Date(c.error_since).getTime()) / 86400000))
    : null)

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
            const list = connsOf(p)
            return (
              <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map(c => {
                  const broken = c.status === 'error' || c.status === 'revoked'
                  const days = brokenDays(c)
                  return (
                    <div key={c.id || c.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: broken ? '#fef2f2' : 'var(--accent-bg)', border: `1px solid ${broken ? 'var(--danger)' : 'var(--accent)'}`, flexWrap: 'wrap' }}>
                      {broken ? <AlertTriangle size={16} color="var(--danger)" /> : <Check size={16} color="var(--ok)" />}
                      <span style={{ fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0 }}>
                        {LABEL[p]}: <strong>{c.email || 'מחובר'}</strong>
                        {broken && (
                          <span style={{ color: 'var(--danger)' }}>
                            {' '}— החיבור פג, הקליטה מהתיבה הזו הופסקה
                            {days > 0 && ` כבר ${days} ימים`}
                          </span>
                        )}
                      </span>
                      {broken && (
                        <button onClick={() => connect(p)} disabled={busy}
                          style={btn({ background: 'var(--danger)', color: '#fff', padding: '7px 12px' })}>
                          <Plug size={14} /> חבר מחדש
                        </button>
                      )}
                      <button onClick={() => disconnect(p, c.email)} disabled={busy} style={btn({ background: 'var(--panel)', color: 'var(--text-dim)', border: '1px solid var(--border)', padding: '7px 12px' })}><X size={14} /> נתק</button>
                    </div>
                  )
                })}
                <button onClick={() => connect(p)} disabled={busy}
                  style={btn(list.length
                    ? { background: 'var(--panel)', color: 'var(--accent)', border: '1px solid var(--accent)', width: 'fit-content' }
                    : { background: 'var(--accent)', color: '#fff', width: 'fit-content' })}>
                  <Plug size={16} /> {list.length ? `חבר תיבה נוספת של ${LABEL[p]}` : `חבר את ${LABEL[p]}`}
                </button>
              </div>
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
