import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

/**
 * TimeSeriesChart — bars over time buckets. `data` = [{ key, label, total, count }].
 */
export default function TimeSeriesChart({ data, color = '#2563eb' }) {
  const svgRef  = useRef(null)
  const wrapRef = useRef(null)
  const tipRef  = useRef(null)
  const [w, setW] = useState(600)
  const H = 240

  useEffect(() => {
    if (!wrapRef.current) return
    const obs = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    if (!data?.length) return

    const margin = { top: 16, right: 12, bottom: 44, left: 56 }
    const innerW = w - margin.left - margin.right
    const innerH = H - margin.top - margin.bottom
    svg.attr('width', w).attr('height', H)
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const maxVal = Math.max(d3.max(data, d => d.total) || 0, 1)
    // Show every Nth label if crowded
    const labelStep = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 46)))

    const x = d3.scaleBand().domain(data.map(d => d.key)).range([0, innerW]).padding(0.25)
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([innerH, 0])

    // Grid + Y axis
    g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(v => v >= 1000 ? `₪${Math.round(v/1000)}k` : `₪${v}`))
      .call(gg => {
        gg.select('.domain').remove()
        gg.selectAll('.tick line').attr('stroke', 'var(--border)').attr('stroke-dasharray', '3,3')
        gg.selectAll('.tick text').attr('fill', 'var(--text-mute)').attr('font-size', '12px').attr('font-family', 'var(--font-main)')
      })

    // X axis labels
    g.append('g').attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickFormat((k, i) => i % labelStep === 0 ? (data[i]?.label ?? '') : ''))
      .call(gg => {
        gg.select('.domain').remove()
        gg.selectAll('.tick line').remove()
        gg.selectAll('.tick text').attr('fill', 'var(--text-mute)').attr('font-size', '11.5px').attr('font-family', 'var(--font-main)').attr('dy', '1.4em')
      })

    const tip = d3.select(tipRef.current)

    g.selectAll('rect.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.key))
      .attr('width', x.bandwidth())
      .attr('y', innerH).attr('height', 0)
      .attr('rx', 4)
      .attr('fill', color)
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 1)
        tip.style('display', 'block').html(
          `<div style="font-weight:700;margin-bottom:3px">${d.label}</div>` +
          `<div style="color:var(--ok);font-size:15px;font-weight:700">${fmtILS(d.total)}</div>` +
          `<div style="color:var(--text-mute);font-size:11.5px;margin-top:2px">${d.count} פריטים</div>`
        )
        const rect = svgRef.current.getBoundingClientRect()
        tip.style('left', (event.clientX - rect.left - 70) + 'px').style('top', (y(d.total) + margin.top - 70) + 'px')
      })
      .on('mouseleave', function () { d3.select(this).attr('opacity', 0.9); tip.style('display', 'none') })
      .transition().duration(500).delay((_, i) => i * 25).ease(d3.easeCubicOut)
      .attr('y', d => y(d.total)).attr('height', d => innerH - y(d.total))
  }, [data, w, color])

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
      <div ref={tipRef} style={{
        display: 'none', position: 'absolute', pointerEvents: 'none',
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px',
        padding: '8px 12px', fontFamily: 'var(--font-main)', color: 'var(--text)',
        boxShadow: 'var(--shadow-modal)', zIndex: 10, minWidth: '120px', textAlign: 'center', direction: 'rtl',
      }} />
    </div>
  )
}
