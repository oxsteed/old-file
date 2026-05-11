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
        title="Verify your identity"
        description="Complete OxSteed identity verification to help protect customers, helpers, jobs, and payments."
        noIndex
      />

      <nav className="verify-identity-nav">
        <div className="verify-identity-nav-inner">
          <Link to="/" className="verify-identity-brand">OxSteed</Link>
          <div className="verify-identity-nav-badge">
            <Lock size={15} aria-hidden="true" />
            Secure verification
          </div>
        </div>
      </nav>

      <main className="verify-identity-main">
        <section className="verify-identity-hero" aria-labelledby="verify-identity-title">
          <div className="verify-identity-copy">
            <div className="verify-identity-eyebrow">
              <ShieldCheck size={16} aria-hidden="true" />
              Trust layer for real-world work
            </div>
            <h1 id="verify-identity-title">Verify once. Work, hire, and get paid with more confidence.</h1>
            <p>
              OxSteed connects people for jobs, bookings, payments, tool rentals, and business
              services. Identity verification helps every part of that system feel safer and more
              accountable.
            </p>

            <div className="verify-identity-benefits" aria-label="Why verification matters">
              <div>
                <UserCheck size={20} aria-hidden="true" />
                <strong>Better marketplace trust</strong>
                <span>Customers and helpers know there is a real person behind the account.</span>
              </div>
              <div>
                <CreditCard size={20} aria-hidden="true" />
                <strong>Safer payments</strong>
                <span>Invoices, deposits, and payouts have a stronger identity trail.</span>
              </div>
              <div>
                <CheckCircle2 size={20} aria-hidden="true" />
                <strong>Smoother approvals</strong>
                <span>Verified users are easier to match, book, review, and support.</span>
              </div>
            </div>
          </div>

          <div className="verify-identity-card" aria-label="Identity verification form">
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
