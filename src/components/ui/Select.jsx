import React from 'react';

export default function Select({
  label, options = [], value, onChange, error,
  required = false, placeholder = 'בחר...', disabled = false, name, size = 'md',
}) {
  const [focused, setFocused] = React.useState(false);

  const height   = size === 'sm' ? '40px' : '46px';
  const fontSize = size === 'sm' ? '16px' : '17px';

  const borderColor = error
    ? 'var(--danger)'
    : focused
    ? 'var(--accent)'
    : 'var(--border)';

  const boxShadow = focused && !error
    ? '0 0 0 3px rgba(37,99,235,0.15)'
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
      <select
        name={name}
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
          paddingInlineEnd: '12px',
          paddingInlineStart: '28px',
          fontSize,
          color: 'var(--text)',
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          appearance: 'none',
          transition: `border-color var(--duration) var(--ease), box-shadow var(--duration) var(--ease)`,
          lineHeight: 1.5,
          fontFamily: 'var(--font-main)',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='%238a8982' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'left 10px center',
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && (
        <p style={{ marginTop: '5px', fontSize: '12px', color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  );
}
