import { useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import adminApi from '../lib/adminApi';
import CountrySelect from './CountrySelect';
import RegionInput from './RegionInput';
import PostalCodeInput from './PostalCodeInput';
import { detectCountryFromLocale } from '../lib/countries';

/**
 * Full user creation form used by super-admins.
 * Submits to POST /admin/super/users/create-full.
 *
 * Props:
 *   onCreated  – callback(user) fired after successful creation
 *   onCancel   – callback fired when the user clicks Cancel
 */
const ACCOUNT_TYPES = [
  { value: 'customer', label: 'Customer', hint: 'Standard customer account' },
  { value: 'helper', label: 'Helper', hint: 'Base helper account' },
  { value: 'helper_pro', label: 'Helper Pro', hint: 'Paid helper tier' },
  { value: 'broker', label: 'Broker', hint: 'Tier 3 helper / broker account' },
  { value: 'logistics', label: 'Logistics', hint: 'Core logistics buyer mode' },
  { value: 'business_owner', label: 'Business Owner', hint: 'Business workspace owner' },
  { value: 'consultant', label: 'Consultant', hint: 'Consulting workspace account' },
  { value: 'tool_owner', label: 'Tool Owner', hint: 'Tool-rental owner account' },
  { value: 'franchise_applicant', label: 'Franchise Applicant', hint: 'Franchise intake + status flow' },
  { value: 'life_only', label: 'Life Only', hint: 'Life dashboard only account' },
  { value: 'business_manager', label: 'Business Manager', hint: 'Granted business management workspace' },
  { value: 'business_representative', label: 'Business Representative', hint: 'Granted business representative workspace' },
  { value: 'business_employee', label: 'Business Employee', hint: 'Granted employee workspace' },
  { value: 'business_support_agent', label: 'Business Support Agent', hint: 'Granted support-agent workspace' },
  { value: 'employee', label: 'Employee', hint: 'Internal employee without admin portal access' },
  { value: 'operations_employee', label: 'Operations Employee', hint: 'Internal employee for logistics operations workspace' },
  { value: 'compliance_employee', label: 'Compliance Employee', hint: 'Internal employee for logistics compliance workspace' },
  { value: 'admin', label: 'Admin', hint: 'Internal admin portal account' },
  { value: 'super_admin', label: 'Super Admin', hint: 'Full internal platform access' },
];

// Must match the Postgres enum subscription_status defined in
// server/migrations/001_initial_schema.sql:
//   ('none', 'trialing', 'active', 'past_due', 'cancelled', 'paused')
// Mismatches here surface as cryptic 500 errors from the backend.
const SUBSCRIPTION_STATUSES = [
  { value: 'none',      label: 'None' },
  { value: 'trialing',  label: 'Trialing' },
  { value: 'active',    label: 'Active' },
  { value: 'past_due',  label: 'Past due' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'paused',    label: 'Paused' },
];

const INITIAL = {
  email: '',
  password: '',
  first_name: '',
  last_name: '',
  phone: '',
  country: detectCountryFromLocale('US'),
  city: '',
  state: '',
  zip_code: '',
  account_type: 'customer',
  membership_tier: '',
  subscription_status: 'none',
  email_verified: false,
  is_verified: false,
  background_check_passed: false,
  logistics_role: '',
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
       'city', 'state', 'zip_code', 'logistics_role'].forEach(k => {
        if (payload[k] === '') payload[k] = null;
      });
      // country always sent (backend defaults to 'US' but be explicit)

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
      // Backend may return { error, detail } - show the underlying detail to
      // super-admins so schema/enum/validation problems are debuggable.
      const baseMsg = resp?.error || 'Failed to create user.';
      const detail  = resp?.detail;
      setServerError(detail ? `${baseMsg} (${detail})` : baseMsg);
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
  const isLogisticsEmployeeType = ['employee', 'operations_employee', 'compliance_employee'].includes(form.account_type);

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelCls}>Country *</label>
            <CountrySelect
              className={inputCls}
              value={form.country}
              onChange={(code) => setForm(f => ({
                ...f,
                country: code,
                // Reset state/zip when the country changes - they're
                // country-specific.
                state: '',
                zip_code: '',
              }))}
              includeBlank={false}
              required
            />
            {fieldErr('country')}
          </div>
        </div>
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
            <label className={labelCls}>State / region</label>
            <RegionInput
              className={inputCls}
              country={form.country}
              value={form.state}
              onChange={(v) => setField('state', v)}
            />
            {fieldErr('state')}
          </div>
          <div>
            <label className={labelCls}>Postal code</label>
            <PostalCodeInput
              className={inputCls}
              country={form.country}
              value={form.zip_code}
              onChange={(v) => setField('zip_code', v)}
            />
            {fieldErr('zip_code')}
          </div>
        </div>
      </section>

      {isLogisticsEmployeeType && (
        <section>
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Internal Workspace</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Logistics role</label>
              <select
                className={inputCls}
                value={form.logistics_role}
                onChange={e => setField('logistics_role', e.target.value)}
              >
                <option value="">Use account-type default</option>
                <option value="logistics_coordinator">Logistics Coordinator</option>
                <option value="sourcing_operator">Sourcing Operator</option>
                <option value="warehouse_operator">Warehouse Operator</option>
                <option value="compliance_reviewer">Compliance Reviewer</option>
              </select>
              <p className="text-xs text-gray-500 mt-2">
                This controls which internal logistics workspace the employee can be provisioned into later.
              </p>
              {fieldErr('logistics_role')}
            </div>
          </div>
        </section>
      )}

      {/* Account */}
      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Account</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Account type *</label>
            <select
              className={inputCls}
              value={form.account_type}
              onChange={e => setField('account_type', e.target.value)}
            >
              {ACCOUNT_TYPES.map((accountType) => (
                <option key={accountType.value} value={accountType.value}>
                  {accountType.label}
                </option>
              ))}
            </select>
            {fieldErr('role')}
            <p className="text-xs text-gray-500 mt-2">
              {ACCOUNT_TYPES.find((accountType) => accountType.value === form.account_type)?.hint}
            </p>
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
                <option key={s.value} value={s.value}>{s.label}</option>
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
