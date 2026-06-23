/**
 * ShekelSign — a currency icon for the Israeli new shekel (₪), with the same
 * { size, color } API as lucide icons so it can drop in anywhere an icon is used.
 *
 * Rendered as an SVG <text> centered geometrically (text-anchor=middle +
 * dominant-baseline=central). This avoids the line-box / baseline quirks of a
 * plain text span, so the glyph is always optically centered and crisp at any
 * size, and fills the box so it reads clearly as a shekel sign.
 */
export default function ShekelSign({ size = 18, color = 'currentColor', style, ...rest }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0, ...style }}
      {...rest}
    >
      {/* fill is set via style (not the SVG attribute) so CSS-variable colors
          like var(--ok) / var(--accent) resolve correctly. */}
      <text
        x="12" y="12.5"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontFamily: 'var(--font-main)', fontWeight: 700, fontSize: '22px', fill: color }}
      >
        ₪
      </text>
    </svg>
  )
}
