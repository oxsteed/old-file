// client/src/pages/JoinPage.jsx
//
// The unified signup. Replaces the customer/helper split at the navbar but
// leaves the legacy /register/customer and /register/helper routes intact for
// any existing campaigns / inbound links.
//
// One form, one path through:
//   step 1 (form) → POST /auth/register/start with { defaultMode }
//                 → POST /auth/register/accept-terms
//                 → user types OTP
//   step 2 (otp)  → POST /auth/register/verify-otp
//                 → navigate to the mode-appropriate post-signup route
//
// The "mode" is recorded on users.default_mode (migration 270) and dictates
// where the user lands. See client/src/utils/modeRouter.js for the mapping.

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Mail, Phone, MapPin, User, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../api/axios';
import { persistSessionPayload } from '../api/auth';
import Footer from '../components/Footer';
import { useAuth } from '../context/AuthContext';
import OTPInput from '../components/registration/OTPInput';
import PasswordField, { scorePassword } from '../components/registration/PasswordField';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';
import PostalCodeInput from '../components/PostalCodeInput';
import {
  detectCountryFromLocale, hasPostalCode, hasRegions,
} from '../lib/countries';
import {
  SELF_SELECTABLE_MODES, MODE_CATALOG, postSignupRouteForMode,
} from '../utils/modeRouter';
import { LAUNCH_SELF_SELECTABLE_MODES } from '../utils/launchScope';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VISIBLE_SIGNUP_MODES = LAUNCH_SELF_SELECTABLE_MODES;

export default function JoinPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const referralRef = searchParams.get('ref') || undefined;
  // Allow direct deep-linking with /join?mode=helper to pre-select a mode.
  const presetMode = searchParams.get('mode');

  // ── Form state ─────────────────────────────────────────
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    country: detectCountryFromLocale(),
    addressLine1: '',
    city: '',
    state: '',
    zipCode: '',
    password: '',
    termsAccepted: false,
    defaultMode: VISIBLE_SIGNUP_MODES.includes(presetMode) ? presetMode : 'customer',
  });
  const [errors, setErrors] = useState({});
  const [emailAvailable, setEmailAvailable] = useState(null);

  // ── OTP state ──────────────────────────────────────────
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpSent, setOtpSent] = useState(false);
  const [registrationToken, setRegistrationToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // If user is already signed in + verified, bounce them out.
  useEffect(() => {
    if (user?.email_verified) {
      navigate(postSignupRouteForMode(user.default_mode || 'customer'), { replace: true });
    }
  }, [user, navigate]);

  const set = useCallback((field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  }, []);

  // ── Email availability check ───────────────────────────
  const checkEmail = useCallback(async () => {
    if (!form.email || !EMAIL_RE.test(form.email)) return;
    try {
      const { data } = await api.post('/auth/check-email', { email: form.email.trim().toLowerCase() });
      setEmailAvailable(!!data.available);
      if (!data.available) {
        setErrors(prev => ({ ...prev, email: t('register.emailTaken') }));
      }
    } catch (err) {
      if (err?.response?.status === 409) {
        setEmailAvailable(false);
        setErrors(prev => ({ ...prev, email: t('register.emailTaken') }));
      } else {
        setEmailAvailable(null);
      }
    }
  }, [form.email, t]);

  // ── Validation ─────────────────────────────────────────
  const validate = useCallback(() => {
    const e = {};
    if (!form.firstName.trim()) e.firstName = t('register.errorFirstName');
    if (!form.lastName.trim()) e.lastName = t('register.errorLastName');
    if (!form.email.trim() || !EMAIL_RE.test(form.email)) e.email = t('register.errorEmail');
    if (emailAvailable === false) e.email = t('register.emailTaken');
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) e.phone = t('register.errorPhone');
    if (!form.country) e.country = t('register.errorCountry');
    if (!form.addressLine1.trim()) e.addressLine1 = t('register.errorStreet');
    if (!form.city.trim()) e.city = t('register.errorCity');
    if (!form.state.trim()) e.state = t('register.errorState');
    const z = form.zipCode.trim();
    if (hasPostalCode(form.country)) {
      if (!z) e.zipCode = t('register.errorZip');
      else if (PostalCodeInput?.isValid && !PostalCodeInput.isValid(form.country, z)) {
        e.zipCode = t('register.errorZipInvalid');
      }
    }
    if (scorePassword(form.password) < 3) e.password = t('register.errorPassword');
    if (!form.termsAccepted) e.termsAccepted = t('register.errorTerms');
    if (!SELF_SELECTABLE_MODES.includes(form.defaultMode) || !VISIBLE_SIGNUP_MODES.includes(form.defaultMode)) e.defaultMode = t('join.errorMode');
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [form, emailAvailable, t]);

  // ── Step 1: send OTP ───────────────────────────────────
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate() || submitting) return;
    setSubmitting(true);
    try {
      const stateValue = hasRegions(form.country)
        ? form.state.trim().toUpperCase()
        : form.state.trim();

      // 1. /auth/register/start with the new defaultMode field.
      const res = await api.post('/auth/register/start', {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        country: form.country,
        addressLine1: form.addressLine1.trim(),
        city: form.city.trim(),
        state: stateValue,
        zip: form.zipCode.trim(),
        ageConfirmed: true,
        defaultMode: form.defaultMode,
        ...(referralRef ? { ref: referralRef } : {}),
      });
      const token = res?.data?.token;
      if (!token) throw new Error('No registration token returned');

      // 2. accept terms — same endpoint the customer flow uses.
      await api.post('/auth/register/accept-terms', {
        token,
        termsAccepted: true,
        privacyAccepted: true,
        brokerAccepted: true,
        electronicSignature: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          date: new Date().toISOString(),
        },
      });

      setRegistrationToken(token);
      setOtpSent(true);
      toast.success(t('register.codeSentToast'));
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || t('register.registrationFailed');
      setErrors(prev => ({ ...prev, general: typeof msg === 'string' ? msg : t('register.registrationFailed') }));
      toast.error(typeof msg === 'string' ? msg : t('register.registrationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: verify OTP ─────────────────────────────────
  const handleOtpComplete = useCallback(async (code) => {
    if (verifying) return;
    setVerifying(true);
    try {
      const { data } = await api.post('/auth/register/verify-otp', {
        token: registrationToken,
        otp: code,
      });
      persistSessionPayload(data);
      if (data?.user) {
        setUser(data.user);
      }
      toast.success(t('register.verifiedToast'));
      const target = postSignupRouteForMode(data?.user?.default_mode || form.defaultMode);
      setTimeout(() => navigate(target, { replace: true }), 800);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('errors.invalidCode'));
      setOtpDigits(['', '', '', '', '', '']);
    } finally {
      setVerifying(false);
    }
  }, [registrationToken, form.defaultMode, navigate, setUser, t, verifying]);

  const handleResendOtp = useCallback(async () => {
    try {
      await api.post('/auth/register/resend-otp', { token: registrationToken });
      setOtpDigits(['', '', '', '', '', '']);
      toast.success(t('register.newCodeSent'));
    } catch {
      toast.error(t('register.resendFailed'));
    }
  }, [registrationToken, t]);

  // ── Render helpers ─────────────────────────────────────
  const inputBase = 'w-full py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 transition-all hover:border-gray-600 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
  const inputWithIcon = `${inputBase} pl-10 pr-3`;

  const FieldError = ({ id, msg }) => msg ? (
    <p id={id} className="text-[11px] text-red-400 flex items-center gap-1 mt-0.5" role="alert">
      <AlertCircle size={12} />{msg}
    </p>
  ) : null;

  const modeMeta = MODE_CATALOG[form.defaultMode] || MODE_CATALOG.customer;
  const selectedModeDescription = useMemo(
    () => t(modeMeta.hintKey, { defaultValue: '' }),
    [modeMeta, t],
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <nav className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="inline-flex min-h-11 items-center text-sm text-gray-400 hover:text-white transition">{t('nav.howItWorks')}</Link>
            <Link to="/login" className="inline-flex min-h-11 items-center text-sm text-gray-400 hover:text-white transition">{t('nav.signIn')}</Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-[520px] flex flex-col gap-8">
          <section className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">{t('join.heroTitle')}</h1>
            <p className="text-orange-400 font-semibold text-lg">{t('join.heroSubtitle')}</p>
            <p className="text-gray-400 text-sm mt-2">{t('join.heroNote')}</p>
          </section>

          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
            {!otpSent ? (
              <form onSubmit={handleSubmit} noValidate className="p-6 flex flex-col gap-5">
                {errors.general && (
                  <div className="p-3 bg-red-900/30 border border-red-700/60 rounded-lg text-red-300 text-sm" role="alert">
                    {errors.general}
                  </div>
                )}

                <div>
                  <label className="text-[11px] font-semibold tracking-wide uppercase text-gray-400 block mb-1">
                    {t('join.modeLabel')}
                  </label>
                  <select
                    value={form.defaultMode}
                    onChange={(e) => set('defaultMode', e.target.value)}
                    className={`${inputBase} px-3 ${errors.defaultMode ? 'border-red-500' : ''}`}
                  >
                    {VISIBLE_SIGNUP_MODES.map((m) => {
                      const meta = MODE_CATALOG[m];
                      return (
                        <option key={m} value={m}>
                          {t(meta.labelKey, { defaultValue: m })}
                        </option>
                      );
                    })}
                  </select>
                  {selectedModeDescription && (
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">{selectedModeDescription}</p>
                  )}
                  <FieldError msg={errors.defaultMode} />
                </div>

                <div className="grid grid-cols-2 gap-3 max-[400px]:grid-cols-1">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="firstName" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.firstName')}</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                      <input
                        id="firstName"
                        type="text"
                        value={form.firstName}
                        onChange={(e) => set('firstName', e.target.value)}
                        className={`${inputWithIcon} ${errors.firstName ? 'border-red-500 bg-red-900/20' : ''}`}
                        autoComplete="given-name"
                      />
                    </div>
                    <FieldError msg={errors.firstName} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="lastName" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.lastName')}</label>
                    <input
                      id="lastName"
                      type="text"
                      value={form.lastName}
                      onChange={(e) => set('lastName', e.target.value)}
                      className={`${inputBase} px-3 ${errors.lastName ? 'border-red-500 bg-red-900/20' : ''}`}
                      autoComplete="family-name"
                    />
                    <FieldError msg={errors.lastName} />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="email" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.emailAddress')}</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                    <input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      onBlur={checkEmail}
                      className={`${inputWithIcon} ${errors.email ? 'border-red-500 bg-red-900/20' : ''}`}
                      autoComplete="email"
                    />
                    {emailAvailable === true && (
                      <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" size={14} />
                    )}
                  </div>
                  <FieldError msg={errors.email} />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="phone" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.phone')}</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                    <input
                      id="phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      className={`${inputWithIcon} ${errors.phone ? 'border-red-500 bg-red-900/20' : ''}`}
                      autoComplete="tel"
                    />
                  </div>
                  <FieldError msg={errors.phone} />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.country')}</label>
                  <CountrySelect
                    value={form.country}
                    onChange={(v) => { set('country', v); set('state', ''); set('zipCode', ''); }}
                    className={`${inputBase} px-3 ${errors.country ? 'border-red-500 bg-red-900/20' : ''}`}
                  />
                  <FieldError msg={errors.country} />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="address" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.streetAddress')}</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                    <input
                      id="address"
                      type="text"
                      value={form.addressLine1}
                      onChange={(e) => set('addressLine1', e.target.value)}
                      className={`${inputWithIcon} ${errors.addressLine1 ? 'border-red-500 bg-red-900/20' : ''}`}
                      autoComplete="street-address"
                    />
                  </div>
                  <FieldError msg={errors.addressLine1} />
                </div>

                <div className="grid grid-cols-2 gap-3 max-[400px]:grid-cols-1">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="city" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.city')}</label>
                    <input
                      id="city"
                      type="text"
                      value={form.city}
                      onChange={(e) => set('city', e.target.value)}
                      className={`${inputBase} px-3 ${errors.city ? 'border-red-500 bg-red-900/20' : ''}`}
                      autoComplete="address-level2"
                    />
                    <FieldError msg={errors.city} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.state')}</label>
                    <RegionInput
                      country={form.country}
                      value={form.state}
                      onChange={(v) => set('state', v)}
                      className={`${inputBase} px-3 ${errors.state ? 'border-red-500 bg-red-900/20' : ''}`}
                    />
                    <FieldError msg={errors.state} />
                  </div>
                </div>

                {hasPostalCode(form.country) && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.zipCode')}</label>
                    <PostalCodeInput
                      country={form.country}
                      value={form.zipCode}
                      onChange={(v) => set('zipCode', v)}
                      className={`${inputBase} px-3 ${errors.zipCode ? 'border-red-500 bg-red-900/20' : ''}`}
                    />
                    <FieldError msg={errors.zipCode} />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">{t('register.passwordLabel')}</label>
                  <PasswordField
                    value={form.password}
                    onChange={(v) => set('password', v)}
                    error={errors.password}
                  />
                </div>

                <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.termsAccepted}
                    onChange={(e) => set('termsAccepted', e.target.checked)}
                    className="mt-0.5 accent-orange-500"
                  />
                  <span dangerouslySetInnerHTML={{ __html: t('join.termsLabel') }} />
                </label>
                <FieldError msg={errors.termsAccepted} />

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition disabled:opacity-60"
                >
                  {submitting ? t('join.submitting') : t('join.submit')}
                  {!submitting && <ChevronRight size={16} />}
                </button>
              </form>
            ) : (
              <div className="p-6 flex flex-col gap-4 text-center">
                <h2 className="text-xl font-semibold">{t('join.otpTitle')}</h2>
                <p className="text-sm text-gray-400">
                  {t('join.otpHint', { email: form.email })}
                </p>
                <OTPInput value={otpDigits} onChange={setOtpDigits} onComplete={handleOtpComplete} />
                <button
                  type="button"
                  onClick={handleResendOtp}
                  className="text-xs text-orange-400 hover:text-orange-300 underline"
                >
                  {t('join.resend')}
                </button>
                {verifying && (
                  <div className="text-sm text-gray-400">{t('join.verifying')}</div>
                )}
              </div>
            )}

            <div className="text-center px-6 pb-5 text-xs text-gray-400">
              {t('auth.welcomeBack')}?{' '}
              <Link to="/login" className="text-orange-400 hover:text-orange-300 underline">
                {t('nav.signIn')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
