// client/src/pages/HelperRegister.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

import Step1AccountSetup from '../components/helperRegister/Step1AccountSetup';
import Step2EmailVerification from '../components/helperRegister/Step2EmailVerification';
import Step3TheFork from '../components/helperRegister/Step3TheFork';
import Step4ProfileLocation from '../components/helperRegister/Step4ProfileLocation';
import Step5ChoosePlan from '../components/helperRegister/Step5ChoosePlan';
import Step6TaxInfo from '../components/helperRegister/Step6TaxInfo';
import Step7ReviewComplete from '../components/helperRegister/Step7ReviewComplete';

// ─── Onboarding step the server returns on the user payload ───
// The server sets user.onboarding_step to one of these values.
// 'active' means onboarding is complete.
type ServerOnboardingStep =
  | 'registered'       // account created, email not verified
  | 'email_verified'   // OTP passed → show the fork
  | 'profile_pending'  // chose "continue setup" but hasn't saved profile yet
  | 'profile_complete' // profile saved → choose plan
  | 'plan_selected'    // plan saved → tax (pro) or review (free)
  | 'tax_complete'     // W-9 saved → review
  | 'active';          // finalize called → fully onboarded

// Maps a server onboarding_step to the UI wizard step number
function serverStepToUIStep(
  onboardingStep: ServerOnboardingStep | string | undefined | null,
  tier?: string | null,
): number {
  switch (onboardingStep) {
    case 'registered':       return 1; // shouldn't happen if they're here with a session
    case 'email_verified':   return 3; // fork
    case 'profile_pending':  return 4;
    case 'profile_complete': return 5;
    case 'plan_selected':
      // If free plan, skip tax → go to review
      return tier === 'free' ? 7 : 6;
    case 'tax_complete':     return 7;
    case 'active':           return -1; // done — redirect to dashboard
    default:                 return 1;
  }
}

// Check completion from ANY of the three server flags AuthContext already normalizes
function isComplete(user: any): boolean {
  return (
    user?.onboarding_step === 'active' ||
    user?.onboarding_completed === true ||
    user?.onboarding_status === 'onboarding_complete'
  );
}

const STEPS = [
  { label: 'Account', icon: '1' },
  { label: 'Verify',  icon: '2' },
  { label: 'Profile', icon: '3' },
  { label: 'Plan',    icon: '4' },
  { label: 'Tax',     icon: '5' },
  { label: 'Review',  icon: '6' },
];

export default function HelperRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    user,
    loading: authLoading,
    isAuthenticated,
    isOnboardingComplete,
    refreshUser,
  } = useAuth();

  // ─── Local wizard state ───
  const [step, setStep] = useState<number>(0); // 0 = not yet determined
  const [registrationToken, setRegistrationToken] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [rehydrated, setRehydrated] = useState(false);
  const mountRef = useRef(false);

  const [formData, setFormData] = useState<{
    firstName: string; lastName: string; email: string;
    phone: string; zip: string; city: string; state: string;
    bio: string; skills: string[]; photoUrl: string;
    taxType: string; taxId: string; legalName: string;
    mailingAddress: { street: string; city: string; state: string; zip: string };
  }>({
    firstName: '', lastName: '', email: '',
    phone: '', zip: '', city: '', state: '',
    bio: '', skills: [], photoUrl: '',
    taxType: '', taxId: '', legalName: '',
    mailingAddress: { street: '', city: '', state: '', zip: '' },
  });

  const updateFormData = (data: Partial<typeof formData>) =>
    setFormData(prev => ({ ...prev, ...data }));

  // ─── Rehydration: single source of truth is the server user payload ───
  // Runs on mount and whenever `user` changes (login, refresh, token rotation).
  const rehydrateFromUser = useCallback(
    (u: any) => {
      if (!u) return;

      // If the helper is fully active, send them to the dashboard immediately.
      if (isComplete(u)) {
        navigate('/helper-dashboard', { replace: true });
        return;
      }

      // Populate formData from the server payload so we never lose progress
      updateFormData({
        firstName: u.first_name || u.firstName || '',
        lastName: u.last_name || u.lastName || '',
        email: u.email || '',
        phone: u.phone || '',
        zip: u.zip || '',
        city: u.city || '',
        state: u.state || '',
        bio: u.bio || '',
        skills: u.skills || u.service_categories || [],
        photoUrl: u.photo_url || u.photoUrl || '',
      });

      if (u.membership_tier) setSelectedTier(u.membership_tier);

      // Resolve the correct wizard step from server truth
      const resolved = serverStepToUIStep(
        u.onboarding_step,
        u.membership_tier,
      );

      if (resolved === -1) {
        navigate('/helper-dashboard', { replace: true });
        return;
      }

      setStep(resolved);
      setRehydrated(true);
    },
    [navigate],
  );

  // On mount: wait for AuthProvider to finish loading, then decide
  useEffect(() => {
    if (authLoading) return; // still loading
    if (mountRef.current) return; // already ran
    mountRef.current = true;

    // Handle Stripe return redirect
    const sessionId = searchParams.get('session_id');
    const stepParam = searchParams.get('step');

    if (isAuthenticated && user) {
      // Existing session → rehydrate from server
      refreshUser()
        .then((freshUser: any) => rehydrateFromUser(freshUser))
        .catch(() => rehydrateFromUser(user)); // fallback to cached
    } else if (sessionId && stepParam) {
      // Stripe callback — user should be authenticated via cookie/token already
      setStep(Number(stepParam));
      setRehydrated(true);
    } else {
      // Brand-new visitor — start at step 1
      setStep(1);
      setRehydrated(true);
    }
  }, [authLoading, isAuthenticated, user, searchParams, refreshUser, rehydrateFromUser]);

  // Whenever user object updates (e.g., after token refresh in auth interceptor),
  // re-check if onboarding completed in the background
  useEffect(() => {
    if (!rehydrated || !user) return;
    if (isComplete(user)) {
      navigate('/helper-dashboard', { replace: true });
    }
  }, [user, rehydrated, navigate]);

  // ─── After finalize completes, refresh user to get 'active' status ───
  const handleOnboardingComplete = useCallback(async () => {
    try {
      const freshUser = await refreshUser();
      if (isComplete(freshUser)) {
        navigate('/helper-dashboard', { state: { message: 'Welcome to OxSteed!' } });
      }
    } catch {
      // Even if refresh fails, navigate — the server already finalized
      navigate('/helper-dashboard', { state: { message: 'Welcome to OxSteed!' } });
    }
  }, [refreshUser, navigate]);

  // ─── "Finish Later" handler ───
  // Navigates to the helper dashboard in restricted mode.
  // The HelperDashboard + ProtectedRoute must check needsOnboarding
  // and restrict bidding / payouts / public visibility accordingly.
  const handleFinishLater = useCallback(() => {
    navigate('/helper-dashboard');
  }, [navigate]);

  // ─── Visible steps (progress bar) ───
  const isFree = selectedTier === 'free';
  const getVisibleSteps = (): number[] => {
    if (isFree) return [1, 2, 4, 5, 7];
    return [1, 2, 4, 5, 6, 7];
  };
  const visibleSteps = getVisibleSteps();
  const currentIndex = visibleSteps.indexOf(step);

  // ─── Step renderer ───
  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1AccountSetup
            onSuccess={(token: string, data: { firstName: string; lastName: string; email: string }) => {
              setRegistrationToken(token);
              updateFormData(data);
              setStep(2);
            }}
          />
        );

      case 2:
        return (
          <Step2EmailVerification
            token={registrationToken}
            email={formData.email}
            firstName={formData.firstName}
            onSuccess={async () => {
              // After OTP verify, we already have tokens in localStorage.
              // Refresh user from server to get the real onboarding_step.
              try {
                const freshUser = await refreshUser();
                rehydrateFromUser(freshUser);
              } catch {
                // Fallback: just show the fork
                setStep(3);
              }
            }}
          />
        );

      case 3:
        return (
          <Step3TheFork
            onContinue={() => setStep(4)}
            onFinishLater={handleFinishLater}
          />
        );

      case 4:
        return (
          <Step4ProfileLocation
            token={registrationToken}
            onBack={() => setStep(3)}
            onSuccess={(data) => {
              updateFormData(data);
              setStep(5);
            }}
          />
        );

      case 5:
        return (
          <Step5ChoosePlan
            token={registrationToken}
            onBack={() => setStep(4)}
            onSuccess={(tier: string) => {
              setSelectedTier(tier);
              setStep(tier === 'free' ? 7 : 6);
            }}
          />
        );

      case 6:
        return (
          <Step6TaxInfo
            token={registrationToken}
            onBack={() => setStep(5)}
            onSuccess={(data) => {
              updateFormData(data);
              setStep(7);
            }}
          />
        );

      case 7:
        return (
          <Step7ReviewComplete
            token={registrationToken}
            formData={formData}
            selectedTier={selectedTier}
            onEdit={(targetStep: number) => setStep(targetStep)}
            onSuccess={handleOnboardingComplete}
          />
        );

      default:
        return null;
    }
  };

  // ─── Loading state ───
  if (authLoading || step === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  const showProgressBar = step !== 3;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800" role="navigation" aria-label="Main navigation">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="text-sm text-gray-400 hover:text-white transition">How It Works</Link>
            <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">Sign In</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Hero */}
        <section className="text-center mb-8 px-4">
          <h1 className="text-3xl font-bold text-white mb-2">
            Start Earning in Your Neighborhood
          </h1>
          <p className="text-orange-400 font-semibold text-lg">
            Set your own rates. Get found by neighbors. Earn on your schedule.
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Takes about 5 minutes · Free to join · Upgrade to Pro anytime
          </p>
        </section>

        {/* Progress bar */}
        {showProgressBar && currentIndex >= 0 && (
          <>
            <div
              className="flex items-center gap-1 mb-1"
              role="progressbar"
              aria-valuenow={currentIndex + 1}
              aria-valuemin={1}
              aria-valuemax={visibleSteps.length}
            >
              {visibleSteps.map((s, i) => {
                const stepMeta = STEPS[s <= 2 ? s - 1 : s - 2];
                return (
                  <React.Fragment key={s}>
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          i < currentIndex
                            ? 'bg-green-500 text-white'
                            : s === step
                            ? 'bg-orange-500 text-white'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                        aria-label={`Step ${i + 1}: ${stepMeta?.label || ''}`}
                      >
                        {i < currentIndex ? '\u2713' : String(i + 1
