import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Mail, SendIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import './InvoiceModal.css';

interface InvoiceModalProps {
  bookingId: number;
  isOpen: boolean;
  onClose: () => void;
  onInvoiceSent?: () => void;
}

const InvoiceModal: React.FC<InvoiceModalProps> = ({ bookingId, isOpen, onClose, onInvoiceSent }) => {
  const { t } = useTranslation();
  const [deliveryMethod, setDeliveryMethod] = useState<'in_platform' | 'email'>('in_platform');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const handleSend = async () => {
    if (deliveryMethod === 'email') {
      if (!recipientEmail.trim()) {
        toast.error(t('toolRentals.emailRequired') || 'Email address required');
        return;
      }
      if (!validateEmail(recipientEmail)) {
        toast.error(t('toolRentals.invalidEmail') || 'Invalid email format');
        return;
      }
    }

    setLoading(true);
    const idempotencyKey = generateUUID();

    try {
      const response = await fetch('/api/tool-rentals/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          bookingId,
          deliveryMethod,
          recipientEmail: recipientEmail.trim() || undefined
        })
      });

      if (!response.ok) throw new Error('Failed to send');
      const data = await response.json();

      toast.success(t('toolRentals.invoiceSent') || 'Invoice sent successfully');
      onInvoiceSent?.();
      onClose();
    } catch (err) {
      toast.error(t('toolRentals.invoiceSendFailed') || 'Failed to send invoice');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="invoice-modal-overlay" onClick={onClose}>
      <div className="invoice-modal-content" onClick={e => e.stopPropagation()}>
        <div className="invoice-modal-header">
          <h2>{t('toolRentals.sendInvoice') || 'Send Invoice'}</h2>
          <button onClick={onClose} className="invoice-modal-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="invoice-modal-body">
          <p className="invoice-modal-subtitle">
            {t('toolRentals.invoiceSubtitle') || 'Choose how to send the invoice to the customer'}
          </p>

          <div className="invoice-delivery-options">
            <label className="invoice-delivery-option">
              <input
                type="radio"
                name="delivery"
                value="in_platform"
                checked={deliveryMethod === 'in_platform'}
                onChange={e => setDeliveryMethod(e.target.value as 'in_platform' | 'email')}
                disabled={loading}
              />
              <div className="invoice-delivery-content">
                <div className="invoice-delivery-title">
                  <SendIcon className="w-4 h-4" />
                  {t('toolRentals.inPlatform') || 'In-Platform'}
                </div>
                <p className="invoice-delivery-desc">
                  {t('toolRentals.inPlatformDesc') || 'Send via OxSteed with read receipts'}
                </p>
              </div>
            </label>

            <label className="invoice-delivery-option">
              <input
                type="radio"
                name="delivery"
                value="email"
                checked={deliveryMethod === 'email'}
                onChange={e => setDeliveryMethod(e.target.value as 'in_platform' | 'email')}
                disabled={loading}
              />
              <div className="invoice-delivery-content">
                <div className="invoice-delivery-title">
                  <Mail className="w-4 h-4" />
                  {t('toolRentals.personalEmail') || 'Personal Email'}
                </div>
                <p className="invoice-delivery-desc">
                  {t('toolRentals.personalEmailDesc') || 'Send from your own email account'}
                </p>
              </div>
            </label>
          </div>

          {deliveryMethod === 'email' && (
            <div className="invoice-email-input">
              <label htmlFor="recipient-email">{t('toolRentals.recipientEmail') || 'Recipient Email'}</label>
              <input
                id="recipient-email"
                type="email"
                placeholder="customer@example.com"
                value={recipientEmail}
                onChange={e => setRecipientEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          )}

          <div className="invoice-info-box">
            <p>
              {t('toolRentals.invoiceInfo') ||
                'The invoice will include your payment method and a QR code for easy payment.'}
            </p>
          </div>
        </div>

        <div className="invoice-modal-footer">
          <button onClick={onClose} disabled={loading} className="invoice-btn-cancel">
            {t('common.cancel') || 'Cancel'}
          </button>
          <button onClick={handleSend} disabled={loading} className="invoice-btn-send">
            {loading ? t('common.sending') : t('toolRentals.sendInvoice')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceModal;
