import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Loader2, Wallet } from 'lucide-react';
import invoicesApi from '../../api/invoices';

function formatMoneyFromCents(cents, language) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat(language || undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export default function InvoiceOxsteedCreditPay({
  invoiceId,
  balanceCents: balanceCentsProp,
  onPaid,
  className = '',
}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [eligibility, setEligibility] = useState(null);

  const loadEligibility = useCallback(async () => {
    if (!invoiceId) return;
    try {
      setLoading(true);
      const { data } = await invoicesApi.getInvoiceCreditEligibility(invoiceId);
      setEligibility(data);
    } catch {
      setEligibility({ eligible: false });
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadEligibility();
  }, [loadEligibility]);

  const balanceCents = useMemo(() => {
    if (eligibility?.balanceCents != null) return eligibility.balanceCents;
    return balanceCentsProp;
  }, [eligibility?.balanceCents, balanceCentsProp]);

  if (loading || !eligibility?.eligible) {
    return null;
  }

  const handlePay = async () => {
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `invoice-credit-${Date.now()}`;
    try {
      setPaying(true);
      await invoicesApi.payInvoiceWithCredit(invoiceId, {
        idempotencyKey,
        amountCents: balanceCents,
      });
      toast.success(t('invoices.creditPaySuccess', { defaultValue: 'Invoice paid with OxSteed Credit' }));
      await loadEligibility();
      onPaid?.();
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        t('invoices.creditPayError', { defaultValue: 'Could not pay with OxSteed Credit' });
      toast.error(message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className={`invoice-credit-pay ${className}`.trim()}>
      <p>{t('invoices.creditPayBody', {
        defaultValue: 'Pay the remaining balance with your OxSteed Credit wallet.',
      })}</p>
      <button
        type="button"
        className="piv-button piv-button-primary invoice-credit-pay-btn"
        onClick={handlePay}
        disabled={paying}
      >
        {paying ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Wallet size={16} aria-hidden="true" />}
        {paying
          ? t('invoices.creditPayProcessing', { defaultValue: 'Processing…' })
          : t('invoices.creditPayCta', {
            amount: formatMoneyFromCents(balanceCents, i18n.language),
            defaultValue: 'Pay {{amount}} with OxSteed Credit',
          })}
      </button>
      <p className="invoice-credit-pay-note">
        {t('invoices.creditPayNote', {
          defaultValue: 'Credit payments settle on the same cycle as restaurant partners.',
        })}
      </p>
    </div>
  );
}

export function InvoiceCreditPaySignInPrompt({ className = '' }) {
  const { t } = useTranslation();
  return (
    <p className={className}>
      <Link to="/login" className="piv-button piv-button-secondary">
        {t('publicInvoice.loginToPayCredit', { defaultValue: 'Sign in to pay with OxSteed Credit' })}
      </Link>
    </p>
  );
}
