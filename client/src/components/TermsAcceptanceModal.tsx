import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import './TermsAcceptanceModal.css';

interface TermsAcceptanceModalProps {
  bookingId: number;
  userRole: 'customer' | 'owner';
  isOpen: boolean;
  onClose: () => void;
  onAccepted?: () => void;
}

const TermsAcceptanceModal: React.FC<TermsAcceptanceModalProps> = ({
  bookingId,
  userRole,
  isOpen,
  onClose,
  onAccepted,
}) => {
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAccepted(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAccept = async () => {
    if (!accepted) {
      toast.error(t('toolRentals.acceptTermsRequired') || 'You must accept the terms to continue');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/tool-rentals/terms/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          userRole,
        }),
      });

      if (!response.ok) throw new Error('Failed to accept terms');

      toast.success(t('toolRentals.termsAccepted') || 'Terms accepted');
      onAccepted?.();
      onClose();
    } catch (err) {
      toast.error(t('toolRentals.acceptTermsFailed') || 'Failed to accept terms');
      console.error('Error accepting terms:', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="terms-modal-overlay" onClick={onClose}>
      <div className="terms-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="terms-modal-header">
          <h2>{t('toolRentals.termsTitle') || 'Tool Rental Agreement'}</h2>
          <button onClick={onClose} className="terms-modal-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="terms-modal-body">
          <div className="terms-warning">
            <AlertCircle className="w-5 h-5" />
            <p>{t('toolRentals.termsWarning') || 'Please read the terms carefully before proceeding'}</p>
          </div>

          <div className="terms-content">
            <section className="terms-section">
              <h3>{t('toolRentals.paymentObligation') || 'Payment Obligation'}</h3>
              <p>
                {userRole === 'customer'
                  ? t('toolRentals.paymentObligation') || 'You agree to send payment to the tool owner by the agreed-upon date.'
                  : 'You agree to accept payment from customers via the specified payment method.'}
              </p>
            </section>

            <section className="terms-section">
              <h3>{t('toolRentals.returnObligation') || 'Return Obligation'}</h3>
              <p>
                {userRole === 'customer'
                  ? t('toolRentals.returnObligation') || 'You agree to return the tool in the agreed-upon condition by the agreed-upon date.'
                  : 'You agree that rented tools will be returned in the agreed-upon condition by the specified date.'}
              </p>
            </section>

            <section className="terms-section">
              <h3>{t('toolRentals.platformFacilitator') || 'Platform Role'}</h3>
              <p>
                {t('toolRentals.platformFacilitator') || 'OxSteed is a technology facilitator only and does not control user behavior.'}
              </p>
            </section>

            <section className="terms-section">
              <h3>{t('toolRentals.disputeResolution') || 'Dispute Resolution'}</h3>
              <p>
                {t('toolRentals.disputeResolution') || 'Disputes are resolved through your bank\'s chargeback process.'}
              </p>
            </section>

            <section className="terms-section">
              <h3>{t('toolRentals.canReport') || 'Reporting'}</h3>
              <p>
                {t('toolRentals.canReport') || 'You can report violations; platform will take action.'}
              </p>
            </section>
          </div>

          <label className="terms-checkbox">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={loading}
            />
            <span>
              {t('toolRentals.acknowledgment') || 'I have read and agree to the Tool Rental Agreement'}
            </span>
          </label>
        </div>

        <div className="terms-modal-footer">
          <button onClick={onClose} disabled={loading} className="terms-btn-cancel">
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            onClick={handleAccept}
            disabled={loading || !accepted}
            className="terms-btn-accept"
          >
            {loading ? t('common.saving') : t('toolRentals.acceptTerms') || 'Accept & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsAcceptanceModal;
