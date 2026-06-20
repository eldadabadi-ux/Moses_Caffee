import { useState, useRef } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { Settings, Save, Info, Percent, Image as ImageIcon, Trash2, Building2, FolderOpen, Bell, Smartphone, Download, Share, Plus, Check, RefreshCw, Database, Upload, ScanLine, KeyRound, ShieldCheck, AlertTriangle } from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Link } from 'react-router-dom'
import { fileToSquareLogo } from '../lib/imageUtils'
import { isFolderSupported, pickDir, savedDirName, clearDir } from '../lib/saveFolder'
import { useInstall } from '../hooks/useInstall'
import { rescanAllReceipts } from '../lib/rescanReceipts'
import { downloadBackup, restoreFromObject, readBackupFile } from '../lib/backup'
import ShekelSign from '../components/icons/ShekelSign'
import toast from 'react-hot-toast'

const LAST_BACKUP_KEY = 'moses_last_backup'
const AUTO_BACKUP_KEY = 'moses_auto_backup'

export default function SettingsPage() {
  const { settings, updateSettings, saving } = useSettings()
  const { user, updatePassword, deleteAccount } = useAuth()
  const { canInstall, promptInstall, isIOS, isStandalone } = useInstall()
  const [vatInput, setVatInput] = useState(String(settings.vatRate))
  const [changed, setChanged] = useState(false)
  const [nameInput, setNameInput] = useState(settings.businessName || '')
  const [nameChanged, setNameChanged] = useState(false)
  const [folderName, setFolderName] = useState(savedDirName())
  const logoInputRef = useRef(null)

  // Re-scan all receipts (price accuracy)
  const [rescanBusy, setRescanBusy] = useState(false)
  const [rescanProg, setRescanProg] = useState(null)   // { done, total, fixed, failed }
  const [rescanResult, setRescanResult] = useState(null)

  // Backup / restore
  const restoreInputRef = useRef(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [lastBackup, setLastBackup] = useState(() => { try { return localStorage.getItem(LAST_BACKUP_KEY) } catch { return null } })
  const [autoBackup, setAutoBackup] = useState(() => { try { return (localStorage.getItem(AUTO_BACKUP_KEY) ?? '1') === '1' } catch { return true } })

  // Account security
  const [pwNew, setPwNew]         = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwBusy, setPwBusy]       = useState(false)
  const [delOpen, setDelOpen]     = useState(false)
  const [delText, setDelText]     = useState('')
  const [delBusy, setDelBusy]     = useState(false)

  async function changePassword() {
    if (pwBusy) return
    if (pwNew.length < 8) { toast.error('הסיסמה חייבת להיות לפחות 8 תווים'); return }
    if (pwNew !== pwConfirm) { toast.error('הסיסמאות אינן תואמות'); return }
    setPwBusy(true)
    try {
      await updatePassword(pwNew)
      setPwNew(''); setPwConfirm('')
      toast.success('הסיסמה עודכנה ✓')
    } catch (err) {
      toast.error(err?.message || 'עדכון הסיסמה נכשל')
    } finally { setPwBusy(false) }
  }

  async function confirmDelete() {
    if (delBusy) return
    setDelBusy(true)
    try {
      await deleteAccount()
      // deleteAccount signs out → auth state change redirects to /login.
    } catch (err) {
      toast.error(err?.message || 'מחיקת החשבון נכשלה')
      setDelBusy(false)
    }
  }

  async function doRescan() {
    if (rescanBusy) return
    if (!window.confirm('סריקה חוזרת תריץ את ה-AI מחדש על כל הקבלות שיש להן תמונה ותתקן מחירים לא מדויקים. זה עשוי לקחת כמה דקות — אנא אל תסגור את הדף. להמשיך?')) return
    setRescanBusy(true); setRescanResult(null); setRescanProg({ done: 0, total: 0, fixed: 0, failed: 0 })
    try {
      const res = await rescanAllReceipts(user, settings.vatRate ?? 18, { onProgress: setRescanProg })
      setRescanResult(res)
      toast.success(`הסריקה הסתיימה — ${res.fixed} מחירים תוקנו מתוך ${res.total}`)
    } catch (err) {
      toast.error('שגיאה בסריקה חוזרת: ' + (err?.message || ''))
    } finally { setRescanBusy(false) }
  }

  async function doBackup() {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const counts = await downloadBackup(user)
      const today = new Date().toISOString().slice(0, 10)
      try { localStorage.setItem(LAST_BACKUP_KEY, today) } catch {}
      setLastBackup(today)
      toast.success(`גיבוי נשמר — ${counts.receipts} קבלות, ${counts.categories} קטגוריות`)
    } catch (err) {
      toast.error('שגיאה בגיבוי: ' + (err?.message || ''))
    } finally { setBackupBusy(false) }
  }

  async function handleRestoreFile(e) {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    setRestoreBusy(true)
    try {
      const obj = await readBackupFile(file)
      const c = obj?.counts || { receipts: obj?.receipts?.length || 0, categories: obj?.categories?.length || 0 }
      if (!window.confirm(`לשחזר מהקובץ ${obj.exported_at ? '(' + new Date(obj.exported_at).toLocaleDateString('he-IL') + ')' : ''}?\n${c.receipts} קבלות ו-${c.categories} קטגוריות. נתונים עם אותו מזהה ייכתבו מחדש.`)) { setRestoreBusy(false); return }
      const restored = await restoreFromObject(obj, user)
      toast.success(`שוחזרו ${restored.receipts} קבלות ו-${restored.categories} קטגוריות`)
      setTimeout(() => window.location.reload(), 1400)
    } catch (err) {
      toast.error('שגיאה בשחזור: ' + (err?.message || 'קובץ לא תקין'))
    } finally { setRestoreBusy(false) }
  }

  function toggleAuto() {
    const next = !autoBackup
    setAutoBackup(next)
    try { localStorage.setItem(AUTO_BACKUP_KEY, next ? '1' : '0') } catch {}
  }

  async function chooseFolder() {
    try {
      const name = await pickDir()
      setFolderName(name)
      toast.success('תיקיית השמירה נבחרה ✓')
    } catch (err) {
      if (err?.name !== 'AbortError') toast.error('לא ניתן לבחור תיקייה')
    }
  }
  async function removeFolder() {
    await clearDir()
    setFolderName(null)
    toast('התיקייה הוסרה — הורדות יישמרו רגיל', { icon: 'ℹ️' })
  }

  async function handleLogoFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const dataUrl = await fileToSquareLogo(file, 400, 0.92)
      await updateSettings({ logo: dataUrl })
      toast.success('הלוגו נשמר ✓')
    } catch {
      toast.error('שגיאה בטעינת הלוגו')
    }
  }

  async function saveName() {
    await updateSettings({ businessName: nameInput.trim() || 'מנהל קבלות' })
    setNameChanged(false)
    toast.success('שם העסק נשמר ✓')
  }

  function handleVatChange(v) {
    setVatInput(v)
    setChanged(true)
  }

  async function save() {
    const rate = parseFloat(vatInput)
    if (isNaN(rate) || rate < 0 || rate > 99) {
      toast.error('אחוז מע"מ חייב להיות בין 0 ל-99')
      return
    }
    await updateSettings({ vatRate: rate })
    setChanged(false)
    toast.success('ההגדרות נשמרו ✓')
  }

  const FS = {
    display: 'block', width: '100%', boxSizing: 'border-box',
    borderRadius: 'var(--r-btn)', border: '1.5px solid var(--border)',
    background: 'var(--panel)', padding: '0 14px', height: '46px',
    fontSize: '17px', color: 'var(--text)', outline: 'none',
    fontFamily: 'var(--font-main)',
  }

  const toggleStyle = (active) => ({
    flex: 1, padding: '12px 16px', borderRadius: '8px',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--panel-2)',
    color: active ? 'var(--accent)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)', fontSize: '16px', fontWeight: active ? 600 : 400,
    cursor: 'pointer', transition: 'all 140ms', textAlign: 'center',
  })

  return (
    <div className="animate-fade-in" dir="rtl" style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings size={24} color="var(--accent)" /> הגדרות
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--text-mute)' }}>
          מחובר כ-{user?.email}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--text-mute)' }}>
          גרסת אפליקציה: <strong style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{import.meta.env.VITE_APP_VERSION || '—'}</strong>
        </p>
      </div>

      {/* Install app Card */}
      {!isStandalone && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Smartphone size={17} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>התקנת האפליקציה בטלפון</span>
          </div>
          <div style={{ padding: 20 }}>
            {canInstall ? (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
                  התקן את האפליקציה למסך הבית — תיפתח כמו אפליקציה רגילה, במסך מלא וללא שורת כתובת.
                </p>
                <button onClick={async () => { const ok = await promptInstall(); if (ok) toast.success('האפליקציה מותקנת!') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 15.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  <Download size={17} /> התקן עכשיו
                </button>
              </>
            ) : isIOS ? (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
                  ב-iPhone/iPad (Safari) — הוסף למסך הבית בשני צעדים:
                </p>
                <ol style={{ margin: 0, paddingInlineStart: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>1</span>
                    <span style={{ fontSize: 15, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      לחץ על כפתור <strong>השיתוף</strong> <Share size={18} style={{ color: 'var(--accent)' }} /> בתחתית הדפדפן
                    </span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>2</span>
                    <span style={{ fontSize: 15, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      בחר <strong>"הוסף למסך הבית"</strong> <Plus size={17} style={{ color: 'var(--accent)' }} />
                    </span>
                  </li>
                </ol>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
                ב-Android (Chrome) — פתח את תפריט הדפדפן (⋮) ובחר <strong>"התקן אפליקציה"</strong> / "הוסף למסך הבית".
                במחשב — לחץ על אייקון ההתקנה בשורת הכתובת.
              </p>
            )}
          </div>
        </div>
      )}
      {isStandalone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--success-tint-1)', border: '1px solid var(--success-tint-border)', borderRadius: 12, fontSize: 14.5, color: 'var(--text)' }}>
          <Check size={17} color="var(--ok)" /> האפליקציה מותקנת ופועלת במצב אפליקציה ✓
        </div>
      )}

      {/* Logo + Business name Card */}
      <div id="set-logo" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={17} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>לוגו ושם העסק</span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {/* Round preview */}
            {settings.logo ? (
              <img src={settings.logo} alt="לוגו" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ color: 'white', fontSize: 38, fontWeight: 700 }}>₪</span>
              </div>
            )}
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.5 }}>
                העלה לוגו (PNG/JPG). הוא יוצג בעמוד הכניסה ובראש האפליקציה.
              </p>
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoFile} style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => logoInputRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  <ImageIcon size={15} /> {settings.logo ? 'החלף לוגו' : 'העלה לוגו'}
                </button>
                {settings.logo && (
                  <button onClick={() => updateSettings({ logo: null })}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--danger)', fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                    <Trash2 size={15} /> הסר
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Business name */}
          <div>
            <label style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8 }}>שם העסק</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input value={nameInput} onChange={e => { setNameInput(e.target.value); setNameChanged(true) }}
                placeholder="שם בית העסק" dir="auto" style={{ ...FS, flex: 1 }} />
              <button onClick={saveName} disabled={!nameChanged}
                style={{ padding: '0 18px', borderRadius: 'var(--r-btn)', border: 'none', background: nameChanged ? 'var(--accent)' : 'var(--panel-2)', color: nameChanged ? 'white' : 'var(--text-mute)', fontSize: 14.5, fontWeight: 600, cursor: nameChanged ? 'pointer' : 'default', fontFamily: 'var(--font-main)' }}>
                שמור
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* VAT Rate Card */}
      <div id="set-vat" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Percent size={15} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>שיעור מע"מ</span>
        </div>
        <div style={{ padding: '20px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-mute)', lineHeight: 1.6 }}>
            שיעור המע"מ הנוכחי בישראל הוא <strong>18%</strong> (נכון ל-2025).
            שנה את הערך כאן אם השיעור השתנה.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8 }}>
                אחוז מע"מ (%)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={vatInput}
                  onChange={e => handleVatChange(e.target.value)}
                  min="0" max="99" step="0.5"
                  style={{ ...FS, paddingLeft: 40, direction: 'ltr' }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e  => e.target.style.borderColor = 'var(--border)'}
                />
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mute)', fontSize: 16, pointerEvents: 'none' }}>%</span>
              </div>
            </div>
            <button
              onClick={save}
              disabled={!changed || saving}
              style={{
                height: 44, padding: '0 20px', borderRadius: 'var(--r-btn)', border: 'none',
                background: changed && !saving ? 'var(--accent)' : 'var(--panel-2)',
                color: changed && !saving ? 'white' : 'var(--text-mute)',
                fontSize: 13.5, fontWeight: 600, cursor: changed ? 'pointer' : 'default',
                fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 140ms',
              }}
            >
              <Save size={14} /> {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </div>

      {/* Display Mode Card */}
      <div id="set-display" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShekelSign size={16} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>הצגת מחירים</span>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-mute)', lineHeight: 1.6 }}>
            בחר האם לראות מחירים כולל מע"מ או ללא מע"מ ברשימת הקבלות ובדשבורד.
            ניתן לשנות גם בלחיצה על הטוגל בכל דף.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={toggleStyle(settings.showWithVat)}  onClick={() => updateSettings({ showWithVat: true })}>
              כולל מע"מ<br/>
              <span style={{ fontSize: 11, opacity: 0.7 }}>המחיר הסופי ששולם</span>
            </button>
            <button style={toggleStyle(!settings.showWithVat)} onClick={() => updateSettings({ showWithVat: false })}>
              ללא מע"מ<br/>
              <span style={{ fontSize: 11, opacity: 0.7 }}>מחיר הבסיס (לניכוי)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Save folder Card */}
      <div id="set-folder" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderOpen size={17} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>תיקיית שמירה</span>
        </div>
        <div style={{ padding: 20 }}>
          {isFolderSupported() ? (
            <>
              <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
                בחר תיקייה במחשב — כל הקבצים שתוריד (Excel / PDF / ZIP) יישמרו אליה אוטומטית בלי לשאול כל פעם.
              </p>
              {folderName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 14px', background: 'var(--success-tint-1)', border: '1px solid var(--success-tint-border)', borderRadius: 10 }}>
                  <FolderOpen size={16} color="var(--ok)" />
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{folderName}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={chooseFolder}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  <FolderOpen size={15} /> {folderName ? 'החלף תיקייה' : 'בחר תיקייה'}
                </button>
                {folderName && (
                  <button onClick={removeFolder}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--danger)', fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                    <Trash2 size={15} /> הסר
                  </button>
                )}
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
              בחירת תיקייה קבועה זמינה במחשב (Chrome/Edge) בלבד. במכשיר נייד הקבצים יורדו לתיקיית ההורדות הרגילה.
            </p>
          )}
        </div>
      </div>

      {/* Monthly reminder timing Card */}
      <div id="set-reminder" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={17} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>תזכורת ייצוא חודשית</span>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
            מתי שתופיע ההודעה "האם לייצא את הקבלות לרואה החשבון?" בכל חודש.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'start', label: 'תחילת החודש', sub: '1 בחודש' },
              { id: 'mid',   label: 'אמצע החודש',  sub: '15 בחודש' },
              { id: 'end',   label: 'סוף החודש',   sub: 'יום אחרון' },
            ].map(opt => {
              const active = (settings.reminderTiming || 'start') === opt.id
              return (
                <button key={opt.id} onClick={() => updateSettings({ reminderTiming: opt.id })}
                  style={{ flex: '1 1 110px', padding: '12px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'center',
                    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-bg)' : 'var(--panel-2)', color: active ? 'var(--accent)' : 'var(--text-mute)' }}>
                  <div style={{ fontSize: 15, fontWeight: active ? 700 : 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>{opt.sub}</div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Re-scan all receipts (price accuracy) Card */}
      <div id="set-rescan" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScanLine size={17} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>דיוק סריקה — סריקה חוזרת</span>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
            סורק מחדש בעזרת AI את כל הקבלות שיש להן תמונה ומתקן <strong>מחירים</strong> שעוגלו (דיוק לאגורה)
            ו<strong>תאריכים</strong> שזוהו הפוך (פורמט ישראלי יום/חודש). הספק והקטגוריות שהגדרת נשמרים.
            הפעולה עשויה לקחת כמה דקות.
          </p>
          {rescanBusy && rescanProg && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>
                <span>סורק… {rescanProg.done}/{rescanProg.total}</span>
                <span>תוקנו: {rescanProg.fixed}{rescanProg.failed ? ` · נכשלו: ${rescanProg.failed}` : ''}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--panel-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${rescanProg.total ? (rescanProg.done / rescanProg.total) * 100 : 0}%`, background: 'var(--accent)', borderRadius: 4, transition: 'width 300ms ease' }} />
              </div>
            </div>
          )}
          {rescanResult && !rescanBusy && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--success-tint-1)', border: '1px solid var(--success-tint-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)' }}>
              הסתיים: נבדקו {rescanResult.total} קבלות · <strong>{rescanResult.fixed}</strong> מחירים תוקנו{rescanResult.failed ? ` · ${rescanResult.failed} נכשלו (נסה שוב)` : ''}.
            </div>
          )}
          <button onClick={doRescan} disabled={rescanBusy}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: 10, border: 'none', background: rescanBusy ? 'var(--panel-2)' : 'var(--accent)', color: rescanBusy ? 'var(--text-mute)' : 'white', fontSize: 15, fontWeight: 700, cursor: rescanBusy ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
            <RefreshCw size={16} style={{ animation: rescanBusy ? 'spin 1s linear infinite' : 'none' }} /> {rescanBusy ? 'סורק…' : 'סרוק מחדש את כל הקבלות'}
          </button>
        </div>
      </div>

      {/* Backup & restore Card */}
      <div id="set-backup" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Database size={17} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>גיבוי ושחזור</span>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
            שמירת כל הנתונים (קבלות, קטגוריות והגדרות) כקובץ JSON אחד שניתן לשחזר ממנו.
          </p>
          {/* Daily auto toggle */}
          <button onClick={toggleAuto}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10, padding: '12px 14px', marginBottom: 12, borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-main)',
              border: `1.5px solid ${autoBackup ? 'var(--accent)' : 'var(--border)'}`, background: autoBackup ? 'var(--accent-bg)' : 'var(--panel-2)' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: autoBackup ? 'var(--accent)' : 'var(--text-dim)' }}>גיבוי יומי אוטומטי</span>
            <span style={{ width: 42, height: 24, borderRadius: 999, background: autoBackup ? 'var(--accent)' : 'var(--border-strong)', position: 'relative', flexShrink: 0, transition: 'background 160ms' }}>
              <span style={{ position: 'absolute', top: 2, [autoBackup ? 'left' : 'right']: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'all 160ms' }} />
            </span>
          </button>
          <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.5 }}>
            פעם ביום, אם הוגדרה תיקיית שמירה — הגיבוי נשמר אליה אוטומטית. אחרת תופיע בקשה קצרה להורדה.
            {lastBackup && <> גיבוי אחרון: <strong>{new Date(lastBackup).toLocaleDateString('he-IL')}</strong>.</>}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={doBackup} disabled={backupBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14.5, fontWeight: 600, cursor: backupBusy ? 'default' : 'pointer', opacity: backupBusy ? 0.7 : 1, fontFamily: 'var(--font-main)' }}>
              <Download size={15} /> {backupBusy ? 'מגבה…' : 'גבה עכשיו'}
            </button>
            <input ref={restoreInputRef} type="file" accept="application/json,.json" onChange={handleRestoreFile} style={{ display: 'none' }} />
            <button onClick={() => restoreInputRef.current?.click()} disabled={restoreBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14.5, cursor: restoreBusy ? 'default' : 'pointer', opacity: restoreBusy ? 0.7 : 1, fontFamily: 'var(--font-main)' }}>
              <Upload size={15} /> {restoreBusy ? 'משחזר…' : 'שחזר מקובץ'}
            </button>
          </div>
        </div>
      </div>

      {/* Account security Card */}
      <div id="set-account" style={{ scrollMarginTop: 76, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={17} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>אבטחת חשבון</span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Change password */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 10 }}>
              <KeyRound size={15} color="var(--accent)" /> שינוי סיסמה
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="סיסמה חדשה (לפחות 8 תווים)" autoComplete="new-password" style={FS} />
              <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="אימות סיסמה חדשה" autoComplete="new-password" style={FS} />
              <button onClick={changePassword} disabled={pwBusy || !pwNew || !pwConfirm}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 8, border: 'none', background: (pwBusy || !pwNew || !pwConfirm) ? 'var(--panel-2)' : 'var(--accent)', color: (pwBusy || !pwNew || !pwConfirm) ? 'var(--text-mute)' : 'white', fontSize: 14.5, fontWeight: 600, cursor: (pwBusy || !pwNew || !pwConfirm) ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                <KeyRound size={15} /> {pwBusy ? 'מעדכן…' : 'עדכן סיסמה'}
              </button>
            </div>
          </div>

          {/* Danger zone — delete account */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600, color: 'var(--danger)', marginBottom: 8 }}>
              <AlertTriangle size={15} /> מחיקת חשבון
            </label>
            <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
              מחיקת החשבון תמחק לצמיתות את כל הקבלות, הקטגוריות, הספקים וההגדרות שלך — ללא אפשרות שחזור.
            </p>
            <button onClick={() => { setDelText(''); setDelOpen(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid var(--danger)', background: 'var(--panel)', color: 'var(--danger)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
              <Trash2 size={15} /> מחק את החשבון שלי
            </button>
          </div>
        </div>
      </div>

      {/* Delete-account confirmation (type-to-confirm) */}
      <Modal isOpen={delOpen} onClose={() => { if (!delBusy) setDelOpen(false) }} title="מחיקת חשבון לצמיתות" size="sm">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: 'var(--danger-tint, rgba(220,38,38,0.08))', border: '1px solid var(--danger)', borderRadius: 10 }}>
            <AlertTriangle size={18} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
              פעולה זו <strong>בלתי הפיכה</strong>. כל הנתונים שלך יימחקו לצמיתות והגישה לחשבון תיחסם מיד.
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13.5, color: 'var(--text-dim)', marginBottom: 7 }}>
              לאישור, הקלד את האימייל שלך: <strong dir="ltr">{user?.email}</strong>
            </label>
            <input value={delText} onChange={e => setDelText(e.target.value)} dir="ltr" placeholder={user?.email} style={FS} />
          </div>
          {(() => {
            const ready = delText.trim().toLowerCase() === (user?.email || '').toLowerCase()
            return (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button onClick={() => setDelOpen(false)} disabled={delBusy}
                  style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14.5, cursor: delBusy ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                  ביטול
                </button>
                <button onClick={confirmDelete} disabled={delBusy || !ready}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 8, border: 'none',
                    background: (delBusy || !ready) ? 'var(--panel-2)' : 'var(--danger)', color: (delBusy || !ready) ? 'var(--text-mute)' : 'white',
                    fontSize: 14.5, fontWeight: 700, cursor: (delBusy || !ready) ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                  <Trash2 size={15} /> {delBusy ? 'מוחק…' : 'מחק לצמיתות'}
                </button>
              </div>
            )
          })()}
        </div>
      </Modal>

      {/* Info box */}
      <div style={{ display: 'flex', gap: 10, padding: '14px 16px', background: 'var(--accent-bg)', border: '1px solid var(--accent-tint-border)', borderRadius: 12, fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        <Info size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>כיצד מחושב המע"מ בסריקה?</strong><br/>
          Gemini מחפש אוטומטית בקבלה את "בסיס חייב" ו"מע"מ" בנפרד.
          אם הקבלה מציגה רק סכום כולל — מחושב הסכום ללא מע"מ לפי הנוסחה:
          <code style={{ background: 'rgba(37,99,235,0.08)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>
            סכום ÷ (1 + {settings.vatRate}%)
          </code>
        </div>
      </div>

      {/* Legal links */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', paddingTop: 4, fontSize: 13.5 }}>
        <Link to="/terms" style={{ color: 'var(--text-mute)', textDecoration: 'none' }}>תקנון</Link>
        <Link to="/privacy" style={{ color: 'var(--text-mute)', textDecoration: 'none' }}>מדיניות פרטיות</Link>
        <Link to="/accessibility" style={{ color: 'var(--text-mute)', textDecoration: 'none' }}>הצהרת נגישות</Link>
      </div>

    </div>
  )
}
