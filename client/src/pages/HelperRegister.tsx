import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Step1BasicInfo from '../components/helperRegister/Step1BasicInfo';
import Step2Profile from '../components/helperRegister/Step2Profile';
import Step3TierSelection from '../components/helperRegister/Step3TierSelection';
import Step4W9 from '../components/helperRegister/Step4W9';
import Step5Payment from '../components/helperRegister/Step5Payment';
import Step6Terms from '../components/helperRegister/Step6Terms';
import Step7OTPVerification from '../components/helperRegister/Step7OTPVerification';

const STEPS = [
  { label: 'Info', icon: '1' },
  { label: 'Profile', icon: '2' },
  { label: 'Tier', icon: '3' },
  { label: 'Tax', icon: '4' },
  { label: 'Payment', icon: '5' },
  { label: 'Terms', icon: '6' },
  { label: 'Verify', icon: '7' },
];

export default function HelperRegister() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [registrationToken, setRegistrationToken] = useState('');
  const [selectedTier, setSelectedTier] = useState('');

  // For free tier, skip W-9 (step 4) and Payment (step 5)
  const isFree = selectedTier === 'free';
  const getVisibleSteps = () => {
    if (isFree) return [1, 2, 3, 6, 7];
    return [1, 2, 3, 4, 5, 6, 7];
  };
  const visibleSteps = getVisibleSteps();
  const currentIndex = visibleSteps.indexOf(step);
  const progress = ((currentIndex + 1) / visibleSteps.length) * 100;

  const nextStep = () => {
    const idx = visibleSteps.indexOf(step);
    if (idx < visibleSteps.length - 1) setStep(visibleSteps[idx + 1]);
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1BasicInfo
            onSuccess={(token: string) => {
              setRegistrationToken(token);
              nextStep();
            }}
          />
        );
      case 2:
        return (
          <Step2Profile
            registrationToken={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 3:
        return (
          <Step3TierSelection
            registrationToken={registrationToken}
            onSuccess={(tier: string) => {
              setSelectedTier(tier);
              if (tier === 'free') {
                setStep(6);
              } else {
                setStep(4);
              }
            }}
          />
        );
      case 4:
        return (
          <Step4W9
            registrationToken={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 5:
        return (
          <Step5Payment
            registrationToken={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 6:
        return (
          <Step6Terms
            registrationToken={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 7:
        return (
          <Step7OTPVerification
            registrationToken={registrationToken}
            onSuccess={() => {
              navigate('/login', { state: { message: 'Registration complete! Please log in.' } });
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">Sign in</Link>
            <Link to="/register/customer" className="text-sm px-3 py-1.5 border border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white rounded-lg font-medium transition">Post a Job</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-4 px-4"><p className="text-orange-400 font-semibold text-lg">Set your own rates, get found by neighbors, earn on your schedule.</p><p className="text-gray-400 text-sm mt-1">List your skills for free. Upgrade to Pro anytime for priority placement.</p></div>
        {/* Header */}
        <h1 className="text-2xl font-bold mb-6">Become an OxSteed Helper</h1>

        {/* Progress bar with labels */}
        <div className="flex items-center gap-1 mb-1">
          {visibleSteps.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    visibleSteps.indexOf(s) < currentIndex
                      ? 'bg-green-500 text-white'
                      : s === step
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {visibleSteps.indexOf(s) < currentIndex ? '\u2713' : STEPS[s - 1].icon}
                </div>
                <span className={`text-xs mt-1 ${
                  s === step ? 'text-orange-400 font-medium' : 'text-gray-500'
                }`}>{STEPS[s - 1].label}</span>
              </div>
              {i < visibleSteps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mb-5 ${
                    visibleSteps.indexOf(s) < currentIndex ? 'bg-green-500' : 'bg-gray-700'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
        <p className="text-sm text-gray-400 mb-8">
          Step {currentIndex + 1} of {visibleSteps.length}: {STEPS[step - 1].label}
        </p>

        {/* Content */}
        <div>{renderStep()}</div>
      </div>
    </div>
  );
}
