import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import PrefetchLink from './PrefetchLink';
import { useAuth } from '../context/AuthContext';
import { redeemVortexToken } from '../api/businesses';
import { useCookieConsentContext } from '../context/CookieConsentContext';
import { useTranslation } from 'react-i18next';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';
import { canUseQrGenerator } from '../utils/modeAccess';
import './Footer.css';

const SHOW_FOOTER_UTILITY_PILLS = LAUNCH_VISIBILITY.footerUtilityPills;
const OXSTEED_MAIN_PHONE = '+1 (937) 408-5169';

export default function Footer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const year = new Date().getFullYear();
  const [vortexOpen, setVortexOpen] = useState(false);
  const [vortexPrefill, setVortexPrefill] = useState('');

  // After login, reopen Vortex with a token saved before sign-in.
  useEffect(() => {
    if (!user) return;
    try {
      const pending = sessionStorage.getItem('oxs:vortexToken');
      if (pending && /^[a-f0-9]{64}$/i.test(pending)) {
        sessionStorage.removeItem('oxs:vortexToken');
        setVortexPrefill(pending);
        setVortexOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, [user]);
  // Reads from the shared CookieConsentProvider - openSettings() here will
  // update the same showSettings state that <CookieConsent> is listening to.
  const { openSettings } = useCookieConsentContext();
  const { t } = useTranslation();
  const showQrGenerator = canUseQrGenerator(user);

  return (
    <>
    <footer className="site-footer">
      <div className="ox-container site-footer__inner">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <Link to="/" className="site-footer__brand-link">
              <svg className="site-footer__mark" width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
                <rect width="512" height="512" rx="88" fill="#16213e" />
                <path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316" />
                <path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316" />
                <path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316" />
                <path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316" />
                <circle cx="256" cy="256" r="145" fill="#F97316" />
                <text x="256" y="236" textAnchor="middle" dominantBaseline="middle" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="90" fill="#FFFFFF">OxS</text>
                <polyline points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              OxSteed
            </Link>
            <p className="site-footer__tagline">
              {t('footer.tagline')}
            </p>
            <p className="site-footer__subtagline">
              {t('footer.subtagline')}
            </p>
          </div>

          <div className="site-footer__link-grid">
            <div className="site-footer__group">
              <span className="site-footer__heading">
                {t('footer.company')}
              </span>
              <FooterLink to="/how-it-works">{t('footer.howOxsteedWorks')}</FooterLink>
              <FooterLink to="/about">{t('footer.about')}</FooterLink>
              <FooterLink to="/careers">{t('footer.careers')}</FooterLink>
            </div>
            <div className="site-footer__group">
              <span className="site-footer__heading">
                {t('footer.platform')}
              </span>
              <FooterLink to="/direct">{t('footer.direct')}</FooterLink>
              <FooterLink to="/delivery">{t('footer.delivery')}</FooterLink>
              <FooterLink to="/consulting-intake">{t('footer.consultingIntake')}</FooterLink>
              <span className="site-footer__heading site-footer__heading--nested">
                {t('footer.resource')}
              </span>
              <FooterLink to="/learn">{t('nav.learnToDiy')}</FooterLink>
              {showQrGenerator && (
                <FooterLink to="/qr-generator">{t('footer.qrGenerator')}</FooterLink>
              )}
            </div>
          </div>
        </div>

        <div className="site-footer__utility">
          <nav className="site-footer__legal-links" aria-label={t('footer.legal')}>
            <FooterLink to="/terms">{t('footer.terms')}</FooterLink>
            <FooterLink to="/privacy">{t('footer.privacy')}</FooterLink>
            <FooterLink to="/security">{t('footer.security')}</FooterLink>
            <FooterLink to="/cookie-policy">{t('footer.cookiePolicy')}</FooterLink>
            <FooterLink to="/do-not-sell">{t('footer.doNotSell')}</FooterLink>
            <FooterLink to="/accessibility">{t('footer.accessibility')}</FooterLink>
            <button
              onClick={openSettings}
              aria-label={t('footer.manageCookies')}
              className="site-footer__cookie-button"
            >
              {t('footer.manageCookies')}
            </button>
          </nav>

          {SHOW_FOOTER_UTILITY_PILLS && (
          <div className="site-footer__pills">
            <button
              type="button"
              onClick={() => navigate('/vortex')}
              className="site-footer__pill"
            >
              {t('footer.vortex')}
            </button>
            {user && (
              <Link
                to="/support/agent"
                className="site-footer__pill"
              >
                {t('nav.supportWorkspace')}
              </Link>
            )}
            <button
              type="button"
              onClick={() => navigate('/direct/request-quote')}
              className="site-footer__pill"
              title={t('footer.consultingTooltip')}
            >
              {t('footer.consulting')}
            </button>
          </div>
          )}
        </div>

        <div className="site-footer__bottom">
          <p className="site-footer__copyright">&copy; {year} OxSteed LLC</p>
          <p className="site-footer__contact">
            <a
              href="mailto:support@oxsteed.com"
              className="site-footer__contact-link"
            >
              support@oxsteed.com
            </a>
            <span className="site-footer__contact-separator" aria-hidden="true">/</span>
            <a
              href="tel:+19374085169"
              aria-label={t('footer.callOxSteed', { defaultValue: `Call OxSteed at ${OXSTEED_MAIN_PHONE}` })}
              className="site-footer__contact-link"
            >
              {OXSTEED_MAIN_PHONE}
            </a>
          </p>
        </div>
      </div>

    </footer>
    {/* Vortex redeem modal - portalled to body to avoid footer stacking context */}
    {vortexOpen && createPortal(
      <VortexModal
        initialToken={vortexPrefill}
        onClose={() => {
          setVortexOpen(false);
          setVortexPrefill('');
        }}
      />,
      document.body
    )}
    </>
  );
}

function FooterLink({ to, children }) {
  return <PrefetchLink className="site-footer__link" to={to}>{children}</PrefetchLink>;
}

function VortexModal({ onClose, initialToken = '' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [token, setToken]   = useState(initialToken);
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialToken) setToken(initialToken);
  }, [initialToken]);

  async function handleRedeem() {
    setError('');
    if (!user) {
      const raw = token.trim();
      if (raw.length === 64) {
        try {
          sessionStorage.setItem('oxs:vortexToken', raw);
        } catch {
          /* ignore */
        }
      }
      navigate(`/login?next=${encodeURIComponent('/')}`);
      return;
    }
    const raw = token.trim();
    if (raw.length !== 64) {
      setError(t('footer.vortexTokenError'));
      return;
    }
    setLoading(true);
    try {
      const result = await redeemVortexToken(raw);
      setSuccess(result);
    } catch (e) {
      setError(e?.response?.data?.error || t('footer.vortexRedeemFailed'));
    } finally {
      setLoading(false);
    }
  }

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1rem',
  };
  const boxStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '16px',
    padding: '2rem',
    width: '100%',
    maxWidth: '480px',
    color: 'var(--color-text)',
  };

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={boxStyle}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 700 }}>{t('footer.vortexTitle')}</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          {t('footer.vortexDesc')}
        </p>

        {!success ? (
          <>
            {!user && (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1rem', lineHeight: 1.5 }}>
                {t('footer.vortexSignInHint')}{' '}
                <Link to={`/login?next=${encodeURIComponent('/')}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                  {t('footer.vortexSignIn')}
                </Link>
              </p>
            )}
            <input
              type="text"
              placeholder={t('footer.vortexPlaceholder')}
              value={token}
              onChange={e => { setToken(e.target.value); setError(''); }}
              maxLength={64}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                letterSpacing: '0.04em',
                boxSizing: 'border-box',
                marginBottom: '0.5rem',
              }}
              autoComplete="off"
              spellCheck="false"
            />
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-faint)', margin: '0 0 1rem' }}>
              {t('footer.vortexChars', { count: token.length })}
            </p>

            {error && (
              <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}
              >
                {t('footer.vortexCancel')}
              </button>
              <button
                onClick={handleRedeem}
                disabled={loading || token.trim().length !== 64}
                style={{
                  background: loading ? 'var(--color-primary-light)' : 'var(--color-primary)',
                  border: 'none', borderRadius: '8px',
                  padding: '0.5rem 1.25rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  opacity: loading || token.trim().length !== 64 ? 0.7 : 1,
                }}
              >
                {loading
                  ? t('footer.vortexJoining')
                  : user
                    ? t('footer.vortexJoin')
                    : t('footer.vortexContinueToLogin')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
              <p style={{ fontWeight: 700, fontSize: '1.1rem', margin: '0 0 0.5rem' }}>
                {t('footer.vortexSuccess', { name: success.business_name })}
              </p>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>
                {t('footer.vortexRole', { role: success.role })}
              </p>
              <button
                onClick={onClose}
                style={{ background: 'var(--color-primary)', border: 'none', borderRadius: '8px', padding: '0.6rem 1.5rem', cursor: 'pointer', color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}
              >
                {t('footer.vortexContinue')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
