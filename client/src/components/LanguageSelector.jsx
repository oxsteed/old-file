import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSelector() {
  const { language, setLanguage, availableLanguages } = useLanguage();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = 'language-selector-menu';

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
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('languageSelector.currentLanguage', { language: current.nativeName || current.name })}
        title={current.nativeName || current.name}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          minHeight: '44px',
          background: 'none',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '0.25rem 0.5rem',
          cursor: 'pointer',
          color: 'var(--color-text)',
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
          id={menuId}
          role="listbox"
          aria-label={t('languageSelector.languageMenu')}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', insetInlineEnd: 0,
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            minWidth: '150px',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {availableLanguages.map(lang => (
            <button
              type="button"
              key={lang.code}
              role="option"
              aria-selected={lang.code === language}
              aria-label={t('languageSelector.chooseLanguage', { language: lang.nativeName || lang.name })}
              onClick={() => { setLanguage(lang.code); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                width: '100%', minHeight: '44px', padding: '0.6rem 0.85rem',
                background: lang.code === language ? 'rgba(249,115,22,0.12)' : 'transparent',
                border: 'none', cursor: 'pointer',
                color: lang.code === language ? 'var(--color-primary)' : 'var(--color-text)',
                fontWeight: lang.code === language ? 700 : 400,
                fontSize: '0.875rem', textAlign: 'start',
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{lang.flag}</span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem' }}>
                <span>{lang.nativeName || lang.name}</span>
                {(lang.nativeName && lang.nativeName !== lang.name) ? (
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, var(--color-text-secondary, #6b7280))', fontWeight: 500 }}>
                    {lang.name}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
