import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

import Step1AccountSetup from '../components/helperRegister/Step1AccountSetup';
import Step2EmailVerification from '../components/helperRegister/Step2EmailVerification';
import Step3TheFork from '../components/helperRegister/Step3TheFork';
import Step4ProfileLocation from '../components/helperRegister/Step4ProfileLocation';
import Step5ChoosePlan from '../components/helperRegister/Step5ChoosePlan';
import Step6TaxInfo from '../components/helperRegister/Step6TaxInfo';
import Step7ReviewComplete from '../components/helperRegister/Step7ReviewComplete';

type ServerOnboardingStep =
  | 'registered'
  | 'email_verified'
  | 'profile_pending'
  | 'profile_complete'
  | 'plan_selected'
  | 'tax_complete'
  | 'active';

type FormDataShape = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zip: string;
  city: string;
  state: string;
  bio: string;
  skills: string[];
  photoUrl: string;
  taxType: string;
  taxId: string;
  legalName: string;
  mailingAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
};

const INITIAL_FORM_DATA: FormDataShape = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  zip: '',
  city: '',
  state: '',
  bio: '',
  skills: [],
  photoUrl: '',
  taxType: '',
  taxId: '',
  legalName: '',
  mailingAddress: { street: '', city: '', state: '', zip: '' },
};

// Progress bar metadata (labels only — Tax is hidden for free-tier paths)
const STEP_META: Record<number, { label: string }> = {
  1: { label: 'Account' },
  2: { label: 'Verify' },
  4: { label: 'Profile' },
  5: { label: 'Plan' },
  6: { label: 'Tax' },
  7: { label: 'Review' },
};

function isComplete(user: any): boolean {
  return (
    user?.onboarding_step === 'active' ||
    user?.onboarding_completed === true ||
    user?.onboarding_status === 'onboarding_complete'
  );
}

function getMembershipTier(user: any): string {
  return user?.membership_tier || user?.membershipTier || user?.plan || '';
}

/**
 * Map the server's onboarding_step to the local wizard step number.
 *
 * Key fix: 'registered' → 1 (account setup), NOT 2.
 * A user at 'registered' has no session yet, so we always show step 1.
 * 'email_verified' → 3 (the fork) — email is done, pick a path.
 */
function mapServerStepToUI(
  onboardingStep: ServerOnboardingStep | string | undefined | null,
  tier?: string | null,
): number {
  switch (onboardingStep) {
    case 'registered':
      return 1; // No profile flags set yet — start from the top
    case 'email_verified':
      return 3; // Email confirmed → fork: continue or finish later
    case 'profile_pending':
      return 4;
    case 'profile_complete':
      return 5;
    case 'plan_selected':
      // Free skips tax
      return tier === 'free' || tier === 'tier1' ? 7 : 6;
    case 'tax_complete':
      return 7;
    case 'active':
      return -1; // Onboarding done — redirect to dashboard
    default:
      return 1;
  }
}

function applyUserToForm(user: any): Partial<FormDataShape> {
  return {
    firstName: user?.first_name || user?.firstName || '',
    lastName: user?.last_name || user?.lastName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    zip: user?.zip || user?.zip_code || '',
    city: user?.city || '',
    state: user?.state || '',
    bio: user?.bio || '',
    skills: user?.skills || user?.service_categories || [],
    photoUrl: user?.photo_url || user?.photoUrl || '',
    legalName: user?.legal_name || user?.legalName || '',
    taxType: user?.tax_type || user?.taxType || '',
    taxId: user?.tax_id || user?.taxId || '',
    mailingAddress: {
      street: user?.mailing_address?.street || user?.mailingAddress?.street || '',
      city: user?.mailing_address?.city || user?.mailingAddress?.city || '',
      state: user?.mailing_address?.state || user?.mailingAddress?.state || '',
      zip: user?.mailing_address?.zip || user?.mailingAddress?.zip || '',
    },
  };
}

export default function HelperRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    user,
    loading: authLoading,
    isAuthenticated,
    refreshUser,
  } = useAuth();

  const [step, setStep] = useState<number>(0); // 0 = resolving
  const [registrationToken, setRegistrationToken] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [formData, setFormData] = useState<FormDataShape>(INITIAL_FORM_DATA);
  const [ready, setReady] = useState(false);
  const didBootstrapRef = useRef(false);

  const updateFormData = useCallback((data: Partial<FormDataShape>) => {
    setFormData(prev => ({ ...prev, ...data }));
  }, []);

  // ── Derive local state from a server user payload ───────────────────────
  const applyUser = useCallback(
    (currentUser: any) => {
      if (!currentUser) return;

      if (isComplete(currentUser)) {
        navigate('/helper-dashboard', { replace: true });
        return;
      }

      updateFormData(applyUserToForm(currentUser));

      const tier = getMembershipTier(currentUser);
      if (tier) setSelectedTier(tier);

      const resolvedStep = mapServerStepToUI(currentUser?.onboarding_step, tier);

      if (resolvedStep === -1) {
        navigate('/helper-dashboard', { replace: true });
        return;
      }

      setStep(resolvedStep);
      setReady(true);
    },
    [navigate, updateFormData],
  );

  // ── Bootstrap: run once after auth finishes loading ─────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    // Stripe return after plan checkout
    const sessionId = searchParams.get('session_id');
    const stepParam = searchParams.get('step');
    if (sessionId && stepParam) {
      setStep(Number(stepParam));
      setReady(true);
      return;
    }

    if (isAuthenticated && user) {
      // Existing session — refresh from server so we get latest DB flags
      refreshUser()
        .then((fresh: any) => applyUser(fresh || user))
        .catch(() => applyUser(user));
    } else {
      // New visitor — start at account setup
      setStep(1);
      setReady(true);
    }
  }, [authLoading, isAuthenticated, user, searchParams, refreshUser, applyUser]);

  // ── Watch for background auth changes (token refresh, etc.) ─────────────
  useEffect(() => {
    if (!ready || !user) return;
    if (isComplete(user)) {
      navigate('/helper-dashboard', { replace: true });
    }
  }, [user, ready, navigate]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleOnboardingComplete = useCallback(async () => {
    try {
      const fresh = await refreshUser();
      if (isComplete(fresh)) {
        navigate('/helper-dashboard', {
          replace: true,
          state: { message: 'Welcome to OxSteed! Your profile is live.' },
        });
        return;
      }
    } catch {
      // Server already finalized — navigate regardless
    }
    navigate('/helper-dashboard', {
      replace: true,
      state: { message: 'Welcome to OxSteed! Your profile is live.' },
    });
  }, [navigate, refreshUser]);

  const handleFinishLater = useCallback(async () => {
    try {
      await refreshUser();
    } catch {
      // ignore
    }
    navigate('/helper-dashboard', { replace: true });
  }, [navigate, refreshUser]);

  // ── Step renderer ─────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1AccountSetup
            onSuccess={(
              token: string,
              data: { firstName: string; lastName: string; email: string },
            ) => {
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
              try {
                const fresh = await refreshUser();
                applyUser(fresh || user);
              } catch {
                // OTP verified but refresh failed — show the fork
                setStep(3);
                setReady(true);
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
            onSuccess={(data: Partial<FormDataShape>) => {
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
              // tier1 = free path (no tax), tier2/pro = tax step
              setStep(tier === 'free' || tier === 'tier1' ? 7 : 6);
            }}
          />
        );

      case 6:
        return (
          <Step6TaxInfo
            token={registrationToken}
            suggestedName={`${formData.firstName} ${formData.lastName}`.trim()}
            onBack={() => setStep(5)}
            onSuccess={(data: Partial<FormDataShape>) => {
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

  // ── Progress bar ──────────────────────────────────────────────────────────
  const isFree = selectedTier === 'free' || selectedTier === 'tier1';
  const visibleSteps = isFree ? [1, 2, 4, 5, 7] : [1, 2, 4, 5, 6, 7];
  const currentIndex = visibleSteps.indexOf(step);
  const showProgressBar = step !== 3 && currentIndex >= 0;

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (authLoading || !ready || step === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading your account…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800" role="navigation" aria-label="Main navigation">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="text-sm text-gray-400 hover:text-white transition">
              How It Works
            </Link>
            {!isAuthenticated && (
              <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">
                Sign In
              </Link>
            )}
            {isAuthenticated && (
              <Link
                to="/helper-dashboard"
                className="text-sm text-gray-400 hover:text-white transition"
              >
                My Dashboard
              </Link>
            )}
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
        {showProgressBar && (
          <>
            <div
              className="flex items-center gap-1 mb-1"
              role="progressbar"
              aria-valuenow={currentIndex + 1}
              aria-valuemin={1}
              aria-valuemax={visibleSteps.length}
              aria-label={`Setup progress: step ${currentIndex + 1} of ${visibleSteps.length}`}
            >
              {visibleSteps.map((s, i) => {
                const meta = STEP_META[s];
                const isDone = i < currentIndex;
                const isActive = s === step;
                return (
                  <React.Fragment key={s}>
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                          isDone
                            ? 'bg-green-500 text-white'
                            : isActive
                            ? 'bg-orange-500 text-white ring-2 ring-orange-500/30'
                            : 'bg-gray-800 text-gray-500 border border-gray-700'
                        }`}
                        aria-label={`Step ${i + 1}: ${meta?.label || ''}`}
                      >
                        {isDone ? '✓' : String(i + 1)}
                      </div>
                      <span className={`mt-1.5 text-xs ${isActive ? 'text-orange-400' : 'text-gray-500'}`}>
                        {meta?.label}
                      </span>
                    </div>
                    {i < visibleSteps.length - 1 && (
                      <div
                        className={`flex-1 h-0.5 rounded mt-[-1rem] mx-0.5 transition-all ${
                          isDone ? 'bg-green-500' : 'bg-gray-800'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="text-right text-xs text-gray-600 mb-6">
              Step {currentIndex + 1} of {visibleSteps.length}
            </div>
          </>
        )}

        {/* Step content */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl overflow-hidden">
          <div className="p-6 sm:p-8">{renderStep()}</div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-600">
          By continuing, you agree to our{' '}
          <Link to="/terms" className="text-gray-400 hover:text-white underline">Terms</Link>{' '}
          and{' '}
          <Link to="/privacy" className="text-gray-400 hover:text-white underline">Privacy Policy</Link>.
        </div>
      </div>
    </div>
  );
}
