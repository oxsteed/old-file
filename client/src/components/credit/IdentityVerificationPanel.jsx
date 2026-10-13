import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';
import {
  appealOxsteedCreditIdentityVerification,
  getOxsteedCreditIdentityVerification,
  requestOxsteedCreditIdentityVerification,
} from '../../api/oxsteedCredit';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import { safeCreditErrorMessage } from '../../lib/creditErrors';

// P3-10-F05: the credit-rail identity-verification request previously had no
// client UI, so users blocked at tier 0 (no fiat funding) had no path to
// unblock. This panel shows the current KYC tier with per-tier funding
// limits, lets the user request verification (Didit auto-grant when a
// verified Didit identity is on file, manual review queue otherwise), and
// offers the appeal path after a rejection.
export default function IdentityVerificationPanel({ currency = 'USD' }) {
  const { t } = useTranslation('credit');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [requestedTier, setRequestedTier] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealing, setAppealing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOxsteedCreditIdentityVerification();
      setStatus(data || null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitRequest = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await requestOxsteedCreditIdentityVerification({ requestedTier });
      toast.success(t('identityVerification.requestSubmitted'));
      await load();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('identityVerification.requestFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  const submitAppeal = async (event) => {
    event.preventDefault();
    const verificationId = status?.latestVerification?.id;
    if (appealing || !verificationId || !appealReason.trim()) return;
    setAppealing(true);
    try {
      await appealOxsteedCreditIdentityVerification(verificationId, { reason: appealReason.trim() });
      toast.success(t('identityVerification.appealSubmitted'));
      setAppealReason('');
      await load();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('identityVerification.appealFailed')));
    } finally {
      setAppealing(false);
    }
  };

  const tier = Number(status?.tier || 0);
  const verificationStatus = status?.status || 'none';
  const latest = status?.latestVerification || null;
  const limits = status?.tierLimitsCents || {};
  const showRequestForm = !loading && (tier === 0 || verificationStatus === 'expired' || verificationStatus === 'none');
  const showAppealForm = !loading && verificationStatus === 'rejected' && latest?.appealStatus !== 'pending';

  return (
    <section className="ox-credit-panel" aria-labelledby="identity-verification-heading" data-testid="identity-verification">
      <div className="ox-credit-panel-heading">
        <div>
          <p className="ox-credit-eyebrow">{t('identityVerification.eyebrow')}</p>
          <h2 id="identity-verification-heading">{t('identityVerification.title')}</h2>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </div>
      <p className="ox-credit-panel-copy">{t('identityVerification.intro')}</p>

      {loading && <p role="status" className="credit-modal-subtitle">{t('identityVerification.loading')}</p>}

      {!loading && (
        <dl className="ox-credit-details-list">
          <div>
            <dt>{t('identityVerification.currentTier')}</dt>
            <dd>{t('identityVerification.tierLabel', { tier })}</dd>
          </div>
          <div>
            <dt>{t('identityVerification.statusLabel')}</dt>
            <dd>{t(`identityVerification.status.${verificationStatus}`)}</dd>
          </div>
          {!!limits.tier1 && (
            <div>
              <dt>{t('identityVerification.tierLimit', { tier: 1 })}</dt>
              <dd>{formatCreditMinorUnits(limits.tier1, currency)}</dd>
            </div>
          )}
          {!!limits.tier2 && (
            <div>
              <dt>{t('identityVerification.tierLimit', { tier: 2 })}</dt>
              <dd>{formatCreditMinorUnits(limits.tier2, currency)}</dd>
            </div>
          )}
        </dl>
      )}

      {!loading && verificationStatus === 'verified' && tier < 2 && (
        <form className="credit-form" onSubmit={submitRequest}>
          <p className="credit-modal-subtitle">{t('identityVerification.upgradeCopy')}</p>
          <button type="submit" className="credit-primary" disabled={submitting} onClick={() => setRequestedTier(2)}>
            {submitting ? t('identityVerification.submitting') : t('identityVerification.requestTier2')}
          </button>
        </form>
      )}

      {!loading && verificationStatus === 'pending' && (
        <p role="status" className="credit-modal-subtitle">
          <strong>{t('identityVerification.pendingTitle')}</strong>
          <br />
          {t('identityVerification.pendingCopy')}
        </p>
      )}

      {showRequestForm && (
        <form className="credit-form" onSubmit={submitRequest}>
          <p className="credit-modal-subtitle">{t('identityVerification.requestCopy')}</p>
          <label>
            <span>{t('identityVerification.requestedTier')}</span>
            <select value={requestedTier} onChange={(event) => setRequestedTier(Number(event.target.value))}>
              <option value={1}>{t('identityVerification.tierOption', { tier: 1 })}</option>
              <option value={2}>{t('identityVerification.tierOption', { tier: 2 })}</option>
            </select>
          </label>
          <button type="submit" className="credit-primary" disabled={submitting}>
            {submitting ? t('identityVerification.submitting') : t('identityVerification.requestVerification')}
          </button>
        </form>
      )}

      {!loading && verificationStatus === 'rejected' && (
        <>
          <p role="status" className="credit-modal-subtitle">
            <strong>{t('identityVerification.rejectedTitle')}</strong>
            <br />
            {latest?.reviewReason
              ? t('identityVerification.rejectedCopyWithReason', { reason: latest.reviewReason })
              : t('identityVerification.rejectedCopy')}
          </p>
          {latest?.appealStatus === 'pending' ? (
            <p role="status" className="credit-modal-subtitle">{t('identityVerification.appealPendingCopy')}</p>
          ) : showAppealForm ? (
            <form className="credit-form" onSubmit={submitAppeal}>
              <label>
                <span>{t('identityVerification.appealReason')}</span>
                <textarea
                  value={appealReason}
                  onChange={(event) => setAppealReason(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder={t('identityVerification.appealReasonPlaceholder')}
                  required
                />
              </label>
              <button type="submit" className="credit-primary" disabled={appealing || !appealReason.trim()}>
                {appealing ? t('identityVerification.submitting') : t('identityVerification.submitAppeal')}
              </button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
