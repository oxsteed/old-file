// client/src/components/registration/AccountForm.tsx
// Unified Step 1 form for both customer & helper registration.
// Handles: avatar, name, business name, email + inline OTP, phone, address, password, terms.
// Orchestrates backend calls: register/start → accept-terms → verify-otp

import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin, Briefcase, ChevronRight, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import AvatarUpload from './AvatarUpload';
import OTPInput from './OTPInput';
import PasswordField, { scorePassword } from './PasswordField';

// ── Types ────────────────────────────────────────────────
interface Props {
  role: 'customer' | 'helper';
  onSuccess: (data: {
    token: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
  }) => void;
}

type FormState = {
  firstName: string;
  lastName: string;
  businessName: string;
  email: string;
  phone: string;
  address: string;
  password: string;
  termsAccepted: boolean;
};

type FormErrors = Partial<Record<keyof FormState | 'general', string>>;

// ── Helpers ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function FieldError({ id, msg }: { id?: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={id} className="text-[11px] text-red-400 flex items-center gap-1 mt-0.5" role="alert">
      <AlertCircle size={12} />
      {msg}
    </p>
  );
}

// ── Component ────────────────────────────────────────────
export default function AccountForm({ role, onSuccess }: Props) {
  const [searchParams] = useSearchParams();
  const referralRef = searchParams.get('ref') || undefined;

  // Form data
  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    businessName: '',
    email: '',
    phone: '',
    address: '',
    password: '',
    termsAccepted: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  // OTP state
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [registrationToken, setRegistrationToken] = useState('');

  // Email availability
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);

  // Loading states
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Field setter ───────────────────────────────────────
  const set = useCallback((field: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  }, []);

  // ── Check email availability on blur ───────────────────
  const checkEmail = useCallback(async () => {
    if (!form.email || !EMAIL_RE.test(form.email)) return;
    try {
      const { data } = await api.post('/auth/check-email', { email: form.email.trim().toLowerCase() });
      setEmailAvailable(data.available);
      if (!data.available) {
        setErrors((prev) => ({ ...prev, email: 'This email is already registered' }));
      }
    } catch {
      setEmailAvailable(null);
    }
  }, [form.email]);

  // ── Send OTP (triggers after email blur & valid) ───────
  const handleSendOtp = useCallback(async () => {
    if (!EMAIL_RE.test(form.email) || otpSent || emailAvailable === false) return;
    setSendingOtp(true);
    try {
      // 1) Create pending registration
      const endpoint = role === 'helper' ? '/helper-registration/start' : '/auth/register/start';
      const res = await api.post(endpoint, {
        email: form.email.trim().toLowerCase(),
        password: form.password || 'Temp1234!', // temp — will be validated on submit
        firstName: form.firstName.trim() || 'Pending',
        lastName: form.lastName.trim() || 'User',
        phone: form.phone || '0000000000',
        zip: form.address?.match(/\d{5}/)?.[0] || '00000',
        ageConfirmed: true,
        ...(referralRef ? { ref: referralRef } : {}),
      });
      const token = res.data.token;
      setRegistrationToken(token);

      // 2) Accept terms → triggers OTP email
      if (role === 'customer') {
        await api.post('/auth/register/accept-terms', {
          token,
          termsAccepted: true,
          privacyAccepted: true,
          brokerAccepted: true,
          electronicSignature: {
            firstName: form.firstName.trim() || 'Pending',
            lastName: form.lastName.trim() || 'User',
            date: new Date().toISOString(),
          },
        });
      }
      // For helpers, OTP is sent automatically by /start

      setOtpSent(true);
      toast.success('Verification code sent to your email');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Could not send verification code';
      toast.error(msg);
    } finally {
      setSendingOtp(false);
    }
  }, [form, role, otpSent, emailAvailable]);

  // ── Email blur → check + optionally send OTP ──────────
  const handleEmailBlur = useCallback(async () => {
    await checkEmail();
    // Only auto-send OTP if we have enough data
    if (EMAIL_RE.test(form.email) && form.firstName && form.lastName && form.password.length >= 8 && !otpSent) {
      await handleSendOtp();
    }
  }, [checkEmail, form.email, form.firstName, form.lastName, form.password, otpSent, handleSendOtp]);

  // ── OTP complete ──────────────────────────────────────
  const handleOtpComplete = useCallback(async (code: string) => {
    try {
      const endpoint = role === 'helper' ? '/helper-registration/verify-otp' : '/auth/register/verify-otp';
      const { data } = await api.post(endpoint, { token: registrationToken, otp: code });
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
      }
      setOtpVerified(true);
      toast.success('Email verified!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Invalid code');
      setOtpDigits(['', '', '', '', '', '']);
    }
  }, [registrationToken, role]);

  // ── Resend OTP ────────────────────────────────────────
  const handleResendOtp = useCallback(async () => {
    try {
      const endpoint = role === 'helper' ? '/helper-registration/send-otp' : '/auth/register/resend-otp';
      const payload = role === 'helper'
        ? { email: form.email.trim().toLowerCase() }
        : { token: registrationToken };
      await api.post(endpoint, payload);
      setOtpDigits(['', '', '', '', '', '']);
      toast.success('New code sent');
    } catch {
      toast.error('Failed to resend code');
    }
  }, [role, form.email, registrationToken]);

  // ── Validation ────────────────────────────────────────
  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    if (!form.email.trim() || !EMAIL_RE.test(form.email)) e.email = 'Enter a valid email';
    if (emailAvailable === false) e.email = 'This email is already registered';
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) e.phone = 'Enter a valid phone number';
    if (!form.address.trim()) e.address = 'Address is required';
    if (scorePassword(form.password) < 3) e.password = 'Password must meet requirements';
    if (!form.termsAccepted) e.termsAccepted = 'Please accept the terms';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      // If OTP hasn't been sent yet, send it now
      if (!otpSent) {
        await handleSendOtp();
        setSubmitting(false);
        return; // Wait for user to enter OTP
      }

      // If OTP sent but not yet verified, prompt user
      if (!otpVerified) {
        toast.error('Please verify your email with the code sent to you');
        setSubmitting(false);
        return;
      }

      // If we already have a token and OTP is verified, proceed to step 2
      onSuccess({
        token: registrationToken,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        address: form.address,
      });
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Registration failed';
      setErrors({ general: msg });
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Shared input classes ──────────────────────────────
  const inputBase =
    'w-full py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 transition-all hover:border-gray-600 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
  const inputWithIcon = `${inputBase} pl-10 pr-3`;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Heading */}
      <div className="pt-5 px-6">
        <h1
          className="text-2xl md:text-3xl font-bold text-white"
          style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.02em' }}
        >
          Create your account
        </h1>
        <p className="text-xs text-gray-400 mt-1 mb-6 leading-relaxed">
          Join OxSteed — your local services marketplace.
        </p>
      </div>

      <div className="px-6 pb-6">
        {/* General error */}
        {errors.general && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/60 rounded-lg text-red-300 text-sm" role="alert">
            {errors.general}
          </div>
        )}

        {/* Avatar */}
        <AvatarUpload onFileSelect={setAvatarFile} />

        <div className="flex flex-col gap-4">
          {/* ── Name row ─────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 max-[400px]:grid-cols-1">
            <div className="flex flex-col gap-1">
              <label htmlFor="firstName" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                className={`${inputBase} px-3 ${errors.firstName ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder="Toussaint"
                autoComplete="given-name"
                required
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'err-firstName' : undefined}
              />
              <FieldError id="err-firstName" msg={errors.firstName} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lastName" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                className={`${inputBase} px-3 ${errors.lastName ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder="Louverture"
                autoComplete="family-name"
                required
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'err-lastName' : undefined}
              />
              <FieldError id="err-lastName" msg={errors.lastName} />
            </div>
          </div>

          {/* ── Business name (optional) ─────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="bizName" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              Business name <span className="font-normal text-gray-500 normal-case tracking-normal ml-1">optional</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                <Briefcase size={16} />
              </span>
              <input
                id="bizName"
                type="text"
                value={form.businessName}
                onChange={(e) => set('businessName', e.target.value)}
                className={inputWithIcon}
                placeholder="My Business Name LLC"
                autoComplete="organization"
              />
            </div>
          </div>

          {/* ── Email ────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              Email address
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                <Mail size={16} />
              </span>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                onBlur={handleEmailBlur}
                className={`${inputWithIcon} ${errors.email ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder="you@example.com"
                autoComplete="email"
                required
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'err-email' : undefined}
              />
            </div>
            {emailAvailable === true && !errors.email && (
              <p className="text-[11px] text-green-500 mt-0.5">Email is available</p>
            )}
            <FieldError id="err-email" msg={errors.email} />
          </div>

          {/* ── Email verification ────────────────────── */}
          {otpSent && !otpVerified && (
            <div className="px-3 py-3 rounded-lg bg-gray-800/40 border border-gray-700/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-green-400 font-medium flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  Code sent — enter it below
                </span>
                <button type="button" onClick={handleResendOtp} className="text-[11px] text-orange-500 hover:opacity-80 transition-opacity">
                  Resend
                </button>
              </div>
              <OTPInput value={otpDigits} onChange={setOtpDigits} onComplete={handleOtpComplete} />
            </div>
          )}

          {otpVerified && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-900/20 border border-green-700/30 text-xs text-green-400 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Email verified
            </div>
          )}

          {/* ── Phone ───────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="phone" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              Phone number
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                <Phone size={16} />
              </span>
              <input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                className={`${inputWithIcon} ${errors.phone ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder="+1 (555) 000-0000"
                autoComplete="tel"
                required
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'err-phone' : undefined}
              />
            </div>
            <FieldError id="err-phone" msg={errors.phone} />
          </div>

          {/* ── Address ─────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="address" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              Address
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                <MapPin size={16} />
              </span>
              <input
                id="address"
                type="text"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                className={`${inputWithIcon} ${errors.address ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder="123 Main St, Springfield, OH"
                autoComplete="street-address"
                required
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? 'err-address' : undefined}
              />
            </div>
            <FieldError id="err-address" msg={errors.address} />
          </div>

          {/* ── Password ────────────────────────────── */}
          <PasswordField
            value={form.password}
            onChange={(val) => set('password', val)}
            error={errors.password}
          />

          {/* ── Terms ───────────────────────────────── */}
          <div className="flex gap-3 items-start pt-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={form.termsAccepted}
              onClick={() => set('termsAccepted', !form.termsAccepted)}
              className={`w-[18px] h-[18px] rounded border-[1.5px] shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                form.termsAccepted
                  ? 'bg-orange-500 border-orange-500'
                  : 'bg-gray-800 border-gray-600 hover:border-gray-500'
              }`}
            >
              {form.termsAccepted && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 6 5 9 10 3" />
                </svg>
              )}
            </button>
            <p className="text-xs text-gray-400 leading-relaxed">
              I agree to OxSteed's{' '}
              <Link to="/terms" target="_blank" className="text-orange-500 hover:underline">Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" target="_blank" className="text-orange-500 hover:underline">Privacy Policy</Link>.
              {' '}I consent to identity verification as required for service providers.
            </p>
          </div>
          <FieldError msg={errors.termsAccepted} />
        </div>

        {/* ── Submit ──────────────────────────────────── */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-3 mt-5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-lg shadow-lg shadow-orange-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <>
              {otpVerified ? 'Continue to Identity Verification' : otpSent ? 'Verify Email & Continue' : 'Create Account'}
              <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
