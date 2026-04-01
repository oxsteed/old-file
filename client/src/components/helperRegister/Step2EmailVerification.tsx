import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/axios';

interface Props {
  token: string;
  email: string;
  firstName: string;
  onSuccess: () => void;
}

export default function Step2EmailVerification({ token, email, firstName, onSuccess }: Props) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [sent, setSent] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Send OTP on mount
  useEffect(() => {
    sendOTP();
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Focus first input
  useEffect(() => {
    if (sent) inputRefs.current[0]?.focus();
  }, [sent]);

  const sendOTP = async () => {
    try {
      await api.post('/helper-registration/send-otp', { email });
      setSent(true);
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send verification code');
    }
  };

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    setError('');
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    // Auto-submit on last digit
    if (value && index === 5) {
      const fullCode = [...next];
      if (fullCode.every(d => d !== '')) {
        verifyCode(fullCode.join(''));
      }
    }
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
      const digits = paste.split('');
      setCode(digits);
      inputRefs.current[5]?.focus();
      verifyCode(paste);
    }
  };

  const verifyCode = async (otp: string) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/helper-registration/verify-otp', { token, otp });

      // Complete registration: create user and get JWT tokens
      const { data } = await api.post('/helper-registration/complete', { email });
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
      }
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
      }

      onSuccess();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Invalid code. Please try again.';
      setError(msg);
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setCode(['', '', '', '', '', '']);
    setError('');
    sendOTP();
  };

  const maskedEmail = email.replace(/(.{2})[^@]+(@.+)/, '$1***$2');

  return (
    <div className="max-w-md mx-auto text-center">
      {/* Email icon */}
      <div className="w-16 h-16 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
      <p className="text-gray-400 mb-1">
        We sent a 6-digit code to <span className="text-white font-medium">{maskedEmail}</span>
      </p>
      <p className="text-gray-500 text-sm mb-8">The code expires in 15 minutes.</p>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm mb-4" role="alert">
          {error}
        </div>
      )}

      {/* 6-digit code inputs */}
      <div className="flex justify-center gap-3 mb-6" onPaste={handlePaste}>
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
            className="w-12 h-14 text-center text-2xl font-bold bg-gray-900 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
            aria-label={`Digit ${i + 1}`}
            disabled={loading}
          />
        ))}
      </div>

      {loading && (
        <p className="text-orange-400 text-sm mb-4">Verifying...</p>
      )}

      {/* Resend */}
      <p className="text-gray-400 text-sm">
        Didn't get the code?{' '}
        {resendCooldown > 0 ? (
          <span className="text-gray-500">Resend in {resendCooldown}s</span>
        ) : (
          <button onClick={handleResend} className="text-orange-500 hover:text-orange-400 font-medium">
            Resend code
          </button>
        )}
      </p>
      <p className="text-gray-600 text-xs mt-6">
        Check your spam folder if you don't see the email.
      </p>
    </div>
  );
}
