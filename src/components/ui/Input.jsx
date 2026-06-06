import React from 'react';

export default function Input({
  label, type = 'text', placeholder, value, onChange,
  error, prefixIcon: PrefixIcon, suffixIcon: SuffixIcon,
  /* legacy compat */ icon: LegacyIcon,
  dir = 'auto', required = false,
  disabled = false, name, size = 'md',
}) {
  const [focused, setFocused] = React.useState(false);

  const height   = size === 'sm' ? '40px' : '46px';
  const fontSize = size === 'sm' ? '16px' : '17px';

  const ActualPrefix = PrefixIcon || LegacyIcon;

  const borderColor = error
    ? 'var(--danger)'
    : focused
    ? 'var(--accent)'
    : 'var(--border)';

  const boxShadow = focused && !error
    ? '0 0 0 3px rgba(37,99,235,0.15)'
    : error && focused
    ? '0 0 0 3px rgba(220,38,38,0.12)'
    : 'none';

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <label style={{
          display: 'block',
          fontSize: '15px',
          fontWeight: 500,
          color: 'var(--text-dim)',
          marginBottom: '7px',
        }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginRight: '3px' }}>*</span>}
        </label>
      )}
      <div style={{ position: 'relative', height }}>
        {ActualPrefix && (
          <div style={{
            position: 'absolute',
            insetInlineEnd: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--text-mute)',
            display: 'flex',
          }}>
            <ActualPrefix size={15} strokeWidth={1.75} />
          </div>
        )}
        {SuffixIcon && (
          <div style={{
            position: 'absolute',
            insetInlineStart: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--text-mute)',
            display: 'flex',
          }}>
            <SuffixIcon size={15} strokeWidth={1.75} />
          </div>
        )}
        <input
          type={type}
          name={name}
          dir={dir}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          style={{
            display: 'block',
            width: '100%',
            height,
            boxSizing: 'border-box',
            borderRadius: 'var(--r-btn)',
            border: `1px solid ${borderColor}`,
            boxShadow,
            background: disabled ? 'var(--panel-2)' : 'var(--panel)',
            paddingTop: 0,
            paddingBottom: 0,
            paddingInlineEnd: ActualPrefix ? '34px' : '12px',
            paddingInlineStart: SuffixIcon ? '34px' : '12px',
            fontSize,
            color: disabled ? 'var(--text-mute)' : 'var(--text)',
            outline: 'none',
            transition: `border-color var(--duration) var(--ease), box-shadow var(--duration) var(--ease)`,
            lineHeight: 1.5,
            fontFamily: 'var(--font-main)',
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      {error && (
        <p style={{ marginTop: '5px', fontSize: '12px', color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  );
}
