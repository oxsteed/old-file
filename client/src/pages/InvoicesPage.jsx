import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Eye,
  FileText,
  Mail,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../hooks/useAuth';
import invoicesApi from '../api/invoices';
import './InvoicesPage.css';

function centsToMoney(cents) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
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

function statusLabel(status = 'draft') {
  return String(status).replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

function invoiceDate(invoice) {
  return invoice.issued_at || invoice.issue_date || invoice.created_at;
}

function invoiceDueDate(invoice) {
  return invoice.due_at || invoice.due_date;
}

function invoiceAmount(invoice) {
  if (invoice.amount_cents !== undefined) return Number(invoice.amount_cents || 0);
  if (invoice.total_cents !== undefined) return Number(invoice.total_cents || 0);
  if (invoice.total !== undefined) return Math.round(Number(invoice.total || 0) * 100);
  return 0;
}

export default function InvoicesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [resendingEmail, setResendingEmail] = useState(null);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const response = await invoicesApi.listInvoices();
      setInvoices(response.data.invoices || []);
    } catch (err) {
      toast.error(t('invoices.loadError') || 'Failed to load invoices');
      console.error('Failed to load invoices', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async (invoiceId) => {
    try {
      setResendingEmail(invoiceId);
      await invoicesApi.resendInvoiceEmail(invoiceId);
      toast.success(t('invoices.emailResent') || 'Invoice email sent successfully');
    } catch (err) {
      toast.error(t('invoices.emailError') || 'Failed to send invoice email');
      console.error('Failed to resend email', err);
    } finally {
      setResendingEmail(null);
    }
  };

  const stats = useMemo(() => {
    const total = invoices.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
    const paid = invoices
      .filter((invoice) => invoice.status === 'paid')
      .reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
    const outstanding = invoices
      .filter((invoice) => ['issued', 'sent', 'overdue', 'draft'].includes(invoice.status))
      .reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
    const overdueCount = invoices.filter((invoice) => invoice.status === 'overdue').length;
    return { total, paid, outstanding, overdueCount };
  }, [invoices]);

  const isHelper = ['helper', 'helper_pro', 'broker', 'business'].includes(user?.role);

  return (
    <PageShell>
      <PageMeta
        title="My Invoices - OxSteed"
        description="Track OxSteed invoices, payment status, consulting receipts, service invoices, tool rental invoices, and business financial records."
      />
      <div className="invoices-page">
        <header className="invoices-hero">
          <div>
            <p className="invoices-kicker">Financial records</p>
            <h1>{t('invoices.title') || 'My Invoices'}</h1>
            <p>
              Keep your OxSteed paper trail in one place: consulting receipts, helper invoices,
              tool rental invoices, paid work, outstanding balances, and payment follow-up.
            </p>
          </div>
          <div className="invoices-hero-actions">
            <Link to="/dashboard?tab=money" className="invoices-btn invoices-btn-primary">
              <CreditCard size={16} />
              Money dashboard
            </Link>
            <button type="button" className="invoices-btn" onClick={loadInvoices} disabled={loading}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <section className="invoices-stats" aria-label="Invoice summary">
          <SummaryCard label="Total invoice value" value={centsToMoney(stats.total)} icon={FileText} />
          <SummaryCard label="Paid" value={centsToMoney(stats.paid)} icon={CheckCircle2} tone="success" />
          <SummaryCard label="Outstanding" value={centsToMoney(stats.outstanding)} icon={CalendarClock} tone="warn" />
          <SummaryCard label="Overdue" value={String(stats.overdueCount)} icon={ShieldCheck} tone={stats.overdueCount > 0 ? 'danger' : 'neutral'} />
        </section>

        {loading ? (
          <div className="invoices-loading">
            <div className="invoices-loading-icon">
              <FileText size={24} />
            </div>
            <p>{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : invoices.length > 0 ? (
          <section className="invoices-panel" aria-label="Invoice list">
            <div className="invoices-panel-header">
              <div>
                <h2>Invoice activity</h2>
                <p>Review payment status, resend emails, and inspect the details behind each charge.</p>
              </div>
              <span>{invoices.length} record{invoices.length === 1 ? '' : 's'}</span>
            </div>

            <div className="invoices-table">
              <div className="invoices-table-head">
                <span>Invoice</span>
                <span>Date</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Due</span>
                <span>Actions</span>
              </div>
              {invoices.map((invoice) => (
                <article key={invoice.id} className="invoices-row">
                  <div>
                    <strong>{invoice.invoice_number || `Invoice ${invoice.id}`}</strong>
                    <small>{invoice.customer_name || invoice.client_name || 'OxSteed customer'}</small>
                  </div>
                  <span>{formatDate(invoiceDate(invoice))}</span>
                  <span className="invoices-amount">{centsToMoney(invoiceAmount(invoice))}</span>
                  <span className={`invoices-status invoices-status-${invoice.status || 'draft'}`}>
                    {statusLabel(invoice.status)}
                  </span>
                  <span>{formatDate(invoiceDueDate(invoice))}</span>
                  <div className="invoices-row-actions">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(invoice)}
                      title={t('invoices.view') || 'View'}
                      aria-label={`View ${invoice.invoice_number || 'invoice'}`}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResendEmail(invoice.id)}
                      disabled={resendingEmail === invoice.id}
                      title={t('invoices.resendEmail') || 'Resend Email'}
                      aria-label={`Resend ${invoice.invoice_number || 'invoice'}`}
                    >
                      <Mail size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <EmptyInvoices isHelper={isHelper} />
        )}

        <section className="invoices-guide" aria-label="How invoices connect">
          <div>
            <h2>How invoices fit into OxSteed</h2>
            <p>
              Invoices are not just receipts. They connect work, tools, consulting, payments,
              records, and follow-up so customers and businesses can see what happened and what still needs attention.
            </p>
          </div>
          <div className="invoices-guide-grid">
            <GuideItem icon={Briefcase} title="Service work" text="Jobs and helper work can create a record of what was requested, billed, paid, or still outstanding." />
            <GuideItem icon={Wrench} title="Tool rentals" text="Tool owners can send rental invoices, track payment, and keep rental history connected to bookings." />
            <GuideItem icon={Sparkles} title="Consulting" text="Business-launch and consulting sessions can produce invoices that stay attached to your account history." />
            <GuideItem icon={PackageSearch} title="Business records" text="Paid and pending invoices feed the bigger money picture: income, taxes, cash flow, and planning." />
          </div>
        </section>

        {selectedInvoice && (
          <InvoiceDetailModal
            invoice={selectedInvoice}
            resending={resendingEmail === selectedInvoice.id}
            onClose={() => setSelectedInvoice(null)}
            onResend={() => handleResendEmail(selectedInvoice.id)}
          />
        )}
      </div>
    </PageShell>
  );
}

function SummaryCard({ label, value, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`invoices-summary-card tone-${tone}`}>
      <div className="invoices-summary-icon">
        <Icon size={18} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyInvoices({ isHelper }) {
  return (
    <section className="invoices-empty">
      <div className="invoices-empty-main">
        <div className="invoices-empty-icon">
          <FileText size={34} />
        </div>
        <p className="invoices-empty-kicker">No invoices yet</p>
        <h2>Your invoice hub is ready before the first bill arrives.</h2>
        <p>
          Once you purchase consulting, receive a service invoice, rent a tool, sell work,
          or send a client invoice, the record will appear here with payment status and follow-up actions.
        </p>
        <div className="invoices-empty-actions">
          {isHelper ? (
            <Link to="/dashboard?tab=invoices" className="invoices-btn invoices-btn-primary">
              Create an invoice
              <ArrowRight size={16} />
            </Link>
          ) : (
            <Link to="/consulting-intake" className="invoices-btn invoices-btn-primary">
              Explore consulting
              <ArrowRight size={16} />
            </Link>
          )}
          <Link to="/tool-rentals" className="invoices-btn">
            Browse tool rentals
          </Link>
          <Link to="/features#payments" className="invoices-btn">
            Learn how payments connect
          </Link>
        </div>
      </div>

      <div className="invoices-empty-side">
        <h3>What will show here?</h3>
        <ul>
          <li>Paid, pending, overdue, and cancelled invoice records.</li>
          <li>Consulting, service, rental, and business invoices.</li>
          <li>Due dates, payment state, customer or consultant details.</li>
          <li>Email resend actions and detail review for follow-up.</li>
        </ul>
      </div>
    </section>
  );
}

function GuideItem({ icon: Icon, title, text }) {
  return (
    <div className="invoices-guide-item">
      <Icon size={18} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function InvoiceDetailModal({ invoice, resending, onClose, onResend }) {
  return (
    <div className="invoices-modal-overlay" onClick={onClose}>
      <div className="invoices-modal" onClick={(event) => event.stopPropagation()}>
        <div className="invoices-modal-header">
          <div>
            <p>Invoice details</p>
            <h2>{invoice.invoice_number || `Invoice ${invoice.id}`}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close invoice details">
            <X size={18} />
          </button>
        </div>

        <div className="invoices-modal-total">
          <span>Amount</span>
          <strong>{centsToMoney(invoiceAmount(invoice))}</strong>
          <em className={`invoices-status invoices-status-${invoice.status || 'draft'}`}>
            {statusLabel(invoice.status)}
          </em>
        </div>

        <div className="invoices-modal-grid">
          <Detail label="Issued" value={formatDate(invoiceDate(invoice))} />
          <Detail label="Due date" value={formatDate(invoiceDueDate(invoice))} />
          {invoice.paid_at && <Detail label="Paid" value={formatDate(invoice.paid_at)} />}
          <Detail label="Customer" value={invoice.customer_name || invoice.client_name || 'Not listed'} />
          <Detail label="Consultant" value={invoice.consultant_name || 'Not listed'} />
          <Detail label="Status" value={statusLabel(invoice.status)} />
        </div>

        <div className="invoices-modal-footer">
          <button type="button" className="invoices-btn invoices-btn-primary" onClick={onResend} disabled={resending}>
            <Mail size={16} />
            {resending ? 'Sending...' : 'Resend email'}
          </button>
          <button type="button" className="invoices-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="invoices-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
