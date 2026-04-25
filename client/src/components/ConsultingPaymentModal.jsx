import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import toast from 'react-hot-toast';
import axios from '../api/axios';
import consultingPaymentApi from '../api/consultingPayment';
import { X } from 'lucide-react';

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'
);

function PaymentForm({ sessionId, onSuccess, onCancel }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);

  useEffect(() => {
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      const response = await consultingPaymentApi.getPackages();
      setPackages(response.data);
      if (response.data.length > 0) {
        setSelectedPackage(response.data[0].id);
      }
    } catch (err) {
      toast.error(t('payment.loadPackagesFailed') || 'Failed to load packages');
      console.error('Failed to load packages', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    if (!selectedPackage) {
      toast.error(t('payment.selectPackage') || 'Please select a package');
      return;
    }

    setLoading(true);

    try {
      // Create payment intent
      const intentResponse = await consultingPaymentApi.createPaymentIntent(
        sessionId,
        selectedPackage
      );

      const { clientSecret } = intentResponse.data;

      // Confirm payment
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement),
          billing_details: {
            name: 'Customer',
          },
        },
      });

      if (error) {
        toast.error(error.message || t('payment.paymentFailed') || 'Payment failed');
      } else if (paymentIntent.status === 'succeeded') {
        toast.success(t('payment.paymentSuccessful') || 'Payment successful!');
        onSuccess();
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('payment.paymentError') || 'Payment error');
      console.error('Payment error', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedPkg = packages.find((p) => p.id === selectedPackage);

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Package Selection */}
      <div>
        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem', color: 'var(--color-text)' }}>
          {t('payment.selectPackage') || 'Select Package'}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              onClick={() => setSelectedPackage(pkg.id)}
              style={{
                padding: '1rem',
                border: selectedPackage === pkg.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                borderRadius: '8px',
                cursor: 'pointer',
                background: selectedPackage === pkg.id ? 'var(--color-surface)' : 'var(--color-bg)',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontWeight: '600', color: 'var(--color-text)' }}>{pkg.package_name}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                ${(pkg.base_price / 100).toFixed(2)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                {pkg.duration_hours} {t('payment.hours') || 'hours'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Package Details */}
      {selectedPkg && (
        <div style={{ padding: '1rem', background: 'var(--color-bg)', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--color-text)' }}>
            {selectedPkg.description}
          </div>
          {selectedPkg.includes_deliverables && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              ✓ {t('payment.includesDeliverables') || 'Includes deliverables'}
            </div>
          )}
          {selectedPkg.max_revisions > 0 && (
            <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              ✓ {selectedPkg.max_revisions} {t('payment.revisions') || 'revisions'}
            </div>
          )}
        </div>
      )}

      {/* Card Element */}
      <div>
        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem', color: 'var(--color-text)' }}>
          {t('payment.cardDetails') || 'Card Details'}
        </label>
        <div style={{ padding: '1rem', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: 'var(--color-text)',
                  '::placeholder': {
                    color: 'var(--color-text-muted)',
                  },
                },
                invalid: {
                  color: '#fa755a',
                },
              },
            }}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          style={{
            padding: '0.75rem 1.5rem',
            border: '1px solid var(--color-border)',
            borderRadius: '6px',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            fontWeight: '600',
            cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {t('common.cancel') || 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={loading || !stripe}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (t('common.processing') || 'Processing...') : t('payment.pay') || 'Pay'}
        </button>
      </div>
    </form>
  );
}

export default function ConsultingPaymentModal({ sessionId, isOpen, onClose, onSuccess }) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
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
          maxWidth: '500px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--color-text)' }}>
            {t('payment.purchaseConsulting') || 'Purchase Consulting Package'}
          </h2>
          <button
            onClick={onClose}
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

        <Elements stripe={stripePromise}>
          <PaymentForm
            sessionId={sessionId}
            onSuccess={() => {
              onSuccess();
              onClose();
            }}
            onCancel={onClose}
          />
        </Elements>
      </div>
    </div>
  );
}
