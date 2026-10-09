// client/src/pages/VerifyIdentityPage.tsx
// Standalone identity-verification gate.
// Shown when a logged-in user has not completed Didit (didit_status !== 'verified'/'skipped').
// Also handles the case where Didit is not configured (verification_unavailable error).

import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CreditCard, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DiditPanel } from '../components/registration';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import './VerifyIdentityPage.css';

export default function VerifyIdentityPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { t } = useTranslation();

  // After Didit webhook fires and status is 'verified', or after a skip, go to the
  // appropriate dashboard.
  const requestedReturn = searchParams.get('returnTo');
  const returnTo = requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//')
    ? requestedReturn
    : null;
  const destination = returnTo || (user && ['helper', 'helper_pro', 'broker'].includes(user?.role ?? '')
    ? '/helper-dashboard'
    : '/dashboard');
  const Content = embedded ? 'section' : 'main';
  // The provider returns to the existing standalone callback URL. Keep the
  // originating Media journey in this tab, scoped to this account and one hour.
  useEffect(() => {
    if (!user?.id) return;
    try {
      if (embedded) {
        sessionStorage.setItem('oxsteed.media.didit.return', JSON.stringify({
          userId: String(user.id), returnTo: destination, createdAt: Date.now(),
        }));
      } else {
        const stored = JSON.parse(sessionStorage.getItem('oxsteed.media.didit.return') || 'null');
        if (stored?.userId === String(user.id) && Date.now() - stored.createdAt < 60 * 60 * 1000
          && typeof stored.returnTo === 'string' && stored.returnTo.startsWith('/media/')) {
          navigate(`/media/verify-identity?returnTo=${encodeURIComponent(stored.returnTo)}`, { replace: true });
        }
      }
    } catch { /* Storage may be disabled; the explicit return query still works. */ }
  }, [embedded, user?.id, destination, navigate]);

  const finish = (replace = false) => {
    try { sessionStorage.removeItem('oxsteed.media.didit.return'); } catch { /* optional storage */ }
    navigate(destination, { replace });
  };

  return (
    <div className={`verify-identity-page${embedded ? ' media-identity-embedded' : ''}`}>
      <PageMeta
        title={t('verifyIdentity.metaTitle')}
        description={t('verifyIdentity.metaDescription')}
        noIndex
      />

      {!embedded && <nav className="verify-identity-nav">
        <div className="verify-identity-nav-inner">
          <Link to="/" className="verify-identity-brand">OxSteed</Link>
          <div className="verify-identity-nav-badge">
            <Lock size={15} aria-hidden="true" />
            {t('verifyIdentity.secureBadge')}
          </div>
        </div>
      </nav>}

      <Content className="verify-identity-main">
        <section className="verify-identity-hero" aria-labelledby="verify-identity-title">
          <div className="verify-identity-copy">
            <div className="verify-identity-eyebrow">
              <ShieldCheck size={16} aria-hidden="true" />
              {t('verifyIdentity.eyebrow')}
            </div>
            <h1 id="verify-identity-title">{t('verifyIdentity.heroTitle')}</h1>
            <p>{t('verifyIdentity.heroDescription')}</p>

            <div className="verify-identity-benefits" aria-label={t('verifyIdentity.benefitsAriaLabel')}>
              <div>
                <UserCheck size={20} aria-hidden="true" />
                <strong>{t('verifyIdentity.benefitTrustTitle')}</strong>
                <span>{t('verifyIdentity.benefitTrustDescription')}</span>
              </div>
              <div>
                <CreditCard size={20} aria-hidden="true" />
                <strong>{t('verifyIdentity.benefitPaymentsTitle')}</strong>
                <span>{t('verifyIdentity.benefitPaymentsDescription')}</span>
              </div>
              <div>
                <CheckCircle2 size={20} aria-hidden="true" />
                <strong>{t('verifyIdentity.benefitApprovalsTitle')}</strong>
                <span>{t('verifyIdentity.benefitApprovalsDescription')}</span>
              </div>
            </div>
          </div>

          <div className="verify-identity-card" aria-label={t('verifyIdentity.formAriaLabel')}>
            <div className="verify-identity-stepper">
              <div>
                <span>1</span>
                {t('verifyIdentity.step1').replace('1. ', '')}
              </div>
              <div className="is-active">
                <span>2</span>
                {t('verifyIdentity.step2').replace('2. ', '')}
              </div>
            </div>

            <DiditPanel
              onVerified={() => finish(true)}
              // No previous step - the user is already registered; send them to dashboard.
              onBack={() => finish()}
            />
          </div>
        </section>
      </Content>

      {!embedded && <Footer />}
    </div>
  );
}
