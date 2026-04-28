import { useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import adminApi from '../lib/adminApi';

/**
 * Focused form for changing a user's email.
 * Submits to PUT /admin/super/users/:userId/edit-full with {email,...}.
 *
 * Props:
 *   user     – { id, email }
 *   onSaved  – callback({email}) on success
 */
export default function EmailChangeForm({ user, onSaved }) {
  const [email,           setEmail]           = useState(user.email || '');
  const [confirm,         setConfirm]         = useState('');
  const [verifyEmail,     setVerifyEmail]     = useState(false);
  const [notify,          setNotify]          = useState(true);
  const [submitting,      setSubmitting]      = useState(false);
  const [serverError,     setServerError]     = useState(null);
  const [success,         setSuccess]         = useState(null);

  const sameAsCurrent = email.trim().toLowerCase() === (user.email || '').toLowerCase();
  const emailMismatch = confirm.length > 0 && confirm !== email;

  const canSubmit =
    !submitting &&
    email.trim().length > 0 &&
    !sameAsCurrent &&
    !emailMismatch;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);
    setSuccess(null);

    if (!email.trim() || sameAsCurrent || emailMismatch) return;

    setSubmitting(true);
    try {
      const payload = {
        email: email.trim().toLowerCase(),
      };
      if (verifyEmail) payload.email_verified = true;
      if (notify) payload.notify_user = true;

      const { data } = await adminApi.put(
        `/admin/super/users/${user.id}/edit-full`, payload
      );

      setSuccess(`Email updated to ${payload.email}.`);
      setConfirm('');
      if (onSaved) onSaved(data.user || { ...user, email: payload.email });
    } catch (err) {
      const resp = err.response?.data;
      setServerError(resp?.error || 'Failed to update email.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 ' +
    'text-gray-100 placeholder-gray-500 focus:outline-none ' +
    'focus:border-orange-500 focus:ring-1 focus:ring-orange-500';
  const labelCls = 'block text-xs font-medium text-gray-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2">
        <Mail size={16} className="text-orange-400" />
        <h3 className="text-sm font-semibold text-gray-200">Change email</h3>
      </div>

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

      <div>
        <label className={labelCls}>Current email</label>
        <input
          type="email"
          className={inputCls + ' opacity-60'}
          value={user.email || ''}
          disabled
          readOnly
        />
      </div>

      <div>
        <label className={labelCls}>New email *</label>
        <input
          type="email"
          className={inputCls}
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
      </div>

      <div>
        <label className={labelCls}>Confirm new email</label>
        <input
          type="email"
          className={inputCls}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="off"
          placeholder="Re-enter new email to confirm"
        />
        {emailMismatch && (
          <p className="text-xs text-red-400 mt-1">Emails do not match.</p>
        )}
        {sameAsCurrent && email.length > 0 && (
          <p className="text-xs text-yellow-400 mt-1">
            New email is the same as the current one.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={verifyEmail}
            onChange={e => setVerifyEmail(e.target.checked)}
            className="rounded bg-gray-900 border-gray-700"
          />
          Mark new email as verified
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={notify}
            onChange={e => setNotify(e.target.checked)}
            className="rounded bg-gray-900 border-gray-700"
          />
          Notify the user of this change
        </label>
      </div>

      <div className="flex items-center justify-end pt-2 border-t border-gray-800">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? 'Updating…' : 'Update email'}
        </button>
      </div>
    </form>
  );
}
