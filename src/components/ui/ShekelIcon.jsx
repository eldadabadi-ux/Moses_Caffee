export default function ShekelIcon({ size = 24, strokeWidth = 1.75, color = 'currentColor', style, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {/* ₪ — shekel sign drawn in Lucide style */}
      <path d="M7 18V9a5 5 0 0 1 10 0v1" />
      <path d="M17 6V15a5 5 0 0 1-10 0v-1" />
    </svg>
  )
}
