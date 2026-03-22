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
    <div className="register-container">
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
  );
}
