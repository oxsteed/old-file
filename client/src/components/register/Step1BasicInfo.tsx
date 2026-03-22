// Step 1: Basic Info - Customer Registration
import { useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface Props {
  onSuccess: (token: string) => void;
}

const inputBase = 'w-full p-3 bg-gray-800/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors';

export default function Step1BasicInfo({ onSuccess }: Props) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', zip: '',
    password: '', confirmPassword: '', ageConfirmed: false
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  // Check email on blur
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
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    if (!form.phone.trim()) e.phone = 'Phone is required';
    if (!form.zip.trim()) e.zip = 'Zip code is required';
    else if (form.zip.length < 5) e.zip = 'Enter a valid 5-digit zip code';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (!form.ageConfirmed) e.ageConfirmed = 'You must confirm you are 18 or older';
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
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        zip: form.zip,
        ageConfirmed: form.ageConfirmed
      });
      toast.success('Info saved! Please review terms.');
      onSuccess(res.data.token);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-2xl font-bold text-white">Create Your Account</h2>
        <p className="text-gray-400 text-sm mt-1">Step 1 of 3 - Basic Information</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <input type="text" placeholder="First Name *" value={form.firstName}
            onChange={e => update('firstName', e.target.value)}
            className={`${inputBase} ${errors.firstName ? 'border-red-500' : ''}`} />
          {errors.firstName && <span className="text-red-400 text-xs mt-1">{errors.firstName}</span>}
        </div>
        <div className="flex-1">
          <input type="text" placeholder="Last Name *" value={form.lastName}
            onChange={e => update('lastName', e.target.value)}
            className={`${inputBase} ${errors.lastName ? 'border-red-500' : ''}`} />
          {errors.lastName && <span className="text-red-400 text-xs mt-1">{errors.lastName}</span>}
        </div>
      </div>

      <div>
        <input type="email" placeholder="Email *" value={form.email}
          onChange={e => update('email', e.target.value)}
          onBlur={checkEmail}
          className={`${inputBase} ${errors.email ? 'border-red-500' : ''}`} />
        {emailAvailable === true && <span className="text-emerald-400 text-xs mt-1">Email is available</span>}
        {emailAvailable === false && <span className="text-red-400 text-xs mt-1">Email is already taken</span>}
        {errors.email && <span className="text-red-400 text-xs mt-1">{errors.email}</span>}
      </div>

      <div>
        <input type="tel" placeholder="Phone (+1) *" value={form.phone}
          onChange={e => update('phone', e.target.value)}
          className={`${inputBase} ${errors.phone ? 'border-red-500' : ''}`} />
        {errors.phone && <span className="text-red-400 text-xs mt-1">{errors.phone}</span>}
      </div>

      <div>
        <input type="text" placeholder="Zip Code *" value={form.zip}
          onChange={e => update('zip', e.target.value)}
          className={`${inputBase} ${errors.zip ? 'border-red-500' : ''}`} />
        <p className="text-gray-500 text-xs mt-1">Used to show services and helpers near you</p>
        {errors.zip && <span className="text-red-400 text-xs mt-1">{errors.zip}</span>}
      </div>

      <div>
        <input type="password" placeholder="Password (min 8 chars) *" value={form.password}
          onChange={e => update('password', e.target.value)}
          className={`${inputBase} ${errors.password ? 'border-red-500' : ''}`} />
        {errors.password && <span className="text-red-400 text-xs mt-1">{errors.password}</span>}
      </div>

      <div>
        <input type="password" placeholder="Confirm Password *" value={form.confirmPassword}
          onChange={e => update('confirmPassword', e.target.value)}
          className={`${inputBase} ${errors.confirmPassword ? 'border-red-500' : ''}`} />
        {errors.confirmPassword && <span className="text-red-400 text-xs mt-1">{errors.confirmPassword}</span>}
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={form.ageConfirmed}
          onChange={e => update('ageConfirmed', e.target.checked)}
          className="mt-1 accent-blue-500" />
        <span className="text-sm text-gray-300">I confirm I am 18 years of age or older</span>
      </label>
      {errors.ageConfirmed && <span className="text-red-400 text-xs block -mt-3">{errors.ageConfirmed}</span>}

      <button type="submit" disabled={loading}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-lg shadow-blue-600/25">
        {loading ? 'Validating...' : 'Continue to Terms'}
      </button>

      <p className="text-center text-sm text-gray-500">
        Already have an account? <a href="/login" className="text-blue-400 hover:text-blue-300 underline">Sign in</a>
      </p>
    </form>
  );
}
