import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import './PaymentMethodSettings.css';

interface PaymentMethod {
  id: number;
  payment_type: 'cash_app' | 'venmo' | 'bank_transfer';
  payment_identifier: string;
  is_active: boolean;
}

const PaymentMethodSettings: React.FC = () => {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paymentType, setPaymentType] = useState<'cash_app' | 'venmo' | 'bank_transfer'>('cash_app');
  const [identifier, setIdentifier] = useState('');

  useEffect(() => {
    loadPaymentMethod();
  }, []);

  const loadPaymentMethod = async () => {
    try {
      const { data } = await api.get('/tool-rentals/payment-method');
      if (data) {
        setMethod(data);
        setPaymentType(data.payment_type);
        setIdentifier(data.payment_identifier || '');
      }
    } catch (err) {
      toast.error(t('toolRentals.loadingError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!identifier.trim()) {
      toast.error(t('toolRentals.paymentIdentifierRequired'));
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post('/tool-rentals/payment-method', {
        paymentType,
        paymentIdentifier: identifier.trim()
      });
      setMethod(data);
      toast.success(t('toolRentals.paymentMethodSaved'));
    } catch (err) {
      toast.error(t('toolRentals.paymentMethodSaveFailed'));
      console.error('Error saving:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('toolRentals.confirmDeletePaymentMethod'))) return;

    setSaving(true);
    try {
      await api.delete('/tool-rentals/payment-method');
      setMethod(null);
      setIdentifier('');
      toast.success(t('toolRentals.paymentMethodDeleted'));
    } catch (err) {
      toast.error(t('toolRentals.paymentMethodDeleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="payment-settings-loading">{t('common.loading')}</div>;

  return (
    <div className="payment-settings-container">
      <h2>{t('toolRentals.paymentMethod')}</h2>
      <p className="payment-settings-desc">
        {t('toolRentals.paymentMethodDesc')}
      </p>

      <div className="payment-settings-warning">
        <AlertCircle className="w-4 h-4" />
        <p>{t('toolRentals.paymentMethodWarning')}</p>
      </div>

      <div className="payment-settings-form">
        <div className="payment-settings-field">
          <label htmlFor="payment-type">{t('toolRentals.paymentType')}</label>
          <select
            id="payment-type"
            value={paymentType}
            onChange={e => setPaymentType(e.target.value as 'cash_app' | 'venmo' | 'bank_transfer')}
            disabled={saving}
          >
            <option value="cash_app">{t('toolRentals.cashApp')}</option>
            <option value="venmo">{t('toolRentals.venmo')}</option>
            <option value="bank_transfer">{t('toolRentals.bankTransfer')}</option>
          </select>
        </div>

        <div className="payment-settings-field">
          <label htmlFor="identifier">
            {paymentType === 'cash_app'
              ? t('toolRentals.cashAppHandle')
              : paymentType === 'venmo'
                ? t('toolRentals.venmoUsername')
                : t('toolRentals.bankAccount')}
          </label>
          <input
            id="identifier"
            type="text"
            placeholder={
              paymentType === 'cash_app'
                ? t('toolRentals.cashAppPlaceholder')
                : paymentType === 'venmo'
                  ? t('toolRentals.venmoPlaceholder')
                  : t('toolRentals.accountDetailsPlaceholder')
            }
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            disabled={saving}
          />
          <p className="payment-settings-hint">
            {paymentType === 'cash_app'
              ? t('toolRentals.cashAppHint')
              : paymentType === 'venmo'
                ? t('toolRentals.venmoHint')
                : t('toolRentals.bankAccountHint')}
          </p>
        </div>

        <div className="payment-settings-actions">
          <button
            onClick={handleSave}
            disabled={saving}
            className="payment-settings-btn save"
          >
            <Save className="w-4 h-4" />
            {saving ? t('common.saving') : t('common.save')}
          </button>

          {method && (
            <button onClick={handleDelete} disabled={saving} className="payment-settings-btn delete">
              <Trash2 className="w-4 h-4" />
              {t('common.delete')}
            </button>
          )}
        </div>

        {method && (
          <div className="payment-settings-status">
            <p>✓ {t('toolRentals.paymentMethodActive')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentMethodSettings;
