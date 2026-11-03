import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import ConfirmDialog from '../../lib/ConfirmDialog';

export default function SubscriptionsAdminPage() {
  const { t } = useTranslation();
  const [subscriptionId, setSubscriptionId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);

  const openConfirm = (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!subscriptionId.trim()) {
      setError(t('adminSubscriptions.idRequired'));
      return;
    }
    setConfirmOpen(true);
  };

  const cancelSubscription = async (reason) => {
    const id = subscriptionId.trim();
    setBusy(true);
    setError('');
    setNotice('');
    setResult(null);
    try {
      // POST /api/admin/super/subscriptions/:id/cancel. The server requires
      // a non-empty reason, a fresh step-up challenge, ends credit
      // subscriptions immediately, and cancels Stripe subscriptions at
      // Stripe first. No admin list endpoint exists, so the id is entered
      // by hand.
      const challengeResponse = await adminApi.post('/admin/super/subscriptions/stepup-challenges', {});
      const challengeId = challengeResponse?.data?.challenge?.id;
      if (!challengeId) throw new Error(t('adminSubscriptions.stepupFailed'));
      const code = window.prompt(t('adminSubscriptions.stepupPrompt'));
      if (!code?.trim()) throw new Error(t('adminSubscriptions.stepupRequired'));
      const { data: body } = await adminApi.post(
        `/admin/super/subscriptions/${encodeURIComponent(id)}/cancel`,
        { reason, stepupChallengeId: challengeId, stepupCode: code.trim() },
      );
      setResult(body?.subscription || null);
      setNotice(body?.alreadyCancelled
        ? t('adminSubscriptions.alreadyCancelledNotice')
        : t('adminSubscriptions.cancelledNotice'));
    } catch (err) {
      const serverMessage = err?.response?.data?.error?.message
        || err?.response?.data?.message
        || err?.response?.data?.error;
      setError(typeof serverMessage === 'string' && serverMessage
        ? serverMessage
        : t('adminSubscriptions.failed'));
      // Throw an Error carrying only the string message so the confirm
      // dialog can render it; the raw axios error may carry an object.
      throw new Error(typeof serverMessage === 'string' && serverMessage
        ? serverMessage
        : t('adminSubscriptions.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-white text-xl font-bold mb-1">
        {t('adminSubscriptions.title')}
      </h1>
      <p className="text-gray-400 text-sm mb-4">
        {t('adminSubscriptions.subtitle')}
      </p>
      <p className="text-amber-300 text-sm mb-4">
        {t('adminSubscriptions.noListNote')}
      </p>

      {error && (
        <div role="alert" className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <form onSubmit={openConfirm} className="max-w-xl space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-400">
            {t('adminSubscriptions.idLabel')}
          </span>
          <input
            type="text"
            value={subscriptionId}
            onChange={(event) => setSubscriptionId(event.target.value)}
            placeholder={t('adminSubscriptions.idPlaceholder')}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {t('adminSubscriptions.reviewButton')}
        </button>
      </form>

      {result && (
        <div className="mt-6 max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-white font-semibold mb-2">
            {t('adminSubscriptions.resultTitle')}
          </h2>
          <dl className="space-y-1 text-sm text-gray-300">
            <div>
              <dt className="inline text-gray-500">{t('adminSubscriptions.resultId')} </dt>
              <dd className="inline font-mono">{String(result.id)}</dd>
            </div>
            <div>
              <dt className="inline text-gray-500">{t('adminSubscriptions.resultUser')} </dt>
              <dd className="inline font-mono">{String(result.user_id || '')}</dd>
            </div>
            <div>
              <dt className="inline text-gray-500">{t('adminSubscriptions.resultStatus')} </dt>
              <dd className="inline">{String(result.status || '')}</dd>
            </div>
            {result.payment_method && (
              <div>
                <dt className="inline text-gray-500">{t('adminSubscriptions.resultPaymentMethod')} </dt>
                <dd className="inline">{String(result.payment_method)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('adminSubscriptions.confirmTitle')}
        message={t('adminSubscriptions.confirmMessage', { id: subscriptionId.trim() })}
        confirmLabel={t('adminSubscriptions.confirmLabel')}
        cancelLabel={t('adminSubscriptions.cancelLabel')}
        danger
        requireReason
        reasonLabel={t('adminSubscriptions.reasonLabel')}
        reasonPlaceholder={t('adminSubscriptions.reasonPlaceholder')}
        onConfirm={cancelSubscription}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}
