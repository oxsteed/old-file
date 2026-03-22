import React, { useState } from 'react';
import Step1BasicInfo from './Step1BasicInfo';
import Step2Terms from './Step2Terms';
import Step5Confirmation from './Step5Confirmation';
import api from '../../api/axios';

const steps = ['Basic Info', 'Terms & OTP', 'Done'];

export default function CustomerRegistration() {
  const [currentStep, setCurrentStep] = useState(1);
  const [registrationToken, setRegistrationToken] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');

  // Step 1 completed: Step1BasicInfo calls /register/start internally
  // and returns the token via onSuccess
  const handleStep1Success = (token: string) => {
    setRegistrationToken(token);
    setCurrentStep(2);
  };

  // Step 2: Terms accepted -> call /register/accept-terms (sends OTP)
  const handleStep2Next = async () => {
    setError('');
    try {
      const res = await api.post('/auth/register/accept-terms', { token: registrationToken });
      setOtpSent(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to accept terms');
    }
  };

  // Verify OTP -> creates account
  const handleVerifyOTP = async () => {
    setOtpLoading(true);
    setOtpError('');
    try {
      const res = await api.post('/auth/register/verify-otp', {
        token: registrationToken,
        otp,
      });
      // Store tokens
      if (res.data.accessToken) {
        localStorage.setItem('accessToken', res.data.accessToken);
        localStorage.setItem('refreshToken', res.data.refreshToken);
      }
      if (res.data.user) {
        setUserEmail(res.data.user.email);
      }
      setCurrentStep(3);
    } catch (err: any) {
      setOtpError(err.response?.data?.error || 'Invalid OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOTP = async () => {
    try {
      await api.post('/auth/register/resend-otp', { token: registrationToken });
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
          {currentStep === 1 && <Step1BasicInfo onSuccess={handleStep1Success} />}

          {currentStep === 2 && !otpSent && (
            <Step2Terms onNext={handleStep2Next} onBack={goBack} />
          )}

          {currentStep === 2 && otpSent && (
            <div className="max-w-md mx-auto text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Verify Your Email</h2>
              <p className="text-gray-600 mb-6 text-sm">
                We sent a 6-digit code to your email. Enter it below.
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
                fullName: userName || 'Customer',
                email: userEmail,
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
