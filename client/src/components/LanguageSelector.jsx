import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

// Map of language codes → flag emoji for the most commonly supported ones
const FLAGS = {
  en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', pt: '🇵🇹',
  it: '🇮🇹', nl: '🇳🇱', pl: '🇵🇱', ru: '🇷🇺', ar: '🇸🇦',
  zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷', tr: '🇹🇷', sv: '🇸🇪',
  da: '🇩🇰', fi: '🇫🇮', nb: '🇳🇴', cs: '🇨🇿', sk: '🇸🇰',
  hu: '🇭🇺', ro: '🇷🇴', uk: '🇺🇦', bg: '🇧🇬', hr: '🇭🇷',
  id: '🇮🇩', ms: '🇲🇾', vi: '🇻🇳', th: '🇹🇭', he: '🇮🇱',
  hi: '🇮🇳', bn: '🇧🇩', fa: '🇮🇷', el: '🇬🇷', lt: '🇱🇹',
  lv: '🇱🇻', et: '🇪🇪', sl: '🇸🇮', sr: '🇷🇸', ga: '🇮🇪',
};

export default function LanguageSelector() {
  const { language, setLanguage, availableLanguages } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const current = availableLanguages.find(l => l.code === language) || { code: 'en', name: 'English' };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Select language"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current.name}
        style={{
          background: 'none',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '0.25rem 0.45rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: '0.8rem',
          color: 'var(--app-text)',
          lineHeight: 1,
        }}
      >
        <GlobeIcon />
        <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {current.code}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Language options"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md, 6px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            minWidth: '180px',
            maxHeight: '320px',
            overflowY: 'auto',
            zIndex: 9999,
            padding: '0.25rem 0',
          }}
        >
          {availableLanguages.map(lang => (
            <button
              key={lang.code}
              role="option"
              aria-selected={lang.code === language}
              onClick={() => { setLanguage(lang.code); setOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                width: '100%',
                padding: '0.45rem 0.75rem',
                background: lang.code === language ? 'var(--color-primary-alpha, rgba(249,115,22,0.12))' : 'none',
                border: 'none',
                cursor: 'pointer',
                color: lang.code === language ? 'var(--color-primary, #f97316)' : 'var(--app-text)',
                fontWeight: lang.code === language ? 600 : 400,
                fontSize: '0.875rem',
                textAlign: 'left',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => {
                if (lang.code !== language)
                  e.currentTarget.style.background = 'var(--color-hover-bg, rgba(255,255,255,0.06))';
              }}
              onMouseLeave={e => {
                if (lang.code !== language) e.currentTarget.style.background = 'none';
              }}
            >
              <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{FLAGS[lang.code] || '🌐'}</span>
              <span>{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
