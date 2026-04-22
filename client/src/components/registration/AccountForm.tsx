// client/src/components/registration/AccountForm.tsx
// Unified Step 1 form for both customer & helper registration.
// Handles: avatar, name, business name, email + inline OTP, phone, structured US address, password, terms.
// Orchestrates backend calls: register/start → accept-terms → verify-otp

import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin, Briefcase, ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import AvatarUpload from './AvatarUpload';
import OTPInput from './OTPInput';
import PasswordField, { scorePassword } from './PasswordField';
import { US_STATE_CODES } from '../../constants/usStates';

// ── Types ────────────────────────────────────────────────
interface Props {
  role: 'customer' | 'helper';
  onSuccess: () => void;
}

type FormState = {
  firstName: string;
  lastName: string;
  businessName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  password: string;
  termsAccepted: boolean;
};

type FormErrors = Partial<Record<keyof FormState | 'general', string>>;

// ── Helpers ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

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
  const { setUser } = useAuth();
  const { t } = useTranslation();

  // Form data
  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    businessName: '',
    email: '',
    phone: '',
    addressLine1: '',
    city: '',
    state: '',
    zipCode: '',
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
        setErrors((prev) => ({ ...prev, email: t('register.emailTaken') }));
      }
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setEmailAvailable(false);
        setErrors((prev) => ({ ...prev, email: t('register.emailTaken') }));
      } else {
        setEmailAvailable(null);
      }
    }
  }, [form.email, t]);

  // ── Send OTP with real form values ─────────────────────
  const sendOtp = useCallback(async (formData: FormState): Promise<string | null> => {
    const endpoint = role === 'helper' ? '/helper-registration/start' : '/auth/register/start';
    const res = await api.post(endpoint, {
      email: formData.email.trim().toLowerCase(),
      password: formData.password,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      phone: formData.phone.trim(),
      addressLine1: formData.addressLine1.trim(),
      city: formData.city.trim(),
      state: formData.state.trim().toUpperCase(),
      zip: formData.zipCode.trim(),
      ageConfirmed: true,
      ...(referralRef ? { ref: referralRef } : {}),
    });
    const token: string = res.data.token;

    if (role === 'customer') {
      await api.post('/auth/register/accept-terms', {
        token,
        termsAccepted: true,
        privacyAccepted: true,
        brokerAccepted: true,
        electronicSignature: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          date: new Date().toISOString(),
        },
      });
    }

    return token;
  }, [role, referralRef]);

  // ── OTP complete ──────────────────────────────────────
  const handleOtpComplete = useCallback(async (code: string) => {
    try {
      const endpoint = role === 'helper' ? '/helper-registration/verify-otp' : '/auth/register/verify-otp';
      const { data } = await api.post(endpoint, { token: registrationToken, otp: code });
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        if (data.user) {
          localStorage.setItem('user', JSON.stringify(data.user));
          setUser(data.user);
        }
      }
      setOtpVerified(true);
      toast.success(t('register.verifiedToast'));
      setTimeout(() => onSuccess(), 1200);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('errors.invalidCode'));
      setOtpDigits(['', '', '', '', '', '']);
    }
  }, [registrationToken, role, setUser, onSuccess, t]);

  // ── Resend OTP ────────────────────────────────────────
  const handleResendOtp = useCallback(async () => {
    try {
      const endpoint = role === 'helper' ? '/helper-registration/send-otp' : '/auth/register/resend-otp';
      const payload = role === 'helper'
        ? { email: form.email.trim().toLowerCase() }
        : { token: registrationToken };
      await api.post(endpoint, payload);
      setOtpDigits(['', '', '', '', '', '']);
      toast.success(t('register.newCodeSent'));
    } catch {
      toast.error(t('register.resendFailed'));
    }
  }, [role, form.email, registrationToken, t]);

  // ── Validation ────────────────────────────────────────
  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.firstName.trim()) e.firstName = t('register.errorFirstName');
    if (!form.lastName.trim()) e.lastName = t('register.errorLastName');
    if (!form.email.trim() || !EMAIL_RE.test(form.email)) e.email = t('register.errorEmail');
    if (emailAvailable === false) e.email = t('register.emailTaken');
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) e.phone = t('register.errorPhone');
    if (!form.addressLine1.trim()) e.addressLine1 = t('register.errorStreet');
    if (!form.city.trim()) e.city = t('register.errorCity');
    if (!form.state) e.state = t('register.errorState');
    const z = form.zipCode.trim();
    if (!z) e.zipCode = t('register.errorZip');
    else if (!ZIP_RE.test(z)) e.zipCode = t('register.errorZipInvalid');
    if (scorePassword(form.password) < 3) e.password = t('register.errorPassword');
    if (!form.termsAccepted) e.termsAccepted = t('register.errorTerms');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (!otpSent) {
        const token = await sendOtp(form);
        if (token) {
          setRegistrationToken(token);
          setOtpSent(true);
          toast.success(t('register.codeSentToast'));
        }
        setSubmitting(false);
        return;
      }

      if (!otpVerified) {
        toast.error(t('register.errorOtp'));
        setSubmitting(false);
        return;
      }

      onSuccess();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || t('register.registrationFailed');
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
          {t('register.createAccount')}
        </h1>
        <p className="text-xs text-gray-400 mt-1 mb-6 leading-relaxed">
          {t('register.tagline')}
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
                {t('register.firstName')}
              </label>
              <input
                id="firstName"
                type="text"
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                className={`${inputBase} px-3 ${errors.firstName ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder={t('register.firstNamePlaceholder')}
                autoComplete="given-name"
                required
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'err-firstName' : undefined}
              />
              <FieldError id="err-firstName" msg={errors.firstName} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lastName" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                {t('register.lastName')}
              </label>
              <input
                id="lastName"
                type="text"
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                className={`${inputBase} px-3 ${errors.lastName ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder={t('register.lastNamePlaceholder')}
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
              {t('register.businessName')} <span className="font-normal text-gray-500 normal-case tracking-normal ml-1">{t('register.optional')}</span>
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
                placeholder={t('register.businessNamePlaceholder')}
                autoComplete="organization"
              />
            </div>
          </div>

          {/* ── Email ────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              {t('register.emailAddress')}
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
                onBlur={checkEmail}
                className={`${inputWithIcon} ${errors.email ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder="you@example.com"
                autoComplete="email"
                required
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'err-email' : undefined}
              />
            </div>
            {emailAvailable === true && !errors.email && (
              <p className="text-[11px] text-green-500 mt-0.5">{t('register.emailAvailable')}</p>
            )}
            <FieldError id="err-email" msg={errors.email} />
          </div>

          {/* ── Email verification ────────────────────── */}
          {otpSent && !otpVerified && (
            <div className="px-3 py-3 rounded-lg bg-gray-800/40 border border-gray-700/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-green-400 font-medium flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  {t('register.codeSent')}
                </span>
                <button type="button" onClick={handleResendOtp} className="text-[11px] text-orange-500 hover:opacity-80 transition-opacity">
                  {t('register.resend')}
                </button>
              </div>
              <OTPInput value={otpDigits} onChange={setOtpDigits} onComplete={handleOtpComplete} />
            </div>
          )}

          {otpVerified && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-900/20 border border-green-700/30 text-xs text-green-400 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              {t('register.emailVerified')}
            </div>
          )}

          {/* ── Phone ───────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="phone" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              {t('register.phone')}
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

          {/* ── Address (structured) ───────────────── */}
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
              {t('register.addressSection')}
            </span>
            <div className="flex flex-col gap-1">
              <label htmlFor="addressLine1" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                {t('register.streetAddress')}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                  <MapPin size={16} />
                </span>
                <input
                  id="addressLine1"
                  type="text"
                  value={form.addressLine1}
                  onChange={(e) => set('addressLine1', e.target.value)}
                  className={`${inputWithIcon} ${errors.addressLine1 ? 'border-red-500 bg-red-900/20' : ''}`}
                  placeholder={t('register.streetPlaceholder')}
                  autoComplete="address-line1"
                  required
                  aria-invalid={!!errors.addressLine1}
                  aria-describedby={errors.addressLine1 ? 'err-addressLine1' : undefined}
                />
              </div>
              <FieldError id="err-addressLine1" msg={errors.addressLine1} />
            </div>
            <div className="grid grid-cols-2 gap-3 max-[400px]:grid-cols-1">
              <div className="flex flex-col gap-1">
                <label htmlFor="city" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                  {t('register.city')}
                </label>
                <input
                  id="city"
                  type="text"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  className={`${inputBase} px-3 ${errors.city ? 'border-red-500 bg-red-900/20' : ''}`}
                  placeholder={t('register.cityPlaceholder')}
                  autoComplete="address-level2"
                  required
                  aria-invalid={!!errors.city}
                  aria-describedby={errors.city ? 'err-city' : undefined}
                />
                <FieldError id="err-city" msg={errors.city} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="state" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                  {t('register.state')}
                </label>
                <select
                  id="state"
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  className={`${inputBase} px-3 ${errors.state ? 'border-red-500 bg-red-900/20' : ''}`}
                  autoComplete="address-level1"
                  required
                  aria-invalid={!!errors.state}
                  aria-describedby={errors.state ? 'err-state' : undefined}
                >
                  <option value="">{t('register.stateSelect')}</option>
                  {US_STATE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <FieldError id="err-state" msg={errors.state} />
              </div>
            </div>
            <div className="flex flex-col gap-1 max-w-[200px]">
              <label htmlFor="zipCode" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                {t('register.zipCode')}
              </label>
              <input
                id="zipCode"
                type="text"
                inputMode="numeric"
                value={form.zipCode}
                onChange={(e) => set('zipCode', e.target.value)}
                className={`${inputBase} px-3 ${errors.zipCode ? 'border-red-500 bg-red-900/20' : ''}`}
                placeholder={t('register.zipPlaceholder')}
                autoComplete="postal-code"
                required
                maxLength={10}
                aria-invalid={!!errors.zipCode}
                aria-describedby={errors.zipCode ? 'err-zipCode' : undefined}
              />
              <FieldError id="err-zipCode" msg={errors.zipCode} />
            </div>
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
              {t('register.termsText')}{' '}
              <Link to="/terms" target="_blank" className="text-orange-500 hover:underline">{t('register.termsLink')}</Link>
              {' '}{t('common.and')}{' '}
              <Link to="/privacy" target="_blank" className="text-orange-500 hover:underline">{t('register.privacyLink')}</Link>.
              {' '}{t('register.termsConsent')}
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
              {otpVerified ? t('register.proceedButton') : otpSent ? t('register.verifyButton') : t('register.createButton')}
              <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
