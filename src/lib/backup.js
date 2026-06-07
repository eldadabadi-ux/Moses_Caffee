/**
 * backup — full-data export/restore as JSON.
 * A backup contains all receipts, all categories and the local settings, so the
 * whole system can be restored later. Used by the daily auto-backup + the manual
 * "backup now" / "restore" buttons in Settings.
 */
import { supabase } from './supabase'
import { downloadFile } from './downloadFile'
import { saveToDir } from './saveFolder'

const SETTINGS_KEY = 'receipts_settings_v1'

export async function buildBackupObject(user) {
  const [recRes, catRes] = await Promise.all([
    supabase.from('receipts').select('*').eq('user_id', user.id).order('receipt_date', { ascending: true }),
    supabase.from('categories').select('*').eq('user_id', user.id).order('level').order('sort_order'),
  ])
  if (recRes.error) throw recRes.error
  let settings = null
  try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') } catch {}
  const receipts = recRes.data || []
  const categories = catRes.data || []
  return {
    app: 'moses-caffee',
    backup_version: 1,
    exported_at: new Date().toISOString(),
    user_id: user.id,
    user_email: user.email || null,
    counts: { receipts: receipts.length, categories: categories.length },
    receipts,
    categories,
    settings,
  }
}

function backupFilename() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `moses-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`
}

export function backupBlob(obj) {
  return new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
}

/** Manual backup — saves to the chosen folder if set, else Save-As / download. */
export async function downloadBackup(user) {
  const obj = await buildBackupObject(user)
  await downloadFile({ blob: backupBlob(obj), filename: backupFilename() })
  return obj.counts
}

/** Silent save to the chosen folder (daily auto-backup). Returns true if saved. */
export async function saveBackupToFolder(user) {
  const obj = await buildBackupObject(user)
  return await saveToDir(backupBlob(obj), backupFilename())
}

export async function readBackupFile(file) {
  const text = await file.text()
  return JSON.parse(text)
}

/** Restore — upsert categories (parents first) then receipts, by id. */
export async function restoreFromObject(obj, user) {
  if (!obj || obj.app !== 'moses-caffee' || !Array.isArray(obj.receipts)) {
    throw new Error('קובץ גיבוי לא תקין')
  }
  const stamp = (arr) => (arr || []).map(x => ({ ...x, user_id: user.id }))
  const restored = { categories: 0, receipts: 0 }

  if (obj.categories?.length) {
    // level-ascending so a parent is always inserted before its children (FK)
    const cats = stamp(obj.categories).sort((a, b) => (a.level || 1) - (b.level || 1))
    const { error } = await supabase.from('categories').upsert(cats, { onConflict: 'id' })
    if (error) throw error
    restored.categories = cats.length
  }

  if (obj.receipts?.length) {
    const rows = stamp(obj.receipts)
    const CHUNK = 10  // receipt images are large — chunk the upsert to stay under payload limits
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      let { error } = await supabase.from('receipts').upsert(slice, { onConflict: 'id' })
      if (error && /amount_before_vat|vat_amount|vat_rate/.test(error.message || '')) {
        const stripped = slice.map(({ amount_before_vat, vat_amount, vat_rate, ...rest }) => rest)
        ;({ error } = await supabase.from('receipts').upsert(stripped, { onConflict: 'id' }))
      }
      if (error) throw error
    }
    restored.receipts = rows.length
  }

  if (obj.settings) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj.settings)) } catch {} }
  return restored
}
