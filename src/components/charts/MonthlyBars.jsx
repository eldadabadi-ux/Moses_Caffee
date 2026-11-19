import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

const HEB_MONTHS = ['ינו','פבר','מרץ','אפר','מאי','יוני','יול','אוג','ספט','אוק','נוב','דצמ']
const HEB_MONTHS_FULL = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

// One distinct color per year in a multi-year stack (oldest year gets the first).
export const YEAR_COLORS = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#0ea5e9', '#d946ef']

export default function MonthlyBars({ data, compareData, year, compareYear, color = '#2563eb', compareColor = '#f59e0b', chartType = 'bar', series = null, unit = 'ils', countNoun = '\u05e7\u05d1\u05dc\u05d5\u05ea' }) {
  // 'ils' plots money and names the document count underneath; 'count' plots
  // the count itself, so there is nothing to repeat on a second line.
  const isCount = unit === 'count'
  const fmtVal = isCount ? (n => `${Math.round(n)}`) : fmtILS
  const subLine = (d) => isCount ? '' :
    `<div style="color:var(--text-mute);font-size:11px;margin-top:2px">${d.count} ${countNoun}</div>`
  const svgRef   = useRef(null)
  const wrapRef  = useRef(null)
  const tipRef   = useRef(null)
  const [dims, setDims] = useState({ w: 600, h: 220 })

  // Responsive resize
  useEffect(() => {
    if (!wrapRef.current) return
    const obs = new ResizeObserver(([e]) => {
      setDims({ w: Math.floor(e.contentRect.width), h: 220 })
    })
    obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    if (!data?.length) return

    const margin = { top: 18, right: 12, bottom: 36, left: 52 }
    const W = dims.w - margin.left - margin.right
    const H = dims.h - margin.top - margin.bottom

    svg.attr('width', dims.w).attr('height', dims.h)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const months = d3.range(1, 13)
    const stacked = Array.isArray(series) && series.length > 1
    const stackTotals = stacked
      ? months.map(m => series.reduce((s, sr) => s + (sr.data[m - 1]?.total || 0), 0))
      : []
    const allVals = stacked
      ? [...stackTotals, ...(compareData || []).map(d => d.total)]
      : [...data.map(d => d.total), ...(compareData || []).map(d => d.total)]
    const maxVal  = Math.max(d3.max(allVals) || 0, 1)

    const xScale = d3.scaleBand().domain(months).range([0, W]).paddingInner(compareData ? 0.25 : 0.35)
    const yScale = d3.scaleLinear().domain([0, maxVal * 1.08]).range([H, 0])

    // Grid lines
    g.append('g').attr('class', 'grid').call(
      d3.axisLeft(yScale).ticks(4)
        .tickSize(-W)
        .tickFormat(v => isCount ? (Number.isInteger(v) ? String(v) : '') : (v >= 1000 ? `₪${Math.round(v/1000)}k` : `₪${v}`))
    )
    .call(gg => {
      gg.select('.domain').remove()
      gg.selectAll('.tick line').attr('stroke', 'var(--border)').attr('stroke-dasharray', '3,3')
      gg.selectAll('.tick text').attr('fill', 'var(--text-mute)').attr('font-size', '10px').attr('font-family', 'var(--font-main)').attr('dx', '-4')
    })

    // X axis month labels
    g.append('g').attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(xScale).tickFormat(m => HEB_MONTHS[m - 1]))
      .call(gg => {
        gg.select('.domain').remove()
        gg.selectAll('.tick line').remove()
        gg.selectAll('.tick text').attr('fill', 'var(--text-mute)').attr('font-size', '10.5px').attr('font-family', 'var(--font-main)').attr('dy', '1.2em')
      })

    const tip = d3.select(tipRef.current)

    function drawBars(dataset, xOffset, fillColor, label) {
      const bw = compareData ? xScale.bandwidth() / 2 - 2 : xScale.bandwidth()
      g.selectAll(`.bar-${label}`)
        .data(dataset)
        .join('rect')
        .attr('class', `bar-${label}`)
        .attr('x', d => xScale(d.month) + xOffset)
        .attr('y', H)
        .attr('width', bw)
        .attr('height', 0)
        .attr('rx', 4).attr('ry', 4)
        .attr('fill', d => d.total === 0 ? 'var(--border)' : fillColor)
        .attr('opacity', d => d.total === 0 ? 0.4 : 0.9)
        .on('mouseenter', function(event, d) {
          if (d.total === 0) return
          d3.select(this).attr('opacity', 1).attr('y', yScale(d.total) - 3).attr('height', H - yScale(d.total) + 3)
          const yr = label === 'A' ? year : compareYear
          tip.style('display', 'block').html(
            `<div style="font-weight:700;margin-bottom:4px">${HEB_MONTHS_FULL[d.month-1]} ${yr}</div>` +
            `<div style="color:var(--ok);font-size:15px;font-weight:700">${fmtVal(d.total)}${isCount ? ' ' + countNoun : ''}</div>` +
            subLine(d)
          )
          const svgRect = svgRef.current.getBoundingClientRect()
          const x = event.clientX - svgRect.left
          const tipW = 140
          tip.style('left', (x - tipW / 2) + 'px').style('top', (yScale(d.total) + margin.top - 80) + 'px')
        })
        .on('mouseleave', function(event, d) {
          d3.select(this).attr('opacity', d.total === 0 ? 0.4 : 0.9).attr('y', yScale(d.total)).attr('height', H - yScale(d.total))
          tip.style('display', 'none')
        })
        .transition().duration(600).delay((_, i) => i * 40).ease(d3.easeBackOut.overshoot(0.5))
        .attr('y', d => d.total > 0 ? yScale(d.total) : H)
        .attr('height', d => d.total > 0 ? H - yScale(d.total) : 0)
    }

    function drawLine(dataset, strokeColor, lineLabel) {
      const cx = d => xScale(d.month) + xScale.bandwidth() / 2
      const line = d3.line().x(cx).y(d => yScale(d.total)).curve(d3.curveMonotoneX)
      const path = g.append('path').datum(dataset)
        .attr('fill', 'none').attr('stroke', strokeColor).attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', line)
      const len = path.node().getTotalLength()
      path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(700).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
      g.selectAll(null).data(dataset).join('circle')
        .attr('cx', cx).attr('cy', d => yScale(d.total)).attr('r', 0)
        .attr('fill', 'var(--panel)').attr('stroke', strokeColor).attr('stroke-width', 2.5)
        .style('cursor', 'pointer')
        .on('mouseenter', function (e, d) {
          d3.select(this).attr('r', 6.5)
          const yr = lineLabel ?? (strokeColor === color ? year : compareYear)
          tip.style('display', 'block').html(
            `<div style="font-weight:700;margin-bottom:4px">${HEB_MONTHS_FULL[d.month-1]} ${yr}</div>` +
            `<div style="color:var(--ok);font-size:15px;font-weight:700">${fmtVal(d.total)}${isCount ? ' ' + countNoun : ''}</div>` +
            subLine(d))
          const r = svgRef.current.getBoundingClientRect()
          tip.style('left', (e.clientX - r.left - 70) + 'px').style('top', (yScale(d.total) + margin.top - 80) + 'px')
        })
        .on('mouseleave', function () { d3.select(this).attr('r', 4); tip.style('display', 'none') })
        .transition().duration(500).delay((_, i) => i * 30).attr('r', 4)
    }

    const bw = compareData ? xScale.bandwidth() / 2 - 2 : xScale.bandwidth()
    if (stacked && chartType === 'line') {
      // Multi-year line mode: one line per year, same palette as the stack.
      series.forEach((sr, i) => drawLine(sr.data, YEAR_COLORS[i % YEAR_COLORS.length], String(sr.year)))
      if (compareData) drawLine(compareData, compareColor, compareYear)
    } else if (stacked) {
      // One column per month, a colored segment per year (client request
      // 18.11.26): the cut between years is visible inside a single bar.
      for (const m of months) {
        let y0 = H
        series.forEach((sr, i) => {
          const d = sr.data[m - 1] || { total: 0, count: 0 }
          if (!(d.total > 0)) return
          const hPx = H - yScale(d.total)
          const segY = y0 - hPx
          const fill = YEAR_COLORS[i % YEAR_COLORS.length]
          g.append('rect')
            .attr('x', xScale(m)).attr('width', bw)
            .attr('y', y0).attr('height', 0)
            .attr('fill', fill).attr('opacity', 0.9)
            .on('mouseenter', function (event) {
              d3.select(this).attr('opacity', 1)
              const stackTotal = stackTotals[m - 1]
              tip.style('display', 'block').html(
                `<div style="font-weight:700;margin-bottom:4px">${HEB_MONTHS_FULL[m - 1]} ${sr.year}</div>` +
                `<div style="color:var(--ok);font-size:15px;font-weight:700">${fmtVal(d.total)}${isCount ? ' ' + countNoun : ''}</div>` +
                `<div style="color:var(--text-mute);font-size:11px;margin-top:2px">${isCount ? '' : d.count + ' ' + countNoun + ' · '}סה״כ החודש בכל השנים: ${fmtVal(stackTotal)}${isCount ? ' ' + countNoun : ''}</div>`)
              const svgRect = svgRef.current.getBoundingClientRect()
              tip.style('left', (event.clientX - svgRect.left - 70) + 'px').style('top', (segY + margin.top - 84) + 'px')
            })
            .on('mouseleave', function () { d3.select(this).attr('opacity', 0.9); tip.style('display', 'none') })
            .transition().duration(600).delay(m * 30).ease(d3.easeCubicOut)
            .attr('y', segY).attr('height', hPx)
          y0 = segY
        })
        if (y0 === H) {   // empty month placeholder, same as the single-year look
          g.append('rect').attr('x', xScale(m)).attr('width', bw)
            .attr('y', H - 2).attr('height', 2).attr('rx', 1)
            .attr('fill', 'var(--border)').attr('opacity', 0.4)
        }
      }
      if (compareData) drawBars(compareData, bw + 4, compareColor, 'B')
    } else if (chartType === 'line') {
      drawLine(data, color)
      if (compareData) drawLine(compareData, compareColor)
    } else {
      drawBars(data, 0, color, 'A')
      if (compareData) drawBars(compareData, bw + 4, compareColor, 'B')
    }

    // Value labels on top of bars (desktop only, bar mode, skip if too many)
    if (chartType === 'bar' && dims.w > 480) {
      const labelData = stacked
        ? months.map(m => ({ month: m, total: stackTotals[m - 1] })).filter(d => d.total > 0)
        : data.filter(d => d.total > 0)
      g.selectAll('.val-label')
        .data(labelData)
        .join('text')
        .attr('class', 'val-label')
        .attr('x', d => xScale(d.month) + bw / 2)
        .attr('y', d => yScale(d.total) - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-mute)')
        .attr('font-size', '9px')
        .attr('font-family', 'var(--font-main)')
        .attr('opacity', 0)
        .text(d => (!isCount && d.total >= 1000) ? `${Math.round(d.total/1000)}k` : Math.round(d.total))
        .transition().delay(800).duration(300)
        .attr('opacity', 1)
    }
  }, [data, compareData, dims, year, compareYear, color, compareColor, chartType, series, unit, countNoun])

  const legendItems = Array.isArray(series) && series.length > 1
    ? [
        ...series.map((sr, i) => ({ label: String(sr.year), color: YEAR_COLORS[i % YEAR_COLORS.length] })),
        ...(compareData && compareYear ? [{ label: `השוואה: ${compareYear}`, color: compareColor }] : []),
      ]
    : null

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
      {legendItems && (
        <div dir="rtl" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', padding: '6px 4px 0', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-main)' }}>
          {legendItems.map(it => (
            <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, display: 'inline-block' }} />
              {it.label}
            </span>
          ))}
        </div>
      )}
      <div ref={tipRef} style={{
        display: 'none', position: 'absolute', pointerEvents: 'none',
        background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: '10px', padding: '10px 14px', fontSize: '13px',
        fontFamily: 'var(--font-main)', color: 'var(--text)',
        boxShadow: 'var(--shadow-modal)', zIndex: 10, minWidth: '130px',
        textAlign: 'center', direction: 'rtl',
      }} />
    </div>
  )
}
