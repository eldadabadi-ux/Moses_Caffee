import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

const COLORS = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626','#0891b2','#c2410c','#0d9488','#be185d','#6366f1']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function CategoryDonut({ data, total, onSelect, selected }) {
  const svgRef  = useRef(null)
  const wrapRef = useRef(null)
  const [size, setSize] = useState(200)

  useEffect(() => {
    if (!wrapRef.current) return
    const obs = new ResizeObserver(([e]) => {
      setSize(Math.min(Math.floor(e.contentRect.width), 240))
    })
    obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    if (!data?.length) return

    const r  = size / 2 - 6
    const ri = r * 0.56

    svg.attr('width', size).attr('height', size).attr('viewBox', `0 0 ${size} ${size}`)

    const g = svg.append('g').attr('transform', `translate(${size/2},${size/2})`)

    const pie = d3.pie().value(d => d.total).sort(null).padAngle(0.025)
    const arc      = d3.arc().innerRadius(ri).outerRadius(r)
    const arcHover = d3.arc().innerRadius(ri - 3).outerRadius(r + 7)

    const colorScale = d3.scaleOrdinal().domain(data.map(d => d.name)).range(COLORS)

    // Drop shadow filter
    const defs = svg.append('defs')
    const filter = defs.append('filter').attr('id', 'drop-shadow')
    filter.append('feDropShadow').attr('dx', 0).attr('dy', 2).attr('stdDeviation', 4).attr('flood-color', 'rgba(0,0,0,0.18)')

    // Non-selected slices turn grey (kept visible, not hidden).
    const GREY = '#cbd5e1'
    const fillFor = d => (selected && selected !== d.data.name) ? GREY : colorScale(d.data.name)

    const paths = g.selectAll('path')
      .data(pie(data))
      .join('path')
      .attr('d', arc)
      .attr('fill', fillFor)
      .attr('stroke', 'var(--panel)')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .attr('transform', 'scale(0)').attr('opacity', 0)
      .on('mouseenter', function(_, d) {
        d3.select(this).transition().duration(180).attr('d', arcHover).attr('filter', 'url(#drop-shadow)')
        centerLabel.select('.center-name').text(d.data.name)
        centerLabel.select('.center-val').text(fmtILS(d.data.total))
        centerLabel.select('.center-pct').text(`${Math.round((d.data.total / total) * 100)}%`)
      })
      .on('mouseleave', function(_, d) {
        d3.select(this).transition().duration(180).attr('d', arc).attr('filter', null)
        centerLabel.select('.center-name').text('סה"כ')
        centerLabel.select('.center-val').text(fmtILS(total))
        centerLabel.select('.center-pct').text('')
      })
      .on('click', (_, d) => onSelect?.(d.data.name === selected ? null : d.data.name))

    // Animate entrance
    paths.transition().duration(700).delay((_, i) => i * 60).ease(d3.easeBackOut)
      .attr('transform', 'scale(1)')
      .attr('opacity', 0.95)

    // Center label
    const centerLabel = g.append('g')
    centerLabel.append('text').attr('class', 'center-name')
      .attr('y', -16).attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-mute)').attr('font-size', '10px')
      .attr('font-family', 'var(--font-main)').text('סה"כ')
    centerLabel.append('text').attr('class', 'center-val')
      .attr('y', 5).attr('text-anchor', 'middle')
      .attr('fill', 'var(--text)').attr('font-size', Math.max(11, Math.min(14, r * 0.22)) + 'px')
      .attr('font-weight', '700').attr('font-family', 'var(--font-main)')
      .text(fmtILS(total))
    centerLabel.append('text').attr('class', 'center-pct')
      .attr('y', 22).attr('text-anchor', 'middle')
      .attr('fill', 'var(--accent)').attr('font-size', '10px')
      .attr('font-family', 'var(--font-main)').text(selected ? 'בטל סינון' : '')

    // Transparent center hit-area — click clears the filter.
    g.append('circle')
      .attr('r', ri - 2).attr('fill', 'transparent')
      .style('cursor', selected ? 'pointer' : 'default')
      .on('click', () => { if (selected) onSelect?.(null) })
      .on('mouseenter', () => { if (selected) centerLabel.select('.center-pct').attr('fill', 'var(--danger)') })
      .on('mouseleave', () => centerLabel.select('.center-pct').attr('fill', 'var(--accent)'))
  }, [data, total, size, selected])

  return (
    <div ref={wrapRef} style={{ display: 'flex', justifyContent: 'center' }}>
      <svg ref={svgRef} />
    </div>
  )
}

export { COLORS }
