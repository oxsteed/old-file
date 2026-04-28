// client/src/pages/CustomerRegister.tsx
// 2-step registration: Account → Didit (optional) → Dashboard

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StepBar, AccountForm, DiditPanel } from '../components/registration';
import { useTranslation } from 'react-i18next';
import Footer from '../components/Footer';
import { useAuth } from '../context/AuthContext';

type Step = 1 | 2;

export default function CustomerRegister() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const { t } = useTranslation();

  // If the user is already registered + email-verified, skip step 1.
  // - Verified/skipped Didit → go straight to dashboard.
  // - Needs Didit → go to the standalone verification page (avoids showing the
  //   account form again for a user who's already in the DB).
  useEffect(() => {
    if (!user?.email_verified) return;
    if (user && ['verified', 'skipped'].includes(user?.didit_status ?? '')) {
      navigate('/dashboard', { replace: true });
    } else if (user) {
      navigate('/verify-identity', { replace: true });
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="text-sm text-gray-400 hover:text-white transition">{t('nav.howItWorks')}</Link>
            <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">{t('nav.signIn')}</Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-[480px] flex flex-col gap-8">

          <section className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Find Trusted Local Help</h1>
            <p className="text-orange-400 font-semibold text-lg">Post a job, compare bids, and hire with confidence.</p>
            <p className="text-gray-400 text-sm mt-2">Free for 90 days · No credit card required</p>
          </section>

          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
            <StepBar
              current={step}
              labels={[t('register.step1Label'), t('register.step2Label')]}
            />

            {step === 1 && (
              <div className="animate-fadeIn">
                <AccountForm
                  role="customer"
                  onSuccess={() => {
                    setStep(2);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>
            )}

            {step === 2 && (
              <div className="animate-fadeIn">
                <DiditPanel
                  onVerified={() => navigate('/dashboard', { replace: true })}
                  onBack={() => setStep(1)}
                />
              </div>
            )}

            <div className="text-center px-6 pb-5 text-xs text-gray-400">
              {t('auth.welcomeBack')}?{' '}
              <Link to="/login" className="text-orange-500 font-medium hover:underline">Sign in</Link>
            </div>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-900/20 border border-violet-700/40">
              <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-xs text-violet-300 font-medium">
                90-day Pro trial included — all features unlocked, no card needed
              </span>
            </div>
          </div>

        </div>
      </div>

      <Footer />
    </div>
  );
}
