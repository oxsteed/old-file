import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/axios';

interface Props {
  token: string;
  onSuccess: () => void;
}

export default function Step7OTPVerification({ token, onSuccess }: Props) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (paste.length === 6) {
      setCode(paste.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const otp = code.join('');
    if (otp.length !== 6) { setError('Please enter the full 6-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/helper/register/verify-otp', { token, otp });
      onSuccess();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Verification failed';
      const remaining = err.response?.data?.attemptsRemaining;
      if (remaining !== undefined) setAttemptsRemaining(remaining);
      if (err.response?.status === 429) {
        const lockout = err.response?.data?.lockoutUntil;
        setError(lockout ? `Too many attempts. Try again after ${new Date(lockout).toLocaleTimeString()}.` : msg);
      } else {
        setError(msg);
      }
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await api.post('/auth/helper/register/resend-otp', { token });
      setResendCooldown(60);
      setError('');
      setAttemptsRemaining(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resend code');
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Verify Your Email</h2>
        <p className="text-gray-400">We sent a 6-digit code to your email. Enter it below to complete your helper registration.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-center gap-3" onPaste={handlePaste}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="w-12 h-14 text-center text-2xl font-bold bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition"
            />
          ))}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {attemptsRemaining !== null && attemptsRemaining > 0 && (
          <p className="text-yellow-400 text-sm text-center">{attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining</p>
        )}

        <button
          type="submit"
          disabled={loading || code.join('').length !== 6}
          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition"
        >
          {loading ? 'Verifying...' : 'Verify & Complete Registration'}
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="text-orange-400 hover:text-orange-300 text-sm disabled:text-gray-500 transition"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Didn't receive a code? Resend"}
          </button>
        </div>
      </form>
    </div>
  );
}
