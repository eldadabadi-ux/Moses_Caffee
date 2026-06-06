import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

const HEB_MONTHS = ['ינו','פבר','מרץ','אפר','מאי','יוני','יול','אוג','ספט','אוק','נוב','דצמ']
const HEB_MONTHS_FULL = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function MonthlyBars({ data, compareData, year, compareYear, color = '#2563eb', compareColor = '#f59e0b', chartType = 'bar' }) {
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
    const allVals = [...data.map(d => d.total), ...(compareData || []).map(d => d.total)]
    const maxVal  = Math.max(d3.max(allVals) || 0, 1)

    const xScale = d3.scaleBand().domain(months).range([0, W]).paddingInner(compareData ? 0.25 : 0.35)
    const yScale = d3.scaleLinear().domain([0, maxVal * 1.08]).range([H, 0])

    // Grid lines
    g.append('g').attr('class', 'grid').call(
      d3.axisLeft(yScale).ticks(4)
        .tickSize(-W)
        .tickFormat(v => v >= 1000 ? `₪${Math.round(v/1000)}k` : `₪${v}`)
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
            `<div style="color:var(--ok);font-size:15px;font-weight:700">${fmtILS(d.total)}</div>` +
            `<div style="color:var(--text-mute);font-size:11px;margin-top:2px">${d.count} קבלות</div>`
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

    function drawLine(dataset, strokeColor) {
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
          const yr = strokeColor === color ? year : compareYear
          tip.style('display', 'block').html(
            `<div style="font-weight:700;margin-bottom:4px">${HEB_MONTHS_FULL[d.month-1]} ${yr}</div>` +
            `<div style="color:var(--ok);font-size:15px;font-weight:700">${fmtILS(d.total)}</div>` +
            `<div style="color:var(--text-mute);font-size:11px;margin-top:2px">${d.count} קבלות</div>`)
          const r = svgRef.current.getBoundingClientRect()
          tip.style('left', (e.clientX - r.left - 70) + 'px').style('top', (yScale(d.total) + margin.top - 80) + 'px')
        })
        .on('mouseleave', function () { d3.select(this).attr('r', 4); tip.style('display', 'none') })
        .transition().duration(500).delay((_, i) => i * 30).attr('r', 4)
    }

    const bw = compareData ? xScale.bandwidth() / 2 - 2 : xScale.bandwidth()
    if (chartType === 'line') {
      drawLine(data, color)
      if (compareData) drawLine(compareData, compareColor)
    } else {
      drawBars(data, 0, color, 'A')
      if (compareData) drawBars(compareData, bw + 4, compareColor, 'B')
    }

    // Value labels on top of bars (desktop only, bar mode, skip if too many)
    if (chartType === 'bar' && dims.w > 480) {
      g.selectAll('.val-label')
        .data(data.filter(d => d.total > 0))
        .join('text')
        .attr('class', 'val-label')
        .attr('x', d => xScale(d.month) + bw / 2)
        .attr('y', d => yScale(d.total) - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-mute)')
        .attr('font-size', '9px')
        .attr('font-family', 'var(--font-main)')
        .attr('opacity', 0)
        .text(d => d.total >= 1000 ? `${Math.round(d.total/1000)}k` : Math.round(d.total))
        .transition().delay(800).duration(300)
        .attr('opacity', 1)
    }
  }, [data, compareData, dims, year, compareYear, color, compareColor, chartType])

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
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
