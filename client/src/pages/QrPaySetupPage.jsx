import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BadgeDollarSign,
  Check,
  Copy,
  Download,
  Link2,
  Loader2,
  Plus,
  Printer,
  QrCode,
  Trash2,
  Wallet,
} from 'lucide-react';
import QRCodeStyling from 'qr-code-styling';
import api from '../api/axios';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import usePayments from '../hooks/usePayments';
import './QrPaySetupPage.css';

const MAX_LABEL_LENGTH = 80;
const MIN_AMOUNT_CENTS = 600; // $6
const MAX_AMOUNT_CENTS = 10_000_000; // $100,000

function formatMoney(cents, currency = 'USD', language = 'en') {
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
    }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

function QrPreview({ payUrl, size = 180 }) {
  const ref = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!ref.current || !payUrl) return undefined;
    const qr = new QRCodeStyling({
      width: size,
      height: size,
      data: payUrl,
      margin: 8,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { color: '#0f172a', type: 'rounded' },
      cornersSquareOptions: { color: '#0f172a', type: 'extra-rounded' },
      cornersDotOptions: { color: '#0f172a', type: 'dot' },
      backgroundOptions: { color: '#ffffff' },
    });
    instanceRef.current = qr;
    ref.current.innerHTML = '';
    qr.append(ref.current);
    return () => {
      instanceRef.current = null;
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [payUrl, size]);

  return <div ref={ref} className="qrp-qr" aria-hidden="true" />;
}

async function downloadQrPng(payUrl, label) {
  const qr = new QRCodeStyling({
    width: 640,
    height: 640,
    data: payUrl,
    margin: 16,
    qrOptions: { errorCorrectionLevel: 'M' },
    dotsOptions: { color: '#0f172a', type: 'rounded' },
    backgroundOptions: { color: '#ffffff' },
  });
  const blob = await qr.getRawData('png');
  if (!blob || !blob.size) throw new Error('empty qr');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safe = (label || 'qr-payment').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'qr-payment';
  link.href = objectUrl;
  link.download = `oxsteed-pay-${safe}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

export default function QrPaySetupPage() {
  const { t, i18n } = useTranslation();
  const { fetchConnectStatus, createConnectAccount } = usePayments();

  const [connectState, setConnectState] = useState('loading'); // loading | ready | blocked | error
  const [connecting, setConnecting] = useState(false);
  const [codes, setCodes] = useState([]);
  const [codesLoading, setCodesLoading] = useState(true);
  const [codesError, setCodesError] = useState(false);

  const [label, setLabel] = useState('');
  const [amountMode, setAmountMode] = useState('open'); // open | fixed
  const [amountDollars, setAmountDollars] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [highlightId, setHighlightId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [printCode, setPrintCode] = useState(null);
  const cardRefs = useRef({});

  const loadStatus = useCallback(async () => {
    setConnectState('loading');
    try {
      const status = await fetchConnectStatus();
      const ready = Boolean(status && status.connected && (status.charges_enabled || status.stripe_connect_ready));
      setConnectState(ready ? 'ready' : 'blocked');
    } catch {
      setConnectState('error');
    }
  }, [fetchConnectStatus]);

  const loadCodes = useCallback(async () => {
    setCodesLoading(true);
    setCodesError(false);
    try {
      const { data } = await api.get('/qr-payments/codes');
      setCodes(Array.isArray(data?.codes) ? data.codes : []);
    } catch {
      setCodesError(true);
    } finally {
      setCodesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (connectState === 'ready') loadCodes();
  }, [connectState, loadCodes]);

  // Print flow: render the print sheet, then print, then clean up.
  useEffect(() => {
    if (!printCode) return undefined;
    document.body.classList.add('qrp-printing');
    const timer = window.setTimeout(() => window.print(), 60);
    const cleanup = () => {
      document.body.classList.remove('qrp-printing');
      setPrintCode(null);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    const fallback = window.setTimeout(cleanup, 5000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(fallback);
      window.removeEventListener('afterprint', cleanup);
      document.body.classList.remove('qrp-printing');
    };
  }, [printCode]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const data = await createConnectAccount();
      const url = data?.url || data?.onboarding_url;
      if (url) {
        window.location.href = url;
        return;
      }
      // Already set up: refresh status.
      await loadStatus();
    } catch {
      toast.error(t('qrPay.connectError', { defaultValue: 'Could not start payout setup. Please try again.' }));
    } finally {
      setConnecting(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setFormError('');
    const trimmed = label.trim();
    if (!trimmed) {
      setFormError(t('qrPay.labelRequired', { defaultValue: 'Please add a label so customers know what they are paying for.' }));
      return;
    }
    let amountCents = null;
    if (amountMode === 'fixed') {
      const parsed = Number.parseFloat(amountDollars);
      if (!Number.isFinite(parsed)) {
        setFormError(t('qrPay.amountInvalid', { defaultValue: 'Enter an amount between $6 and $100,000.' }));
        return;
      }
      amountCents = Math.round(parsed * 100);
      if (amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
        setFormError(t('qrPay.amountInvalid', { defaultValue: 'Enter an amount between $6 and $100,000.' }));
        return;
      }
    }
    setCreating(true);
    try {
      const { data } = await api.post('/qr-payments/codes', {
        label: trimmed.slice(0, MAX_LABEL_LENGTH),
        ...(amountCents != null ? { amount_cents: amountCents } : {}),
      });
      const created = data?.code || data;
      setCodes((prev) => [created, ...prev]);
      setLabel('');
      setAmountDollars('');
      setAmountMode('open');
      setHighlightId(created?.id ?? null);
      toast.success(t('qrPay.createSuccess', { defaultValue: 'Payment QR code created.' }));
      window.setTimeout(() => {
        const el = created?.id != null ? cardRefs.current[created.id] : null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    } catch {
      setFormError(t('qrPay.createError', { defaultValue: 'Could not create the QR code. Please try again.' }));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (code) => {
    try {
      await navigator.clipboard.writeText(code.pay_url);
      setCopiedId(code.id);
      toast.success(t('qrPay.copied', { defaultValue: 'Link copied' }));
      window.setTimeout(() => setCopiedId((current) => (current === code.id ? null : current)), 2000);
    } catch {
      toast.error(t('qrPay.createError', { defaultValue: 'Could not create the QR code. Please try again.' }));
    }
  };

  const handleDownload = async (code) => {
    try {
      await downloadQrPng(code.pay_url, code.label);
    } catch {
      toast.error(t('qrPay.createError', { defaultValue: 'Could not create the QR code. Please try again.' }));
    }
  };

  const handleToggle = async (code) => {
    try {
      const { data } = await api.patch(`/qr-payments/codes/${code.id}`, { is_active: !code.is_active });
      const updated = data?.code || data;
      setCodes((prev) => prev.map((item) => (item.id === code.id ? { ...item, ...updated } : item)));
    } catch {
      toast.error(t('qrPay.toggleError', { defaultValue: 'Could not update the QR code.' }));
    }
  };

  const handleDelete = async (code) => {
    if (!window.confirm(t('qrPay.confirmDelete', { defaultValue: 'Delete this QR code? Customers who scan it will no longer be able to pay.' }))) return;
    try {
      await api.delete(`/qr-payments/codes/${code.id}`);
      setCodes((prev) => prev.filter((item) => item.id !== code.id));
      toast.success(t('qrPay.deleteSuccess', { defaultValue: 'QR code deleted.' }));
    } catch {
      toast.error(t('qrPay.deleteError', { defaultValue: 'Could not delete the QR code.' }));
    }
  };

  const renderConnectGate = () => {
    if (connectState === 'loading') {
      return (
        <div className="qrp-state" role="status">
          <Loader2 className="qrp-spin" size={28} aria-hidden="true" />
          <p>{t('qrPay.loading', { defaultValue: 'Loading...' })}</p>
        </div>
      );
    }
    if (connectState === 'error') {
      return (
        <div className="qrp-state">
          <AlertCircle size={28} aria-hidden="true" />
          <p>{t('qrPay.loadError', { defaultValue: 'Could not load your QR codes.' })}</p>
          <button type="button" className="qrp-btn qrp-btn-secondary" onClick={loadStatus}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      );
    }
    // blocked: payouts not connected
    return (
      <section className="qrp-connect" aria-labelledby="qrp-connect-title">
        <span className="qrp-connect-icon" aria-hidden="true">
          <Wallet size={30} />
        </span>
        <div>
          <h2 id="qrp-connect-title">{t('qrPay.connectTitle', { defaultValue: 'Connect payouts first' })}</h2>
          <p>{t('qrPay.connectBody', { defaultValue: 'To receive QR payments, connect your bank account with our secure payment partner. It takes a few minutes.' })}</p>
        </div>
        <button
          type="button"
          className="qrp-btn qrp-btn-primary"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting ? t('qrPay.connecting', { defaultValue: 'Connecting...' }) : t('qrPay.connectCta', { defaultValue: 'Connect payouts' })}
        </button>
      </section>
    );
  };

  const renderCodes = () => {
    if (codesLoading) {
      return (
        <div className="qrp-state" role="status">
          <Loader2 className="qrp-spin" size={28} aria-hidden="true" />
          <p>{t('qrPay.loading', { defaultValue: 'Loading...' })}</p>
        </div>
      );
    }
    if (codesError) {
      return (
        <div className="qrp-state">
          <AlertCircle size={28} aria-hidden="true" />
          <p>{t('qrPay.loadError', { defaultValue: 'Could not load your QR codes.' })}</p>
          <button type="button" className="qrp-btn qrp-btn-secondary" onClick={loadCodes}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      );
    }
    if (!codes.length) {
      return (
        <div className="qrp-state">
          <QrCode size={28} aria-hidden="true" />
          <p>{t('qrPay.codesEmpty', { defaultValue: 'You have not created any payment QR codes yet.' })}</p>
        </div>
      );
    }
    return (
      <div className="qrp-grid">
        {codes.map((code) => (
          <article
            key={code.id}
            ref={(el) => { if (el) cardRefs.current[code.id] = el; else delete cardRefs.current[code.id]; }}
            className={`qrp-card${highlightId === code.id ? ' is-new' : ''}${code.is_active ? '' : ' is-inactive'}`}
            aria-label={code.label}
          >
            <div className="qrp-card-top">
              <QrPreview payUrl={code.pay_url} />
              <div className="qrp-card-meta">
                <div className="qrp-card-title-row">
                  <h3>{code.label}</h3>
                  <span className={`qrp-badge${code.is_active ? ' is-on' : ''}`}>
                    {code.is_active
                      ? t('qrPay.activeBadge', { defaultValue: 'Active' })
                      : t('qrPay.inactiveBadge', { defaultValue: 'Inactive' })}
                  </span>
                </div>
                <p className="qrp-amount">
                  {code.amount_cents != null
                    ? formatMoney(code.amount_cents, code.currency, i18n.language)
                    : t('qrPay.openAmount', { defaultValue: 'Open amount' })}
                </p>
                <p className="qrp-stats">
                  <span>{formatMoney(code.total_received_cents, code.currency, i18n.language)} {t('qrPay.totalReceived', { defaultValue: 'received' })}</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {code.payment_count === 1
                      ? t('qrPay.paymentCountOne', { defaultValue: '1 payment' })
                      : t('qrPay.paymentCountOther', { count: code.payment_count || 0, defaultValue: '{{count}} payments' })}
                  </span>
                </p>
                <p className="qrp-link">
                  <Link2 size={14} aria-hidden="true" />
                  <span className="qrp-link-url">{code.pay_url}</span>
                </p>
              </div>
            </div>
            <div className="qrp-card-actions">
              <button type="button" className="qrp-btn qrp-btn-ghost qrp-btn-sm" onClick={() => handleCopy(code)}>
                {copiedId === code.id ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                {t('qrPay.copyLink', { defaultValue: 'Copy link' })}
              </button>
              <button type="button" className="qrp-btn qrp-btn-ghost qrp-btn-sm" onClick={() => handleDownload(code)}>
                <Download size={15} aria-hidden="true" />
                {t('qrPay.download', { defaultValue: 'Download' })}
              </button>
              <button type="button" className="qrp-btn qrp-btn-ghost qrp-btn-sm" onClick={() => setPrintCode(code)}>
                <Printer size={15} aria-hidden="true" />
                {t('qrPay.print', { defaultValue: 'Print' })}
              </button>
            </div>
            <div className="qrp-card-footer">
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(code.is_active)}
                className={`qrp-toggle${code.is_active ? ' is-on' : ''}`}
                onClick={() => handleToggle(code)}
                aria-label={code.is_active
                  ? t('qrPay.deactivate', { defaultValue: 'Deactivate' })
                  : t('qrPay.activate', { defaultValue: 'Activate' })}
              >
                <span className="qrp-toggle-knob" aria-hidden="true" />
                <span className="qrp-toggle-label">
                  {code.is_active
                    ? t('qrPay.deactivate', { defaultValue: 'Deactivate' })
                    : t('qrPay.activate', { defaultValue: 'Activate' })}
                </span>
              </button>
              <button type="button" className="qrp-btn qrp-btn-danger-ghost qrp-btn-sm" onClick={() => handleDelete(code)}>
                <Trash2 size={15} aria-hidden="true" />
                {t('qrPay.delete', { defaultValue: 'Delete' })}
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  };

  return (
    <PageShell>
      <PageMeta title={t('qrPay.setupTitle', { defaultValue: 'Get paid with QR codes' })} />
      <div className="qrpay-page">
        <header className="qrp-header">
          <span className="qrp-header-icon" aria-hidden="true">
            <BadgeDollarSign size={26} />
          </span>
          <div>
            <h1>{t('qrPay.setupTitle', { defaultValue: 'Get paid with QR codes' })}</h1>
            <p>{t('qrPay.setupSubtitle', { defaultValue: 'Create QR codes your customers can scan to pay you directly. No app needed on their side.' })}</p>
          </div>
        </header>

        {connectState !== 'ready' ? renderConnectGate() : (
          <>
            <section className="qrp-panel" aria-labelledby="qrp-create-title">
              <h2 id="qrp-create-title">
                <Plus size={18} aria-hidden="true" />
                {t('qrPay.createTitle', { defaultValue: 'Create a payment QR code' })}
              </h2>
              <form onSubmit={handleCreate} className="qrp-form" noValidate>
                <div className="qrp-field">
                  <label htmlFor="qrp-label">{t('qrPay.labelLabel', { defaultValue: 'Label' })}</label>
                  <input
                    id="qrp-label"
                    type="text"
                    value={label}
                    maxLength={MAX_LABEL_LENGTH}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('qrPay.labelPlaceholder', { defaultValue: 'e.g. Lawn mowing, Bakery pickup' })}
                    className="qrp-input"
                  />
                </div>

                <fieldset className="qrp-field">
                  <legend>{t('qrPay.amountModeLabel', { defaultValue: 'Amount' })}</legend>
                  <div className="qrp-radio-cards">
                    <label className={`qrp-radio-card${amountMode === 'open' ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="qrp-amount-mode"
                        value="open"
                        checked={amountMode === 'open'}
                        onChange={() => setAmountMode('open')}
                      />
                      <strong>{t('qrPay.amountOpen', { defaultValue: 'Customer enters amount' })}</strong>
                      <span>{t('qrPay.amountOpenHint', { defaultValue: 'The customer chooses how much to pay when they scan.' })}</span>
                    </label>
                    <label className={`qrp-radio-card${amountMode === 'fixed' ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="qrp-amount-mode"
                        value="fixed"
                        checked={amountMode === 'fixed'}
                        onChange={() => setAmountMode('fixed')}
                      />
                      <strong>{t('qrPay.amountFixed', { defaultValue: 'Fixed amount' })}</strong>
                      <span>{t('qrPay.amountFixedHint', { defaultValue: 'Every scan pays the same amount.' })}</span>
                    </label>
                  </div>
                </fieldset>

                {amountMode === 'fixed' && (
                  <div className="qrp-field">
                    <label htmlFor="qrp-amount">{t('qrPay.amountLabel', { defaultValue: 'Amount (USD)' })}</label>
                    <div className="qrp-amount-input">
                      <span aria-hidden="true">$</span>
                      <input
                        id="qrp-amount"
                        type="number"
                        min="1"
                        max="100000"
                        step="0.01"
                        inputMode="decimal"
                        value={amountDollars}
                        onChange={(e) => setAmountDollars(e.target.value)}
                        placeholder="25.00"
                        className="qrp-input"
                      />
                    </div>
                  </div>
                )}

                {formError && (
                  <p className="qrp-form-error" role="alert">
                    <AlertCircle size={15} aria-hidden="true" />
                    {formError}
                  </p>
                )}

                <button type="submit" className="qrp-btn qrp-btn-primary" disabled={creating}>
                  {creating
                    ? t('qrPay.creating', { defaultValue: 'Creating...' })
                    : t('qrPay.createCta', { defaultValue: 'Create QR code' })}
                </button>
              </form>
            </section>

            <section aria-labelledby="qrp-codes-title">
              <h2 id="qrp-codes-title" className="qrp-section-title">
                {t('qrPay.codesTitle', { defaultValue: 'Your payment QR codes' })}
              </h2>
              {renderCodes()}
            </section>
          </>
        )}
      </div>

      {printCode && (
        <div className="qrp-print-sheet" aria-hidden="true">
          <h2>{printCode.label}</h2>
          <QrPreview payUrl={printCode.pay_url} size={320} />
          <p className="qrp-print-amount">
            {printCode.amount_cents != null
              ? formatMoney(printCode.amount_cents, printCode.currency, i18n.language)
              : t('qrPay.openAmount', { defaultValue: 'Open amount' })}
          </p>
          <p className="qrp-print-hint">{t('qrPay.scanHint', { defaultValue: 'Scan with your phone camera to pay.' })}</p>
          <p className="qrp-print-url">{printCode.pay_url}</p>
        </div>
      )}
    </PageShell>
  );
}
