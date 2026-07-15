import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { uploadAppAsset } from '../api/uploads';

function currencyLabel(amountCents, currencyCode = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currencyCode || 'USD').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amountCents || 0) / 100);
  } catch {
    return `$${(Number(amountCents || 0) / 100).toFixed(2)}`;
  }
}

const PROVIDERS = [
  { value: 'cash', label: 'Cash' },
  { value: 'cash_app', label: 'Cash App' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

export default function DirectPaymentRecordModal({
  isOpen,
  title,
  subtitle,
  sourceType,
  sourceId,
  sourceLabel,
  amountCents,
  currencyCode = 'USD',
  payerId = null,
  payeeId = null,
  businessId = null,
  defaultProvider = 'cash_app',
  onClose,
  onSuccess,
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState(defaultProvider);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [proofLink, setProofLink] = useState('');
  const [proofAttachment, setProofAttachment] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const displayAmount = useMemo(() => currencyLabel(amountCents, currencyCode), [amountCents, currencyCode]);

  useEffect(() => {
    if (!isOpen) return;
    setProvider(defaultProvider);
    setConfirmationCode('');
    setProofLink('');
    setProofAttachment(null);
    setNote('');
    setError('');
    setLoading(false);
    setUploadingProof(false);
  }, [isOpen, defaultProvider, sourceId, sourceType]);

  if (!isOpen) return null;

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
      const { data } = await api.post('/main-app/payment-requests', {
        sourceType,
        sourceId,
        amountCents,
        currencyCode,
        payerId,
        payeeId,
        businessId,
        description: sourceLabel || title || 'Direct payment record',
        settlementMode: 'manual_direct',
        externalProvider: provider,
        metadata: {
          confirmationCode: confirmationCode.trim() || null,
          proofLink: proofLink.trim() || proofAttachment?.url || null,
          proofAttachment: proofAttachment || null,
          note: note.trim() || null,
          sourceLabel: sourceLabel || title || null,
          directPayment: true,
        },
      });

      toast.success(t('payment.directRecordSaved', 'Payment record saved.'));
      onSuccess?.(data);
      onClose?.();
    } catch (err) {
      const message = err?.response?.data?.error?.message
        || err?.response?.data?.error
        || err?.response?.data?.message
        || t('payment.directRecordFailed', 'Unable to save payment record.');
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
            DIRECT PAYMENT RECORD
          </p>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.5rem', color: 'var(--color-text)' }}>
            {title || 'Record a direct payment'}
          </h2>
          {subtitle && (
            <p style={{ margin: '0.5rem 0 0', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              {subtitle}
            </p>
          )}
        </div>

        <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.18)', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>
            {sourceLabel || 'Selected record'}
          </div>
          <div style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: '0.92rem' }}>
            Amount: <strong style={{ color: 'var(--color-text)' }}>{displayAmount}</strong> · This creates a record in the app so both sides can keep proof and follow up later.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Payment method used</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{ padding: '0.85rem 0.9rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            >
              {PROVIDERS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Confirmation number or reference</span>
            <input
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value)}
              placeholder="Last 4, confirmation code, receipt number, or message ID"
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
                  : 'Attach a receipt image, PDF, or screenshot so the proof is stored in the app history.'}
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
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>Notes for the other party</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Add context, payment timing, or anything the other party should confirm."
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
              {loading ? 'Saving…' : 'Save payment record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
