import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, CheckCircle2, Save } from 'lucide-react';
import adminApi from '../lib/adminApi';
import CountrySelect from './CountrySelect';
import RegionInput from './RegionInput';
import PostalCodeInput from './PostalCodeInput';

/**
 * Comprehensive editor for the standard editable fields on a user record.
 * Submits to PUT /admin/super/users/:userId/edit-full.
 *
 * Props:
 *   user        – existing user object (must contain id and current values)
 *   onSaved     – callback(updatedUser) after successful save
 */
const ROLES = ['customer', 'helper', 'helper_pro', 'broker', 'admin'];

const SUBSCRIPTION_STATUSES = [
  'none', 'trial', 'active', 'past_due', 'canceled',
];

// Plain text fields rendered by the generic <input> loop. Country/state/zip
// are rendered with country-aware components below.
const TEXT_FIELDS = [
  { key: 'first_name',          labelKey: 'firstName'          },
  { key: 'last_name',           labelKey: 'lastName'           },
  { key: 'phone',               labelKey: 'phone'              },
  { key: 'city',                labelKey: 'city'               },
  { key: 'membership_tier',     labelKey: 'membershipTier'     },
];

const BOOLEAN_FIELDS = [
  { key: 'email_verified',          labelKey: 'emailVerified'          },
  { key: 'is_verified',             labelKey: 'identityVerified'       },
  { key: 'background_check_passed', labelKey: 'backgroundCheckPassed'   },
  { key: 'is_active',               labelKey: 'accountActive'           },
];

function buildInitial(user) {
  const out = {};
  TEXT_FIELDS.forEach(f => { out[f.key] = user[f.key] ?? ''; });
  BOOLEAN_FIELDS.forEach(f => { out[f.key] = !!user[f.key]; });
  out.country             = user.country || 'US';
  out.state               = user.state ?? '';
  out.zip_code            = user.zip_code ?? '';
  out.role                = user.role || 'customer';
  out.subscription_status = user.subscription_status || 'none';
  return out;
}

export default function UserEditForm({ user, onSaved }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`adminUsers.edit.${key}`, options);
  const [form,        setForm]        = useState(() => buildInitial(user));
  const [original]                    = useState(() => buildInitial(user));
  const [submitting,  setSubmitting]  = useState(false);
  const [errors,      setErrors]      = useState({});
  const [serverError, setServerError] = useState(null);
  const [success,     setSuccess]     = useState(null);
  const [notify,      setNotify]      = useState(false);
  const [message,     setMessage]     = useState('');

  // Refresh form if user prop changes
  useEffect(() => { setForm(buildInitial(user)); }, [user.id]); // eslint-disable-line

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  // Build payload of only changed fields
  const buildDiff = () => {
    const diff = {};
    Object.keys(form).forEach(k => {
      if (form[k] !== original[k]) diff[k] = form[k];
    });
    return diff;
  };

  const dirty = Object.keys(buildDiff()).length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    setServerError(null);
    setSuccess(null);

    const diff = buildDiff();
    if (Object.keys(diff).length === 0) {
      setServerError(copy('noChanges'));
      return;
    }

    setSubmitting(true);
    try {
      const payload = { ...diff };
      if (notify) {
        payload.notify_user = true;
        if (message.trim()) payload.notification_message = message.trim();
      }

      const { data } = await adminApi.put(
        `/admin/super/users/${user.id}/edit-full`, payload
      );

      const count = data.changes_count ?? data.changesCount ?? 0;
      setSuccess(
        count > 0
          ? `Saved ${count} change${count === 1 ? '' : 's'}.`
          : copy('noChangesDetected')
      );
      if (onSaved) onSaved(data.user || { ...user, ...diff });
    } catch (err) {
      const resp = err.response?.data;
      if (resp?.fields) setErrors(resp.fields);
      setServerError(resp?.error || copy('saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 ' +
    'text-gray-100 placeholder-gray-500 focus:outline-none ' +
    'focus:border-orange-500 focus:ring-1 focus:ring-orange-500';
  const labelCls = 'block text-xs font-medium text-gray-400 mb-1';

  const fieldErr = (k) => errors[k]
    ? <p className="text-xs text-red-400 mt-1">{errors[k]}</p>
    : null;

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

      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">{copy('profile')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TEXT_FIELDS.map(f => (
            <div key={f.key}>
              <label className={labelCls}>{copy(f.labelKey)}</label>
              <input
                type="text"
                className={inputCls}
                value={form[f.key] ?? ''}
                onChange={e => setField(f.key, e.target.value)}
              />
              {fieldErr(f.key)}
            </div>
          ))}
          <div>
            <label className={labelCls}>{copy('country')}</label>
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
            />
            {fieldErr('country')}
          </div>
          <div>
            <label className={labelCls}>{copy('stateRegion')}</label>
            <RegionInput
              className={inputCls}
              country={form.country}
              value={form.state}
              onChange={(v) => setField('state', v)}
            />
            {fieldErr('state')}
          </div>
          <div>
            <label className={labelCls}>{copy('postalCode')}</label>
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

      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">{copy('account')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{copy('role')}</label>
            <select
              className={inputCls}
              value={form.role}
              onChange={e => setField('role', e.target.value)}
            >
              {ROLES.map(r => <option key={r} value={r}>{copy(`roles.${r}`)}</option>)}
            </select>
            {fieldErr('role')}
          </div>
          <div>
            <label className={labelCls}>{copy('subscriptionStatus')}</label>
            <select
              className={inputCls}
              value={form.subscription_status}
              onChange={e => setField('subscription_status', e.target.value)}
            >
              {SUBSCRIPTION_STATUSES.map(s => <option key={s} value={s}>{copy(`subscriptions.${s}`)}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {BOOLEAN_FIELDS.map(f => (
            <label key={f.key} className="inline-flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={!!form[f.key]}
                onChange={e => setField(f.key, e.target.checked)}
                className="rounded bg-gray-900 border-gray-700"
              />
              {copy(f.labelKey)}
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-gray-800 bg-gray-950/50 p-4">
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={notify}
            onChange={e => setNotify(e.target.checked)}
            className="rounded bg-gray-900 border-gray-700"
          />
          {copy('notifyUser')}
        </label>
        {notify && (
          <textarea
            className={inputCls + ' min-h-[60px] mt-3'}
            placeholder={copy('notificationPlaceholder')}
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
        )}
      </section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
        <span className="text-xs text-gray-500 me-auto">
          {dirty
            ? copy('unsaved', { count: Object.keys(buildDiff()).length })
            : copy('noChanges')}
        </span>
        <button
          type="submit"
          disabled={submitting || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {submitting ? copy('saving') : copy('saveChanges')}
        </button>
      </div>
    </form>
  );
}
