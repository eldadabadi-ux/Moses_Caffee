import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

const COLORS = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626','#0891b2','#c2410c','#0d9488','#be185d','#6366f1']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`
const LEVEL_DOT = ['#2563eb', '#7c3aed', '#059669']

export default function CategoryTree({ l1Data, categories, receipts, total, amountOf }) {
  const [expanded, setExpanded] = useState({})
  const amt = amountOf || (r => parseFloat(r.amount || 0))
  function toggle(id) { setExpanded(p => ({ ...p, [id]: !p[id] })) }

  function getL2(l1Cat) {
    const l2cats = categories.filter(c => c.level === 2 && c.parent_id === l1Cat.id)
    return l2cats.map(c => {
      const sum = receipts.filter(r => r.category_id === c.id).reduce((s, r) => s + amt(r), 0)
      const cnt = receipts.filter(r => r.category_id === c.id).length
      const l3cats = categories.filter(x => x.level === 3 && x.parent_id === c.id)
      const l3 = l3cats.map(x => ({
        ...x,
        total: receipts.filter(r => r.category_id === x.id).reduce((s, r) => s + amt(r), 0),
        count: receipts.filter(r => r.category_id === x.id).length,
      })).filter(x => x.total > 0)
      return { ...c, total: sum, count: cnt, l3 }
    }).filter(c => c.total > 0).sort((a, b) => b.total - a.total)
  }

  // One row — fully fluid: name ellipsizes, only the amount has a fixed min-width.
  function Row({ level, name, count, total: amount, pct, color, hasChildren, open, onClick }) {
    const fs = level === 0 ? 16 : level === 1 ? 15 : 14
    const bg = level === 0 ? 'var(--panel)' : level === 1 ? 'var(--panel-2)' : 'rgba(0,0,0,0.02)'
    return (
      <div onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
          padding: '9px 12px', borderRadius: '9px', background: bg,
          border: '1px solid var(--border)', cursor: hasChildren ? 'pointer' : 'default',
        }}>
        <span style={{ width: 16, flexShrink: 0, color: 'var(--text-mute)', display: 'flex' }}>
          {hasChildren ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </span>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: fs, fontWeight: level === 0 ? 600 : 500, color: level === 2 ? 'var(--text-dim)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-mute)', flexShrink: 0 }}>{count}</span>
        {pct != null && <span style={{ fontSize: 12.5, color: 'var(--text-mute)', flexShrink: 0, minWidth: 34, textAlign: 'left' }}>{Math.round(pct)}%</span>}
        <span style={{ fontSize: fs, fontWeight: 700, color: 'var(--ok)', flexShrink: 0, minWidth: 66, textAlign: 'left', whiteSpace: 'nowrap' }}>{fmtILS(amount)}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
      {l1Data.map((item, idx) => {
        const color  = COLORS[idx % COLORS.length]
        const pct    = total > 0 ? (item.total / total) * 100 : 0
        const isOpen = !!expanded[item.id]
        const l2     = getL2(item)
        return (
          <div key={item.id} style={{ minWidth: 0 }}>
            <Row level={0} name={item.name} count={item.count} total={item.total} pct={pct} color={color}
              hasChildren={l2.length > 0} open={isOpen} onClick={() => l2.length > 0 && toggle(item.id)} />

            {/* L2 — indented with a small padding (not margin) so it never overflows */}
            {isOpen && l2.length > 0 && (
              <div style={{ paddingInlineStart: '14px', marginTop: '3px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, animation: 'fadeIn 180ms ease' }}>
                {l2.map(c2 => {
                  const pct2 = total > 0 ? (c2.total / total) * 100 : 0
                  const isO2 = !!expanded[c2.id]
                  return (
                    <div key={c2.id} style={{ minWidth: 0 }}>
                      <Row level={1} name={c2.name} count={c2.count} total={c2.total} pct={pct2} color={LEVEL_DOT[1]}
                        hasChildren={c2.l3?.length > 0} open={isO2} onClick={() => c2.l3?.length > 0 && toggle(c2.id)} />
                      {isO2 && c2.l3?.length > 0 && (
                        <div style={{ paddingInlineStart: '14px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, animation: 'fadeIn 180ms ease' }}>
                          {c2.l3.map(c3 => (
                            <Row key={c3.id} level={2} name={c3.name} count={c3.count} total={c3.total}
                              pct={total > 0 ? (c3.total / total) * 100 : 0} color={LEVEL_DOT[2]} hasChildren={false} />
                          ))}
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
