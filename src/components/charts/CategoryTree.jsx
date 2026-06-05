import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

const COLORS = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626','#0891b2','#c2410c','#0d9488','#be185d','#6366f1']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function CategoryTree({ l1Data, categories, receipts, total, amountOf }) {
  const [expanded, setExpanded] = useState({})

  // Amount accessor — respects VAT display mode if provided
  const amt = amountOf || (r => parseFloat(r.amount || 0))

  function toggle(id) { setExpanded(p => ({ ...p, [id]: !p[id] })) }

  // Build L2 totals per L1
  function getL2(l1Cat) {
    const l2cats = categories.filter(c => c.level === 2 && c.parent_id === l1Cat.id)
    return l2cats.map(c => {
      const sum = receipts
        .filter(r => r.category_id === c.id)
        .reduce((s, r) => s + amt(r), 0)
      const cnt = receipts.filter(r => r.category_id === c.id).length
      // L3
      const l3cats = categories.filter(x => x.level === 3 && x.parent_id === c.id)
      const l3 = l3cats.map(x => {
        const a = receipts.filter(r => r.category_id === x.id).reduce((s, r) => s + amt(r), 0)
        return { ...x, total: a, count: receipts.filter(r => r.category_id === x.id).length }
      }).filter(x => x.total > 0)
      return { ...c, total: sum, count: cnt, l3 }
    }).filter(c => c.total > 0).sort((a, b) => b.total - a.total)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {l1Data.map((item, idx) => {
        const color  = COLORS[idx % COLORS.length]
        const pct    = total > 0 ? (item.total / total) * 100 : 0
        const isOpen = !!expanded[item.id]
        const l2     = getL2(item)

        return (
          <div key={item.id}>
            {/* L1 Row */}
            <div
              onClick={() => l2.length > 0 && toggle(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '9px 14px', borderRadius: '10px',
                background: 'var(--panel)', border: `1px solid var(--border)`,
                cursor: l2.length > 0 ? 'pointer' : 'default',
                transition: 'background 120ms',
              }}
              onMouseEnter={e => { if (l2.length) e.currentTarget.style.background = 'var(--panel-2)' }}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--panel)'}
            >
              {/* Expand toggle */}
              <span style={{ color: 'var(--text-mute)', flexShrink: 0, width: 16 }}>
                {l2.length > 0
                  ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                  : null}
              </span>
              {/* Color dot */}
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
              {/* Name */}
              <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, color: 'var(--text)' }}>{item.name}</span>
              {/* Count badge */}
              <span style={{ fontSize: '11px', color: 'var(--text-mute)', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '999px', padding: '1px 7px' }}>
                {item.count} קבלות
              </span>
              {/* Amount */}
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ok)', minWidth: 80, textAlign: 'left' }}>
                {fmtILS(item.total)}
              </span>
              {/* Progress bar */}
              <div style={{ width: 80, flexShrink: 0 }}>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 600ms ease' }} />
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-mute)', textAlign: 'left', marginTop: 2 }}>{Math.round(pct)}%</div>
              </div>
            </div>

            {/* L2 children */}
            {isOpen && l2.length > 0 && (
              <div style={{ marginRight: '24px', marginTop: '3px', display: 'flex', flexDirection: 'column', gap: '2px', animation: 'fadeIn 180ms ease' }}>
                {l2.map((c2, i2) => {
                  const pct2  = total > 0 ? (c2.total / total) * 100 : 0
                  const isO2  = !!expanded[c2.id]
                  return (
                    <div key={c2.id}>
                      <div
                        onClick={() => c2.l3?.length > 0 && toggle(c2.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '7px 14px', borderRadius: '8px',
                          background: 'var(--panel-2)', border: '1px solid var(--border)',
                          cursor: c2.l3?.length > 0 ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{ color: 'var(--text-mute)', flexShrink: 0, width: 16 }}>
                          {c2.l3?.length > 0 ? isO2 ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
                        </span>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#7c3aed', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--text)' }}>{c2.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-mute)' }}>{c2.count} קבלות</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ok)', minWidth: 72, textAlign: 'left' }}>{fmtILS(c2.total)}</span>
                        <div style={{ width: 60, flexShrink: 0 }}>
                          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct2}%`, background: '#7c3aed', borderRadius: 3 }} />
                          </div>
                          <div style={{ fontSize: '9.5px', color: 'var(--text-mute)', textAlign: 'left', marginTop: 1 }}>{Math.round(pct2)}%</div>
                        </div>
                      </div>

                      {/* L3 */}
                      {isO2 && c2.l3?.length > 0 && (
                        <div style={{ marginRight: '24px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px', animation: 'fadeIn 180ms ease' }}>
                          {c2.l3.map(c3 => {
                            const pct3 = total > 0 ? (c3.total / total) * 100 : 0
                            return (
                              <div key={c3.id} style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '6px 14px', borderRadius: '7px',
                                background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border)',
                              }}>
                                <span style={{ width: 16 }} />
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-dim)' }}>{c3.name}</span>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-mute)' }}>{c3.count} קבלות</span>
                                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ok)', minWidth: 68, textAlign: 'left' }}>{fmtILS(c3.total)}</span>
                                <div style={{ width: 50, flexShrink: 0 }}>
                                  <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct3}%`, background: '#059669', borderRadius: 2 }} />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
