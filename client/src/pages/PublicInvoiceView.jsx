import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import '../styles/PublicInvoiceView.css';

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

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

function getStatusLabel(status = 'sent') {
  return String(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWebsiteHref(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function PublicInvoiceView() {
  const { token } = useParams();
  const { t } = useTranslation();

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        setError('Invoice not found or has expired');
        console.error('Error loading invoice:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadInvoice();
    return () => {
      isMounted = false;
    };
  }, [token]);

  const lineItems = useMemo(() => parseLineItems(invoice?.line_items), [invoice]);
  const subtotal = Number(invoice?.subtotal || 0);
  const taxAmount = Number(invoice?.tax_amount || 0);
  const total = Number(invoice?.total || 0);
  const amountPaid = Number(invoice?.amount_paid || 0);
  const balanceDue = Math.max(total - amountPaid, 0);
  const status = invoice?.status || 'sent';
  const isPaid = status === 'paid';
  const websiteHref = getWebsiteHref(business?.website);

  if (loading) {
    return (
      <div className="piv-page">
        <PageMeta title="Loading invoice" noIndex />
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
        <PageMeta title="Invoice unavailable" noIndex />
        <div className="piv-state-card piv-state-card-error">
          <AlertCircle size={34} aria-hidden="true" />
          <h1>{t('common.notFound')}</h1>
          <p>
            {error || 'Invoice not found'} This can happen when a link is expired, mistyped, or
            the invoice was replaced by a newer version.
          </p>
          <div className="piv-state-actions">
            <Link to="/" className="piv-button piv-button-primary">
              <ArrowLeft size={16} aria-hidden="true" />
              {t('common.backHome')}
            </Link>
            <Link to="/support/escalation" className="piv-button piv-button-secondary">
              Contact support
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="piv-page">
      <PageMeta
        title={`${invoice.invoice_number || 'Invoice'} from ${business?.business_name || 'OxSteed'}`}
        description="View a secure OxSteed invoice, confirm the business details, and continue to payment."
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
                Secure OxSteed invoice
              </div>
              <h1 id="invoice-title">{business?.business_name || 'OxSteed invoice'}</h1>
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
            <span className={`piv-status piv-status-${status}`}>{getStatusLabel(status)}</span>
            <p>Balance due</p>
            <strong>{formatMoney(balanceDue)}</strong>
            <small>Invoice {invoice.invoice_number || 'number pending'}</small>
          </div>
        </section>

        <div className="piv-layout">
          <section className="piv-panel piv-invoice-panel" aria-label="Invoice details">
            <div className="piv-details-grid">
              <div>
                <span>Invoice number</span>
                <strong>{invoice.invoice_number || 'Not assigned'}</strong>
              </div>
              <div>
                <span>Issued</span>
                <strong>{formatDate(invoice.issue_date)}</strong>
              </div>
              <div>
                <span>Due</span>
                <strong>{formatDate(invoice.due_date)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{getStatusLabel(status)}</strong>
              </div>
            </div>

            <div className="piv-bill-to">
              <span>Bill to</span>
              <strong>{invoice.client_name || 'Customer'}</strong>
              {invoice.client_company && <p>{invoice.client_company}</p>}
              {invoice.client_email && <p>{invoice.client_email}</p>}
            </div>

            <div className="piv-table-wrap">
              <table className="piv-line-items">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length ? (
                    lineItems.map((item, idx) => {
                      const quantity = Number(item.quantity || 1);
                      const unitPrice = Number(item.unit_price || 0);
                      return (
                        <tr key={`${item.description || 'line'}-${idx}`}>
                          <td>{item.description || 'Service'}</td>
                          <td>{quantity}</td>
                          <td>{formatMoney(unitPrice)}</td>
                          <td>{formatMoney(quantity * unitPrice)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="4" className="piv-empty-line">
                        Line item details are unavailable. The total below is still the invoice
                        amount recorded by the business.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="piv-totals">
              <div>
                <span>Subtotal</span>
                <strong>{formatMoney(subtotal)}</strong>
              </div>
              {taxAmount > 0 && (
                <div>
                  <span>Tax ({invoice.invoice_tax_rate || 0}%)</span>
                  <strong>{formatMoney(taxAmount)}</strong>
                </div>
              )}
              {amountPaid > 0 && (
                <div>
                  <span>Amount paid</span>
                  <strong>{formatMoney(amountPaid)}</strong>
                </div>
              )}
              <div className="piv-total-due">
                <span>Total due</span>
                <strong>{formatMoney(balanceDue)}</strong>
              </div>
            </div>

            {invoice.notes && (
              <div className="piv-notes">
                <span>Notes from {business?.business_name || 'the business'}</span>
                <p>{invoice.notes}</p>
              </div>
            )}
          </section>

          <aside className="piv-side">
            <section className="piv-panel piv-action-card">
              {isPaid ? (
                <>
                  <CheckCircle2 size={34} aria-hidden="true" />
                  <h2>Payment received</h2>
                  <p>Thank you. Keep this link for your records and future reference.</p>
                </>
              ) : (
                <>
                  <CreditCard size={34} aria-hidden="true" />
                  <h2>Ready to pay?</h2>
                  <p>Sign in to OxSteed to continue with secure payment and account protection.</p>
                  <Link to="/login" className="piv-button piv-button-primary piv-full-button">
                    Login to pay
                  </Link>
                </>
              )}
            </section>

            <section className="piv-panel piv-trust-card">
              <h2>What happens next</h2>
              <div className="piv-trust-item">
                <Lock size={18} aria-hidden="true" />
                <p>Payment stays tied to your OxSteed account and invoice record.</p>
              </div>
              <div className="piv-trust-item">
                <Clock3 size={18} aria-hidden="true" />
                <p>Due dates, paid status, and receipts stay visible after payment.</p>
              </div>
              <div className="piv-trust-item">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>Questions can be traced back to the business and OxSteed support.</p>
              </div>
            </section>

            <section className="piv-panel piv-question-card">
              <h2>Need clarity?</h2>
              <p>Contact {business?.business_name || 'the business'} before paying if a line item looks unfamiliar.</p>
              {business?.phone && <a href={`tel:${business.phone}`}>{business.phone}</a>}
            </section>
          </aside>
        </div>

        <footer className="piv-footer">
          <span>&copy; {new Date().getFullYear()} {business?.business_name || 'OxSteed'}.</span>
          <span>Powered by OxSteed secure invoices.</span>
        </footer>
      </main>
    </div>
  );
}

export default PublicInvoiceView;
