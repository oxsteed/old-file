// client/src/pages/VerifyIdentityPage.tsx
// Standalone identity-verification gate.
// Shown when a logged-in user has not completed Didit (didit_status !== 'verified'/'skipped').
// Also handles the case where Didit is not configured (verification_unavailable error).

import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CreditCard, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DiditPanel } from '../components/registration';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import './VerifyIdentityPage.css';

export default function VerifyIdentityPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();

  // After Didit webhook fires and status is 'verified', or after a skip, go to the
  // appropriate dashboard.
  const destination = user && ['helper', 'helper_pro', 'broker'].includes(user?.role ?? '')
    ? '/helper-dashboard'
    : '/dashboard';

  return (
    <div className="verify-identity-page">
      <PageMeta
        title={t('verifyIdentity.metaTitle')}
        description={t('verifyIdentity.metaDescription')}
        noIndex
      />

      <nav className="verify-identity-nav">
        <div className="verify-identity-nav-inner">
          <Link to="/" className="verify-identity-brand">OxSteed</Link>
          <div className="verify-identity-nav-badge">
            <Lock size={15} aria-hidden="true" />
            {t('verifyIdentity.secureBadge')}
          </div>
        </div>
      </nav>

      <main className="verify-identity-main">
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
              onVerified={() => navigate(destination, { replace: true })}
              // No previous step - the user is already registered; send them to dashboard.
              onBack={() => navigate(destination)}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
