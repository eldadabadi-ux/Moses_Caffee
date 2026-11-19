/**
 * LegacyDomainNotice — the old moses-caffee.pages.dev address still serves the
 * same build, so a client who kept the old icon keeps working there and never
 * notices. That is not harmless: passkeys are bound to app.eldadai.co.il, so
 * biometric sign-in simply cannot work on the old host ("The RP ID is invalid
 * for this domain", 19.11.26), and the old project is about to be deleted.
 *
 * A silent redirect would throw an installed PWA out into a browser tab with no
 * explanation, so this says what happened and lets the user make the move.
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, Smartphone } from 'lucide-react'

export const NEW_ORIGIN = 'https://app.eldadai.co.il'
const LEGACY_HOSTS = ['moses-caffee.pages.dev']

export function isLegacyHost(hostname = window.location.hostname) {
  return LEGACY_HOSTS.includes(hostname)
}

export default function LegacyDomainNotice() {
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(isLegacyHost()) }, [])
  if (!show) return null

  const target = NEW_ORIGIN + window.location.pathname + window.location.search

  return (
    <div dir="rtl" style={{
      position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(15,23,42,0.80)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, fontFamily: 'var(--font-main)',
    }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 18, padding: 26, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 21, fontWeight: 800, color: 'var(--text)' }}>
          המערכת עברה לכתובת חדשה
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 15, color: 'var(--text-dim)', lineHeight: 1.7 }}>
          הכתובת הישנה תיסגר בקרוב. כל הנתונים, הקבלות וההגדרות ממתינים לך בכתובת החדשה —
          אותו חשבון, אותה סיסמה.
        </p>
        <a href={target}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 12, background: 'var(--accent)', color: '#fff', fontSize: 17, fontWeight: 700, textDecoration: 'none' }}>
          מעבר לכתובת החדשה <ArrowLeft size={19} />
        </a>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, padding: '11px 13px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
          <Smartphone size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65 }}>
            בטלפון: לאחר המעבר, בתפריט הדפדפן בחר <strong>"הוספה למסך הבית"</strong> כדי להתקין את האפליקציה
            מהכתובת החדשה, ומחק את הסמל הישן. כניסה בזיהוי ביומטרי אפשרית רק מהכתובת החדשה.
          </div>
        </div>
        <div dir="ltr" style={{ marginTop: 12, textAlign: 'center', fontSize: 12.5, color: 'var(--text-mute)' }}>
          {NEW_ORIGIN.replace('https://', '')}
        </div>
      </div>
    </div>
  )
}
