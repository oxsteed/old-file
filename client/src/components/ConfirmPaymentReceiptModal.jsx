import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { formatMoney } from '../lib/format';
import { uploadAppAsset } from '../api/uploads';

function currencyLabel(amountCents, currencyCode = 'USD') {
  return formatMoney((Number(amountCents || 0) / 100), { currency: currencyCode });
}

export default function ConfirmPaymentReceiptModal({
  isOpen,
  paymentRequest,
  onClose,
  onSuccess,
}) {
  const { t } = useTranslation();
  const [confirmationCode, setConfirmationCode] = useState('');
  const [proofLink, setProofLink] = useState('');
  const [proofAttachment, setProofAttachment] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(() => {
    if (!paymentRequest) return null;
    return {
      amount: currencyLabel(paymentRequest.amountCents, paymentRequest.currencyCode),
      description: paymentRequest.description || 'Payment record',
      status: paymentRequest.status,
    };
  }, [paymentRequest]);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmationCode('');
    setProofLink('');
    setProofAttachment(null);
    setNote('');
    setError('');
    setLoading(false);
    setUploadingProof(false);
  }, [isOpen, paymentRequest?.id]);

  if (!isOpen || !paymentRequest) return null;

  const handleProofUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setUploadingProof(true);
    try {
      const uploaded = await uploadAppAsset(file, 'main-payment-proof');
      const attachment = {
        url: uploaded.url,
        key: uploaded.key || null,
        name: file.name,
        type: uploaded.content_type || file.type || null,
        sizeBytes: uploaded.size_bytes || file.size || null,
      };
      setProofAttachment(attachment);
      if (!proofLink.trim()) {
        setProofLink(uploaded.url);
      }
      toast.success(t('payment.proofUploaded', 'Proof attachment uploaded.'));
    } catch (err) {
      const message = err?.response?.data?.error?.message
        || err?.response?.data?.error
        || err?.response?.data?.message
        || t('payment.proofUploadFailed', 'Unable to upload proof attachment.');
      setError(message);
      toast.error(message);
    } finally {
      setUploadingProof(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post(`/main-app/payment-requests/${paymentRequest.id}/confirm`, {
        confirmationCode: confirmationCode.trim() || null,
        proofLink: proofLink.trim() || proofAttachment?.url || null,
        proofAttachment: proofAttachment || null,
        note: note.trim() || null,
      });

      toast.success(t('payment.confirmed', 'Receipt confirmed.'));
      onSuccess?.(data?.paymentRequest || data);
      onClose?.();
    } catch (err) {
      const message = err?.response?.data?.error?.message
        || err?.response?.data?.error
        || err?.response?.data?.message
        || t('payment.confirmFailed', 'Unable to confirm payment receipt.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--color-surface)',
          borderRadius: 18,
          padding: '1.5rem',
          boxShadow: '0 18px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--color-primary)' }}>
            PAYMENT RECEIPT
          </p>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.5rem', color: 'var(--color-text)' }}>
            Confirm receipt
          </h2>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Mark this payment as confirmed so the other party can see the receipt history in the app.
          </p>
        </div>

        <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>{summary?.description}</div>
          <div style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: '0.92rem' }}>
            Amount: <strong style={{ color: 'var(--color-text)' }}>{summary?.amount}</strong> · Current status: <strong style={{ color: 'var(--color-text)' }}>{summary?.status}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Confirmation number or reference</span>
            <input
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value)}
              placeholder="Receipt number, confirmation code, or cash app reference"
              style={{ padding: '0.85rem 0.9rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Proof link or attachment URL</span>
            <input
              value={proofLink}
              onChange={(e) => setProofLink(e.target.value)}
              placeholder="Link to screenshot, PDF, receipt image, or shared file"
              style={{ padding: '0.85rem 0.9rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Upload proof attachment</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={handleProofUpload}
              disabled={uploadingProof}
              style={{ padding: '0.85rem 0.9rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              {uploadingProof
                ? 'Uploading proof attachment…'
                : proofAttachment
                  ? `Attached: ${proofAttachment.name}`
                  : 'Attach the receipt image, PDF, or screenshot so the confirmation shows up in history.'}
            </div>
            {proofAttachment && (
              <button
                type="button"
                onClick={() => setProofAttachment(null)}
                style={{ width: 'fit-content', padding: '0.45rem 0.7rem', borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.82rem', fontWeight: 700 }}
              >
                Remove attachment
              </button>
            )}
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Optional note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Add any clarification for the other party or support."
              style={{ padding: '0.85rem 0.9rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', resize: 'vertical' }}
            />
          </label>

          {error && (
            <div style={{ padding: '0.75rem 0.9rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fecaca' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" onClick={onClose} disabled={loading} style={{ padding: '0.8rem 1rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 700 }}>
              Cancel
            </button>
            <button type="submit" disabled={loading} style={{ padding: '0.8rem 1rem', borderRadius: 10, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 800 }}>
              {loading ? 'Confirming…' : 'Confirm receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
