import React, { useState } from 'react';
import Step1BasicInfo from './Step1BasicInfo';
import Step2Terms from './Step2Terms';
import Step5Confirmation from './Step5Confirmation';

const API_BASE = import.meta.env.VITE_API_URL || '';

const steps = ['Basic Info', 'Terms & OTP', 'Done'];

export default function CustomerRegistration() {
  const [currentStep, setCurrentStep] = useState(1);
  const [registrationToken, setRegistrationToken] = useState('');
  const [formData, setFormData] = useState<any>({
    fullName: '',
    email: '',
    phone: '',
    zipCode: '',
    password: '',
    ageConfirmed: false,
  });
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');

  // Step 1: Basic info -> call /register/start
  const handleStep1Next = async (step1Data: any) => {
    setFormData((prev: any) => ({ ...prev, ...step1Data }));
    setError('');
    try {
      const nameParts = step1Data.fullName.trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || firstName;

      const res = await fetch(`${API_BASE}/api/auth/register/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: step1Data.email,
          password: step1Data.password,
          firstName,
          lastName,
          phone: step1Data.phone,
          zip: step1Data.zipCode,
          ageConfirmed: step1Data.ageConfirmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed');
        return;
      }
      setRegistrationToken(data.token);
      setCurrentStep(2);
    } catch (err) {
      setError('Network error. Please try again.');
    }
  };

  // Step 2: Terms accepted -> call /register/accept-terms (sends OTP)
  const handleStep2Next = async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/register/accept-terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: registrationToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to accept terms');
        return;
      }
      setOtpSent(true);
    } catch (err) {
      setError('Network error. Please try again.');
    }
  };

  // Verify OTP -> creates account
  const handleVerifyOTP = async () => {
    setOtpLoading(true);
    setOtpError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: registrationToken, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error || 'Invalid OTP');
        return;
      }
      // Store tokens
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      setCurrentStep(3);
    } catch (err) {
      setOtpError('Network error. Please try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOTP = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/register/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: registrationToken }),
      });
      setOtpError('New OTP sent to your email.');
    } catch {
      setOtpError('Failed to resend OTP.');
    }
  };

  const goBack = () => {
    if (otpSent) {
      setOtpSent(false);
      return;
    }
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
        {currentStep < 3 && (
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
                style={{ width: `${(currentStep / 3) * 100}%` }}
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

          {currentStep === 2 && !otpSent && (
            <Step2Terms onNext={handleStep2Next} onBack={goBack} />
          )}

          {currentStep === 2 && otpSent && (
            <div className="max-w-md mx-auto text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Verify Your Email</h2>
              <p className="text-gray-600 mb-6 text-sm">
                We sent a 6-digit code to <strong>{formData.email}</strong>. Enter it below.
              </p>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full text-center text-2xl tracking-widest p-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {otpError && (
                <p className="text-red-600 text-sm mb-3">{otpError}</p>
              )}
              <button
                onClick={handleVerifyOTP}
                disabled={otp.length !== 6 || otpLoading}
                className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition mb-3"
              >
                {otpLoading ? 'Verifying...' : 'Verify & Create Account'}
              </button>
              <button
                onClick={handleResendOTP}
                className="text-sm text-blue-600 hover:underline"
              >
                Resend code
              </button>
              <div className="mt-4">
                <button onClick={goBack} className="text-sm text-gray-500 hover:underline">
                  Back
                </button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <Step5Confirmation
              registrationData={{
                fullName: formData.fullName,
                email: formData.email,
                accountType: 'customer',
              }}
            />
          )}
        </div>

        {/* Footer */}
        {currentStep < 3 && !otpSent && (
          <p className="text-center text-sm text-gray-500 mt-4">
            Already have an account?{' '}
            <a href="/login" className="text-blue-600 underline">Sign in</a>
          </p>
        )}
      </div>
    </div>
  );
}
