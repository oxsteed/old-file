import React, { useState } from 'react';
import Step1BasicInfo from './Step1BasicInfo';
import Step2Terms from './Step2Terms';
import Step3AccountType from './Step3AccountType';
import Step4Payment from './Step4Payment';
import Step5Confirmation from './Step5Confirmation';

const API_BASE = import.meta.env.VITE_API_URL || '';

const steps = ['Basic Info', 'Terms', 'Account', 'Payment', 'Confirmation'];

export default function CustomerRegistration() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<any>({
    // Step 1
    fullName: '',
    email: '',
    phone: '',
    zipCode: '',
    password: '',
    ageConfirmed: false,
    // Step 2
    termsAccepted: false,
    termsVersion: '',
    termsAcceptedAt: '',
    termsIpAddress: '',
    // Step 3
    accountType: 'residential',
    serviceInterests: [],
    // Step 4
    paymentMethod: 'none',
    skipPayment: true,
  });
  const [error, setError] = useState('');

  const handleStep1Next = (step1Data: any) => {
    setFormData((prev: any) => ({ ...prev, ...step1Data }));
    setCurrentStep(2);
  };

  const handleStep2Next = (termsData: any) => {
    setFormData((prev: any) => ({
      ...prev,
      termsAccepted: termsData.termsAccepted,
      termsVersion: termsData.termsVersion,
      termsAcceptedAt: termsData.acceptedAt,
      termsIpAddress: termsData.ipAddress,
    }));
    setCurrentStep(3);
  };

  const handleStep3Next = (accountData: any) => {
    setFormData((prev: any) => ({ ...prev, ...accountData }));
    setCurrentStep(4);
  };

  const handleStep4Next = async (paymentData: any) => {
    const finalData = { ...formData, ...paymentData };
    setFormData(finalData);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/register/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: finalData.fullName,
          email: finalData.email,
          phone: finalData.phone,
          zipCode: finalData.zipCode,
          password: finalData.password,
          ageConfirmed: finalData.ageConfirmed,
          termsAccepted: finalData.termsAccepted,
          termsVersion: finalData.termsVersion,
          termsAcceptedAt: finalData.termsAcceptedAt,
          termsIpAddress: finalData.termsIpAddress,
          accountType: finalData.accountType,
          serviceInterests: finalData.serviceInterests,
          paymentMethod: finalData.paymentMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed. Please try again.');
        return;
      }

      setCurrentStep(5);
    } catch (err) {
      setError('Network error. Please try again.');
    }
  };

  const goBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-600">OxSteed</h1>
          <p className="text-gray-500 mt-1">Create your customer account</p>
        </div>

        {/* Progress bar */}
        {currentStep < 5 && (
          <div className="mb-8">
            <div className="flex justify-between mb-2">
              {steps.map((label, idx) => (
                <div
                  key={idx}
                  className={`text-xs font-medium ${
                    idx + 1 <= currentStep ? 'text-blue-600' : 'text-gray-400'
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(currentStep / 5) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Step content */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-8">
          {currentStep === 1 && <Step1BasicInfo onNext={handleStep1Next} />}
          {currentStep === 2 && <Step2Terms onNext={handleStep2Next} onBack={goBack} />}
          {currentStep === 3 && <Step3AccountType onNext={handleStep3Next} onBack={goBack} />}
          {currentStep === 4 && <Step4Payment onNext={handleStep4Next} onBack={goBack} />}
          {currentStep === 5 && (
            <Step5Confirmation
              registrationData={{
                fullName: formData.fullName,
                email: formData.email,
                accountType: formData.accountType,
              }}
            />
          )}
        </div>

        {/* Footer */}
        {currentStep < 5 && (
          <p className="text-center text-sm text-gray-500 mt-4">
            Already have an account?{' '}
            <a href="/login" className="text-blue-600 underline">Sign in</a>
          </p>
        )}
      </div>
    </div>
  );
}
