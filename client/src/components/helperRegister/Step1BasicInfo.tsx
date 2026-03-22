import { useState } from 'react';
import api from '../../api/axios';

interface Props {
  onSuccess: (token: string) => void;
}

export default function Step1BasicInfo({ onSuccess }: Props) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', zip: '',
    password: '', confirmPassword: '', ageConfirmed: false
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);
  const [zipError, setZipError] = useState('');

  const set = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const checkEmail = async () => {
    if (!form.email) return;
    setEmailChecking(true);
    try {
      await api.post('/auth/check-email', { email: form.email });
      setErrors(prev => ({ ...prev, email: '' }));
    } catch (err: any) {
      if (err.response?.status === 409) setErrors(prev => ({ ...prev, email: 'Email already registered' }));
    } finally { setEmailChecking(false); }
  };

  const checkZip = async () => {
    if (!form.zip || form.zip.length < 5) return;
    try {
      await api.post('/auth/check-zip', { zip: form.zip });
      setZipError('');
    } catch {
      setZipError('Service not available in your area yet');
    }
  };

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    if (!form.phone || form.phone.replace(/\D/g, '').length < 10) e.phone = 'Valid US phone required';
    if (!form.zip || form.zip.length < 5) e.zip = 'Valid zip code required';
    if (form.password.length < 8) e.password = 'Min 8 characters';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (!form.ageConfirmed) e.age = 'Must confirm age';
    if (zipError) e.zip = zipError;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await api.post('/auth/helper/register/start', {
        email: form.email, password: form.password,
        firstName: form.firstName, lastName: form.lastName,
        phone: form.phone.replace(/\D/g, ''), zip: form.zip,
        ageConfirmed: form.ageConfirmed
      });
      onSuccess(res.data.token);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Registration failed';
      if (msg.includes('Email')) setErrors(prev => ({ ...prev, email: msg }));
      else if (msg.includes('area')) setZipError(msg);
      else setErrors(prev => ({ ...prev, general: msg }));
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white">Become a Helper</h1>
      <p className="text-gray-400 text-sm">Step 1 of 7 - Basic Information</p>

      {errors.general && <p className="text-red-400 text-sm">{errors.general}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <input placeholder="First Name *" value={form.firstName}
            onChange={e => set('firstName', e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
          {errors.firstName && <p className="text-red-400 text-xs mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <input placeholder="Last Name *" value={form.lastName}
            onChange={e => set('lastName', e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
          {errors.lastName && <p className="text-red-400 text-xs mt-1">{errors.lastName}</p>}
        </div>
      </div>

      <div>
        <input type="email" placeholder="Email *" value={form.email}
          onChange={e => set('email', e.target.value)} onBlur={checkEmail}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
      </div>

      <div>
        <input placeholder="Phone (+1) *" value={form.phone}
          onChange={e => set('phone', formatPhone(e.target.value))}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
      </div>

      <div>
        <input placeholder="Zip Code *" value={form.zip} maxLength={5}
          onChange={e => set('zip', e.target.value.replace(/\D/g, '').slice(0, 5))}
          onBlur={checkZip}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        {(errors.zip || zipError) && <p className="text-red-400 text-xs mt-1">{errors.zip || zipError}</p>}
      </div>

      <div>
        <input type="password" placeholder="Password (min 8 chars) *" value={form.password}
          onChange={e => set('password', e.target.value)}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
      </div>

      <div>
        <input type="password" placeholder="Confirm Password *" value={form.confirmPassword}
          onChange={e => set('confirmPassword', e.target.value)}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        {errors.confirmPassword && <p className="text-red-400 text-xs mt-1">{errors.confirmPassword}</p>}
      </div>

      <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
        <input type="checkbox" checked={form.ageConfirmed}
          onChange={e => set('ageConfirmed', e.target.checked)}
          className="rounded border-gray-600" />
        I confirm I am 18 years of age or older
      </label>
      {errors.age && <p className="text-red-400 text-xs">{errors.age}</p>}

      <button type="submit" disabled={loading || !!errors.email || !!zipError}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
        {loading ? 'Validating...' : 'Continue to Profile'}
      </button>

      <p className="text-center text-gray-400 text-sm">
        Already have an account? <a href="/login" className="text-orange-500 hover:text-orange-400">Sign in</a>
      </p>
    </form>
  );
}
