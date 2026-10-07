import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Loader2, Wallet } from 'lucide-react';
import invoicesApi from '../../api/invoices';

function formatMoneyFromCents(cents, language, currencyCode = 'USD') {
  const value = Number(cents || 0) / 100;
  const currency = String(currencyCode || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(language || undefined, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

function parseDollarsToCents(input) {
  const normalized = String(input || '').trim().replace(/,/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
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
  const [payMode, setPayMode] = useState('full');
  const [partialAmount, setPartialAmount] = useState('');

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

  const payAmountCents = useMemo(() => {
    if (payMode === 'full') return balanceCents;
    const parsed = parseDollarsToCents(partialAmount);
    return parsed;
  }, [payMode, partialAmount, balanceCents]);

  const partialInvalid = payMode === 'partial' && (
    payAmountCents == null
    || payAmountCents < 1
    || payAmountCents > balanceCents
  );

  if (loading || !eligibility?.eligible) {
    return null;
  }

  const handlePay = async () => {
    if (partialInvalid) {
      toast.error(t('invoices.creditPayAmountInvalid', {
        defaultValue: 'Enter an amount greater than zero and no more than the balance due.',
      }));
      return;
    }
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `invoice-credit-${Date.now()}`;
    try {
      setPaying(true);
      await invoicesApi.payInvoiceWithCredit(invoiceId, {
        idempotencyKey,
        amountCents: payAmountCents,
      });
      const isPartial = payAmountCents < balanceCents;
      toast.success(
        isPartial
          ? t('invoices.creditPayPartialSuccess', { defaultValue: 'Partial payment applied with OxSteed Credit' })
          : t('invoices.creditPaySuccess', { defaultValue: 'Invoice paid with OxSteed Credit' }),
      );
      setPartialAmount('');
      setPayMode('full');
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

  const ctaAmount = payMode === 'full' ? balanceCents : (payAmountCents || 0);
  const displayCurrency = eligibility?.currency || 'USD';

  return (
    <div className={`invoice-credit-pay ${className}`.trim()}>
      <p>{t('invoices.creditPayBody', {
        defaultValue: 'Pay with your OxSteed Credit wallet (full balance or a partial amount).',
      })}</p>

      <div className="invoice-credit-pay-modes" role="radiogroup" aria-label={t('invoices.creditPayModeAria', { defaultValue: 'Credit payment amount' })}>
        <label className="invoice-credit-pay-mode">
          <input
            type="radio"
            name={`credit-pay-mode-${invoiceId}`}
            checked={payMode === 'full'}
            onChange={() => setPayMode('full')}
          />
          <span>
            {t('invoices.creditPayFull', {
              amount: formatMoneyFromCents(balanceCents, i18n.language, displayCurrency),
              defaultValue: 'Pay full balance ({{amount}})',
            })}
          </span>
        </label>
        <label className="invoice-credit-pay-mode">
          <input
            type="radio"
            name={`credit-pay-mode-${invoiceId}`}
            checked={payMode === 'partial'}
            onChange={() => setPayMode('partial')}
          />
          <span>{t('invoices.creditPayPartial', { defaultValue: 'Pay a partial amount' })}</span>
        </label>
      </div>

      {payMode === 'partial' && (
        <label className="invoice-credit-pay-partial-field">
          <span>{t('invoices.creditPayPartialLabel', {
            defaultValue: 'Amount ({{currency}})',
            currency: displayCurrency,
          })}</span>
          <input
            type="text"
            inputMode="decimal"
            value={partialAmount}
            onChange={(event) => setPartialAmount(event.target.value)}
            placeholder={formatMoneyFromCents(Math.min(balanceCents, 1000), i18n.language, displayCurrency)}
            aria-invalid={partialInvalid}
          />
          <small>
            {t('invoices.creditPayPartialHint', {
              max: formatMoneyFromCents(balanceCents, i18n.language, displayCurrency),
              defaultValue: 'Maximum {{max}}',
            })}
          </small>
        </label>
      )}

      <button
        type="button"
        className="piv-button piv-button-primary invoice-credit-pay-btn"
        onClick={handlePay}
        disabled={paying || partialInvalid}
      >
        {paying ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Wallet size={16} aria-hidden="true" />}
        {paying
          ? t('invoices.creditPayProcessing', { defaultValue: 'Processing…' })
          : t('invoices.creditPayCta', {
            amount: formatMoneyFromCents(ctaAmount, i18n.language, displayCurrency),
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
