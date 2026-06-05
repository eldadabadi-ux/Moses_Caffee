import { useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { Settings, Save, Info, Percent } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { settings, updateSettings, saving } = useSettings()
  const { user } = useAuth()
  const [vatInput, setVatInput] = useState(String(settings.vatRate))
  const [changed, setChanged] = useState(false)

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
    background: 'var(--panel)', padding: '0 14px', height: '44px',
    fontSize: '15px', color: 'var(--text)', outline: 'none',
    fontFamily: 'var(--font-main)',
  }

  const toggleStyle = (active) => ({
    flex: 1, padding: '10px 16px', borderRadius: '8px',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--panel-2)',
    color: active ? 'var(--accent)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)', fontSize: '13.5px', fontWeight: active ? 600 : 400,
    cursor: 'pointer', transition: 'all 140ms', textAlign: 'center',
  })

  return (
    <div className="animate-fade-in" dir="rtl" style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings size={20} color="var(--accent)" /> הגדרות
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-mute)' }}>
          מחובר כ-{user?.email}
        </p>
      </div>

      {/* VAT Rate Card */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
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
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
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

      {/* Info box */}
      <div style={{ display: 'flex', gap: 10, padding: '14px 16px', background: 'var(--accent-bg)', border: '1px solid var(--accent-tint-border)', borderRadius: 12, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
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
