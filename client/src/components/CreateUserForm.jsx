import { useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import adminApi from '../lib/adminApi';

/**
 * Full user creation form used by super-admins.
 * Submits to POST /admin/super/users/create-full.
 *
 * Props:
 *   onCreated  – callback(user) fired after successful creation
 *   onCancel   – callback fired when the user clicks Cancel
 */
const ROLES = [
  { value: 'customer',   label: 'Customer' },
  { value: 'helper',     label: 'Helper' },
  { value: 'helper_pro', label: 'Helper Pro' },
  { value: 'broker',     label: 'Broker' },
];

const SUBSCRIPTION_STATUSES = [
  'none', 'trial', 'active', 'past_due', 'canceled',
];

const INITIAL = {
  email: '',
  password: '',
  first_name: '',
  last_name: '',
  phone: '',
  city: '',
  state: '',
  zip_code: '',
  role: 'customer',
  membership_tier: '',
  subscription_status: 'none',
  email_verified: false,
  is_verified: false,
  background_check_passed: false,
  business_name: '',
  notes: '',
};

export default function CreateUserForm({ onCreated, onCancel }) {
  const [form,        setForm]        = useState(INITIAL);
  const [submitting,  setSubmitting]  = useState(false);
  const [errors,      setErrors]      = useState({});
  const [serverError, setServerError] = useState(null);
  const [success,     setSuccess]     = useState(null);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    setServerError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const payload = { ...form };
      // Strip empty strings on optional fields so backend defaults apply
      ['membership_tier', 'business_name', 'notes', 'phone',
       'city', 'state', 'zip_code'].forEach(k => {
        if (payload[k] === '') payload[k] = null;
      });

      const { data } = await adminApi.post(
        '/admin/super/users/create-full', payload
      );

      setSuccess(`User ${data.user?.email || form.email} created successfully.`);
      setForm(INITIAL);
      if (onCreated) onCreated(data.user);
    } catch (err) {
      const resp = err.response?.data;
      if (resp?.fields) {
        setErrors(resp.fields);
      }
      setServerError(resp?.error || 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldErr = (k) => errors[k]
    ? <p className="text-xs text-red-400 mt-1">{errors[k]}</p>
    : null;

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 ' +
    'text-gray-100 placeholder-gray-500 focus:outline-none ' +
    'focus:border-orange-500 focus:ring-1 focus:ring-orange-500';

  const labelCls = 'block text-xs font-medium text-gray-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {serverError && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-950 border border-red-800 text-red-300 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{serverError}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-green-950 border border-green-800 text-green-300 text-sm">
          <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Identity */}
      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Identity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>First name *</label>
            <input
              type="text"
              className={inputCls}
              value={form.first_name}
              onChange={e => setField('first_name', e.target.value)}
              required
              autoComplete="off"
            />
            {fieldErr('first_name')}
          </div>
          <div>
            <label className={labelCls}>Last name *</label>
            <input
              type="text"
              className={inputCls}
              value={form.last_name}
              onChange={e => setField('last_name', e.target.value)}
              required
              autoComplete="off"
            />
            {fieldErr('last_name')}
          </div>
          <div>
            <label className={labelCls}>Email *</label>
            <input
              type="email"
              className={inputCls}
              value={form.email}
              onChange={e => setField('email', e.target.value)}
              required
              autoComplete="off"
            />
            {fieldErr('email')}
          </div>
          <div>
            <label className={labelCls}>Password *</label>
            <input
              type="password"
              className={inputCls}
              value={form.password}
              onChange={e => setField('password', e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            {fieldErr('password')}
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input
              type="tel"
              className={inputCls}
              value={form.phone}
              onChange={e => setField('phone', e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls}>Business name</label>
            <input
              type="text"
              className={inputCls}
              value={form.business_name}
              onChange={e => setField('business_name', e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      </section>

      {/* Location */}
      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Location</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>City</label>
            <input
              type="text"
              className={inputCls}
              value={form.city}
              onChange={e => setField('city', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>State</label>
            <input
              type="text"
              className={inputCls}
              value={form.state}
              onChange={e => setField('state', e.target.value.toUpperCase())}
              maxLength={2}
              placeholder="CA"
            />
          </div>
          <div>
            <label className={labelCls}>ZIP code</label>
            <input
              type="text"
              className={inputCls}
              value={form.zip_code}
              onChange={e => setField('zip_code', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Account */}
      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Account</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Role *</label>
            <select
              className={inputCls}
              value={form.role}
              onChange={e => setField('role', e.target.value)}
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {fieldErr('role')}
          </div>
          <div>
            <label className={labelCls}>Membership tier</label>
            <input
              type="text"
              className={inputCls}
              value={form.membership_tier}
              onChange={e => setField('membership_tier', e.target.value)}
              placeholder="auto (tier1/tier2 if helper)"
            />
          </div>
          <div>
            <label className={labelCls}>Subscription status</label>
            <select
              className={inputCls}
              value={form.subscription_status}
              onChange={e => setField('subscription_status', e.target.value)}
            >
              {SUBSCRIPTION_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.email_verified}
              onChange={e => setField('email_verified', e.target.checked)}
              className="rounded bg-gray-900 border-gray-700"
            />
            Email verified
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.is_verified}
              onChange={e => setField('is_verified', e.target.checked)}
              className="rounded bg-gray-900 border-gray-700"
            />
            Identity verified
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.background_check_passed}
              onChange={e => setField('background_check_passed', e.target.checked)}
              className="rounded bg-gray-900 border-gray-700"
            />
            Background check passed
          </label>
        </div>
      </section>

      {/* Notes */}
      <section>
        <label className={labelCls}>Internal notes</label>
        <textarea
          className={inputCls + ' min-h-[80px]'}
          value={form.notes}
          onChange={e => setField('notes', e.target.value)}
          placeholder="Optional. Visible to admins only."
        />
      </section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded-md text-sm text-gray-300 hover:text-white"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}
