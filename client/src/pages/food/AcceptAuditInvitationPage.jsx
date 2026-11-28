import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

// Group 14 Slice 5i (741, D-784): the invited accountant accepts an
// audit invitation. The page is public like /investor/invite: the
// verify step needs no account (id + email + code is the secret), and
// the accept step needs a signed-in account that owns the invited
// email. Accepting mints the time-limited share grant, so the request
// then appears in the accountant's audit-request list.
export default function AcceptAuditInvitationPage() {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.auditRequests.${key}`, options);
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(null);
  const [step, setStep] = useState('verify');
  const [message, setMessage] = useState('');
  const [signInRequired, setSignInRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const formatDate = (value) => {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch {
      return String(value);
    }
  };

  async function verify(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setSignInRequired(false);
    try {
      const { data } = await api.post('/audit-requests/invitations/verify', {
        invitationId: params.get('id') || undefined,
        email: email.trim(),
        code: code.trim(),
      });
      setVerified(data);
      setStep('accept');
      setMessage(text('inviteAcceptVerifiedNotice'));
    } catch (error) {
      setMessage(error?.response?.data?.error || text('loadError'));
    } finally {
      setBusy(false);
    }
  }

  async function accept(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setSignInRequired(false);
    try {
      await api.post('/audit-requests/invitations/accept', {
        invitationId: verified?.invitationId || params.get('id') || undefined,
        email: email.trim(),
        code: code.trim(),
      });
      setStep('done');
      setMessage(text('inviteAcceptAcceptedNotice'));
    } catch (error) {
      if (error?.response?.status === 401) setSignInRequired(true);
      setMessage(error?.response?.data?.error || text('loadError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10" dir={i18n.dir()}>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">{text('eyebrow')}</p>
      <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{text('inviteAcceptTitle')}</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{text('inviteAcceptDescription')}</p>
      {step === 'verify' && <form onSubmit={verify} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('inviteAcceptEmailLabel')}
          <input className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('inviteAcceptCodeLabel')}
          <input className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" inputMode="numeric" required value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <button className="w-full rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>{busy ? text('loading') : text('inviteAcceptVerify')}</button>
      </form>}
      {step === 'accept' && <form onSubmit={accept} className="mt-6 space-y-4">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {text('invitationExpiresAt', { date: formatDate(verified?.expiresAt) })}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">{text('inviteAcceptSignInPrompt')}</p>
        <button className="w-full rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>{busy ? text('loading') : text('inviteAcceptAccept')}</button>
      </form>}
      {step === 'done' && <div className="mt-6 space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">{text('inviteAcceptAcceptedNotice')}</p>
        <Link className="inline-block rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white" to="/statements/audit-requests">{text('inviteAcceptViewRequests')}</Link>
      </div>}
      {message && <p role={step === 'done' || step === 'accept' ? 'status' : 'alert'} className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300">{message}</p>}
      {signInRequired && <Link className="mt-3 inline-block text-sm text-sky-600 underline dark:text-sky-400" to="/login">{text('inviteAcceptSignInPrompt')}</Link>}
    </main>
  );
}
