import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

function centsToMoney(cents, language) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat(language || undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatDate(value, language, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(language || undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusLabel(status = 'draft', t) {
  const normalized = String(status || 'draft').toLowerCase();
  const map = {
    draft: t('invoices.statusDraft', { defaultValue: 'Draft' }),
    sent: t('invoices.statusSent', { defaultValue: 'Sent' }),
    issued: t('invoices.statusIssued', { defaultValue: 'Issued' }),
    paid: t('invoices.statusPaid', { defaultValue: 'Paid' }),
    overdue: t('invoices.statusOverdue', { defaultValue: 'Overdue' }),
    cancelled: t('invoices.statusCancelled', { defaultValue: 'Cancelled' }),
    partial: t('invoices.statusPartial', { defaultValue: 'Partially paid' }),
    outstanding: t('invoices.statusOutstanding', { defaultValue: 'Outstanding' }),
  };
  return map[normalized] || normalized.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
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
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [resendingEmail, setResendingEmail] = useState(null);
  const [view, setView] = useState(searchParams.get('view') || 'all');

  useEffect(() => {
    loadInvoices(view);
  }, [view]);

  useEffect(() => {
    const invoiceId = searchParams.get('invoiceId');
    if (!invoiceId || loading || !invoices.length) return;
    const match = invoices.find((inv) => String(inv.id) === String(invoiceId));
    if (match) setSelectedInvoice(match);
  }, [searchParams, invoices, loading]);

  const loadInvoices = async (activeView = view) => {
    try {
      setLoading(true);
      const response = await invoicesApi.listInvoices(50, 0, activeView);
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
      .filter((invoice) => ['issued', 'sent', 'overdue', 'partial', 'draft'].includes(invoice.status))
      .reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
    const overdueCount = invoices.filter((invoice) => invoice.status === 'overdue').length;
    return { total, paid, outstanding, overdueCount };
  }, [invoices]);

  const isHelper = ['helper', 'helper_pro', 'broker', 'business'].includes(user?.role);
  const language = i18n.resolvedLanguage || i18n.language;
  const notSetText = t('invoices.notSet', { defaultValue: 'Not set' });
  const notListedText = t('invoices.notListed', { defaultValue: 'Not listed' });

  return (
    <PageShell>
      <PageMeta
        title={t('invoices.metaTitle', { defaultValue: 'My Invoices - OxSteed' })}
        description={t('invoices.metaDescription', { defaultValue: 'Track OxSteed invoices, payment status, consulting receipts, service invoices, tool rental invoices, and business financial records.' })}
      />
      <div className="invoices-page">
        <header className="invoices-hero">
          <div>
            <p className="invoices-kicker">{t('invoices.kicker', { defaultValue: 'Financial records' })}</p>
            <h1>{t('invoices.title') || 'My Invoices'}</h1>
            <p>
              {t('invoices.heroDescription', { defaultValue: 'Keep your OxSteed paper trail in one place: consulting receipts, helper invoices, tool rental invoices, paid work, outstanding balances, and payment follow-up.' })}
            </p>
          </div>
          <div className="invoices-hero-actions">
            <Link to="/dashboard?tab=money" className="invoices-btn invoices-btn-primary">
              <CreditCard size={16} />
              {t('invoices.moneyDashboard', { defaultValue: 'Money dashboard' })}
            </Link>
            <button type="button" className="invoices-btn" onClick={loadInvoices} disabled={loading}>
              <RefreshCw size={16} />
              {t('invoices.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </header>

        <div className="invoices-view-tabs" role="tablist" aria-label={t('invoices.viewTabsAria', { defaultValue: 'Invoice views' })}>
          {[
            { key: 'all', label: t('invoices.viewAll', { defaultValue: 'All' }) },
            { key: 'issued', label: t('invoices.viewIssued', { defaultValue: 'Issued by me' }) },
            { key: 'received', label: t('invoices.viewReceived', { defaultValue: 'Bills to pay' }) },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              className={`invoices-view-tab${view === tab.key ? ' active' : ''}`}
              onClick={() => {
                setView(tab.key);
                const next = new URLSearchParams(searchParams);
                next.set('view', tab.key);
                setSearchParams(next, { replace: true });
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="invoices-stats" aria-label={t('invoices.summaryAriaLabel', { defaultValue: 'Invoice summary' })}>
          <SummaryCard label={t('invoices.totalInvoiceValue', { defaultValue: 'Total invoice value' })} value={centsToMoney(stats.total, language)} icon={FileText} />
          <SummaryCard label={t('invoices.statusPaid', { defaultValue: 'Paid' })} value={centsToMoney(stats.paid, language)} icon={CheckCircle2} tone="success" />
          <SummaryCard label={t('invoices.statusOutstanding', { defaultValue: 'Outstanding' })} value={centsToMoney(stats.outstanding, language)} icon={CalendarClock} tone="warn" />
          <SummaryCard label={t('invoices.statusOverdue', { defaultValue: 'Overdue' })} value={String(stats.overdueCount)} icon={ShieldCheck} tone={stats.overdueCount > 0 ? 'danger' : 'neutral'} />
        </section>

        {loading ? (
          <div className="invoices-loading">
            <div className="invoices-loading-icon">
              <FileText size={24} />
            </div>
            <p>{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : invoices.length > 0 ? (
          <section className="invoices-panel" aria-label={t('invoices.listAriaLabel', { defaultValue: 'Invoice list' })}>
            <div className="invoices-panel-header">
              <div>
                <h2>{t('invoices.activityTitle', { defaultValue: 'Invoice activity' })}</h2>
                <p>{t('invoices.activityDescription', { defaultValue: 'Review payment status, resend emails, and inspect the details behind each charge.' })}</p>
              </div>
              <span>{t('invoices.recordCount', { count: invoices.length, defaultValue: '{{count}} record' })}</span>
            </div>

            <div className="invoices-table">
              <div className="invoices-table-head">
                <span>{t('invoices.invoiceLabel', { defaultValue: 'Invoice' })}</span>
                <span>{t('invoices.date', { defaultValue: 'Date' })}</span>
                <span>{t('invoices.amount', { defaultValue: 'Amount' })}</span>
                <span>{t('invoices.status', { defaultValue: 'Status' })}</span>
                <span>{t('invoices.due', { defaultValue: 'Due' })}</span>
                <span>{t('invoices.actions', { defaultValue: 'Actions' })}</span>
              </div>
              {invoices.map((invoice) => (
                <article key={invoice.id} className="invoices-row">
                  <div>
                    <strong>{invoice.invoice_number || t('invoices.invoiceIdFallback', { id: invoice.id, defaultValue: 'Invoice {{id}}' })}</strong>
                    <small>
                      {invoice.perspective === 'received'
                        ? (invoice.business_name || t('invoices.fromBusinessFallback', { defaultValue: 'From a business' }))
                        : (invoice.customer_name || invoice.client_name || t('invoices.customerFallback', { defaultValue: 'OxSteed customer' }))}
                    </small>
                  </div>
                  <span>{formatDate(invoiceDate(invoice), language, notSetText)}</span>
                  <span className="invoices-amount">{centsToMoney(invoiceAmount(invoice), language)}</span>
                  <span className={`invoices-status invoices-status-${invoice.status || 'draft'}`}>
                    {statusLabel(invoice.status, t)}
                  </span>
                  <span>{formatDate(invoiceDueDate(invoice), language, notSetText)}</span>
                  <div className="invoices-row-actions">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(invoice)}
                      title={t('invoices.view') || 'View'}
                      aria-label={t('invoices.viewAriaLabel', { invoice: invoice.invoice_number || t('invoices.invoiceGeneric', { defaultValue: 'invoice' }), defaultValue: 'View {{invoice}}' })}
                    >
                      <Eye size={16} />
                    </button>
                    {invoice.perspective === 'received' && invoice.public_token && invoice.status !== 'paid' ? (
                      <Link
                        to={`/invoice/p/${invoice.public_token}`}
                        className="invoices-pay-link"
                        title={t('invoices.viewAndPay', { defaultValue: 'View & pay' })}
                      >
                        <CreditCard size={16} />
                      </Link>
                    ) : null}
                    {invoice.perspective !== 'received' ? (
                      <button
                        type="button"
                        onClick={() => handleResendEmail(invoice.id)}
                        disabled={resendingEmail === invoice.id}
                        title={t('invoices.resendEmail') || 'Resend Email'}
                        aria-label={t('invoices.resendAriaLabel', { invoice: invoice.invoice_number || t('invoices.invoiceGeneric', { defaultValue: 'invoice' }), defaultValue: 'Resend {{invoice}}' })}
                      >
                        <Mail size={16} />
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <EmptyInvoices isHelper={isHelper} />
        )}

        <section className="invoices-guide" aria-label={t('invoices.guideAriaLabel', { defaultValue: 'How invoices connect' })}>
          <div>
            <h2>{t('invoices.guideTitle', { defaultValue: 'How invoices fit into OxSteed' })}</h2>
            <p>{t('invoices.guideDescription', { defaultValue: 'Invoices are not just receipts. They connect work, tools, consulting, payments, records, and follow-up so customers and businesses can see what happened and what still needs attention.' })}</p>
          </div>
          <div className="invoices-guide-grid">
            <GuideItem icon={Briefcase} title={t('invoices.guideServiceTitle', { defaultValue: 'Service work' })} text={t('invoices.guideServiceText', { defaultValue: 'Jobs and helper work can create a record of what was requested, billed, paid, or still outstanding.' })} />
            <GuideItem icon={Wrench} title={t('invoices.guideToolTitle', { defaultValue: 'Tool rentals' })} text={t('invoices.guideToolText', { defaultValue: 'Tool owners can send rental invoices, track payment, and keep rental history connected to bookings.' })} />
            <GuideItem icon={Sparkles} title={t('invoices.guideConsultingTitle', { defaultValue: 'Consulting' })} text={t('invoices.guideConsultingText', { defaultValue: 'Business-launch and consulting sessions can produce invoices that stay attached to your account history.' })} />
            <GuideItem icon={PackageSearch} title={t('invoices.guideBusinessTitle', { defaultValue: 'Business records' })} text={t('invoices.guideBusinessText', { defaultValue: 'Paid and pending invoices feed the bigger money picture: income, taxes, cash flow, and planning.' })} />
          </div>
        </section>

        {selectedInvoice && (
          <InvoiceDetailModal
            invoice={selectedInvoice}
            language={language}
            notSetText={notSetText}
            notListedText={notListedText}
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
  const { t } = useTranslation();
  return (
    <section className="invoices-empty">
      <div className="invoices-empty-main">
        <div className="invoices-empty-icon">
          <FileText size={34} />
        </div>
        <p className="invoices-empty-kicker">{t('invoices.noInvoices', { defaultValue: 'No invoices yet' })}</p>
        <h2>{t('invoices.emptyTitle', { defaultValue: 'Your invoice hub is ready before the first bill arrives.' })}</h2>
        <p>{t('invoices.emptyDescription', { defaultValue: 'Once you purchase consulting, receive a service invoice, rent a tool, sell work, or send a client invoice, the record will appear here with payment status and follow-up actions.' })}</p>
        <div className="invoices-empty-actions">
          {isHelper ? (
            <Link to="/dashboard?tab=invoices" className="invoices-btn invoices-btn-primary">
              {t('invoices.createInvoice', { defaultValue: 'Create an invoice' })}
              <ArrowRight size={16} />
            </Link>
          ) : (
            <Link to="/consulting-intake" className="invoices-btn invoices-btn-primary">
              {t('invoices.exploreConsulting', { defaultValue: 'Explore consulting' })}
              <ArrowRight size={16} />
            </Link>
          )}
          <Link to="/tool-rentals" className="invoices-btn">
            {t('invoices.browseToolRentals', { defaultValue: 'Browse tool rentals' })}
          </Link>
          <Link to="/features#payments" className="invoices-btn">
            {t('invoices.learnPayments', { defaultValue: 'Learn how payments connect' })}
          </Link>
        </div>
      </div>

      <div className="invoices-empty-side">
        <h3>{t('invoices.emptySideTitle', { defaultValue: 'What will show here?' })}</h3>
        <ul>
          <li>{t('invoices.emptyBullet1', { defaultValue: 'Paid, pending, overdue, and cancelled invoice records.' })}</li>
          <li>{t('invoices.emptyBullet2', { defaultValue: 'Consulting, service, rental, and business invoices.' })}</li>
          <li>{t('invoices.emptyBullet3', { defaultValue: 'Due dates, payment state, customer or consultant details.' })}</li>
          <li>{t('invoices.emptyBullet4', { defaultValue: 'Email resend actions and detail review for follow-up.' })}</li>
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

function InvoiceDetailModal({ invoice, language, notSetText, notListedText, resending, onClose, onResend }) {
  const { t } = useTranslation();
  return (
    <div className="invoices-modal-overlay" onClick={onClose}>
      <div className="invoices-modal" onClick={(event) => event.stopPropagation()}>
        <div className="invoices-modal-header">
          <div>
            <p>{t('invoices.detailsTitle', { defaultValue: 'Invoice details' })}</p>
            <h2>{invoice.invoice_number || t('invoices.invoiceIdFallback', { id: invoice.id, defaultValue: 'Invoice {{id}}' })}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('invoices.closeDetails', { defaultValue: 'Close invoice details' })}>
            <X size={18} />
          </button>
        </div>

        <div className="invoices-modal-total">
          <span>{t('invoices.amount', { defaultValue: 'Amount' })}</span>
          <strong>{centsToMoney(invoiceAmount(invoice), language)}</strong>
          <em className={`invoices-status invoices-status-${invoice.status || 'draft'}`}>
            {statusLabel(invoice.status, t)}
          </em>
        </div>

        <div className="invoices-modal-grid">
          <Detail label={t('invoices.issuedDate', { defaultValue: 'Issued' })} value={formatDate(invoiceDate(invoice), language, notSetText)} />
          <Detail label={t('invoices.dueDate', { defaultValue: 'Due Date' })} value={formatDate(invoiceDueDate(invoice), language, notSetText)} />
          {invoice.paid_at && <Detail label={t('invoices.paidDate', { defaultValue: 'Paid' })} value={formatDate(invoice.paid_at, language, notSetText)} />}
          <Detail label={t('invoices.customerName', { defaultValue: 'Customer' })} value={invoice.customer_name || invoice.client_name || notListedText} />
          <Detail label={t('invoices.consultant', { defaultValue: 'Consultant' })} value={invoice.consultant_name || notListedText} />
          <Detail label={t('invoices.status', { defaultValue: 'Status' })} value={statusLabel(invoice.status, t)} />
        </div>

        <div className="invoices-modal-footer">
          <button type="button" className="invoices-btn invoices-btn-primary" onClick={onResend} disabled={resending}>
            <Mail size={16} />
            {resending ? t('invoices.sending', { defaultValue: 'Sending...' }) : t('invoices.resendEmail', { defaultValue: 'Resend Email' })}
          </button>
          <button type="button" className="invoices-btn" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
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
