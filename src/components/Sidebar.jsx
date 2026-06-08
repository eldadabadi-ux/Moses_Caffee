import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import {
  Receipt, BarChart2, Tag, Settings, Camera, Plus, FileSpreadsheet,
  RefreshCw, ChevronDown, ChevronRight, LogOut, X, PieChart, TrendingUp, Layers,
  ArrowLeftRight, Percent, FolderOpen, Bell, Building2, ScanLine, Database,
} from 'lucide-react'

// Navigation tree — every section + its options.
const NAV = [
  {
    id: 'dashboard', label: 'דשבורד', icon: BarChart2, to: '/',
    children: [
      { label: 'הוצאות חודשיות',          icon: BarChart2,        anchor: 'dash-monthly' },
      { label: 'התפלגות קטגוריות',        icon: PieChart,         anchor: 'dash-categories' },
      { label: 'ניתוח מעמיק (תתי-קטגוריות)', icon: TrendingUp,    anchor: 'dash-drilldown' },
      { label: 'השוואת ספקים',            icon: ArrowLeftRight,   anchor: 'dash-compare' },
    ],
  },
  {
    id: 'receipts', label: 'קבלות', icon: Receipt, to: '/receipts',
    children: [
      { label: 'סריקת קבלה',  icon: Camera,          action: 'receipts-scan' },
      { label: 'הוספה ידנית', icon: Plus,            action: 'receipts-add' },
      { label: 'ייצוא לרו"ח', icon: FileSpreadsheet, action: 'receipts-export' },
    ],
  },
  {
    id: 'categories', label: 'קטגוריות', icon: Tag, to: '/categories',
    children: [
      { label: 'הוסף קטגוריה',     icon: Plus,      action: 'categories-add' },
      { label: 'סווג קבלות מחדש',  icon: RefreshCw, action: 'categories-recat' },
    ],
  },
  {
    id: 'settings', label: 'הגדרות', icon: Settings, to: '/settings',
    children: [
      { label: 'לוגו ושם העסק',  icon: Building2,  anchor: 'set-logo' },
      { label: 'שיעור מע"מ',     icon: Percent,    anchor: 'set-vat' },
      { label: 'הצגת מחירים',    icon: Receipt,    anchor: 'set-display' },
      { label: 'תיקיית שמירה',   icon: FolderOpen, anchor: 'set-folder' },
      { label: 'תזכורת חודשית',  icon: Bell,       anchor: 'set-reminder' },
      { label: 'דיוק סריקה',     icon: ScanLine,   anchor: 'set-rescan' },
      { label: 'גיבוי ושחזור',   icon: Database,   anchor: 'set-backup' },
    ],
  },
]

export default function Sidebar({ drawer = false, onNavigate, onClose, onSignOut, onCollapse }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings } = useSettings()
  const activeSection = NAV.find(s => s.to === location.pathname)?.id
  const [open, setOpen] = useState(() => ({ [activeSection || 'receipts']: true }))

  function toggle(id) { setOpen(p => ({ ...p, [id]: !p[id] })) }

  function goSection(s) {
    navigate(s.to)
    setOpen(p => ({ ...p, [s.id]: true }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
    onNavigate?.()
  }

  function goChild(parent, child) {
    const needNav = location.pathname !== parent.to
    navigate(parent.to)
    const run = () => {
      if (child.anchor) document.getElementById(child.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (child.action) window.dispatchEvent(new Event(child.action))
    }
    setTimeout(run, needNav ? 280 : 60)
    onNavigate?.()
  }

  const W = 250

  return (
    <aside style={{
      position: 'fixed', top: 0, right: 0, height: '100dvh', width: W, zIndex: 200,
      background: 'var(--panel)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-main)',
      boxShadow: drawer ? '-8px 0 30px rgba(0,0,0,0.18)' : 'none',
      animation: drawer ? 'slideInRight 240ms cubic-bezier(0.16,1,0.3,1) both' : 'none',
    }} dir="rtl">

      {/* Header: logo + name (+ close on mobile) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px', borderBottom: '1px solid var(--border)' }}>
        {settings.logo
          ? <img src={settings.logo} alt="לוגו" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} />
          : <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>₪</span></div>}
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{settings.businessName || 'מנהל קבלות'}</span>
        {drawer && (
          <button onClick={onClose} aria-label="סגור" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: 4, display: 'flex' }}><X size={20} /></button>
        )}
        {!drawer && onCollapse && (
          <button onClick={onCollapse} aria-label="כווץ תפריט" title="כווץ תפריט" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: 4, display: 'flex' }}><ChevronRight size={20} /></button>
        )}
      </div>

      {/* Nav tree */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {NAV.map(s => {
          const isActive = location.pathname === s.to
          const isOpen = !!open[s.id]
          const Icon = s.icon
          return (
            <div key={s.id} style={{ marginBottom: 4 }}>
              {/* Section row */}
              <div style={{ display: 'flex', alignItems: 'center', borderRadius: 10, background: isActive ? 'var(--accent-bg)' : 'transparent' }}>
                <button onClick={() => goSection(s)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right',
                    color: isActive ? 'var(--accent)' : 'var(--text)', fontSize: 16, fontWeight: isActive ? 700 : 600 }}>
                  <Icon size={19} />
                  {s.label}
                </button>
                <button onClick={() => toggle(s.id)} aria-label="הרחב"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: '11px 10px', display: 'flex' }}>
                  <ChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
                </button>
              </div>
              {/* Children */}
              {isOpen && (
                <div style={{ marginTop: 2, marginInlineStart: 8, paddingInlineStart: 8, borderInlineStart: '1.5px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                  {s.children.map((c, i) => {
                    const CIcon = c.icon
                    return (
                      <button key={i} onClick={() => goChild(s, c)}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right',
                          color: 'var(--text-dim)', fontSize: 14.5, borderRadius: 8 }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--panel-2)'; e.currentTarget.style.color = 'var(--accent)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-dim)' }}>
                        {CIcon && <CIcon size={15} style={{ flexShrink: 0, opacity: 0.8 }} />}
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer: connection + signout */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text-mute)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)' }} /> מחובר
        </span>
        <button onClick={() => { onClose?.(); onSignOut?.() }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-mute)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
          <LogOut size={14} /> התנתק
        </button>
      </div>
    </aside>
  )
}
