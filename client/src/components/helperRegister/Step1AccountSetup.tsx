import { useState } from 'react';
import api from '../../api/axios';

interface Props {
  onSuccess: (token: string, data: { firstName: string; lastName: string; email: string }) => void;
}

export default function Step1AccountSetup({ onSuccess }: Props) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '',
    ageConfirmed: false, privacyConsent: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const getPasswordStrength = (pw: string): { label: string; color: string; width: string } => {
    if (pw.length === 0) return { label: '', color: '', width: '0%' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { label: 'Weak', color: 'bg-red-500', width: '20%' };
    if (score <= 2) return { label: 'Fair', color: 'bg-yellow-500', width: '40%' };
    if (score <= 3) return { label: 'Good', color: 'bg-blue-500', width: '60%' };
    if (score <= 4) return { label: 'Strong', color: 'bg-green-500', width: '80%' };
    return { label: 'Very Strong', color: 'bg-green-400', width: '100%' };
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    else if (form.firstName.trim().length < 2) e.firstName = 'Must be at least 2 characters';
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    else if (form.lastName.trim().length < 2) e.lastName = 'Must be at least 2 characters';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (!form.ageConfirmed) e.ageConfirmed = 'You must confirm you are 18 or older';
    if (!form.privacyConsent) e.privacyConsent = 'You must agree to the Privacy Policy';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await api.post('/auth/helper/register/start', {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: '0000000000', // collected later in Step 4
        zip: '00000',        // collected later in Step 4
        ageConfirmed: form.ageConfirmed,
      });
      onSuccess(res.data.token, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
      });
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Registration failed. Please try again.';
      if (msg.toLowerCase().includes('email')) setErrors(prev => ({ ...prev, email: msg }));
      else setErrors(prev => ({ ...prev, general: msg }));
    } finally {
      setLoading(false);
    }
  };

  const strength = getPasswordStrength(form.password);
  const inputClass = 'w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {errors.general && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm" role="alert">
          {errors.general}
        </div>
      )}

      {/* Google OAuth placeholder */}
      <button type="button" disabled
        className="w-full py-3 bg-white text-gray-800 font-medium rounded-lg flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google (Coming Soon)
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-700"></div>
        <span className="text-gray-500 text-sm">or</span>
        <div className="flex-1 h-px bg-gray-700"></div>
      </div>

      {/* Name fields */}
      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="block text-sm text-gray-300 mb-1">First Name</label>
            <input id="firstName" type="text" autoComplete="given-name" placeholder="Jane"
              value={form.firstName} onChange={e => set('firstName', e.target.value)}
              className={inputClass} aria-required="true" aria-invalid={!!errors.firstName} />
            {errors.firstName && <p className="text-red-400 text-xs mt-1" role="alert">{errors.firstName}</p>}
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm text-gray-300 mb-1">Last Name</label>
            <input id="lastName" type="text" autoComplete="family-name" placeholder="Doe"
              value={form.lastName} onChange={e => set('lastName', e.target.value)}
              className={inputClass} aria-required="true" aria-invalid={!!errors.lastName} />
            {errors.lastName && <p className="text-red-400 text-xs mt-1" role="alert">{errors.lastName}</p>}
          </div>
        </div>
        {/* Government ID notice */}
        <p className="text-xs text-amber-400/80 mt-2 flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>Use your legal name exactly as it appears on your government-issued ID. This is required for identity verification and tax purposes.</span>
        </p>
      </div>

      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm text-gray-300 mb-1">Email</label>
        <input id="email" type="email" autoComplete="email" placeholder="jane@example.com"
          value={form.email} onChange={e => set('email', e.target.value)}
          className={inputClass} aria-required="true" aria-invalid={!!errors.email} inputMode="email" />
        {errors.email && <p className="text-red-400 text-xs mt-1" role="alert">{errors.email}</p>}
      </div>

      {/* Password */}
      <div>
        <label htmlFor="password" className="block text-sm text-gray-300 mb-1">Create Password</label>
        <div className="relative">
          <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
            placeholder="At least 8 characters"
            value={form.password} onChange={e => set('password', e.target.value)}
            className={inputClass + ' pr-12'} aria-required="true" aria-invalid={!!errors.password} />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm"
            aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {form.password.length > 0 && (
          <div className="mt-2">
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className={`h-full ${strength.color} transition-all duration-300`} style={{ width: strength.width }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{strength.label}</p>
          </div>
        )}
        {errors.password && <p className="text-red-400 text-xs mt-1" role="alert">{errors.password}</p>}
      </div>

      {/* Consent checkboxes */}
      <div className="space-y-3">
        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={form.ageConfirmed}
            onChange={e => set('ageConfirmed', e.target.checked)}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I confirm I am at least 18 years old (required per our{' '}
            <a href="/terms" target="_blank" className="text-orange-400 underline hover:text-orange-300">Terms of Service</a>).
          </span>
        </label>
        {errors.ageConfirmed && <p className="text-red-400 text-xs ml-6" role="alert">{errors.ageConfirmed}</p>}

        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={form.privacyConsent}
            onChange={e => set('privacyConsent', e.target.checked)}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I agree to the{' '}
            <a href="/privacy" target="_blank" className="text-orange-400 underline hover:text-orange-300">Privacy Policy</a>.
          </span>
        </label>
        {errors.privacyConsent && <p className="text-red-400 text-xs ml-6" role="alert">{errors.privacyConsent}</p>}
      </div>

      <button type="submit" disabled={loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition text-lg">
        {loading ? 'Creating Account...' : 'Get Started Free'}
      </button>

      <p className="text-center text-gray-500 text-xs">
        Your data is encrypted and stored securely. We never share your information with third parties without consent.
      </p>

      <p className="text-center text-gray-400 text-sm">
        Already have an account?{' '}
        <a href="/login" className="text-orange-500 hover:text-orange-400 font-medium">Sign in</a>
      </p>
    </form>
  );
}
