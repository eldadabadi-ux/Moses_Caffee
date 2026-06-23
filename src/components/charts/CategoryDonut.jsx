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
      setSize(Math.min(Math.floor(e.contentRect.width), 300))
    })
    obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    if (!data?.length) return

    // Leave a margin inside the SVG for the hover-expansion (+7) and the drop
    // shadow so the donut is never clipped on any side.
    const PAD = Math.max(18, size * 0.075)
    const r  = size / 2 - PAD
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

    // ── Center label ─────────────────────────────────────────────────────────
    // Shows the selected (or hovered) slice value BIG + "מתוך {total}" small.
    const truncName = (s) => (s && s.length > 16 ? s.slice(0, 15) + '…' : s)
    const sel = data.find(d => d.name === selected)
    const valFont = Math.max(13, Math.min(19, r * 0.28))

    const centerLabel = g.append('g').style('pointer-events', 'none')
    const nameT = centerLabel.append('text').attr('y', -18).attr('text-anchor', 'middle')
      .attr('font-size', '10.5px').attr('font-family', 'var(--font-main)')
    const valT = centerLabel.append('text').attr('y', 4).attr('text-anchor', 'middle')
      .attr('fill', 'var(--text)').attr('font-weight', '800').attr('font-family', 'var(--font-main)').attr('font-size', valFont + 'px')
    const subT = centerLabel.append('text').attr('y', 22).attr('text-anchor', 'middle')
      .attr('font-size', '10.5px').attr('font-family', 'var(--font-main)')

    function showSlice(name, val) {
      nameT.text(truncName(name)).attr('fill', name === selected ? 'var(--accent)' : 'var(--text-mute)')
      valT.text(fmtILS(val))
      subT.text(`מתוך ${fmtILS(total)}`).attr('fill', 'var(--text-mute)')
    }
    function resetCenter() {
      if (sel) { showSlice(sel.name, sel.total) }
      else { nameT.text('סה"כ').attr('fill', 'var(--text-mute)'); valT.text(fmtILS(total)); subT.text('').attr('fill', 'var(--text-mute)') }
    }
    resetCenter()

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
        showSlice(d.data.name, d.data.total)
      })
      .on('mouseleave', function(_, d) {
        d3.select(this).transition().duration(180).attr('d', arc).attr('filter', null)
        resetCenter()
      })
      .on('click', (_, d) => onSelect?.(d.data.name === selected ? null : d.data.name))

    // Animate entrance
    paths.transition().duration(700).delay((_, i) => i * 60).ease(d3.easeBackOut)
      .attr('transform', 'scale(1)')
      .attr('opacity', 0.95)

    // Transparent center hit-area — click clears the filter (when a slice is selected).
    g.append('circle')
      .attr('r', ri - 2).attr('fill', 'transparent')
      .style('cursor', selected ? 'pointer' : 'default')
      .on('click', () => { if (selected) onSelect?.(null) })
      .on('mouseenter', () => { if (selected) subT.text('בטל בחירה').attr('fill', 'var(--danger)') })
      .on('mouseleave', resetCenter)
  }, [data, total, size, selected])

  return (
    <div ref={wrapRef} style={{ display: 'flex', justifyContent: 'center' }}>
      <svg ref={svgRef} />
    </div>
  )
}

export { COLORS }
