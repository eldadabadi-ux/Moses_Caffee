import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function TopVendors({ data, onSelect, selected }) {
  const svgRef  = useRef(null)
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(400)

  useEffect(() => {
    if (!wrapRef.current) return
    const obs = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    if (!data?.length) return

    const top    = data.slice(0, 10)
    const barH   = 28
    const labelW = Math.min(140, width * 0.38)
    const amtW   = 72
    const barW   = width - labelW - amtW - 16
    const H      = top.length * (barH + 6)

    svg.attr('width', width).attr('height', H)

    const xScale = d3.scaleLinear().domain([0, d3.max(top, d => d.total) || 1]).range([0, barW])

    const g = svg.append('g')

    top.forEach((d, i) => {
      const y    = i * (barH + 6)
      const isS  = selected === d.name
      const row  = g.append('g').attr('transform', `translate(0,${y})`).style('cursor', 'pointer')

      // Background
      row.append('rect')
        .attr('width', width).attr('height', barH)
        .attr('rx', 6).attr('fill', isS ? 'var(--accent-bg)' : 'transparent')

      // Vendor name (RTL — starts from right)
      row.append('text')
        .attr('x', width).attr('y', barH / 2 + 1).attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', isS ? 'var(--accent)' : 'var(--text)')
        .attr('font-size', '12.5px').attr('font-weight', isS ? '600' : '400')
        .attr('font-family', 'var(--font-main)')
        .text(d.name.length > 18 ? d.name.slice(0, 17) + '…' : d.name)

      // Bar track
      const barX = width - labelW - barW - amtW
      row.append('rect')
        .attr('x', barX).attr('y', (barH - 10) / 2)
        .attr('width', barW).attr('height', 10).attr('rx', 5)
        .attr('fill', 'var(--border)')

      // Bar fill (animated)
      row.append('rect')
        .attr('x', barX).attr('y', (barH - 10) / 2)
        .attr('width', 0).attr('height', 10).attr('rx', 5)
        .attr('fill', isS ? 'var(--accent)' : '#60a5fa')
        .attr('opacity', 0.85)
        .transition().duration(600).delay(i * 50).ease(d3.easeQuadOut)
        .attr('width', xScale(d.total))

      // Amount
      row.append('text')
        .attr('x', barX - 8).attr('y', barH / 2 + 1).attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', 'var(--ok)').attr('font-size', '11.5px').attr('font-weight', '600')
        .attr('font-family', 'var(--font-main)')
        .text(fmtILS(d.total))

      // Count badge
      row.append('text')
        .attr('x', barX + xScale(d.total) + 6).attr('y', barH / 2 + 1).attr('dy', '0.35em')
        .attr('fill', 'var(--text-mute)').attr('font-size', '10px')
        .attr('font-family', 'var(--font-main)')
        .text(`×${d.count}`)

      // Click
      row.on('click', () => onSelect?.(d.name === selected ? null : d.name))
        .on('mouseenter', function() { d3.select(this).select('rect:first-child').attr('fill', 'var(--panel-2)') })
        .on('mouseleave', function() { d3.select(this).select('rect:first-child').attr('fill', isS ? 'var(--accent-bg)' : 'transparent') })
    })
  }, [data, width, selected])

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg ref={svgRef} style={{ display: 'block', overflow: 'visible' }} />
    </div>
  )
}
