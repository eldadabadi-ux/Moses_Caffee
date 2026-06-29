import { useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { saveBackupToFolder, downloadBackup } from '../lib/backup'
import { hasDir } from '../lib/saveFolder'
import { isMobileDevice } from '../lib/isMobileDevice'
import toast from 'react-hot-toast'

const LAST_KEY = 'moses_last_backup'   // YYYY-MM-DD of the last successful backup
const AUTO_KEY = 'moses_auto_backup'   // '1' (default) | '0'
const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * DailyBackup — automatic, silent daily backup. NO prompt. Runs once per
 * calendar day (on the first app open of the day, and again at midnight if the
 * app stays open). Writes to the configured save folder when available;
 * otherwise downloads the JSON in the background. The data is also always safe
 * in the cloud (Supabase), so a missing local backup is never a risk.
 */
export default function DailyBackup() {
  const { user } = useAuth()
  const ran = useRef(false)

  useEffect(() => {
    // Backups download/save files — only on the desktop website, never on a phone.
    if (!user || isMobileDevice()) return
    let timer

    async function runIfDue() {
      let auto = '1'
      try { auto = localStorage.getItem(AUTO_KEY) ?? '1' } catch {}
      if (auto !== '1') return
      let last = null
      try { last = localStorage.getItem(LAST_KEY) } catch {}
      if (last === todayStr()) return
      try {
        let saved = false
        if (await hasDir()) saved = await saveBackupToFolder(user)
        if (!saved) await downloadBackup(user)   // no folder → silent background download
        try { localStorage.setItem(LAST_KEY, todayStr()) } catch {}
        toast.success('גיבוי יומי בוצע ✓', { icon: '💾', duration: 3000 })
      } catch { /* best-effort — the data is also safe in the cloud */ }
    }

    if (!ran.current) { ran.current = true; runIfDue() }

    // Re-run at the next midnight (and reschedule) so an always-open app backs
    // up at 00:00 as well.
    function scheduleMidnight() {
      const now = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10)
      timer = setTimeout(async () => { await runIfDue(); scheduleMidnight() }, next - now)
    }
    scheduleMidnight()
    return () => clearTimeout(timer)
  }, [user])

  return null
}
