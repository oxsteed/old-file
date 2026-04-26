// client/src/pages/VerifyIdentityPage.tsx
// Standalone identity-verification gate.
// Shown when a logged-in user has not completed Didit (didit_status !== 'verified'/'skipped').
// Also handles the case where Didit is not configured (verification_unavailable error).

import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { DiditPanel } from '../components/registration';
import Footer from '../components/Footer';

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
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-[480px]">
          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
            {/* Step indicator — always step 2 for this page */}
            <div className="flex border-b border-gray-800">
              <div className="flex-1 py-3 text-center text-xs font-semibold text-gray-500">
                {t('verifyIdentity.step1')}
              </div>
              <div className="flex-1 py-3 text-center text-xs font-semibold text-orange-400 border-b-2 border-orange-500">
                {t('verifyIdentity.step2')}
              </div>
            </div>

            <DiditPanel
              onVerified={() => navigate(destination, { replace: true })}
              // No previous step — the user is already registered; send them to dashboard.
              onBack={() => navigate(destination)}
            />
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
