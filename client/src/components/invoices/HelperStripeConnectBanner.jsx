import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import usePayments from '../../hooks/usePayments';
import { isStripeConnectReady, needsStripeConnectContinue } from '../../utils/stripeConnectStatus';

/**
 * Issuer-facing CTA: Stripe Connect is only started when the user clicks
 * (POST /payments/connect). No background account creation.
 */
export default function HelperStripeConnectBanner({ className = '' }) {
  const { t } = useTranslation();
  const { fetchConnectStatus, createConnectAccount } = usePayments();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchConnectStatus();
      const nextStatus = data || { connected: false };
      setStatus(nextStatus);
      return nextStatus;
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [fetchConnectStatus]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className={`invoice-helper-stripe-banner loading ${className}`.trim()} role="status">
        <Loader2 className="invoice-spin" size={18} aria-hidden="true" />
      </div>
    );
  }

  const ready = isStripeConnectReady(status);
  if (ready) {
    return (
      <p className={`invoice-helper-stripe-banner ready ${className}`.trim()}>
        {t('invoices.helperStripeConnectReady')}
      </p>
    );
  }

  const needsContinue = needsStripeConnectContinue(status);

  const handleClick = async () => {
    setConnecting(true);
    try {
      const data = await createConnectAccount('/invoices');
      const url = data?.url || data?.onboarding_url;
      if (url) {
        window.location.href = url;
        return;
      }
      const refreshedStatus = await load();
      if (isStripeConnectReady(refreshedStatus)) {
        toast.success(t('invoices.helperStripeConnectReady', { defaultValue: 'Card payments are enabled for your invoices.' }));
      } else {
        toast.error(t('businessHub.integrations.stripeChargesDisabled', {
          defaultValue: 'Stripe is connected but card charges are not enabled yet. Finish requirements in Stripe to accept invoice card payments.',
        }));
      }
    } catch {
      toast.error(t('businessHub.integrations.toastStripeStartFail'));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section className={`invoice-helper-stripe-banner ${className}`.trim()} aria-labelledby="helper-stripe-connect-title">
      <Wallet size={22} aria-hidden="true" />
      <div>
        <h3 id="helper-stripe-connect-title">{t('invoices.helperStripeConnectTitle')}</h3>
        <p>
          {needsContinue
            ? t('businessHub.integrations.stripeChargesDisabled', {
              defaultValue: 'Stripe is connected but card charges are not enabled yet. Finish requirements in Stripe to accept invoice card payments.',
            })
            : t('invoices.helperStripeConnectBody')}
        </p>
      </div>
      <button type="button" className="invoice-helper-stripe-cta" onClick={handleClick} disabled={connecting} data-track="ui.cf491daf90.1">
        {connecting
          ? t('businessHub.integrations.saving')
          : (needsContinue
            ? t('invoices.helperStripeConnectContinue')
            : t('invoices.helperStripeConnectCta'))}
      </button>
    </section>
  );
}
