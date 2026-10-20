import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CheckCircle2, X } from 'lucide-react';
import {
  getFoodWalletCreditCapacity,
  requestFoodWalletCredit,
  uploadFoodAsset,
} from '../../api/food';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { createStableIdempotencyKeyStore } from '../../lib/idempotency';
import './RestaurantCreditPage.css';

function Modal({ title, subtitle, onClose, children }) {
  const { t } = useTranslation('credit');
  return (
    <div className="credit-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="credit-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="credit-modal-close" onClick={onClose} aria-label={t('restaurantWallet.close')} data-track-private>
          <X size={20} />
        </button>
        <p className="credit-eyebrow">{t('restaurantWallet.restaurantCredit')}</p>
        <h2>{title}</h2>
        {subtitle && <p className="credit-modal-subtitle">{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}

function parseAmountCents(amount, currency) {
  const parsed = parseCreditMajorAmount(amount, currency);
  return parsed > 0 ? Math.round(parsed * 100) : 0;
}

export default function RequestCreditModal({ restaurantId, restaurantName, currency, paymentInstructions, paymentQrUrl, referenceHint, onClose, onChanged }) {
  const { t } = useTranslation('credit');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState(null);
  const [proofMethod, setProofMethod] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());
  // Phase 5 trial-tier cap: null while the capacity check is in flight.
  // Fail open on error (the server still enforces the cap authoritatively
  // on the request path with a 409); fail closed on display once we know.
  const [atCapacity, setAtCapacity] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getFoodWalletCreditCapacity(restaurantId)
      .then((result) => {
        if (!cancelled) setAtCapacity(Boolean(result?.at_capacity));
      })
      .catch(() => {
        if (!cancelled) setAtCapacity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const uploadProof = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'food-wallet-credit-proof');
      setProof({ url: uploaded?.url, name: file.name });
      toast.success(t('restaurantWallet.uploaded'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.uploadFailed')));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount, currency);
    if (!amountCents) return toast.error(t('restaurantWallet.validCreditAmount'));
    if (!reference.trim() && !proof?.url) return toast.error(t('restaurantWallet.proofRequired'));
    setSubmitting(true);
    const payload = {
      amountCents,
      paymentReference: reference.trim() || undefined,
      proofAttachmentUrl: proof?.url || undefined,
      note: note.trim() || undefined,
      fundingMethod: 'direct_payment',
    };
    const keyPayload = { restaurantId, ...payload };
    try {
      await requestFoodWalletCredit(restaurantId, {
        ...payload,
        idempotencyKey: idempotencyKeysRef.current.get('restaurant-wallet-credit-request', keyPayload),
      });
      idempotencyKeysRef.current.clear('restaurant-wallet-credit-request', keyPayload);
      toast.success(t('restaurantWallet.requestSent'));
      try {
        await onChanged?.();
      } catch {
        toast.error(t('restaurantWallet.refreshFailed'));
      }
      onClose();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.submitFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={atCapacity ? t('restaurantWallet.atCapacityTitle') : t('restaurantWallet.requestTitle')} subtitle={atCapacity ? undefined : t('restaurantWallet.requestSubtitle', { restaurant: restaurantName })} onClose={onClose}>
      {atCapacity === null ? (
        <p className="credit-modal-subtitle" role="status">{t('restaurantWallet.loading')}</p>
      ) : atCapacity ? (
        <div className="credit-capacity-notice" role="status">
          <p>{t('restaurantWallet.atCapacityBody')}</p>
        </div>
      ) : (
      <>
      {paymentInstructions && (
        <div className="credit-payment-info">
          <strong>{t('restaurantWallet.sendPaymentTo')}</strong>
          <p>{paymentInstructions}</p>
          {paymentQrUrl && <img src={paymentQrUrl} alt={t('restaurantWallet.paymentQrAlt')} className="credit-payment-qr" />}
          {referenceHint && <p className="credit-payment-hint">{referenceHint}</p>}
        </div>
      )}
      <form className="credit-form" onSubmit={submit} data-track-private>
        <label><span>{t('restaurantWallet.amountPaid')}</span><div className="credit-money-input"><span>{currency}</span><input autoFocus inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
        <div className="credit-proof-choice" role="group" aria-label={t('restaurantWallet.proofMethod')}>
          <button type="button" className={proofMethod === 'upload' ? 'active' : ''} onClick={() => { setProofMethod('upload'); setReference(''); }} data-track-private>{t('restaurantWallet.uploadReceipt')}</button>
          <button type="button" className={proofMethod === 'reference' ? 'active' : ''} onClick={() => { setProofMethod('reference'); setProof(null); }} data-track-private>{t('restaurantWallet.enterConfirmation')}</button>
        </div>
        {proofMethod === 'upload' ? (
          proof?.name ? (
            <div className="credit-proof-attached">
              <span><CheckCircle2 size={17} /><strong>{proof.name}</strong></span>
              <button type="button" onClick={() => setProof(null)} data-track-private>{t('restaurantWallet.remove')}</button>
            </div>
          ) : (
            <label className="credit-proof-upload"><span>{uploading ? t('restaurantWallet.uploading') : t('restaurantWallet.chooseProof')}</span><input type="file" accept="image/*,application/pdf" onChange={uploadProof} disabled={uploading} /></label>
          )
        ) : (
          <label><span>{t('restaurantWallet.confirmation')}</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} placeholder={t('restaurantWallet.confirmationPlaceholder')} /></label>
        )}
        <details className="credit-form-details">
          <summary>{t('restaurantWallet.noteOptional')}</summary>
          <label><span>{t('restaurantWallet.noteLabel')}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} placeholder={t('restaurantWallet.notePlaceholder')} /></label>
        </details>
        <button type="submit" className="credit-primary" disabled={submitting || uploading} data-track-private>{uploading ? t('restaurantWallet.uploading') : submitting ? t('restaurantWallet.sending') : t('restaurantWallet.sendApproval')}</button>
      </form>
      </>
      )}
    </Modal>
  );
}
