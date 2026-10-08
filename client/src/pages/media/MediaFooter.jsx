import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCookieConsentContext } from '../../context/CookieConsentContext';
import OxSteedIcon from '../../components/OxSteedIcon';

const LEGAL_LINKS = [
  ['terms', '/terms'],
  ['privacy', '/privacy'],
  ['security', '/security'],
  ['cookiePolicy', '/cookie-policy'],
  ['doNotSell', '/do-not-sell'],
  ['accessibility', '/accessibility'],
];

const LEGAL_PAGES = {
  '/terms': lazy(() => import('../terms')),
  '/privacy': lazy(() => import('../privacy')),
  '/security': lazy(() => import('../security')),
  '/cookie-policy': lazy(() => import('../cookiepolicy')),
  '/do-not-sell': lazy(() => import('../donotsell')),
  '/accessibility': lazy(() => import('../accessibility')),
};

export default function MediaFooter() {
  const { t } = useTranslation();
  const { openSettings } = useCookieConsentContext();
  const [openLegal, setOpenLegal] = useState(null);
  const closeButtonRef = useRef(null);
  const LegalPage = openLegal ? LEGAL_PAGES[openLegal] : null;

  useEffect(() => {
    if (!openLegal) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenLegal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openLegal]);

  const openLegalPage = (event, path) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpenLegal(path);
  };

  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) setOpenLegal(null);
  };

  return (
    <>
      <footer className="media-footer-card">
        <div className="media-footer-brand">
          <Link to="/" className="media-footer-wordmark" aria-label="OxSteed">
            <OxSteedIcon size={30} />
            <span>OxSteed</span>
          </Link>
          <span className="media-footer-branch">Media</span>
        </div>
        <nav className="media-footer-links" aria-label={t('footer.legal')}>
          {LEGAL_LINKS.map(([key, path]) => (
            <a key={path} href={path} onClick={(event) => openLegalPage(event, path)}>{t(`footer.${key}`)}</a>
          ))}
          <button type="button" onClick={openSettings}>{t('footer.manageCookies')}</button>
        </nav>
        <div className="media-footer-bottom">
          <span>© {new Date().getFullYear()} OxSteed LLC</span>
          <span className="media-footer-contact">
            <a href="mailto:support@oxsteed.com">support@oxsteed.com</a>
            <span aria-hidden="true">·</span>
            <a href="tel:+19374085169">+1 (937) 408-5169</a>
          </span>
        </div>
      </footer>
      {LegalPage && (
        <div className="media-legal-overlay" role="presentation" onMouseDown={closeOnBackdrop}>
          <section className="media-legal-dialog" role="dialog" aria-modal="true" aria-labelledby="media-legal-title">
            <header className="media-legal-dialog-header">
              <div>
                <span className="media-legal-dialog-kicker">{t('media.feed.title')}</span>
                <h2 id="media-legal-title">{t(`footer.${LEGAL_LINKS.find(([, path]) => path === openLegal)?.[0]}`)}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="media-legal-close"
                onClick={() => setOpenLegal(null)}
                aria-label={t('media.shell.close')}
              >
                ×
              </button>
            </header>
            <div className="media-legal-dialog-body">
              <Suspense fallback={<div className="media-legal-loading">{t('media.shell.loadingLegal')}</div>}>
                <LegalPage embedded />
              </Suspense>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
