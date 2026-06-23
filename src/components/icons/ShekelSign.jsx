/**
 * ShekelSign — a currency icon for the Israeli new shekel (₪), with the same
 * { size, color } API as lucide icons so it can drop in anywhere an icon is used.
 * Renders the ₪ glyph (always correct at any size) styled as an icon.
 */
export default function ShekelSign({ size = 18, color = 'currentColor', style, ...rest }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        // Render the ₪ glyph a bit larger than the nominal icon box so it reads
        // clearly as a shekel sign (the ₪ glyph is dense at small sizes). The box
        // stays size×size so surrounding layout is unaffected.
        width: size, height: size, fontSize: Math.round(size * 1.2), lineHeight: 1,
        fontWeight: 600, color, fontFamily: 'var(--font-main)', flexShrink: 0, ...style,
      }}
      {...rest}
    >
      ₪
    </span>
  )
}
