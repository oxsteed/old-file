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
  mailingAddress: {
    street: '',
    city: '',
    state: '',
    zip: '',
  },
};

const STEPS = [
  { label: 'Account', icon: '1' },
  { label: 'Verify', icon: '2' },
  { label: 'Profile', icon: '3' },
  { label: 'Plan', icon: '4' },
  { label: 'Tax', icon: '5' },
  { label: 'Review', icon: '6' },
];

function isOnboardingComplete(user: any): boolean {
  return (
    user?.onboarding_step === 'active' ||
    user?.onboarding_completed === true ||
    user?.onboarding_status === 'onboarding_complete'
  );
}

function getMembershipTier(user: any): string {
  return (
    user?.membership_tier ||
    user?.membershipTier ||
    user?.plan ||
    ''
  );
}

function mapServerStepToUI(
  onboardingStep: ServerOnboardingStep | string | undefined | null,
  tier?: string | null,
): number {
  switch (onboardingStep) {
    case 'registered':
      return 2;
    case 'email_verified':
      return 3;
    case 'profile_pending':
      return 4;
    case 'profile_complete':
      return 5;
    case 'plan_selected':
      return tier === 'free' ? 7 : 6;
    case 'tax_complete':
      return 7;
    case 'active':
      return -1;
    default:
      return 1;
  }
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

  const [step, setStep] = useState<number>(0);
  const [registrationToken, setRegistrationToken] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [formData, setFormData] = useState<FormDataShape>(INITIAL_FORM_DATA);
  const [ready, setReady] = useState(false);
  const didBootstrapRef = useRef(false);

  const updateFormData = useCallback((data: Partial<FormDataShape>) => {
    setFormData(prev => ({ ...prev, ...data }));
  }, []);

  const applyUserToLocalState = useCallback((currentUser: any) => {
    if (!currentUser) return;

    if (isOnboardingComplete(currentUser)) {
      navigate('/helper-dashboard', { replace: true });
      return;
    }

    updateFormData({
      firstName: currentUser?.first_name || currentUser?.firstName || '',
      lastName: currentUser?.last_name || currentUser?.lastName || '',
      email: currentUser?.email || '',
      phone: currentUser?.phone || '',
      zip: currentUser?.zip || '',
      city: currentUser?.city || '',
      state: currentUser?.state || '',
      bio: currentUser?.bio || '',
      skills: currentUser?.skills || currentUser?.service_categories || [],
      photoUrl: currentUser?.photo_url || currentUser?.photoUrl || '',
      legalName: currentUser?.legal_name || currentUser?.legalName || '',
      taxType: currentUser?.tax_type || currentUser?.taxType || '',
      taxId: currentUser?.tax_id || currentUser?.taxId || '',
      mailingAddress: {
        street:
          currentUser?.mailing_address?.street ||
          currentUser?.mailingAddress?.street ||
          '',
        city:
          currentUser?.mailing_address?.city ||
          currentUser?.mailingAddress?.city ||
          '',
        state:
          currentUser?.mailing_address?.state ||
          currentUser?.mailingAddress?.state ||
          '',
        zip:
          currentUser?.mailing_address?.zip ||
          currentUser?.mailingAddress?.zip ||
          '',
      },
    });

    const tier = getMembershipTier(currentUser);
    if (tier) {
      setSelectedTier(tier);
    }

    const resolvedStep = mapServerStepToUI(currentUser?.onboarding_step, tier);

    if (resolvedStep === -1) {
      navigate('/helper-dashboard', { replace: true });
      return;
    }

    setStep(resolvedStep);
    setReady(true);
  }, [navigate, updateFormData]);

  const rehydrateFromServer = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setStep(1);
      setReady(true);
      return;
    }

    try {
      const freshUser = await refreshUser();
      applyUserToLocalState(freshUser || user);
    } catch {
      applyUserToLocalState(user);
    }
  }, [isAuthenticated, user, refreshUser, applyUserToLocalState]);

  useEffect(() => {
    if (authLoading) return;
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    const sessionId = searchParams.get('session_id');
    const stepParam = searchParams.get('step');

    if (sessionId && stepParam) {
      setStep(Number(stepParam));
      setReady(true);
      return;
    }

    rehydrateFromServer();
  }, [authLoading, searchParams, rehydrateFromServer]);

  useEffect(() => {
    if (!ready || !user) return;

    if (isOnboardingComplete(user)) {
      navigate('/helper-dashboard', { replace: true });
      return;
    }

    const tier = getMembershipTier(user);
    const resolvedStep = mapServerStepToUI(user?.onboarding_step, tier);
    if (resolvedStep > 0 && resolvedStep !== step) {
      setStep(resolvedStep);
    }
  }, [user, ready, step, navigate]);

  const handleOnboardingComplete = useCallback(async () => {
    try {
      const freshUser = await refreshUser();
      if (isOnboardingComplete(freshUser)) {
        navigate('/helper-dashboard', {
          replace: true,
          state: { message: 'Welcome to OxSteed!' },
        });
        return;
      }
    } catch {
    }

    navigate('/helper-dashboard', {
      replace: true,
      state: { message: 'Welcome to OxSteed!' },
    });
  }, [navigate, refreshUser]);

  const handleFinishLater = useCallback(async () => {
    try {
      await refreshUser();
    } catch {
    }

    navigate('/helper-dashboard', { replace: true });
  }, [navigate, refreshUser]);

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
                const freshUser = await refreshUser();
                applyUserToLocalState(freshUser || user);
              } catch {
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
              setStep(tier === 'free' ? 7 : 6);
            }}
          />
        );

      case 6:
        return (
          <Step6TaxInfo
            token={registrationToken}
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

  const isFree = selectedTier === 'free';
  const visibleSteps = isFree ? [1, 2, 4, 5, 7] : [1, 2, 4, 5, 6, 7];
  const currentIndex = visibleSteps.indexOf(step);
  const showProgressBar = step !== 3 && currentIndex >= 0;

  if (authLoading || !ready || step === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
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
        <section className="text-center mb-8 px-4">
          <h1 className="text-3xl font-bold text-white mb-2">Start Earning in Your Neighborhood</h1>
          <p className="text-orange-400 font-semibold text-lg">Set your own rates. Get found by neighbors. Earn on your schedule.</p>
          <p className="text-gray-400 text-sm mt-2">Takes about 5 minutes · Free to join · Upgrade to Pro anytime</p>
        </section>

        {showProgressBar && (
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
                        {i < currentIndex ? '✓' : String(i + 1)}
                      </div>
                      <span className="mt-2 text-xs text-gray-400">{stepMeta?.label}</span>
                    </div>
                    {i < visibleSteps.length - 1 && (
                      <div
                        className={`flex-1 h-1 rounded ${i < currentIndex ? 'bg-green-500' : 'bg-gray-700'}`}
                        aria-hidden="true"
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="text-right text-xs text-gray-500 mb-6">
              Step {currentIndex + 1} of {visibleSteps.length}
            </div>
          </>
        )}

        <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl overflow-hidden">
          <div className="p-6 sm:p-8">{renderStep()}</div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          By continuing, you agree to our{' '}
          <Link to="/terms" className="text-gray-300 hover:text-white">Terms</Link>{' '}
          and{' '}
          <Link to="/privacy" className="text-gray-300 hover:text-white">Privacy Policy</Link>.
        </div>
      </div>
    </div>
  );
}
