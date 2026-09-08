import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Eye, EyeOff, ArrowRight, MapPin, Briefcase, ShieldCheck } from 'lucide-react';
import Footer from '../components/Footer';
import AuthNavbar from '../components/AuthNavbar';
import { resolveAuthReturnPath } from '../utils/authReturnPath';

function diditGateSatisfied(user) {
  if (!user?.email_verified) return true;
  const ds = user.didit_status || 'pending';
  if (user.didit_enforcement_required) return ds === 'verified';
  return ds === 'verified' || ds === 'skipped';
}

/**
 * Returns true when `name` looks like a real full name:
 * at least 2 words (first + last), minimum 5 total characters,
 * only letters, spaces, hyphens, and apostrophes.
 */
function isValidFullName(name) {
  const trimmed = (name || '').trim();
  if (trimmed.length < 5) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return words.every((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ''-]+$/.test(w));
}

// ── Left-panel feature data ────────────────────────────────────────────────────
function FeatureItem({ icon, title, sub }) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}
      >
        {icon}
      </div>
      <div>
        <p className="text-white font-semibold text-sm leading-snug">{title}</p>
        <p className="text-orange-100/80 text-sm mt-0.5 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}

export default function Login() {
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [termsAgreed, setTermsAgreed]   = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [rememberMe, setRememberMe]       = useState(false);
  const [mfaToken, setMfaToken]           = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [loading, setLoading]           = useState(false);

  const { login, completeTwoFactor } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { t }     = useTranslation();

  const from = resolveAuthReturnPath(location.state?.from);

  // Button is only enabled when all conditions are met — full name required (≥2 words)
  const canSubmit = email.trim() && password && termsAgreed && isValidFullName(signatureName);

  const finishLogin = (result) => {
    const loggedInUser = result?.user;

    if (loggedInUser?.email_verified && !diditGateSatisfied(loggedInUser)) {
      toast.success(t('login.verifyIdentityToast'));
      navigate('/verify-identity', { replace: true });
      return;
    }

    toast.success(t('login.welcomeBackToast'));
    navigate(from, { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!termsAgreed) {
      toast.error(t('login.agreementRequired'));
      return;
    }
    if (!isValidFullName(signatureName)) {
      toast.error(t('login.signatureFullNameRequired'));
      return;
    }

    setLoading(true);
    try {
      const result = await login({
        email,
        password,
        termsAgreed: true,
        agreementName: signatureName.trim(),
        rememberMe,
      });
      if (result?.requiresTwoFactor && result?.mfaToken) {
        setMfaToken(result.mfaToken);
        setTwoFactorCode('');
        setPassword('');
        return;
      }
      finishLogin(result);
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'signature_name_mismatch') {
        toast.error(t('login.signatureNameMismatch'));
      } else {
        toast.error(err.response?.data?.error || t('errors.loginFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e) => {
    e.preventDefault();
    const code = twoFactorCode.trim();
    if (!mfaToken) {
      toast.error(t('login.twoFactorSessionExpired'));
      return;
    }
    if (!code) {
      toast.error(t('login.twoFactorCodeRequired'));
      return;
    }

    setLoading(true);
    try {
      const normalizedCode = code.replace(/[\s-]/g, '');
      const result = await completeTwoFactor({
        mfaToken,
        token: code,
        isBackupCode: !/^\d{6}$/.test(normalizedCode),
      });
      finishLogin(result);
    } catch (err) {
      toast.error(err.response?.data?.error || t('login.twoFactorInvalid'));
    } finally {
      setLoading(false);
    }
  };

  const resetTwoFactor = () => {
    setMfaToken(null);
    setTwoFactorCode('');
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex flex-col">

      <AuthNavbar
        cta={{
          to: '/join',
          label: t('login.joinOxSteed', { defaultValue: 'Join OxSteed' }),
        }}
      />

      <div className="flex flex-1">

        {/* ── Left panel — brand ─────────────────────────────────────────────── */}
        <div
          className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
          style={{ background: 'linear-gradient(155deg, #7c2d12 0%, #c2410c 48%, #d97706 100%)' }}
        >
          {/* Dot grid texture */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.55) 1px, transparent 1px)',
              backgroundSize: '26px 26px',
              opacity: 0.1,
            }}
          />

          {/* Ambient glow blobs */}
          <div className="absolute top-1/3 -right-32 w-96 h-96 rounded-full blur-3xl"
            style={{ background: 'rgba(251,191,36,0.12)' }} />
          <div className="absolute -bottom-32 -left-24 w-80 h-80 rounded-full blur-3xl"
            style={{ background: 'rgba(234,88,12,0.18)' }} />

          {/* Decorative concentric rings (top-right) */}
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full"
            style={{ border: '1.5px solid rgba(255,255,255,0.10)' }} />
          <div className="absolute -top-6 -right-6 w-52 h-52 rounded-full"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }} />

          {/* Bottom decorative band */}
          <div className="absolute bottom-0 left-0 right-0 h-32"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.25), transparent)' }} />

          {/* ── Panel content ── */}
          <div className="relative z-10 flex flex-col justify-between p-12 w-full">

            {/* Wordmark */}
            <div className="flex items-center gap-4">
              {/* Logo badge */}
              <div
                className="flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  backdropFilter: 'blur(12px)',
                  border: '1.5px solid rgba(255,255,255,0.28)',
                }}
              >
                <span className="text-white text-xl font-black text-white text-xl font-black tracking-tighter leading-none select-none"><svg width="40" height="40" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="512" height="512" rx="88" fill="#16213e" /><path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316" /><path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316" /><path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316" /><path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316" /><circle cx="256" cy="256" r="145" fill="#F97316" /><text x="256" y="236" textAnchor="middle" dominantBaseline="middle" fontFamily="Arial Black, Arial, Helvetica, system-ui, sans-serif" fontWeight="900" fontSize="90" fill="#FFFFFF">OxS</text><polyline points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              </div>
              <div>
                <h1 className="text-white font-black tracking-tight leading-none"
                  style={{ fontSize: '2.75rem' }}>OxSteed</h1>
                <div className="w-10 h-0.5 my-2" style={{ background: 'rgba(255,255,255,0.35)' }} />
                <p className="text-orange-100 text-sm font-medium">{t('login.brandTagline')}</p>
              </div>
            </div>

            {/* Feature bullets */}
            <div className="space-y-7">
              <FeatureItem
                icon={<MapPin size={19} className="text-white" />}
                title={t('login.feature1Title')}
                sub={t('login.feature1Sub')}
              />
              <FeatureItem
                icon={<Briefcase size={19} className="text-white" />}
                title={t('login.feature2Title')}
                sub={t('login.feature2Sub')}
              />
              <FeatureItem
                icon={<ShieldCheck size={19} className="text-white" />}
                title={t('login.feature3Title')}
                sub={t('login.feature3Sub')}
              />
            </div>

            {/* Footer */}
            <p className="text-orange-200/60 text-xs">
              {t('login.copyright', { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>

        {/* ── Right panel — form ─────────────────────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md space-y-8">

            {/* Mobile wordmark */}
            <div className="lg:hidden text-center">
              <h1 className="text-3xl font-bold text-orange-500">OxSteed</h1>
              <p className="text-[var(--color-text-faint)] mt-1">{t('login.brandTagline')}</p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-[var(--color-text)]">
                {mfaToken ? t('login.twoFactorTitle') : t('login.title')}
              </h2>
              <p className="text-[var(--color-text-muted)] mt-1">
                {mfaToken ? t('login.twoFactorSubtitle') : t('login.subtitle')}
              </p>
            </div>

            <form onSubmit={mfaToken ? handleTwoFactorSubmit : handleSubmit} className="space-y-5">

              {mfaToken ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 flex gap-3">
                    <ShieldCheck className="mt-0.5 flex-shrink-0 text-orange-400" size={22} />
                    <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                      {t('login.twoFactorHint')}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="two-factor-code" className="block text-sm font-medium text-gray-300 mb-1.5">
                      {t('login.twoFactorCodeLabel')}
                    </label>
                    <input
                      id="two-factor-code"
                      type="text"
                      required
                      autoFocus
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value)}
                      className="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                      placeholder={t('login.twoFactorCodePlaceholder')}
                      autoComplete="one-time-code"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={resetTwoFactor}
                    className="text-sm font-medium text-orange-400 hover:text-orange-300 transition"
                  >
                    {t('login.twoFactorBack')}
                  </button>
                </div>
              ) : (
                <>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
                  {t('auth.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                    placeholder={t('login.emailPlaceholder')}
                  autoComplete="email"
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                    {t('auth.password')}
                  </label>
                  <Link to="/forgot-password" className="text-sm text-orange-500 hover:text-orange-400 transition">
                    {t('auth.forgotPassword')}
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition pr-12"
                    placeholder={t('login.passwordPlaceholder')}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition"
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* ── Terms & Signature agreement box ── */}
              <div className="rounded-xl bg-[var(--color-surface-translucent)] border border-[var(--color-border-subtle)] p-4 space-y-4">

                {/* Mandatory checkbox */}
                <div className="flex items-start gap-3">
                  <input
                    id="terms-agree"
                    type="checkbox"
                    checked={termsAgreed}
                    onChange={(e) => setTermsAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-600 bg-gray-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-gray-950 cursor-pointer"
                    aria-required="true"
                  />
                  <label htmlFor="terms-agree" className="text-sm text-gray-300 leading-relaxed cursor-pointer select-none">
                    {t('login.termsAgreeLabel')}{' '}
                    <Link
                      to="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:text-orange-300 underline underline-offset-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('login.termsLink')}
                    </Link>
                    {' '}{t('login.termsAgreeAnd')}{' '}
                    <Link
                      to="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:text-orange-300 underline underline-offset-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('login.privacyLink')}
                    </Link>
                  </label>
                </div>

                {/* Typed name signature */}
                <div>
                  <label
                    htmlFor="signature-name"
                    className="block text-sm font-medium text-gray-300 mb-1.5"
                  >
                    {t('login.signatureLabel')}
                  </label>
                  <input
                    id="signature-name"
                    type="text"
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder={t('login.signaturePlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition italic font-medium"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="signature-hint"
                  />
                  {signatureName.trim().length > 0 && !isValidFullName(signatureName) ? (
                    <p id="signature-hint" className="mt-1.5 text-xs text-orange-400 leading-relaxed" role="alert">
                      {t('login.signatureFullNameRequired')}
                    </p>
                  ) : (
                    <p id="signature-hint" className="mt-1.5 text-xs text-gray-500 leading-relaxed">
                      {t('login.signatureHint')}
                    </p>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-gray-950"
                />
                {t('login.rememberMe')}
              </label>
                </>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || (mfaToken ? !twoFactorCode.trim() : !canSubmit)}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                aria-disabled={mfaToken ? !twoFactorCode.trim() : !canSubmit}
              >
                {loading ? (
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <>
                    {mfaToken ? t('login.twoFactorSubmit') : t('login.signIn')}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-800" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-[var(--color-bg)] text-[var(--color-text-faint)]">{t('login.newHere')}</span>
              </div>
            </div>

            {/* Sign-up link */}
            <div className="flex justify-center">
              <Link
                to="/join"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 border border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white font-medium rounded-xl transition-all duration-200"
              >
                {t('login.joinOxSteed', { defaultValue: 'Join OxSteed' })}
                <ArrowRight size={16} />
              </Link>
            </div>

          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
