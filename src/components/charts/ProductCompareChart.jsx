import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'

const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`
const trunc = (s, n = 10) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s)

// Decide how to render the X labels so (Hebrew) product names never overlap the
// bars or each other. Measures REAL label widths via canvas, then picks:
//   flat   — names sit horizontally under each bar (fits)
//   angled — names rotated just enough to fit within each band
//   numbers— bars get 1,2,3… and a numbered legend lists the full names below
function computeLayout(products, w) {
  const n = Math.max(products.length, 1)
  const isNarrow = w < 520
  const fs = isNarrow ? 10 : 11
  const maxChars = isNarrow ? 14 : 18
  const side = { left: 50, right: 12 }
  const innerW = Math.max(w - side.left - side.right, 60)
  const bandW = innerW / n

  let labelW = 12
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = `${fs}px Assistant, Heebo, system-ui, sans-serif`
    labelW = Math.max(12, ...products.map(p => ctx.measureText(trunc(p.name || '', maxChars)).width))
  } catch { /* SSR / no canvas */ }

  let mode = 'angled', ANG = 36, bottom = 56
  if (labelW < bandW * 0.9) {
    // Names fit horizontally under their bar → keep them flat.
    mode = 'flat'; ANG = 0; bottom = fs + 22
  } else if (isNarrow) {
    // Mobile: never rotate (angled Hebrew names still crowd the bars). Use
    // numbers under the bars + a legend — guaranteed not to overlap.
    mode = 'numbers'; bottom = fs + 18
  } else {
    const need = Math.acos(Math.min(1, (bandW * 0.95) / labelW)) * 180 / Math.PI
    if (need > 56) { mode = 'numbers'; bottom = fs + 18 }
    else { mode = 'angled'; ANG = Math.max(34, Math.min(56, Math.round(need))); bottom = Math.round(Math.sin(ANG * Math.PI / 180) * labelW + fs + 14) }
  }
  bottom = Math.min(170, Math.max(34, bottom))
  return { mode, ANG, fs, maxChars, PLOT_H: 200, margin: { top: 18, right: side.right, bottom, left: side.left } }
}

/**
 * ProductCompareChart — VERTICAL grouped bars (or line+points) comparing two
 * vendors across a set of products. `products` = [{ name, a, b }] (largest first).
 * `chartType` = 'bar' | 'line'.  RTL: first product sits on the right.
 */
export default function ProductCompareChart({ products = [], labelA, labelB, colorA = '#2563eb', colorB = '#f59e0b', chartType = 'bar' }) {
  const svgRef  = useRef(null)
  const wrapRef = useRef(null)
  const tipRef  = useRef(null)
  const [w, setW] = useState(600)

  const layout = useMemo(() => computeLayout(products, w), [products, w])

  useEffect(() => {
    if (!wrapRef.current) return
    const obs = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    if (!products.length) return

    // RTL: reverse so the first (largest) product is on the right
    const items = [...products].reverse()
    const { mode, ANG, fs, maxChars, PLOT_H, margin } = layout
    const innerW = w - margin.left - margin.right
    const innerH = PLOT_H
    const H = margin.top + PLOT_H + margin.bottom
    svg.attr('width', w).attr('height', H)
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const maxVal = Math.max(d3.max(items, d => Math.max(d.a, d.b)) || 0, 1)
    const x0 = d3.scaleBand().domain(items.map(d => d.name)).range([0, innerW]).paddingInner(0.28).paddingOuter(0.12)
    // 'b' first then 'a' → in RTL, vendor A ends up on the right of each pair
    const x1 = d3.scaleBand().domain(['b', 'a']).range([0, x0.bandwidth()]).padding(0.12)
    const y  = d3.scaleLinear().domain([0, maxVal * 1.12]).range([innerH, 0])

    // Y grid
    g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(v => v >= 1000 ? `₪${Math.round(v/1000)}k` : `₪${v}`))
      .call(gg => {
        gg.select('.domain').remove()
        gg.selectAll('.tick line').attr('stroke', 'var(--border)').attr('stroke-dasharray', '3,3')
        gg.selectAll('.tick text').attr('fill', 'var(--text-mute)').attr('font-size', '10px').attr('font-family', 'var(--font-main)').attr('dx', '-4')
      })

    // X axis labels (flat / angled / numbers)
    const axisG = g.append('g').attr('transform', `translate(0,${innerH})`)
    if (mode === 'numbers') {
      axisG.call(d3.axisBottom(x0).tickSize(6).tickFormat((_n, i) => String(items.length - i)))
        .call(gg => {
          gg.select('.domain').remove()
          gg.selectAll('.tick line').attr('stroke', 'var(--border)')
          gg.selectAll('.tick text').attr('fill', 'var(--text-dim)').attr('font-size', `${fs + 1}px`).attr('font-weight', 700).attr('font-family', 'var(--font-main)').attr('dy', '1.1em')
        })
    } else {
      axisG.call(d3.axisBottom(x0).tickSize(6).tickFormat(nm => trunc(nm, maxChars)))
        .call(gg => {
          gg.select('.domain').remove()
          gg.selectAll('.tick line').attr('stroke', 'var(--border)')
          const txt = gg.selectAll('.tick text').attr('fill', 'var(--text)').attr('font-size', `${fs}px`).attr('font-family', 'var(--font-main)')
          if (mode === 'flat') txt.attr('text-anchor', 'middle').attr('dy', '1.05em')
          else txt.attr('transform', `rotate(-${ANG})`).attr('text-anchor', 'end').attr('dx', '-0.5em').attr('dy', '0.5em')
          txt.each(function (d) { d3.select(this).append('title').text(d) })   // full name on hover
        })
    }

    const tip = d3.select(tipRef.current)
    function showTip(event, name, vendorLabel, value, col) {
      tip.style('display', 'block').html(
        `<div style="font-weight:700;margin-bottom:3px">${name}</div>` +
        `<div style="display:flex;align-items:center;gap:5px;justify-content:center"><span style="width:9px;height:9px;border-radius:2px;background:${col};display:inline-block"></span><span style="font-size:12.5px">${vendorLabel}</span></div>` +
        `<div style="color:var(--ok);font-size:15px;font-weight:700;margin-top:2px">${fmtILS(value)}</div>`
      )
      const rect = svgRef.current.getBoundingClientRect()
      tip.style('left', (event.clientX - rect.left - 75) + 'px').style('top', (event.clientY - rect.top - 78) + 'px')
    }
    const hideTip = () => tip.style('display', 'none')

    if (chartType === 'line') {
      const cx = d => x0(d.name) + x0.bandwidth() / 2
      for (const [key, col, lbl] of [['a', colorA, labelA], ['b', colorB, labelB]]) {
        const line = d3.line().x(cx).y(d => y(d[key])).curve(d3.curveMonotoneX)
        const path = g.append('path').datum(items)
          .attr('fill', 'none').attr('stroke', col).attr('stroke-width', 2.5)
          .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', line)
        const len = path.node().getTotalLength()
        path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
          .transition().duration(700).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        g.selectAll(null).data(items).join('circle')
          .attr('cx', cx).attr('cy', d => y(d[key])).attr('r', 0)
          .attr('fill', 'var(--panel)').attr('stroke', col).attr('stroke-width', 2.5)
          .style('cursor', 'pointer')
          .on('mouseenter', function (e, d) { d3.select(this).attr('r', 6.5); showTip(e, d.name, lbl, d[key], col) })
          .on('mouseleave', function () { d3.select(this).attr('r', 4.5); hideTip() })
          .transition().duration(500).delay((_, i) => i * 25).attr('r', 4.5)
      }
    } else {
      const groups = g.selectAll('.grp').data(items).join('g')
        .attr('class', 'grp').attr('transform', d => `translate(${x0(d.name)},0)`)
      for (const [key, col, lbl] of [['a', colorA, labelA], ['b', colorB, labelB]]) {
        groups.append('rect')
          .attr('x', x1(key)).attr('width', x1.bandwidth())
          .attr('y', innerH).attr('height', 0).attr('rx', 4)
          .attr('fill', d => d[key] > 0 ? col : 'var(--border)')
          .attr('opacity', d => d[key] > 0 ? 0.92 : 0.4)
          .style('cursor', 'pointer')
          .on('mouseenter', function (e, d) { if (d[key] > 0) { d3.select(this).attr('opacity', 1); showTip(e, d.name, lbl, d[key], col) } })
          .on('mouseleave', function (e, d) { d3.select(this).attr('opacity', d[key] > 0 ? 0.92 : 0.4); hideTip() })
          .transition().duration(600).delay((_, i) => i * 40).ease(d3.easeBackOut.overshoot(0.4))
          .attr('y', d => d[key] > 0 ? y(d[key]) : innerH).attr('height', d => d[key] > 0 ? innerH - y(d[key]) : 0)
      }
      if (w > 480 && items.length <= 6) {
        for (const key of ['a', 'b']) {
          groups.append('text')
            .attr('x', x1(key) + x1.bandwidth() / 2).attr('y', d => (d[key] > 0 ? y(d[key]) : innerH) - 4)
            .attr('text-anchor', 'middle').attr('fill', 'var(--text-mute)').attr('font-size', '9px').attr('font-family', 'var(--font-main)')
            .attr('opacity', 0).text(d => d[key] > 0 ? (d[key] >= 1000 ? `${Math.round(d[key]/1000)}k` : Math.round(d[key])) : '')
            .transition().delay(750).duration(300).attr('opacity', 1)
        }
      }
    }
  }, [products, w, chartType, labelA, labelB, colorA, colorB, layout])

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* Vendor legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: colorA, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{labelA}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: colorB, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{labelB}</span>
        </span>
      </div>

      <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
        <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
        <div ref={tipRef} style={{
          display: 'none', position: 'absolute', pointerEvents: 'none',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px',
          padding: '8px 12px', fontFamily: 'var(--font-main)', color: 'var(--text)',
          boxShadow: 'var(--shadow-modal)', zIndex: 10, minWidth: '120px', textAlign: 'center', direction: 'rtl',
        }} />
      </div>

      {/* Numbered legend — maps the 1,2,3… under the bars to full product names */}
      {layout.mode === 'numbers' && products.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12.5 }}>
          {products.map((p, k) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', flexShrink: 0 }}>{k + 1}</span>
              <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{p.name}</span>
            </span>
          ))}
        </div>
      )}

      {products.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '18px 0', fontSize: 14 }}>אין מוצרים משותפים להשוואה</p>
      )}
    </div>
  )
}
