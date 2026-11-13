import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import ConfirmDialog from '../../lib/ConfirmDialog';

function formatPreviewAmount(preview, unknown) {
  if (preview?.amountCents == null) return unknown;
  const currency = String(preview.currency || 'USD').toUpperCase();
  const amount = (Number(preview.amountCents) / 100).toFixed(2);
  return preview.interval ? `${amount} ${currency} / ${preview.interval}` : `${amount} ${currency}`;
}

function SubscriptionPreview({ preview, t }) {
  if (!preview) return null;
  return (
    <dl className="mt-4 space-y-1 rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-gray-300">
      <div>
        <dt className="inline text-gray-500">{t('adminSubscriptions.resultId')} </dt>
        <dd className="inline font-mono">{String(preview.id)}</dd>
      </div>
      <div>
        <dt className="inline text-gray-500">{t('adminSubscriptions.resultUser')} </dt>
        <dd className="inline">{preview.userDisplayName || t('adminSubscriptions.previewUnknown')}{preview.userEmail ? ` (${preview.userEmail})` : ''}</dd>
      </div>
      <div>
        <dt className="inline text-gray-500">{t('adminSubscriptions.previewPlan')} </dt>
        <dd className="inline">{preview.planName || t('adminSubscriptions.previewUnknown')}</dd>
      </div>
      <div>
        <dt className="inline text-gray-500">{t('adminSubscriptions.resultStatus')} </dt>
        <dd className="inline">{String(preview.status || '')}</dd>
      </div>
      <div>
        <dt className="inline text-gray-500">{t('adminSubscriptions.previewAmount')} </dt>
        <dd className="inline">{formatPreviewAmount(preview, t('adminSubscriptions.previewUnknown'))}</dd>
      </div>
      {preview.stripeCustomerId && (
        <div>
          <dt className="inline text-gray-500">{t('adminSubscriptions.previewStripeCustomer')} </dt>
          <dd className="inline font-mono">{String(preview.stripeCustomerId)}</dd>
        </div>
      )}
    </dl>
  );
}

export default function SubscriptionsAdminPage() {
  const { t } = useTranslation();
  const [subscriptionId, setSubscriptionId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Domain 7 #6: never confirm blind. The subscription is looked up and
  // previewed (user, plan, status, amount) before the confirm can proceed,
  // and the confirm stays disabled until a preview for the exact id entered
  // has loaded. A transposed id that matches a different subscription shows
  // that subscription's owner, so the admin can catch it.
  const lookupSubscription = async (id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      setPreview(null);
      setPreviewError('');
      return null;
    }
    setPreview(null);
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const { data: body } = await adminApi.get(`/admin/super/subscriptions/${encodeURIComponent(normalizedId)}`);
      const found = body?.subscription || null;
      if (!found || String(found.id) !== normalizedId) {
        setPreview(null);
        setPreviewError(t('adminSubscriptions.previewFailed'));
        return null;
      }
      setPreview(found);
      return found;
    } catch (err) {
      setPreview(null);
      const serverMessage = err?.response?.data?.error?.message
        || err?.response?.data?.message
        || err?.response?.data?.error;
      setPreviewError(typeof serverMessage === 'string' && serverMessage
        ? serverMessage
        : t('adminSubscriptions.previewFailed'));
      return null;
    } finally {
      setPreviewLoading(false);
    }
  };

  const openConfirm = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!subscriptionId.trim()) {
      setError(t('adminSubscriptions.idRequired'));
      return;
    }
    const found = preview && String(preview.id) === subscriptionId.trim()
      ? preview
      : await lookupSubscription(subscriptionId.trim());
    if (!found) return;
    setConfirmOpen(true);
  };

  const cancelSubscription = async (reason) => {
    const id = subscriptionId.trim();
    // Defense in depth (clawback pattern): no step-up is issued without a
    // loaded preview for this exact id, even if the dialog state is bypassed.
    if (!preview || String(preview.id) !== id) {
      throw new Error(t('adminSubscriptions.previewRequired'));
    }
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
      // A thrown Error without a server response (e.g. the preview guard
      // above) already carries the message to show; axios failures fall back
      // to the generic text instead of the axios status line.
      const message = typeof serverMessage === 'string' && serverMessage
        ? serverMessage
        : (!err?.response && typeof err?.message === 'string' && err.message
          ? err.message
          : t('adminSubscriptions.failed'));
      setError(message);
      // Throw an Error carrying only the string message so the confirm
      // dialog can render it; the raw axios error may carry an object.
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  };

  const previewMatchesId = preview && String(preview.id) === subscriptionId.trim();

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
            onChange={(event) => { setSubscriptionId(event.target.value); setPreview(null); setPreviewError(''); }}
            onBlur={() => { if (subscriptionId.trim() && !previewMatchesId) lookupSubscription(subscriptionId.trim()); }}
            placeholder={t('adminSubscriptions.idPlaceholder')}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
          />
        </label>
        {previewLoading && (
          <p role="status" className="text-sm text-gray-400">{t('adminSubscriptions.previewLoading')}</p>
        )}
        {previewError && (
          <p role="alert" className="text-sm text-red-300">{previewError}</p>
        )}
        {preview && (
          <div>
            <h2 className="text-white font-semibold">
              {t('adminSubscriptions.previewTitle')}
            </h2>
            <SubscriptionPreview preview={preview} t={t} />
          </div>
        )}
        <button
          type="submit"
          disabled={busy || previewLoading}
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
        message={(
          <>
            <p>{t('adminSubscriptions.confirmMessage', { id: subscriptionId.trim() })}</p>
            <SubscriptionPreview preview={previewMatchesId ? preview : null} t={t} />
          </>
        )}
        confirmLabel={t('adminSubscriptions.confirmLabel')}
        cancelLabel={t('adminSubscriptions.cancelLabel')}
        danger
        requireReason
        reasonLabel={t('adminSubscriptions.reasonLabel')}
        reasonPlaceholder={t('adminSubscriptions.reasonPlaceholder')}
        confirmDisabled={!previewMatchesId || previewLoading}
        onConfirm={cancelSubscription}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}
