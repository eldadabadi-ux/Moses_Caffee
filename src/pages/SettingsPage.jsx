import { useState, useRef } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { Settings, Save, Info, Percent, Image as ImageIcon, Trash2, Building2, FolderOpen, Bell } from 'lucide-react'
import { fileToSquareLogo } from '../lib/imageUtils'
import { isFolderSupported, pickDir, savedDirName, clearDir } from '../lib/saveFolder'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { settings, updateSettings, saving } = useSettings()
  const { user } = useAuth()
  const [vatInput, setVatInput] = useState(String(settings.vatRate))
  const [changed, setChanged] = useState(false)
  const [nameInput, setNameInput] = useState(settings.businessName || '')
  const [nameChanged, setNameChanged] = useState(false)
  const [folderName, setFolderName] = useState(savedDirName())
  const logoInputRef = useRef(null)

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
      </div>

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
          <span style={{ fontSize: 15 }}>₪</span>
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

    </div>
  )
}
