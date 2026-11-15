import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Inbox, Copy, Check, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

async function authFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message || body.error || `שגיאה ${res.status}`)
  return body
}

const card = { scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }
const head = { padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }

/**
 * InboundMailCard — the customer's personal inbound address (client request #7).
 * They forward supplier emails to it; each attachment arrives as a pending
 * receipt. Pairs with the Gmail/Outlook connect card but needs no OAuth — just a
 * one-time forwarding rule in the customer's own mailbox.
 */
export default function InboundMailCard() {
  const [info, setInfo] = useState(null)   // { alias, domain, address }
  const [err, setErr] = useState(false)
  const [copied, setCopied] = useState(false)
  const [guide, setGuide] = useState(false)

  useEffect(() => { authFetch('/api/inbound/alias').then(setInfo).catch(() => setErr(true)) }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(info.address); setCopied(true); toast.success('הכתובת הועתקה'); setTimeout(() => setCopied(false), 2000) }
    catch { toast.error('ההעתקה נכשלה — סמן והעתק ידנית') }
  }

  const active = info?.address && info?.domain

  return (
    <div id="set-inbound" style={card}>
      <div style={head}>
        <Inbox size={17} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>קליטת מייל אוטומטית</span>
      </div>
      <div style={{ padding: 20 }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          קיבלת כתובת מייל אישית. הגדר פעם אחת בתיבה שלך העברה אוטומטית של מיילים מספקים לכתובת הזו —
          וכל קבלה שמצורפת תיקלט אוטומטית ותחכה לאישור ב"קבלות". ללא צורך בחיבור חשבון.
        </p>

        {err && (
          <div style={{ padding: '11px 14px', background: 'var(--warn-tint-1)', border: '1px solid var(--warn-tint-border)', borderRadius: 10, fontSize: 13.5, color: 'var(--text)' }}>
            טעינת הכתובת נכשלה. נסה לרענן את העמוד.
          </div>
        )}

        {!err && !info && (
          <div style={{ fontSize: 14, color: 'var(--text-mute)' }}>טוען…</div>
        )}

        {info && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <code style={{ flex: '1 1 260px', direction: 'ltr', textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1.5px solid var(--accent)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 15, fontWeight: 600, fontFamily: 'monospace', userSelect: 'all', overflowX: 'auto' }}>
                {active ? info.address : info.alias}
              </code>
              {active && (
                <button onClick={copy}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 16px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'הועתק' : 'העתק'}
                </button>
              )}
            </div>

            {!active && (
              <div style={{ marginTop: 12, padding: '11px 14px', background: 'var(--warn-tint-1)', border: '1px solid var(--warn-tint-border)', borderRadius: 10, fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>
                הכתובת שמורה, אך דומיין הקליטה טרם הופעל במערכת. לאחר הפעלת הדומיין (הגדרת <code>INBOUND_DOMAIN</code>)
                הכתובת המלאה תוצג כאן ותהיה פעילה.
              </div>
            )}

            {active && (
              <div style={{ marginTop: 14 }}>
                <button onClick={() => setGuide(g => !g)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-main)', padding: 0 }}>
                  <ChevronDown size={16} style={{ transform: guide ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
                  איך מגדירים העברה אוטומטית? (פעם אחת, כ-2 דקות)
                </button>
                {guide && (
                  <div style={{ marginTop: 10, padding: '14px 16px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Gmail</div>
                    הגדרות (⚙️) → See all settings → Filters and Blocked Addresses → Create a new filter →
                    בשדה "has the words" כתוב <code>has:attachment</code> → Create filter → סמן
                    "Forward it to" → Add forwarding address → הדבק את הכתובת שלמעלה → אשר את מייל האימות שיישלח אליה.
                    <div style={{ fontWeight: 700, color: 'var(--text)', margin: '12px 0 4px' }}>Outlook</div>
                    Settings → Mail → Rules → Add new rule → תנאי: "Has attachment" → פעולה:
                    "Forward to" → הדבק את הכתובת שלמעלה → Save.
                    <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-mute)' }}>
                      טיפ: אפשר לצמצם את ההעברה רק למיילים מספקים ספציפיים (לפי כתובת השולח) כדי לא להעביר הכול.
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
