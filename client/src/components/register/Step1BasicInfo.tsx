// Step 1: Basic Info - Customer Registration
import { useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface Props {
  onSuccess: (token: string, data: { firstName: string; lastName: string; email: string }) => void;
}

export default function Step1BasicInfo({ onSuccess }: Props) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', zip: '',
    password: '', ageConfirmed: false, privacyConsent: false
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
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

  const checkEmail = useCallback(async () => {
    if (!form.email) return;
    try {
      const res = await api.post('/auth/check-email', { email: form.email });
      setEmailAvailable(res.data.available);
    } catch {
      setEmailAvailable(null);
    }
  }, [form.email]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    else if (form.firstName.trim().length < 2) e.firstName = 'Must be at least 2 characters';
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    else if (form.lastName.trim().length < 2) e.lastName = 'Must be at least 2 characters';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (!form.phone.trim()) e.phone = 'Phone is required';
    if (!form.zip.trim()) e.zip = 'Zip code is required';
    else if (form.zip.length < 5) e.zip = 'Enter a valid 5-digit zip code';
    if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (!form.ageConfirmed) e.ageConfirmed = 'You must confirm you are 18 or older';
    if (!form.privacyConsent) e.privacyConsent = 'You must agree to the Privacy Policy';
    if (emailAvailable === false) e.email = 'This email is already registered';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await api.post('/auth/register/start', {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone,
        zip: form.zip,
        ageConfirmed: form.ageConfirmed
      });
      toast.success('Info saved! Please review terms.');
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
    <form onSubmit={handleSubmit} className="space-y-5">
      {errors.general && (
        <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {errors.general}
        </div>
      )}

      <button type="button" disabled className="w-full py-3 bg-gray-800 border border-gray-600 rounded-lg text-gray-300 font-medium flex items-center justify-center gap-2 opacity-60 cursor-not-allowed">
        <span className="text-lg">G</span> Continue with Google (Coming Soon)
      </button>

      <div className="flex items-center gap-3 text-gray-500 text-sm">
        <div className="flex-1 h-px bg-gray-700" />
        <span>or</span>
        <div className="flex-1 h-px bg-gray-700" />
      </div>

      {/* Name fields */}
      <div>
        <div className="grid grid-cols-2 gap-4">
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

      <div>
        <label htmlFor="email" className="block text-sm text-gray-300 mb-1">Email</label>
        <input id="email" type="email" autoComplete="email" placeholder="jane@example.com"
          value={form.email} onChange={e => set('email', e.target.value)} onBlur={checkEmail}
          className={inputClass} aria-required="true" aria-invalid={!!errors.email} inputMode="email" />
        {emailAvailable === true && <p className="text-green-400 text-xs mt-1">Email is available</p>}
        {emailAvailable === false && <p className="text-red-400 text-xs mt-1">Email is already taken</p>}
        {errors.email && <p className="text-red-400 text-xs mt-1" role="alert">{errors.email}</p>}
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm text-gray-300 mb-1">Phone (+1)</label>
        <input id="phone" type="tel" autoComplete="tel" placeholder="(555) 123-4567"
          value={form.phone} onChange={e => set('phone', e.target.value)}
          className={inputClass} aria-required="true" aria-invalid={!!errors.phone} inputMode="tel" />
        {errors.phone && <p className="text-red-400 text-xs mt-1" role="alert">{errors.phone}</p>}
      </div>

      <div>
        <label htmlFor="zip" className="block text-sm text-gray-300 mb-1">Zip Code</label>
        <input id="zip" type="text" autoComplete="postal-code" placeholder="40291"
          value={form.zip} onChange={e => set('zip', e.target.value)}
          className={inputClass} aria-required="true" aria-invalid={!!errors.zip} inputMode="numeric" />
        <p className="text-xs text-gray-500 mt-1">Used to show services and helpers near you</p>
        {errors.zip && <p className="text-red-400 text-xs mt-1" role="alert">{errors.zip}</p>}
      </div>

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
        {loading ? 'Creating Account...' : 'Find Local Help'}
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
