import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Save } from 'lucide-react';
import adminApi from '../lib/adminApi';

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

const TEXT_FIELDS = [
  { key: 'first_name',          label: 'First name'           },
  { key: 'last_name',           label: 'Last name'            },
  { key: 'phone',               label: 'Phone'                },
  { key: 'city',                label: 'City'                 },
  { key: 'state',               label: 'State', maxLength: 2  },
  { key: 'zip_code',            label: 'ZIP code'             },
  { key: 'membership_tier',     label: 'Membership tier'      },
];

const BOOLEAN_FIELDS = [
  { key: 'email_verified',          label: 'Email verified'           },
  { key: 'is_verified',             label: 'Identity verified'        },
  { key: 'background_check_passed', label: 'Background check passed'  },
  { key: 'is_active',               label: 'Account active'           },
];

function buildInitial(user) {
  const out = {};
  TEXT_FIELDS.forEach(f => { out[f.key] = user[f.key] ?? ''; });
  BOOLEAN_FIELDS.forEach(f => { out[f.key] = !!user[f.key]; });
  out.role                = user.role || 'customer';
  out.subscription_status = user.subscription_status || 'none';
  return out;
}

export default function UserEditForm({ user, onSaved }) {
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
      setServerError('No changes to save.');
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
          : 'No changes detected.'
      );
      if (onSaved) onSaved(data.user || { ...user, ...diff });
    } catch (err) {
      const resp = err.response?.data;
      if (resp?.fields) setErrors(resp.fields);
      setServerError(resp?.error || 'Failed to save changes.');
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
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Profile</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TEXT_FIELDS.map(f => (
            <div key={f.key}>
              <label className={labelCls}>{f.label}</label>
              <input
                type="text"
                className={inputCls}
                value={form[f.key] ?? ''}
                maxLength={f.maxLength}
                onChange={e => setField(
                  f.key,
                  f.key === 'state' ? e.target.value.toUpperCase() : e.target.value
                )}
              />
              {fieldErr(f.key)}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Account</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Role</label>
            <select
              className={inputCls}
              value={form.role}
              onChange={e => setField('role', e.target.value)}
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {fieldErr('role')}
          </div>
          <div>
            <label className={labelCls}>Subscription status</label>
            <select
              className={inputCls}
              value={form.subscription_status}
              onChange={e => setField('subscription_status', e.target.value)}
            >
              {SUBSCRIPTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
              {f.label}
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
          Notify user about these changes
        </label>
        {notify && (
          <textarea
            className={inputCls + ' min-h-[60px] mt-3'}
            placeholder="Optional message to include in the notification."
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
        )}
      </section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
        <span className="text-xs text-gray-500 mr-auto">
          {dirty
            ? `${Object.keys(buildDiff()).length} unsaved change(s)`
            : 'No changes'}
        </span>
        <button
          type="submit"
          disabled={submitting || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
