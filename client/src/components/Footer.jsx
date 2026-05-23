import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { redeemVortexToken } from '../api/businesses';
import { useCookieConsentContext } from '../context/CookieConsentContext';
import { useTranslation } from 'react-i18next';
import { routeForMode } from '../utils/modeRouter';

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
  const dashboardPath = routeForMode(currentMode);
  const isHelper = helperRoles.has(user?.role);

  const footerSectionTitleStyle = {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '0.95rem',
  };

  const actionPillStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    textDecoration: 'none',
    background: 'rgba(249,115,22,0.08)',
    border: '1px solid rgba(249,115,22,0.28)',
    borderRadius: '999px',
    padding: '0.42rem 0.85rem',
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--color-primary)',
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
        color: 'var(--color-text-muted)',
        padding: 'var(--space-10) 0 var(--space-8)',
      }}
    >
      <div className="ox-container">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-8)',
          marginBottom: 'var(--space-8)',
          paddingBottom: 'var(--space-8)',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{
            border: '1px solid var(--color-border)',
            borderRadius: '1.25rem',
            padding: '1.35rem',
            background: 'linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(30,41,59,0.96) 55%, rgba(249,115,22,0.16) 100%)',
            boxShadow: '0 18px 40px rgba(2,6,23,0.16)',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.55rem',
              padding: '0.3rem 0.7rem',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#f8fafc',
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '1rem',
            }}>
              <span>OxSteed network</span>
            </div>

            <Link
              to="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                textDecoration: 'none',
                fontSize: '1.9rem',
                fontWeight: 800,
                color: '#fff',
                marginBottom: '0.85rem',
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
            <p style={{ fontSize: '0.97rem', color: 'rgba(226,232,240,0.82)', maxWidth: '34ch', lineHeight: 1.7, margin: '0 0 1.1rem' }}>
              {t('footer.tagline')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
              <Link to={dashboardPath} style={actionPillStyle}>{t('nav.dashboard')}</Link>
              <Link to="/logistics" style={actionPillStyle}>{t('logistics.nav.entry', 'OxSteed Logistics')}</Link>
              <Link to="/how-it-works" style={actionPillStyle}>{t('footer.howOxsteedWorks')}</Link>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 'var(--space-6)',
            alignContent: 'start',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <span style={footerSectionTitleStyle}>
                Platform
              </span>
              {user ? (
                <FooterLink to={dashboardPath}>{t('nav.dashboard')}</FooterLink>
              ) : (
                <FooterLink to="/login">{t('nav.signIn')}</FooterLink>
              )}
              <FooterLink to="/jobs">{t('footer.browseJobs')}</FooterLink>
              <FooterLink to={user?.role === 'customer' ? '/post-job' : '/register/customer'}>{t('footer.postJob')}</FooterLink>
              <FooterLink to={isHelper ? dashboardPath : '/register/helper'}>{t('footer.listSkills')}</FooterLink>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <span style={footerSectionTitleStyle}>
                Company
              </span>
              <FooterLink to="/how-it-works">{t('footer.howOxsteedWorks')}</FooterLink>
              <FooterLink to="/about">{t('footer.about')}</FooterLink>
              <FooterLink to="/helpers">{t('footer.findHelpers')}</FooterLink>
              <FooterLink to="/products">{t('footer.browseProducts')}</FooterLink>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <span style={footerSectionTitleStyle}>
                Access
              </span>
              <FooterLink to="/tool-rentals">{t('toolRentals.browsePage')}</FooterLink>
              <FooterLink to="/settings">{t('nav.settings')}</FooterLink>
              <FooterLink to="/consulting-intake">{t('footer.consulting')}</FooterLink>
              {user && <FooterLink to="/support/agent">{t('nav.supportWorkspace')}</FooterLink>}
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
          padding: '1rem 1.1rem',
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
              aria-label="Manage cookie preferences"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: '0.78rem',
                color: 'var(--color-text-faint)',
                cursor: 'pointer',
                transition: 'color var(--transition-fast)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-faint)')}
            >
              Manage Cookies
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={() => navigate('/vortex')}
              style={actionPillStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(249,115,22,0.14)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(249,115,22,0.08)'}
            >
              {t('footer.vortex')}
            </button>
            {user && (
              <Link
                to="/support/agent"
                style={actionPillStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(249,115,22,0.14)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(249,115,22,0.08)';
                }}
              >
                {t('nav.supportWorkspace')}
              </Link>
            )}
            <button
              type="button"
              onClick={() => navigate('/consulting-intake')}
              style={actionPillStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(249,115,22,0.14)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(249,115,22,0.08)'}
              title={t('footer.consultingTooltip')}
            >
              {t('footer.consulting')}
            </button>
          </div>
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
          color: 'var(--color-text-faint)',
        }}>
          <p>&copy; {year} OxSteed LLC</p>
          <p>
            <a
              href="mailto:support@oxsteed.com"
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              support@oxsteed.com
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
        fontSize: '0.96rem',
        color: 'var(--color-text-muted)',
        textDecoration: 'none',
        transition: 'color var(--transition-fast), transform var(--transition-fast)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = 'var(--color-text)';
        e.currentTarget.style.transform = 'translateX(2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--color-text-muted)';
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
        fontSize: '0.78rem',
        color: 'var(--color-text-faint)',
        textDecoration: 'none',
        transition: 'color var(--transition-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
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
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
