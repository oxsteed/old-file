import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { redeemVortexToken } from '../api/businesses';
import { useCookieConsentContext } from '../context/CookieConsentContext';
import { useTranslation } from 'react-i18next';
import { routeForMode } from '../utils/modeRouter';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

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
  const helperRoles = new Set(['helper', 'helper_pro', 'broker']);
  const currentMode = user?.default_mode || (helperRoles.has(user?.role) ? 'helper' : 'customer');
  const isHelper = helperRoles.has(user?.role);

  const footerSectionTitleStyle = {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '0.95rem',
  };

  const utilityPillStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    textDecoration: 'none',
    background: 'rgba(148,163,184,0.08)',
    border: '1px solid var(--color-border)',
    borderRadius: '999px',
    padding: '0.4rem 0.8rem',
    fontSize: '0.76rem',
    fontWeight: 600,
    color: 'var(--color-text)',
    cursor: 'pointer',
    letterSpacing: '0.02em',
    transition: 'background var(--transition-fast), transform var(--transition-fast)',
  };

  return (
    <>
    <footer
      style={{
        borderTop: '1px solid var(--color-border)',
        background: 'linear-gradient(180deg, var(--color-bg) 0%, var(--color-surface) 18%, var(--color-surface) 100%)',
        color: 'var(--color-text)',
        padding: 'var(--space-10) 0 var(--space-8)',
      }}
    >
      <div className="ox-container">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          alignItems: 'start',
          gap: 'var(--space-8)',
          marginBottom: 'var(--space-8)',
          paddingBottom: 'var(--space-8)',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{
            border: '1px solid var(--color-border)',
            borderRadius: '1.25rem',
            padding: '1.1rem 1.15rem',
            background: 'linear-gradient(180deg, rgba(148,163,184,0.04) 0%, rgba(148,163,184,0.02) 100%)',
            maxWidth: '32rem',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.55rem',
              padding: '0.3rem 0.7rem',
              borderRadius: '999px',
              background: 'rgba(249,115,22,0.08)',
              border: '1px solid rgba(249,115,22,0.22)',
              color: 'var(--color-primary)',
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '1rem',
            }}>
              <span>{t('footer.networkTagline')}</span>
            </div>

            <Link
              to="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                textDecoration: 'none',
                fontSize: '1.55rem',
                fontWeight: 800,
                color: 'var(--color-text)',
                marginBottom: '0.7rem',
              }}
            >
              <svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
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
            <p style={{ fontSize: '0.94rem', color: 'var(--color-text)', maxWidth: '34ch', lineHeight: 1.7, margin: '0 0 1rem' }}>
              {t('footer.tagline')}
            </p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text)', lineHeight: 1.6 }}>
              {t('footer.subtagline')}
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 'var(--space-6)',
            alignContent: 'start',
          }}>
            <div style={{ display: 'none', flexDirection: 'column', gap: '0.7rem' }}>
              <span style={footerSectionTitleStyle}>
                {t('footer.company')}
              </span>
              <FooterLink to="/how-it-works">{t('footer.howOxsteedWorks')}</FooterLink>
              <FooterLink to="/about">{t('footer.about')}</FooterLink>
            </div>
            <div style={{ display: 'none', flexDirection: 'column', gap: '0.7rem' }}>
              <span style={footerSectionTitleStyle}>
                {t('footer.legal')}
              </span>
              <FooterLink to="/legal/background-check">{t('footer.backgroundCheck')}</FooterLink>
              <FooterLink to="/legal/arbitration">{t('footer.arbitration')}</FooterLink>
              <FooterLink to="/legal/escrow-policy">{t('footer.escrowPolicy')}</FooterLink>
              <FooterLink to="/legal/account-termination">{t('footer.accountTermination')}</FooterLink>
              <FooterLink to="/legal/dispute-resolution">{t('footer.disputeResolution')}</FooterLink>
              <FooterLink to="/legal/independent-contractor">{t('footer.independentContractor')}</FooterLink>
            </div>
            <div style={{ display: 'none', flexDirection: 'column', gap: '0.7rem' }}>
              <span style={footerSectionTitleStyle}>
                {t('footer.platform')}
              </span>
              {user ? (
                <FooterLink to={routeForMode(currentMode)}>{t('nav.dashboard')}</FooterLink>
              ) : (
                <FooterLink to="/login">{t('nav.signIn')}</FooterLink>
              )}
              <FooterLink to="/jobs">{t('footer.browseJobs')}</FooterLink>
              <FooterLink to={user?.role === 'customer' ? '/post-job' : '/register/customer'}>{t('footer.postJob')}</FooterLink>
              <FooterLink to={isHelper ? routeForMode(currentMode) : '/register/helper'}>{t('footer.listSkills')}</FooterLink>
              <FooterLink to="/helpers">{t('footer.findHelpers')}</FooterLink>
              <FooterLink to="/products">{t('footer.browseProducts')}</FooterLink>
              {isHelper && (
                <>
                  <span style={{ ...footerSectionTitleStyle, marginTop: '0.6rem', marginBottom: '0.1rem' }}>
                    {t('footer.resource')}
                  </span>
                  <FooterLink to="/qr-generator">{t('footer.qrGenerator')}</FooterLink>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          alignItems: 'center',
          padding: '0.9rem 1rem',
          border: '1px solid var(--color-border)',
          borderRadius: '1rem',
          background: 'rgba(148,163,184,0.04)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center' }}>
            <LegalLink to="/terms">{t('footer.terms')}</LegalLink>
            <LegalLink to="/privacy">{t('footer.privacy')}</LegalLink>
            <LegalLink to="/security">{t('footer.security')}</LegalLink>
            <LegalLink to="/cookie-policy">{t('footer.cookiePolicy')}</LegalLink>
            <LegalLink to="/do-not-sell">{t('footer.doNotSell')}</LegalLink>
            <LegalLink to="/accessibility">{t('footer.accessibility')}</LegalLink>
            <button
              onClick={openSettings}
              aria-label={t('footer.manageCookies')}
              style={{
                background: 'none',
                border: 'none',
                minHeight: '40px',
                padding: '0.45rem 0',
                fontSize: '0.78rem',
                color: 'var(--color-text)',
                cursor: 'pointer',
                transition: 'color var(--transition-fast)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text)')}
            >
              {t('footer.manageCookies')}
            </button>
          </div>

          {SHOW_FOOTER_UTILITY_PILLS && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={() => navigate('/vortex')}
              style={utilityPillStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.14)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(148,163,184,0.08)'}
            >
              {t('footer.vortex')}
            </button>
            {user && (
              <Link
                to="/support/agent"
                style={utilityPillStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(148,163,184,0.14)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(148,163,184,0.08)';
                }}
              >
                {t('nav.supportWorkspace')}
              </Link>
            )}
            <button
              type="button"
              onClick={() => navigate('/direct/request-quote')}
              style={utilityPillStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.14)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(148,163,184,0.08)'}
              title={t('footer.consultingTooltip')}
            >
              {t('footer.consulting')}
            </button>
          </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-2)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text)',
        }}>
          <p>&copy; {year} OxSteed LLC</p>
          <p>
            <a
              href="mailto:support@oxsteed.com"
              style={{ display: 'inline-flex', minHeight: '40px', alignItems: 'center', color: 'var(--color-primary)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              support@oxsteed.com
            </a>
            <span aria-hidden="true">{' · '}</span>
            <a
              href="tel:+19374085169"
              aria-label={t('footer.callOxSteed', { defaultValue: `Call OxSteed at ${OXSTEED_MAIN_PHONE}` })}
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
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
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        minHeight: '40px',
        alignItems: 'center',
        fontSize: '0.96rem',
        color: 'var(--color-text)',
        textDecoration: 'none',
        transition: 'color var(--transition-fast), transform var(--transition-fast)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = 'var(--color-primary)';
        e.currentTarget.style.transform = 'translateX(2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--color-text)';
        e.currentTarget.style.transform = 'translateX(0)';
      }}
    >
      {children}
    </Link>
  );
}

function LegalLink({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        minHeight: '40px',
        alignItems: 'center',
        fontSize: '0.78rem',
        color: 'var(--color-text)',
        textDecoration: 'none',
        transition: 'color var(--transition-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text)'}
    >
      {children}
    </Link>
  );
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
