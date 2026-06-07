import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { saveBackupToFolder, downloadBackup } from '../lib/backup'
import { hasDir } from '../lib/saveFolder'
import { Database, X } from 'lucide-react'
import toast from 'react-hot-toast'

const LAST_KEY = 'moses_last_backup'   // YYYY-MM-DD of the last successful backup
const AUTO_KEY = 'moses_auto_backup'   // '1' (default) | '0'
const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * DailyBackup — runs once per day. If a save folder is configured (desktop) it
 * writes the JSON backup there silently; otherwise it shows a small one-tap
 * prompt to download the backup. Mounted once in the app shell.
 */
export default function DailyBackup() {
  const { user } = useAuth()
  const [prompt, setPrompt] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (!user || ran.current) return
    ran.current = true
    let auto = '1'
    try { auto = localStorage.getItem(AUTO_KEY) ?? '1' } catch {}
    if (auto !== '1') return
    let last = null
    try { last = localStorage.getItem(LAST_KEY) } catch {}
    if (last === todayStr()) return

    ;(async () => {
      try {
        if (await hasDir()) {
          const ok = await saveBackupToFolder(user)
          if (ok) {
            try { localStorage.setItem(LAST_KEY, todayStr()) } catch {}
            toast.success('גיבוי יומי נשמר לתיקייה ✓', { icon: '💾', duration: 4000 })
            return
          }
        }
      } catch { /* fall through to prompt */ }
      // No folder (or save failed) → offer a one-tap download, a moment after load.
      setTimeout(() => setPrompt(true), 2500)
    })()
  }, [user])

  async function doDownload() {
    try {
      await downloadBackup(user)
      try { localStorage.setItem(LAST_KEY, todayStr()) } catch {}
      toast.success('גיבוי יומי נשמר ✓')
      setPrompt(false)
    } catch {
      toast.error('שגיאה בגיבוי')
    }
  }
  function dismiss() {
    try { localStorage.setItem(LAST_KEY, todayStr()) } catch {}
    setPrompt(false)
  }

  if (!prompt) return null
  return (
    <div dir="rtl" style={{
      position: 'fixed', zIndex: 300, left: 16, right: 16, bottom: 'calc(78px + env(safe-area-inset-bottom))',
      maxWidth: 420, margin: '0 auto', background: 'var(--panel)', border: '1px solid var(--accent)',
      borderRadius: 14, boxShadow: 'var(--shadow-modal)', padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Database size={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text)' }}>גיבוי יומי</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>שמירת עותק של כל הנתונים (JSON) לשחזור עתידי.</div>
      </div>
      <button onClick={doDownload} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)', flexShrink: 0 }}>גבה</button>
      <button onClick={dismiss} aria-label="סגור" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: 4, display: 'flex', flexShrink: 0 }}><X size={18} /></button>
    </div>
  )
}
