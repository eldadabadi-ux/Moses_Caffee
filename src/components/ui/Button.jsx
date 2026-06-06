import React from 'react';

/* ─── Variant styles ─────────────────────────────────────────── */
const variants = {
  primary: {
    background: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: '1px solid var(--btn-primary-bg)',
  },
  secondary: {
    background: 'var(--panel)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-dim)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'var(--danger)',
    color: '#ffffff',
    border: '1px solid var(--danger)',
  },
  success: {
    background: 'var(--ok)',
    color: '#ffffff',
    border: '1px solid var(--ok)',
  },
};

const hoverVariants = {
  primary:   { background: 'var(--btn-primary-hover, #2c2c29)' },
  secondary: { background: 'var(--panel-2)', borderColor: 'var(--border-strong)' },
  ghost:     { background: 'var(--panel-2)' },
  danger:    { background: '#b91c1c' },
  success:   { background: '#15803d' },
};

const sizes = {
  sm: { padding: '7px 12px',  fontSize: '16px', gap: '5px' },
  md: { padding: '10px 16px', fontSize: '17px', gap: '6px' },
  lg: { padding: '12px 20px', fontSize: '18px', gap: '6px' },
};

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  icon: Icon,
}) {
  const isDisabled = disabled || loading;
  const vs  = variants[variant]  || variants.primary;
  const hvs = hoverVariants[variant] || hoverVariants.primary;
  const ss  = sizes[size] || sizes.md;

  const [hovered, setHovered] = React.useState(false);

  const style = {
    ...vs,
    ...(hovered && !isDisabled ? hvs : {}),
    padding:        ss.padding,
    fontSize:       ss.fontSize,
    gap:            ss.gap,
    borderRadius:   'var(--r-btn)',
    fontWeight:     500,
    fontFamily:     'var(--font-main)',
    cursor:         isDisabled ? 'not-allowed' : 'pointer',
    opacity:        isDisabled ? 0.5 : 1,
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    transition:     `background var(--duration) var(--ease), border-color var(--duration) var(--ease), color var(--duration) var(--ease)`,
    outline:        'none',
    lineHeight:     1,
    whiteSpace:     'nowrap',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={className}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.2)'; }}
      onBlur={e =>  { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {loading && (
        <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity=".25" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity=".75" />
        </svg>
      )}
      {Icon && !loading && <Icon size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />}
      {children}
    </button>
  );
}
