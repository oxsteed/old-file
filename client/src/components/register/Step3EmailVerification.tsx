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
      }
      if (res.data.refreshToken) {
        localStorage.setItem('refreshToken', res.data.refreshToken);
      }
      setSuccess(true);
      toast.success('Account created successfully!');
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Verification failed');
      toast.error(err.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await api.post('/auth/register/resend-otp', { token: registrationToken });
      toast.success('New code sent to your email');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend code');
    }
  };

  if (success) {
    return (
      <div className="text-center py-8">
        <h2 className="text-2xl font-bold text-orange-400 mb-2">Welcome to OxSteed!</h2>
        <p className="text-gray-400">Your account has been created. Redirecting to dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white text-center">Verify Your Email</h2>
      <p className="text-gray-400 text-center text-sm">
        We sent a 6-digit verification code to your email. Enter it below to complete registration.
      </p>

      <input
        type="text"
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        className="w-full text-center text-3xl tracking-[0.5em] p-4 bg-gray-800/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-colors mb-4"
        autoFocus
      />

      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}

      <button
        onClick={handleVerify}
        disabled={otp.length !== 6 || loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Verifying...' : 'Verify & Create Account'}
      </button>

      <p className="text-center text-sm text-gray-400">
        Didn't receive a code?{' '}
        <button onClick={handleResend} className="text-orange-400 hover:text-orange-300 underline">
          Resend code
        </button>
      </p>

      <p className="text-gray-500 text-xs text-center">
        The code expires in 15 minutes. After 3 failed attempts, your registration will be locked for 1 hour.
      </p>
    </div>
  );
}
