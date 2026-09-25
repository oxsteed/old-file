import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import consultingPaymentApi from '../api/consultingPayment';
import DirectPaymentRecordModal from './DirectPaymentRecordModal';
import { X } from 'lucide-react';

export default function ConsultingPaymentModal({ sessionId, isOpen, onClose, onSuccess }) {
  const { t } = useTranslation();
  const [packages, setPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    loadPackages();
  }, [isOpen]);

  const loadPackages = async () => {
    try {
      setLoading(true);
      const response = await consultingPaymentApi.getPackages();
      const nextPackages = response.data || [];
      setPackages(nextPackages);
      setSelectedPackage((current) => current || nextPackages[0]?.id || null);
    } catch (err) {
      toast.error(t('payment.loadPackagesFailed'));
      console.error('Failed to load packages', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedPkg = useMemo(
    () => packages.find((pkg) => pkg.id === selectedPackage) || null,
    [packages, selectedPackage]
  );

  if (!isOpen) return null;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: 'var(--color-surface)',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '540px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--color-text)' }}>
              {t('payment.purchaseConsulting')}
            </h2>
            <button
              onClick={onClose}
              aria-label={t('common.aria.closeButton')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={24} />
            </button>
          </div>

          <p style={{ margin: '0 0 1.25rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {t('payment.consultingIntro')}
          </p>

          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem', color: 'var(--color-text)' }}>
                {t('payment.selectPackage')}
              </label>
              {loading ? (
                <div style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>
                  {t('common.loading')}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                  {packages.map((pkg) => (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setSelectedPackage(pkg.id)}
                      style={{
                        padding: '1rem',
                        border: selectedPackage === pkg.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        background: selectedPackage === pkg.id ? 'var(--color-surface)' : 'var(--color-bg)',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>{pkg.package_name}</div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                        ${(pkg.base_price / 100).toFixed(2)}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                        {pkg.duration_hours} {t('payment.hours')}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedPkg && (
              <div style={{ padding: '1rem', background: 'var(--color-bg)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.95rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                  {selectedPkg.description}
                </div>
                {selectedPkg.includes_deliverables && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    ✓ {t('payment.includesDeliverables')}
                  </div>
                )}
                {selectedPkg.max_revisions > 0 && (
                  <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    ✓ {selectedPkg.max_revisions} {t('payment.revisions')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!selectedPkg}
              onClick={() => setShowRecordModal(true)}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                cursor: selectedPkg ? 'pointer' : 'not-allowed',
                opacity: selectedPkg ? 1 : 0.6,
              }}
            >
              {t('payment.recordDirectButton')}
            </button>
          </div>
        </div>
      </div>

      <DirectPaymentRecordModal
        isOpen={showRecordModal && !!selectedPkg}
        title={t('payment.recordConsultingTitle')}
        subtitle={t('payment.recordConsultingSubtitle')}
        sourceType="other"
        sourceId={sessionId}
        sourceLabel={selectedPkg ? t('payment.consultingPackageLabel', { name: selectedPkg.package_name }) : t('payment.consultingPackage')}
        amountCents={selectedPkg?.base_price || 0}
        currencyCode="USD"
        payerId={null}
        payeeId={null}
        businessId={null}
        defaultProvider="bank_transfer"
        onClose={() => setShowRecordModal(false)}
        onSuccess={(data) => {
          setShowRecordModal(false);
          onSuccess?.(data);
          onClose?.();
        }}
      />
    </>
  );
}
