import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSelector() {
  const { language, setLanguage, availableLanguages } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const current = availableLanguages.find(l => l.code === language) || availableLanguages[0];

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current.name}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          background: 'none',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '0.25rem 0.5rem',
          cursor: 'pointer',
          color: 'var(--app-text)',
          fontSize: '0.8rem',
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: '1rem' }}>{current.flag}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{current.code}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            minWidth: '150px',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {availableLanguages.map(lang => (
            <button
              key={lang.code}
              role="option"
              aria-selected={lang.code === language}
              onClick={() => { setLanguage(lang.code); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                width: '100%', padding: '0.6rem 0.85rem',
                background: lang.code === language ? 'rgba(249,115,22,0.12)' : 'none',
                border: 'none', cursor: 'pointer',
                color: lang.code === language ? 'var(--color-primary, #f97316)' : 'var(--app-text)',
                fontWeight: lang.code === language ? 700 : 400,
                fontSize: '0.875rem', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{lang.flag}</span>
              <span>{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
