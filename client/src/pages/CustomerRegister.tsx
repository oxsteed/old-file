// src/pages/CustomerRegister.tsx
import { useState } from 'react';
import Step1BasicInfo from '../components/register/Step1BasicInfo';
import Step2Terms from '../components/register/Step2Terms';
import Step3EmailVerification from '../components/register/Step3EmailVerification';

type Step = 1 | 2 | 3;

export default function CustomerRegister() {
  const [step, setStep] = useState<Step>(1);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-orange-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-2xl shadow-2xl shadow-orange-900/20 p-8">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                step >= s
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                  : 'bg-gray-700 text-gray-400'
              }`}>
                {s}
              </div>
              {s < 3 && (
                <div className={`w-12 h-0.5 transition-all duration-300 ${
                  step > s ? 'bg-orange-500' : 'bg-gray-700'
                }`} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <Step1BasicInfo
            onSuccess={(token) => {
              setRegistrationToken(token);
              setStep(2);
            }}
          />
        )}

        {step === 2 && registrationToken && (
          <Step2Terms
            registrationToken={registrationToken}
            onSuccess={() => setStep(3)}
          />
        )}

        {step === 3 && registrationToken && (
          <Step3EmailVerification
            registrationToken={registrationToken}
          />
        )}
      </div>
    </div>
  );
}
