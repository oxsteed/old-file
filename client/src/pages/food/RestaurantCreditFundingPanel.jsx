import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  getCreditFundingPath,
  submitCreditFundingProof,
  uploadFoodAsset,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

/**
 * Approval funding step: the restaurant funds its OxSteed Credit reserve.
 *
 * Two paths (determined server-side by Stripe availability for the
 * restaurant's country):
 *  - stripe: "Fund your reserve" button -> Stripe checkout (Phase 4 flow).
 *  - manual: OxSteed's payment instructions + proof upload form.
 *
 * Approval isn't complete until funding_status = 'funded': the banner
 * stays until then.
 */
export default function RestaurantCreditFundingPanel({ restaurant, approval, onFunded }) {
  const { t } = useTranslation('credit');
  const [fundingPath, setFundingPath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCreditFundingPath(restaurant.id);
      setFundingPath(data);
    } catch (error) {
      toast.error(apiErrorMessage(error, t('creditFunding.loadFailed', 'Unable to load funding options.')));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, t]);

  useEffect(() => { load(); }, [load]);

  // Already funded: nothing to do.
  if (!loading && approval?.fundingStatus === 'funded') return null;
  // Not yet approved: funding comes after approval.
  if (!loading && approval && approval.status !== 'approved') return null;

  const handleProofUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'credit-funding-proof');
      setProof({ url: uploaded?.url, name: file.name });
      toast.success(t('creditFunding.proofUploaded', 'Proof uploaded.'));
    } catch (error) {
      toast.error(apiErrorMessage(error, t('creditFunding.uploadFailed', 'Proof upload failed.')));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitProof = async (event) => {
    event.preventDefault();
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      toast.error(t('creditFunding.validAmount', 'Enter a valid funding amount.'));
      return;
    }
    if (!proof?.url && !reference.trim()) {
      toast.error(t('creditFunding.proofRequired', 'Upload proof of payment or enter a reference.'));
      return;
    }
    setSubmitting(true);
    try {
      await submitCreditFundingProof({
        restaurantId: restaurant.id,
        amountCents,
        currencyCode: fundingPath?.fundingPath?.currencyCode || 'USD',
        proofUrl: proof?.url || undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        idempotencyKey: `funding-proof:${restaurant.id}:${Date.now()}`,
      });
      toast.success(t('creditFunding.submitted', 'Funding proof submitted for review.'));
      setAmount('');
      setReference('');
      setNote('');
      setProof(null);
      load();
      onFunded?.();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('creditFunding.submitFailed', 'Could not submit funding proof.')));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="fd-credit-funding-panel"><p>{t('creditFunding.loading', 'Loading funding options…')}</p></div>;
  }

  const method = fundingPath?.fundingPath?.method;
  const instructions = fundingPath?.fundingPath?.instructions;

  return (
    <div className="fd-credit-funding-panel" role="region" aria-label={t('creditFunding.title', 'Fund your credit reserve')}>
      <h3>{t('creditFunding.title', 'Fund your credit reserve')}</h3>
      <p className="fd-credit-funding-lede">
        {t('creditFunding.lede', 'Your approval is almost complete. Fund your OxSteed Credit reserve to start issuing restaurant credit.')}
      </p>

      {method === 'stripe' && (
        <div className="fd-credit-funding-stripe">
          <p>{t('creditFunding.stripeBody', 'Pay securely by card via Stripe. Your reserve is credited automatically once payment succeeds.')}</p>
          {/* The Stripe checkout button lives in RestaurantCreditReservePanel (Phase 4 flow). */}
          <p className="fd-credit-funding-hint">{t('creditFunding.stripeHint', 'Use the reserve purchase panel below to fund by card.')}</p>
        </div>
      )}

      {method === 'manual' && (
        <div className="fd-credit-funding-manual">
          {instructions ? (
            <div className="fd-credit-funding-instructions">
              <strong>{t('creditFunding.sendTo', 'Send your payment to:')}</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{instructions.instructions}</p>
              {instructions.qrUrl && (
                <img src={instructions.qrUrl} alt={t('creditFunding.qrAlt', 'Payment QR code')} className="fd-credit-funding-qr" />
              )}
              {instructions.referenceHint && (
                <p className="fd-credit-funding-hint">{instructions.referenceHint}</p>
              )}
            </div>
          ) : (
            <p className="fd-credit-funding-hint">
              {t('creditFunding.noInstructions', 'Manual funding is not yet configured for your country. Please contact OxSteed support.')}
            </p>
          )}

          {instructions && (
            <form onSubmit={handleSubmitProof} className="fd-credit-funding-form">
              <label>
                <span>{t('creditFunding.amount', 'Amount you sent')}</span>
                <input
                  type="number" min="1" step="0.01" required
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label>
                <span>{t('creditFunding.proof', 'Proof of payment')}</span>
                {proof?.name ? (
                  <span className="fd-credit-funding-proof-name">{proof.name}</span>
                ) : (
                  <input type="file" accept="image/*,application/pdf" onChange={handleProofUpload} disabled={uploading} />
                )}
              </label>
              <label>
                <span>{t('creditFunding.reference', 'Payment reference (optional)')}</span>
                <input
                  value={reference} onChange={(e) => setReference(e.target.value)}
                  maxLength={160}
                  placeholder={t('creditFunding.referencePlaceholder', 'Transaction ID or reference number')}
                />
              </label>
              <label>
                <span>{t('creditFunding.note', 'Note (optional)')}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
              </label>
              <button type="submit" disabled={submitting || uploading} className="fd-btn-primary">
                {submitting
                  ? t('creditFunding.submitting', 'Submitting…')
                  : t('creditFunding.submit', 'Submit for verification')}
              </button>
              <p className="fd-credit-funding-hint">
                {t('creditFunding.reviewNote', 'OxSteed reviews your proof and credits your reserve once verified.')}
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
