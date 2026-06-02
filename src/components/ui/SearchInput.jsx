import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

export default function SearchInput({
  value,
  onChange,
  placeholder = 'חיפוש...',
  debounceMs = 300,
}) {
  const [localValue, setLocalValue] = useState(value || '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [localValue, debounceMs]);

  return (
    <div style={{ position: 'relative' }} dir="rtl">
      <div style={{
        position: 'absolute', inset: '0', left: '10px', right: 'auto',
        display: 'flex', alignItems: 'center', pointerEvents: 'none',
      }}>
        <Search size={15} style={{ color: 'var(--text-mute)' }} />
      </div>
      <input
        type="text"
        dir="rtl"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          display: 'block',
          width: '100%',
          boxSizing: 'border-box',
          height: '36px',
          borderRadius: 'var(--r-btn)',
          border: focused ? '1px solid var(--accent)' : '1px solid var(--border)',
          background: 'var(--panel)',
          paddingRight: '12px',
          paddingLeft: '34px',
          fontSize: '13px',
          color: 'var(--text)',
          fontFamily: 'var(--font-main)',
          outline: 'none',
          boxShadow: focused ? '0 0 0 3px rgba(37,99,235,0.12)' : 'none',
          transition: 'border-color 140ms, box-shadow 140ms',
        }}
      />
    </div>
  );
}
