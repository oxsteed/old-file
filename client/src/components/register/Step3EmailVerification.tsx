// Step 3: Email OTP Verification - Customer Registration
import { useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface Props {
  registrationToken: string;
}

export default function Step3EmailVerification({ registrationToken }: Props) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleVerify = async () => {
    if (otp.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/register/verify-otp', {
        token: registrationToken,
        otp,
      });
      // Store auth tokens
      if (res.data.accessToken) {
        localStorage.setItem('accessToken', res.data.accessToken);
        localStorage.setItem('refreshToken', res.data.refreshToken);
      }
      toast.success('Account created successfully!');
      setSuccess(true);
      // Redirect to dashboard after short delay
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 2000);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Verification failed';
      setError(msg);
      if (err.response?.data?.attemptsRemaining !== undefined) {
        setError(`${msg} (${err.response.data.attemptsRemaining} attempts remaining)`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await api.post('/auth/register/resend-otp', { token: registrationToken });
      toast.success('New verification code sent!');
      setError('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend code');
    }
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto text-center py-8">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome to OxSteed!</h2>
        <p className="text-gray-600">Your account has been created. Redirecting to dashboard...</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Verify Your Email</h2>
      <p className="text-gray-600 mb-6 text-sm">
        We sent a 6-digit verification code to your email. Enter it below to complete registration.
      </p>

      <input
        type="text"
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        className="w-full text-center text-3xl tracking-[0.5em] p-4 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        autoFocus
      />

      {error && (
        <p className="text-red-600 text-sm mb-3">{error}</p>
      )}

      <button
        onClick={handleVerify}
        disabled={otp.length !== 6 || loading}
        className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition mb-4 font-medium"
      >
        {loading ? 'Verifying...' : 'Verify & Create Account'}
      </button>

      <p className="text-sm text-gray-500">
        Didn't receive a code?{' '}
        <button
          onClick={handleResend}
          className="text-blue-600 hover:underline"
        >
          Resend code
        </button>
      </p>

      <p className="text-xs text-gray-400 mt-4">
        The code expires in 15 minutes. After 3 failed attempts, your registration will be locked for 1 hour.
      </p>
    </div>
  );
}
