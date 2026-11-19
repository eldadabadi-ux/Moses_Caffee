/**
 * PasskeyCard — self-service enrolment of Face ID / Touch ID / Windows Hello
 * (client request 19.11.26: entering the system must stop being a chore).
 *
 * Shows the devices already enrolled on the account, enrols the current one,
 * and revokes any of them. All logic lives in lib/passkeys.js — this is the
 * screen only.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  passkeysSupported, biometricAvailable, listPasskeys, registerPasskey,
  deletePasskey, deviceLabel, passkeyErrorText, isAlreadyRegistered,
} from '../lib/passkeys'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { Fingerprint, Plus, Trash2, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'

const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function PasskeyCard() {
  const [loading, setLoading] = useState(true)
  const [keys, setKeys]       = useState([])
  const [busy, setBusy]       = useState(false)
  const [canBiometric, setCanBiometric] = useState(false)
  const [unavailable, setUnavailable]   = useState(false)
  const [hasTotp, setHasTotp]           = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setKeys(await listPasskeys()) }
    catch (e) { setUnavailable(true); console.warn('[passkeys] list', e?.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!passkeysSupported()) { setUnavailable(true); setLoading(false); return }
    biometricAvailable().then(setCanBiometric)
    supabase.auth.mfa.listFactors()
      .then(({ data }) => setHasTotp((data?.totp || []).some(f => f.status === 'verified')))
      .catch(() => {})
    refresh()
  }, [refresh])

  async function add() {
    if (busy) return
    setBusy(true)
    try {
      await registerPasskey(deviceLabel())
      toast.success('המכשיר נרשם — מעתה אפשר להיכנס בזיהוי ביומטרי ✓')
      await refresh()
    } catch (e) {
      const msg = passkeyErrorText(e)
      // A synced passkey already covering this device is good news, not an error.
      if (msg) isAlreadyRegistered(e) ? toast(msg, { icon: '🔐' }) : toast.error(msg)
    } finally { setBusy(false) }
  }

  async function remove(k) {
    if (busy) return
    if (!window.confirm(`להסיר את "${k.friendly_name || 'המכשיר'}"? לא תהיה אפשרות להיכנס ממנו בזיהוי ביומטרי.`)) return
    setBusy(true)
    try {
      await deletePasskey(k.id)
      toast.success('המכשיר הוסר')
      await refresh()
    } catch (e) { toast.error(passkeyErrorText(e) || 'ההסרה נכשלה') }
    finally { setBusy(false) }
  }

  const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }
  const head = { padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }

  return (
    <div id="set-passkeys" style={{ ...card, scrollMarginTop: 76 }} dir="rtl">
      <div style={head}>
        <Fingerprint size={17} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>כניסה ביומטרית (Face ID / טביעת אצבע)</span>
        {keys.length > 0 && (
          <span style={{ marginInlineStart: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--ok)', background: 'var(--success-tint-1)', border: '1px solid var(--success-tint-border)', borderRadius: 6, padding: '2px 8px' }}>
            {keys.length} מכשירים
          </span>
        )}
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-mute)', fontSize: 14 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> טוען…
          </div>
        ) : unavailable ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-mute)', lineHeight: 1.7 }}>
            הדפדפן או המכשיר הנוכחי אינם תומכים בכניסה ביומטרית. אפשר להמשיך להיכנס עם סיסמה,
            ולרשום מכשיר נתמך (iPhone, Android, Mac, Windows Hello) בהמשך.
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.7 }}>
              רישום המכשיר מאפשר להיכנס למערכת בסריקת פנים או טביעת אצבע — בלי סיסמה ובלי קוד מאפליקציית אימות.
              הזיהוי הביומטרי נשאר במכשיר בלבד ואינו נשלח למערכת; נשמר רק מפתח הצפנה ציבורי.
            </p>

            {keys.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {keys.map(k => (
                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-2)' }}>
                    <ShieldCheck size={16} color="var(--ok)" style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {k.friendly_name || 'מכשיר רשום'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
                        נרשם {fmtDate(k.created_at)}{k.last_used_at ? ` · שימוש אחרון ${fmtDate(k.last_used_at)}` : ''}
                      </div>
                    </div>
                    <button onClick={() => remove(k)} disabled={busy} title="הסר מכשיר"
                      style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', color: 'var(--danger)', padding: 5, display: 'flex', flexShrink: 0 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* The loop the user would otherwise not close: a passkey sign-in
                is aal1, so an enrolled TOTP factor still demands its code. */}
            {keys.length >= 2 && hasTotp && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}>
                <ShieldCheck size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
                רשומים {keys.length} מכשירים. כדי להיכנס בזיהוי ביומטרי בלבד, ללא קוד מאפליקציית האימות, יש לכבות את האימות הדו-שלבי בכרטיס שמתחת.
              </div>
            )}

            {keys.length === 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, border: '1px solid #d9770655', background: '#d9770614', color: '#d97706', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>
                  מומלץ לרשום מכשיר שני (למשל גם טלפון וגם מחשב) — כך אובדן מכשיר אחד אינו חוסם את הכניסה.
                  אם ה-Passkey נשמר בחשבון Google או ב-iCloud הוא כבר מסונכרן למכשירים האחרים, וניסיון רישום
                  נוסף מהם יוחזר בהודעה "המכשיר כבר רשום" — וזה תקין.
                </span>
              </div>
            )}

            <button onClick={add} disabled={busy}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, border: 'none', background: busy ? 'var(--panel-2)' : 'var(--accent)', color: busy ? 'var(--text-mute)' : 'white', fontSize: 14.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
              <Plus size={16} /> {busy ? 'רושם…' : keys.length ? 'רשום את המכשיר הנוכחי' : 'הפעל כניסה ביומטרית במכשיר הזה'}
            </button>

            {!canBiometric && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
                במכשיר הנוכחי לא זוהה חיישן ביומטרי מובנה. הרישום עדיין אפשרי באמצעות מפתח אבטחה חיצוני או טלפון סמוך.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
