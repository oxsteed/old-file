import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSelector({ menuAlign = 'end', appearance }) {
  const { language, setLanguage, preferredLanguage, setPreferredLanguage, availableLanguages } = useLanguage();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const menuId = useId();
  const searchId = useId();

  const current = availableLanguages.find(l => l.code === language) || availableLanguages[0];

  const normalizedQuery = query.trim().toLowerCase();
  const filteredLanguages = normalizedQuery
    ? availableLanguages.filter(l =>
        (l.nativeName || '').toLowerCase().includes(normalizedQuery) ||
        (l.name || '').toLowerCase().includes(normalizedQuery) ||
        (l.code || '').toLowerCase().includes(normalizedQuery))
    : availableLanguages;

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
        onClick={() => { setQuery(''); setOpen(o => !o); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('languageSelector.currentLanguage', { language: current.nativeName || current.name })}
        title={current.nativeName || current.name}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          minHeight: '44px',
          background: 'none',
          border: appearance === 'media' ? 'none' : '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '0.25rem 0.5rem',
          cursor: 'pointer',
          color: 'var(--color-text)',
          fontSize: appearance === 'media' ? '1rem' : '0.8rem',
          fontWeight: 600,
        }}
      >
        {appearance === 'media' ? <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg> : <span style={{ fontSize: '1rem' }}>{current.flag}</span>}
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
            position: 'absolute', top: 'calc(100% + 6px)',
            insetInlineStart: menuAlign === 'start' ? 0 : 'auto',
            insetInlineEnd: menuAlign === 'start' ? 'auto' : 0,
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            minWidth: '150px',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.5rem 0.6rem 0.25rem' }}>
            <label htmlFor={searchId} style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {t('languageSelector.searchLanguages')}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('languageSelector.searchLanguages')}
              autoComplete="off"
              style={{
                width: '100%',
                padding: '0.5rem 0.65rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                background: 'var(--color-input-bg, transparent)',
                color: 'var(--color-text)',
                outline: 'none',
              }}
            />
          </div>
          <div
            role="presentation"
            style={{
              maxHeight: 'min(490px, 70vh)',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
            }}
          >
          {filteredLanguages.map(lang => {
            const isPreferred = lang.code === preferredLanguage;
            return (
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
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem', flex: 1 }}>
                <span>{lang.nativeName || lang.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, var(--color-text-secondary, #6b7280))', fontWeight: 500 }}>
                  {lang.name}
                  {isPreferred ? (
                    <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                      {' '}· {t('languageSelector.preferred')}
                    </span>
                  ) : null}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={t('languageSelector.setPreferred', { language: lang.nativeName || lang.name })}
                title={t('languageSelector.setPreferred', { language: lang.nativeName || lang.name })}
                onClick={(e) => { e.stopPropagation(); setPreferredLanguage(lang.code); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setPreferredLanguage(lang.code); } }}
                style={{ display: 'flex', alignItems: 'center', padding: '0.25rem', cursor: 'pointer' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24"
                  fill={isPreferred ? 'var(--color-primary)' : 'none'}
                  stroke={isPreferred ? 'var(--color-primary)' : 'currentColor'}
                  strokeWidth="1.8" strokeLinejoin="round"
                  style={{ opacity: isPreferred ? 1 : 0.45 }}>
                  <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
                </svg>
              </span>
            </button>
            );
          })}
          {filteredLanguages.length === 0 && (
            <div style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--color-text-muted, var(--color-text-secondary, #6b7280))', textAlign: 'center' }}>
              {t('languageSelector.noResults')}
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
