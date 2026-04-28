import { useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, KeyRound, RefreshCw } from 'lucide-react';
import adminApi from '../lib/adminApi';

/**
 * Admin-driven password reset for an existing user.
 * Submits to PUT /admin/super/users/:userId/edit-full with {password,...}.
 *
 * Props:
 *   user     – { id, email }
 *   onSaved  – callback() on success
 */

function generatePassword(length = 14) {
  const charsets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghjkmnpqrstuvwxyz',
    '23456789',
    '!@#$%^&*-_=+',
  ];
  // Ensure one char from each charset
  let pwd = charsets.map(s => s[Math.floor(Math.random() * s.length)]).join('');
  const all = charsets.join('');
  while (pwd.length < length) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  // Fisher-Yates shuffle
  const arr = pwd.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

export default function PasswordResetForm({ user, onSaved }) {
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [show,        setShow]        = useState(false);
  const [notify,      setNotify]      = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [serverError, setServerError] = useState(null);
  const [success,     setSuccess]     = useState(null);

  const tooShort   = password.length > 0 && password.length < 8;
  const mismatch   = confirm.length > 0 && password !== confirm;
  const canSubmit  = !submitting && password.length >= 8 && !mismatch;

  const handleGenerate = () => {
    const pwd = generatePassword(14);
    setPassword(pwd);
    setConfirm(pwd);
    setShow(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);
    setSuccess(null);
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const payload = { password };
      if (notify) payload.notify_user = true;

      await adminApi.put(`/admin/super/users/${user.id}/edit-full`, payload);

      setSuccess('Password updated successfully.');
      setPassword('');
      setConfirm('');
      setShow(false);
      if (onSaved) onSaved();
    } catch (err) {
      const resp = err.response?.data;
      setServerError(resp?.error || 'Failed to update password.');
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-orange-400" />
          <h3 className="text-sm font-semibold text-gray-200">Reset password</h3>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-orange-400"
        >
          <RefreshCw size={12} />
          Generate strong password
        </button>
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
        <label className={labelCls}>New password (min 8 characters) *</label>
        <input
          type={show ? 'text' : 'password'}
          className={inputCls}
          value={password}
          onChange={e => setPassword(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
        />
        {tooShort && (
          <p className="text-xs text-red-400 mt-1">Must be at least 8 characters.</p>
        )}
      </div>

      <div>
        <label className={labelCls}>Confirm password *</label>
        <input
          type={show ? 'text' : 'password'}
          className={inputCls}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
        {mismatch && (
          <p className="text-xs text-red-400 mt-1">Passwords do not match.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={show}
            onChange={e => setShow(e.target.checked)}
            className="rounded bg-gray-900 border-gray-700"
          />
          Show password
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={notify}
            onChange={e => setNotify(e.target.checked)}
            className="rounded bg-gray-900 border-gray-700"
          />
          Notify the user
        </label>
      </div>

      <div className="rounded-md bg-yellow-950/50 border border-yellow-800 p-3 text-xs text-yellow-300">
        <strong>Heads up:</strong> The password is hashed before storage. The
        plaintext is never written to logs and will not be retrievable after this
        action — share it with the user via a secure channel before leaving this page.
      </div>

      <div className="flex items-center justify-end pt-2 border-t border-gray-800">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}
