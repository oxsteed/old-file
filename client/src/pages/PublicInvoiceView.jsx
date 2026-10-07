import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import InvoiceOxsteedCreditPay, { InvoiceCreditPaySignInPrompt } from '../components/invoices/InvoiceOxsteedCreditPay';
import InvoiceStripeCardPay from '../components/invoices/InvoiceStripeCardPay';
import '../styles/PublicInvoiceView.css';
import { formatDate, formatMoney } from '../lib/format';

function parseLineItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getStatusLabel(status = 'sent', t) {
  const normalized = String(status || 'sent').toLowerCase();
  return t(`publicInvoice.statusLabels.${normalized}`, {
    defaultValue: normalized.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
  });
}

function getWebsiteHref(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function PublicInvoiceView() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadInvoice() {
      try {
        setLoading(true);
        const response = await api.get(`/businesses/invoices/public/${token}`);
        if (!isMounted) return;
        setInvoice(response.data.invoice);
        setBusiness(response.data.business);
        setError(null);
      } catch (err) {
        if (!isMounted) return;
        setError(t('publicInvoice.notFound'));
        console.error('Error loading invoice:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadInvoice();
    return () => {
      isMounted = false;
    };
  }, [token, t, reloadKey]);

  const lineItems = useMemo(() => parseLineItems(invoice?.line_items), [invoice]);
  const subtotal = Number(invoice?.subtotal || 0);
  const taxAmount = Number(invoice?.tax_amount || 0);
  const total = Number(invoice?.total || 0);
  const amountPaid = Number(invoice?.amount_paid || 0);
  const balanceDue = Math.max(total - amountPaid, 0);
  const balanceDueCents = Math.round(balanceDue * 100);
  const status = invoice?.status || 'sent';
  const isPaid = status === 'paid';
  const canTryCreditPay = user && !isPaid && ['sent', 'partial', 'overdue'].includes(status);
  const websiteHref = getWebsiteHref(business?.website);

  if (loading) {
    return (
      <div className="piv-page">
        <PageMeta title={t('publicInvoice.loadingTitle')} noIndex />
        <div className="piv-state-card">
          <div className="piv-loader" aria-hidden="true" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="piv-page">
        <PageMeta title={t('publicInvoice.unavailableTitle')} noIndex />
        <div className="piv-state-card piv-state-card-error">
          <AlertCircle size={34} aria-hidden="true" />
          <h1>{t('common.notFound')}</h1>
          <p>
            {error || t('publicInvoice.notFound')} {t('publicInvoice.errorBody')}
          </p>
          <div className="piv-state-actions">
            <Link to="/" className="piv-button piv-button-primary">
              <ArrowLeft size={16} aria-hidden="true" />
              {t('common.backHome')}
            </Link>
            <Link to="/support/escalation" className="piv-button piv-button-secondary">
              {t('supportWidget.talkToHuman')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="piv-page">
      <PageMeta
        title={`${invoice.invoice_number || t('publicInvoice.invoice')} ${t('publicInvoice.from')} ${business?.business_name || 'OxSteed'}`}
        description={t('publicInvoice.metaDescription')}
        noIndex
      />

      <main className="piv-container">
        <Link to="/" className="piv-back-link">
          <ArrowLeft size={16} aria-hidden="true" />
          OxSteed
        </Link>

        <section className="piv-hero" aria-labelledby="invoice-title">
          <div className="piv-business-block">
            {business?.logo_url ? (
              <img src={business.logo_url} alt={business.business_name} className="piv-logo" />
            ) : (
              <div className="piv-logo-fallback" aria-hidden="true">
                <FileText size={28} />
              </div>
            )}
            <div>
              <div className="piv-eyebrow">
                <ShieldCheck size={16} aria-hidden="true" />
                {t('publicInvoice.secureInvoice')}
              </div>
              <h1 id="invoice-title">{business?.business_name || t('publicInvoice.oxsteedInvoice')}</h1>
              <div className="piv-business-meta">
                {business?.phone && <span>{business.phone}</span>}
                {websiteHref && (
                  <a href={websiteHref} target="_blank" rel="noopener noreferrer">
                    {business.website}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="piv-amount-card">
            <span className={`piv-status piv-status-${status}`}>{getStatusLabel(status, t)}</span>
            <p>{t('publicInvoice.balanceDue')}</p>
            <strong>{formatMoney(balanceDue)}</strong>
            <small>{t('publicInvoice.invoiceNumber')} {invoice.invoice_number || t('publicInvoice.numberPending')}</small>
          </div>
        </section>

        <div className="piv-layout">
          <section className="piv-panel piv-invoice-panel" aria-label={t('publicInvoice.invoiceDetails')}>
            <div className="piv-details-grid">
              <div>
                <span>{t('publicInvoice.invoiceNumber')}</span>
                <strong>{invoice.invoice_number || t('publicInvoice.notAssigned')}</strong>
              </div>
              <div>
                <span>{t('publicInvoice.issued')}</span>
                <strong>{formatDate(invoice.issue_date, { fallback: t('publicInvoice.notSet') })}</strong>
              </div>
              <div>
                <span>{t('publicInvoice.due')}</span>
                <strong>{formatDate(invoice.due_date, { fallback: t('publicInvoice.notSet') })}</strong>
              </div>
              <div>
                <span>{t('publicInvoice.status')}</span>
                <strong>{getStatusLabel(status, t)}</strong>
              </div>
            </div>

            <div className="piv-bill-to">
              <span>{t('publicInvoice.billTo')}</span>
              <strong>{invoice.client_name || t('publicInvoice.customer')}</strong>
              {invoice.client_company && <p>{invoice.client_company}</p>}
              {invoice.client_email && <p>{invoice.client_email}</p>}
            </div>

            <div className="piv-table-wrap">
              <table className="piv-line-items">
                <thead>
                  <tr>
                    <th>{t('publicInvoice.description')}</th>
                    <th>{t('publicInvoice.quantity')}</th>
                    <th>{t('publicInvoice.unitPrice')}</th>
                    <th>{t('publicInvoice.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length ? (
                    lineItems.map((item, idx) => {
                      const quantity = Number(item.quantity || 1);
                      const unitPrice = Number(item.unit_price || 0);
                      return (
                        <tr key={`${item.description || 'line'}-${idx}`}>
                          <td>{item.description || t('publicInvoice.service')}</td>
                          <td>{quantity}</td>
                          <td>{formatMoney(unitPrice)}</td>
                          <td>{formatMoney(quantity * unitPrice)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="4" className="piv-empty-line">
                        {t('publicInvoice.lineItemsUnavailable')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="piv-totals">
              <div>
                <span>{t('publicInvoice.subtotal')}</span>
                <strong>{formatMoney(subtotal)}</strong>
              </div>
              {taxAmount > 0 && (
                <div>
                  <span>{t('publicInvoice.tax', { rate: invoice.invoice_tax_rate || 0 })}</span>
                  <strong>{formatMoney(taxAmount)}</strong>
                </div>
              )}
              {amountPaid > 0 && (
                <div>
                  <span>{t('publicInvoice.amountPaid')}</span>
                  <strong>{formatMoney(amountPaid)}</strong>
                </div>
              )}
              <div className="piv-total-due">
                <span>{t('publicInvoice.totalDue')}</span>
                <strong>{formatMoney(balanceDue)}</strong>
              </div>
            </div>

            {invoice.notes && (
              <div className="piv-notes">
                <span>{t('publicInvoice.notesFrom', { business: business?.business_name || t('publicInvoice.fallbackBusiness') })}</span>
                <p>{invoice.notes}</p>
              </div>
            )}
          </section>

          <aside className="piv-side">
            <section className="piv-panel piv-action-card">
              {isPaid ? (
                <>
                  <CheckCircle2 size={34} aria-hidden="true" />
                  <h2>{t('publicInvoice.paymentReceivedTitle')}</h2>
                  <p>{t('publicInvoice.paymentReceivedBody')}</p>
                </>
              ) : (
                <>
                  <Mail size={34} aria-hidden="true" />
                  <h2>{t('publicInvoice.payOfflineTitle', { defaultValue: 'Pay outside OxSteed' })}</h2>
                  <p>{t('publicInvoice.payOfflineBody', {
                    business: business?.business_name || t('publicInvoice.fallbackBusiness'),
                    defaultValue: 'Use the payment method you agreed with {{business}} (bank transfer, cash, or other).',
                  })}</p>
                  {user && invoice?.id ? (
                    <InvoiceStripeCardPay
                      invoiceId={String(invoice.id)}
                      balanceCents={balanceDueCents}
                      onPaid={() => setReloadKey((key) => key + 1)}
                      className="piv-stripe-card-pay"
                    />
                  ) : null}
                  {canTryCreditPay && invoice?.id ? (
                    <InvoiceOxsteedCreditPay
                      invoiceId={String(invoice.id)}
                      balanceCents={balanceDueCents}
                      onPaid={() => setReloadKey((key) => key + 1)}
                    />
                  ) : !user && !isPaid ? (
                    <InvoiceCreditPaySignInPrompt className="piv-credit-signin" />
                  ) : null}
                </>
              )}
            </section>

            <section className="piv-panel piv-trust-card">
              <h2>{t('publicInvoice.whatNext')}</h2>
              <div className="piv-trust-item">
                <Lock size={18} aria-hidden="true" />
                <p>{t('publicInvoice.trustOffline')}</p>
              </div>
              <div className="piv-trust-item">
                <Clock3 size={18} aria-hidden="true" />
                <p>{t('publicInvoice.trustReceipts')}</p>
              </div>
              <div className="piv-trust-item">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>{t('publicInvoice.trustSupport')}</p>
              </div>
            </section>

            <section className="piv-panel piv-question-card">
              <h2>{t('publicInvoice.needClarity')}</h2>
              <p>{t('publicInvoice.clarityBody', { business: business?.business_name || t('publicInvoice.fallbackBusiness') })}</p>
              {business?.phone && <a href={`tel:${business.phone}`}>{business.phone}</a>}
            </section>
          </aside>
        </div>

        <footer className="piv-footer">
          <span>&copy; {new Date().getFullYear()} {business?.business_name || 'OxSteed'}.</span>
          <span>{t('publicInvoice.poweredBy')}</span>
        </footer>
      </main>
    </div>
  );
}

export default PublicInvoiceView;
