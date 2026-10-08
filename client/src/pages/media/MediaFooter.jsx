import React from 'react';
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

export default function MediaFooter() {
  const { t } = useTranslation();
  const { openSettings } = useCookieConsentContext();

  return (
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
          <Link key={path} to={path}>{t(`footer.${key}`)}</Link>
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
  );
}
