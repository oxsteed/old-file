import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Step1BasicInfo from '../components/helperRegister/Step1BasicInfo';
import Step2Profile from '../components/helperRegister/Step2Profile';
import Step3TierSelection from '../components/helperRegister/Step3TierSelection';
import Step4W9 from '../components/helperRegister/Step4W9';
import Step5Payment from '../components/helperRegister/Step5Payment';
import Step6Terms from '../components/helperRegister/Step6Terms';
import Step7OTPVerification from '../components/helperRegister/Step7OTPVerification';

const STEPS = [
  { label: 'Basic Info', icon: '1' },
  { label: 'Profile', icon: '2' },
  { label: 'Select Tier', icon: '3' },
  { label: 'W-9 Info', icon: '4' },
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
            token={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 3:
        return (
          <Step3TierSelection
            token={registrationToken}
            onSuccess={(tier: string) => {
              setSelectedTier(tier);
              // After tier selection, figure out next step
              if (tier === 'free') {
                setStep(6); // skip W-9 and Payment
              } else {
                setStep(4); // go to W-9
              }
            }}
          />
        );
      case 4:
        return (
          <Step4W9
            token={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 5:
        return (
          <Step5Payment
            token={registrationToken}
            tier={selectedTier}
            onSuccess={() => nextStep()}
          />
        );
      case 6:
        return (
          <Step6Terms
            token={registrationToken}
            onSuccess={() => nextStep()}
          />
        );
      case 7:
        return (
          <Step7OTPVerification
            token={registrationToken}
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
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-xl font-bold text-white mb-4">Become an OxSteed Helper</h1>
          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-2">
            {visibleSteps.map((s, i) => (
              <div key={s} className="flex items-center flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition ${
                    s === step
                      ? 'bg-orange-500 text-white'
                      : s < step || visibleSteps.indexOf(s) < currentIndex
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {visibleSteps.indexOf(s) < currentIndex ? '\u2713' : STEPS[s - 1].icon}
                </div>
                {i < visibleSteps.length - 1 && (
                  <div className={`flex-1 h-1 mx-1 rounded ${
                    visibleSteps.indexOf(s) < currentIndex ? 'bg-green-500' : 'bg-gray-700'
                  }`} />
                )}
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-400">
            Step {currentIndex + 1} of {visibleSteps.length}: {STEPS[step - 1].label}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {renderStep()}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-900 border-t border-gray-800 px-4 py-3 text-center">
        <p className="text-gray-500 text-sm">
          Already have an account?{' '}
          <a href="/login" className="text-orange-400 hover:text-orange-300">Log in</a>
        </p>
      </div>
    </div>
  );
}
