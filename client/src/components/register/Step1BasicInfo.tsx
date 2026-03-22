// Step 1: Basic Info - Customer Registration
import { useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface Props {
  onSuccess: (token: string) => void;
}

const inputBase = 'w-full p-3 border rounded bg-white text-gray-900 placeholder-gray-400';

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
    } catch (err: any) {
      if (err.response?.status === 409) {
        setEmailAvailable(false);
        setErrors(prev => ({ ...prev, email: 'Email already registered' }));
      }
    }
  }, [form.email]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    if (emailAvailable === false) e.email = 'Email already registered';
    if (!form.phone.trim()) e.phone = 'Required';
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) e.phone = 'Invalid phone number';
    if (!form.zip.trim()) e.zip = 'Required';
    if (form.zip.length < 5) e.zip = 'Enter a valid 5-digit zip code';
    if (form.password.length < 8) e.password = 'Min 8 characters';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (!form.ageConfirmed) e.ageConfirmed = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await api.post('/auth/register/start', {
        email: form.email, password: form.password,
        firstName: form.firstName, lastName: form.lastName,
        phone: form.phone, zip: form.zip, ageConfirmed: form.ageConfirmed
      });
      onSuccess(res.data.token);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Create Your Account</h2>
      <p className="text-gray-500 mb-6">Step 1 of 3 - Basic Information</p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <input placeholder="First Name *" value={form.firstName}
            onChange={e => update('firstName', e.target.value)}
            className={`${inputBase} ${errors.firstName ? 'border-red-500' : ''}`} />
          {errors.firstName && <span className="text-red-500 text-sm">{errors.firstName}</span>}
        </div>
        <div>
          <input placeholder="Last Name *" value={form.lastName}
            onChange={e => update('lastName', e.target.value)}
            className={`${inputBase} ${errors.lastName ? 'border-red-500' : ''}`} />
          {errors.lastName && <span className="text-red-500 text-sm">{errors.lastName}</span>}
        </div>
      </div>

      <div className="mb-3">
        <input type="email" placeholder="Email *" value={form.email}
          onChange={e => update('email', e.target.value)}
          onBlur={checkEmail}
          className={`${inputBase} ${errors.email ? 'border-red-500' : emailAvailable === true ? 'border-green-500' : ''}`} />
        {errors.email && <span className="text-red-500 text-sm">{errors.email}</span>}
        {emailAvailable === true && <span className="text-green-500 text-sm">Email available</span>}
      </div>

      <div className="mb-3">
        <input type="tel" placeholder="Phone (+1) *" value={form.phone}
          onChange={e => update('phone', e.target.value)}
          className={`${inputBase} ${errors.phone ? 'border-red-500' : ''}`} />
        {errors.phone && <span className="text-red-500 text-sm">{errors.phone}</span>}
      </div>

      <div className="mb-3">
        <input placeholder="Zip Code *" value={form.zip} maxLength={5}
          onChange={e => update('zip', e.target.value)}
          className={`${inputBase} ${errors.zip ? 'border-red-500' : ''}`} />
        <p className="text-xs text-gray-400 mt-1">Used to show services and helpers near you</p>
        {errors.zip && <span className="text-red-500 text-sm">{errors.zip}</span>}
      </div>

      <div className="mb-3">
        <input type="password" placeholder="Password (min 8 chars) *" value={form.password}
          onChange={e => update('password', e.target.value)}
          className={`${inputBase} ${errors.password ? 'border-red-500' : ''}`} />
        {errors.password && <span className="text-red-500 text-sm">{errors.password}</span>}
      </div>

      <div className="mb-4">
        <input type="password" placeholder="Confirm Password *" value={form.confirmPassword}
          onChange={e => update('confirmPassword', e.target.value)}
          className={`${inputBase} ${errors.confirmPassword ? 'border-red-500' : ''}`} />
        {errors.confirmPassword && <span className="text-red-500 text-sm">{errors.confirmPassword}</span>}
      </div>

      <label className="flex items-start gap-2 mb-6 cursor-pointer">
        <input type="checkbox" checked={form.ageConfirmed}
          onChange={e => update('ageConfirmed', e.target.checked)}
          className="mt-1" />
        <span className="text-sm">I confirm I am 18 years of age or older</span>
      </label>
      {errors.ageConfirmed && <span className="text-red-500 text-sm block -mt-4 mb-4">{errors.ageConfirmed}</span>}

      <button type="submit" disabled={loading}
        className="w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 disabled:opacity-50">
        {loading ? 'Validating...' : 'Continue to Terms'}
      </button>
      <p className="text-center text-sm text-gray-500 mt-4">
        Already have an account? <a href="/login" className="text-blue-600 underline">Sign in</a>
      </p>
    </form>
  );
}
