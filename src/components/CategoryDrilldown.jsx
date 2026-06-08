import { useState, useMemo } from 'react'
import { Store, ChevronDown } from 'lucide-react'
import { timeSeries, vendorBreakdown, vendorComposition, vendorItemsTable } from '../lib/itemAggregation'
import TimeSeriesChart from './charts/TimeSeriesChart'
import ChartTypeToggle from './charts/ChartTypeToggle'

const COLORS = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626','#0891b2','#c2410c','#0d9488','#be185d','#6366f1','#65a30d','#9333ea']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`
const fmtILS2 = n => `₪${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum  = n => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })

// Hebrew labels for extra item fields that may appear in future receipts.
const EXTRA_LABELS = { sku: 'מק"ט', catalog: 'מק"ט', barcode: 'ברקוד', discount: 'הנחה', מפתח: 'מפתח' }

// ── Per-item table for an expanded vendor (data-driven columns) ──────────────────
// Linked to the composition bar: hovering a row highlights its bar segment & vice-versa.
function VendorTable({ data, activeName, onHover, colorByName = {} }) {
  if (!data || !data.rows.length) return null
  const { rows, hasQuantity, hasUnit, hasUnitPrice, extraKeys } = data
  const cols = [
    { key: 'name', label: 'שם הפריט', align: 'right', head: true, cell: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: colorByName[r.name] || 'var(--border-strong)', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
      </span>
    ) },
    ...(hasQuantity  ? [{ key: 'quantity',   label: 'כמות',       align: 'center', cell: r => r.quantity != null ? fmtNum(r.quantity) : '—' }] : []),
    ...(hasUnit      ? [{ key: 'unit',       label: 'יח׳',        align: 'center', cell: r => r.unit || '—' }] : []),
    ...(hasUnitPrice ? [{ key: 'unit_price', label: 'מחיר ליח׳',  align: 'left',   cell: r => r.unit_price != null ? fmtILS2(r.unit_price) : '—' }] : []),
    ...extraKeys.map(k => ({ key: 'x_' + k, label: EXTRA_LABELS[k] || k, align: 'center', cell: r => (r.extra?.[k] ?? '—') })),
    { key: 'total', label: 'סה"כ', align: 'left', strong: true, cell: r => fmtILS2(r.total) },
  ]
  const grand = rows.reduce((s, r) => s + r.total, 0)
  const th = (c) => ({ textAlign: c.align, padding: '8px 10px', fontWeight: 700, color: 'var(--text-dim)', fontSize: 12, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' })
  const td = (c) => ({ textAlign: c.align, padding: '8px 10px', color: c.strong ? 'var(--ok)' : 'var(--text)', fontWeight: c.strong ? 700 : (c.head ? 600 : 400), whiteSpace: c.head ? 'normal' : 'nowrap', minWidth: c.head ? 110 : 0, direction: c.align === 'left' ? 'ltr' : 'rtl' })
  return (
    <div style={{ marginTop: 12, overflowX: 'auto', overflowY: 'hidden', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-main)', fontSize: 13.5, minWidth: 320 }}>
        <thead>
          <tr style={{ background: 'var(--panel-2)' }}>{cols.map(c => <th key={c.key} style={th(c)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const hot = activeName === r.name
            return (
              <tr key={i}
                onMouseEnter={() => onHover?.(r.name)}
                onMouseLeave={() => onHover?.(null)}
                style={{ borderBottom: '1px solid var(--border)', background: hot ? 'var(--accent-bg)' : 'transparent', cursor: 'default', transition: 'background 120ms' }}>
                {cols.map(c => <td key={c.key} style={td(c)}>{c.cell(r)}</td>)}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--panel-2)' }}>
            <td colSpan={cols.length - 1} style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text)' }}>סה"כ</td>
            <td style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 800, color: 'var(--ok)', direction: 'ltr', whiteSpace: 'nowrap' }}>{fmtILS2(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const GRANS = [
  { id: 'day',     label: 'יומי' },
  { id: 'week',    label: 'שבועי' },
  { id: 'month',   label: 'חודשי' },
  { id: 'quarter', label: 'רבעוני' },
  { id: 'year',    label: 'שנתי' },
]

// ── Stacked composition bar: a vendor's spend split into product rectangles ──────
// Linked to the table via `activeName` / `onHover` (hover a segment ↔ a row).
function CompositionBar({ rows, total, activeName, onHover }) {
  if (!rows.length) return null
  const active = rows.findIndex(r => r.name === activeName)
  const act = active >= 0 ? active : null
  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      {/* Tooltip */}
      {act != null && rows[act] && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 12px',
          boxShadow: 'var(--shadow-modal)', zIndex: 10, textAlign: 'center', direction: 'rtl',
          maxWidth: '92%', whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS[act % COLORS.length], flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rows[act].name}</span>
          </div>
          <div style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 15, marginTop: 2 }}>{fmtILS(rows[act].total)}</div>
          <div style={{ color: 'var(--text-mute)', fontSize: 11.5 }}>
            {Math.round((rows[act].total / total) * 100)}% · {rows[act].count} פריטים
          </div>
        </div>
      )}
      {/* Bar */}
      <div style={{ display: 'flex', width: '100%', height: 30, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {rows.map((r, i) => {
          const frac = r.total / total
          const pct = frac * 100
          const isActive = act === i
          const showLabel = frac >= 0.16
          return (
            <div key={r.name}
              onMouseEnter={() => onHover?.(r.name)}
              onMouseLeave={() => onHover?.(null)}
              onClick={() => onHover?.(activeName === r.name ? null : r.name)}
              title={`${r.name} · ${fmtILS(r.total)}`}
              style={{
                width: `${pct}%`, minWidth: 3, height: '100%', background: COLORS[i % COLORS.length],
                opacity: act == null || isActive ? 1 : 0.4, cursor: 'pointer',
                outline: isActive ? '2px solid var(--text)' : 'none', outlineOffset: -2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                transition: 'opacity 120ms', borderInlineStart: i ? '1px solid rgba(255,255,255,0.5)' : 'none',
              }}>
              {showLabel && (
                <span style={{ color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-main)' }}>{r.name}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CategoryDrilldown({ items }) {
  const [gran, setGran]   = useState('month')
  const [chartType, setChartType] = useState('bar')
  const [openVendor, setOpenVendor] = useState(null)  // expanded vendor name

  const vendors = useMemo(() => vendorBreakdown(items, []), [items])
  const series  = useMemo(() => timeSeries(items, [], gran), [items, gran])
  const compositions = useMemo(() => {
    const m = {}
    for (const v of vendors) m[v.name] = vendorComposition(items, v.name)
    return m
  }, [vendors, items])
  // Detailed item table for the expanded vendor (computed lazily).
  const openTable = useMemo(() => openVendor ? vendorItemsTable(items, openVendor) : null, [openVendor, items])
  // Shared hover state linking the colored bar ↔ the table rows (by product name).
  const [hoverName, setHoverName] = useState(null)
  const openColors = useMemo(() => {
    const m = {}; (compositions[openVendor]?.rows || []).forEach((r, i) => { m[r.name] = COLORS[i % COLORS.length] }); return m
  }, [openVendor, compositions])

  const maxVendor = Math.max(...vendors.map(v => v.total), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }} dir="rtl">

      {/* Granularity + chart type */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        <div style={{ display: 'flex', gap: '4px', background: 'var(--panel-2)', borderRadius: '9px', padding: '3px', flexWrap: 'wrap' }}>
          {GRANS.map(g => (
            <button key={g.id} onClick={() => setGran(g.id)}
              style={{ padding: '6px 12px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: '13.5px', fontWeight: gran === g.id ? 700 : 500,
                background: gran === g.id ? 'var(--accent)' : 'transparent', color: gran === g.id ? 'white' : 'var(--text-dim)' }}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overall spend over time */}
      {series.length > 0
        ? <TimeSeriesChart data={series} color="#2563eb" chartType={chartType} />
        : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: '15px' }}>אין נתונים לתקופה</p>}

      {/* Vendors — click a vendor to split its bar into product rectangles */}
      {vendors.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-mute)' }}>
            <Store size={13} style={{ verticalAlign: '-2px', marginInlineEnd: 4, color: 'var(--accent)' }} />
            ספקים · לחץ על ספק כדי לראות את פירוט הפריטים שנרכשו ממנו (שם, כמות, יח׳, מחיר ליח׳, סה"כ)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {vendors.map((v) => {
              const open = openVendor === v.name
              const comp = compositions[v.name]
              const pct = (v.total / maxVendor) * 100
              return (
                <div key={v.name} style={{ border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 11, background: open ? 'var(--accent-bg)' : 'var(--panel-2)', padding: '10px 14px', transition: 'background 120ms' }}>
                  {/* Header row — click to toggle */}
                  <button onClick={() => { setOpenVendor(open ? null : v.name); setHoverName(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', padding: 0 }}>
                    <Store size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: open ? 700 : 600, color: open ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                    <span style={{ fontSize: '12.5px', color: 'var(--text-mute)', flexShrink: 0, whiteSpace: 'nowrap' }}>{v.count} רכישות</span>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ok)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtILS(v.total)}</span>
                    <ChevronDown size={16} style={{ color: 'var(--text-mute)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
                  </button>
                  {/* Collapsed: proportional bar. Expanded: composition bar + item table. */}
                  {open ? (
                    <>
                      {comp && <CompositionBar rows={comp.rows} total={comp.total || 1} activeName={hoverName} onHover={setHoverName} />}
                      <VendorTable data={openTable} activeName={hoverName} onHover={setHoverName} colorByName={openColors} />
                    </>
                  ) : (
                    <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#60a5fa', borderRadius: 3 }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
