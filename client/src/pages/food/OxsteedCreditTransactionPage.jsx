import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ExternalLink,
  Printer,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { getOxsteedCreditTransaction } from '../../api/oxsteedCredit';
import './OxsteedCreditPage.css';

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function dateTime(value) {
  if (!value) return 'No date recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'No date recorded'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(error) {
  return error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
    || 'Unable to load this OxSteed Credit transaction.';
}

function transactionLabel(transaction) {
  return {
    load: 'Credit added',
    purchase: 'Restaurant purchase',
    refund: 'Purchase refunded',
    transfer: 'Credit transfer',
    adjustment: 'Account adjustment',
    expiration: 'Credit expired',
    chargeback: 'Chargeback',
  }[transaction?.transactionType] || String(transaction?.transactionType || 'Credit activity').replace(/_/g, ' ');
}

function referenceLabel(value) {
  if (!value) return 'Not provided';
  return String(value).replace(/_/g, ' ');
}

export default function OxsteedCreditTransactionPage() {
  const { transactionId } = useParams();
  const [searchParams] = useSearchParams();
  const currencyCode = searchParams.get('currency') || 'USD';
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setTransaction(await getOxsteedCreditTransaction(transactionId, { currencyCode }));
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [transactionId, currencyCode]);

  const printReceipt = () => window.print();
  const positive = transaction?.direction === 'credit';
  const currency = transaction?.currencyCode || currencyCode;
  const orderPath = transaction?.orderId ? `/food/orders/${transaction.orderId}` : null;

  return (
    <>
      <PageMeta title="OxSteed Credit transaction" description="Review a detailed OxSteed Credit transaction receipt." noIndex />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <Link to="/oxsteed-credit" className="ox-credit-back"><ArrowLeft size={16} /> Back to OxSteed Credit</Link>
          <header className="ox-credit-hero">
            <div>
              <p className="ox-credit-eyebrow">OxSteed financial services</p>
              <h1>Transaction receipt</h1>
              <p>Review the posted details for this OxSteed Credit balance change. Your access is limited to your own account activity.</p>
            </div>
            <button type="button" className="ox-credit-refresh ox-credit-print-button" onClick={printReceipt} disabled={!transaction}><Printer size={16} /> Print / save PDF</button>
          </header>

          {loading ? <div className="ox-credit-loading">Loading transaction details...</div> : error ? (
            <section className="ox-credit-panel ox-credit-error-panel" role="alert">
              <AlertCircle size={26} />
              <strong>Transaction unavailable</strong>
              <span>{error}</span>
              <button type="button" className="ox-credit-refresh" onClick={load}><RefreshCw size={15} /> Try again</button>
            </section>
          ) : transaction ? (
            <>
              <section className={`ox-credit-receipt-card ${positive ? 'positive' : 'negative'}`}>
                <div className="ox-credit-receipt-top">
                  <span className="ox-credit-receipt-icon">{positive ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span>
                  <div><p className="ox-credit-eyebrow">{transactionLabel(transaction)}</p><strong>{positive ? '+' : '-'}{money(transaction.amountCents, currency)}</strong><span>{dateTime(transaction.postedAt || transaction.createdAt)}</span></div>
                  <span className="ox-credit-receipt-status"><ShieldCheck size={14} /> Posted</span>
                </div>
                <div className="ox-credit-receipt-grid">
                  <div><span>Currency</span><strong>{currency}</strong></div>
                  <div><span>Activity type</span><strong>{referenceLabel(transaction.transactionType)}</strong></div>
                  <div><span>Transaction ID</span><strong>{transaction.id}</strong></div>
                </div>
              </section>

              <div className="ox-credit-sections ox-credit-detail-sections">
                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Context</p><h2>Related details</h2></div><Receipt size={21} color="#d66e0c" /></div>
                  <div className="ox-credit-detail-list">
                    <div><span>Description</span><strong>{transaction.description || 'OxSteed Credit ledger entry'}</strong></div>
                    <div><span>Restaurant</span><strong>{transaction.restaurantName || 'Not tied to a restaurant'}</strong></div>
                    {orderPath && <div><span>Food order</span><strong><Link to={orderPath}>Order #{transaction.orderId} <ExternalLink size={13} /></Link></strong></div>}
                    <div><span>Reference type</span><strong>{referenceLabel(transaction.referenceType)}</strong></div>
                    <div><span>Reference ID</span><strong className="ox-credit-detail-code">{transaction.referenceId || 'Not provided'}</strong></div>
                  </div>
                </section>

                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Assistance</p><h2>Need help?</h2></div><Building2 size={21} color="#15727a" /></div>
                  <div className="ox-credit-help-content">
                    <p>If this entry looks incorrect or you do not recognize it, report it from your Credit activity list. A dispute creates a review record without changing your balance automatically.</p>
                    <Link to="/oxsteed-credit#credit-activity" className="ox-credit-secondary-link">Report a problem <ArrowUpRight size={15} /></Link>
                    <div className="ox-credit-security-note"><AlertCircle size={15} /> Need more help? <Link to="/support/escalation">Contact support</Link></div>
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </div>
      </main>
      <Footer />
    </>
  );
}
