import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  AlertCircle,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Store,
  WalletCards,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import {
  getOxsteedCreditAccount,
  listOxsteedCreditEligiblePartners,
  listOxsteedCreditTransactions,
  openOxsteedCreditDispute,
} from '../../api/oxsteedCredit';
import toast from 'react-hot-toast';
import './OxsteedCreditPage.css';

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format((Number(cents) || 0) / 100);
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
    || 'Unable to load OxSteed Credit right now.';
}

function partnerLimit(partner) {
  if (!partner.maxTransactionCents) return null;
  return `Up to ${money(partner.maxTransactionCents, partner.currencyCode)} per transaction`;
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
  }[transaction.transactionType] || String(transaction.transactionType || 'Credit activity').replace(/_/g, ' ');
}

export default function OxsteedCreditPage() {
  const [account, setAccount] = useState(null);
  const [partners, setPartners] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disputeTransactionId, setDisputeTransactionId] = useState(null);
  const [disputeReason, setDisputeReason] = useState('incorrect_amount');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [accountResult, partnerResult, transactionResult] = await Promise.all([
        getOxsteedCreditAccount(),
        listOxsteedCreditEligiblePartners(),
        listOxsteedCreditTransactions({ limit: 50 }),
      ]);
      setAccount(accountResult);
      setPartners(Array.isArray(partnerResult) ? partnerResult : []);
      setTransactions(Array.isArray(transactionResult) ? transactionResult : []);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitDispute = async (event) => {
    event.preventDefault();
    if (!disputeTransactionId || !disputeDescription.trim()) return;
    setDisputeSubmitting(true);
    try {
      await openOxsteedCreditDispute({ transactionId: disputeTransactionId, reasonCode: disputeReason, description: disputeDescription.trim() });
      toast.success('Your dispute was submitted for review.');
      setDisputeTransactionId(null);
      setDisputeDescription('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const currency = account?.currencyCode || 'USD';
  const balanceCents = Number(account?.balanceCents || 0);
  const reservedCents = Number(account?.reservedCents || 0);
  const availableCents = Number(account?.availableBalanceCents ?? Math.max(0, balanceCents - reservedCents));

  return (
    <>
      <PageMeta
        title="OxSteed Credit"
        description="See your OxSteed Credit balance and the partner restaurants where your restricted stored value can be spent."
        noIndex
      />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <Link to="/restaurants" className="ox-credit-back"><ArrowLeft size={16} /> Back to restaurants</Link>
          <header className="ox-credit-hero">
            <div>
              <p className="ox-credit-eyebrow">OxSteed financial services</p>
              <h1>OxSteed Credit</h1>
              <p>One restricted credit balance you can use at participating restaurants under their current partner agreements.</p>
            </div>
            <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true })} disabled={loading || refreshing}>
              <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> Refresh
            </button>
          </header>

          <section className="ox-credit-disclaimer" role="note">
            <ShieldCheck size={19} />
            <div><strong>Stored-value credit, not a bank account</strong><span>OxSteed Credit is not a deposit account, cash balance, or promise of bank services. Spending is limited to the partners and terms shown below.</span></div>
          </section>

          {loading ? <div className="ox-credit-loading">Loading your credit account...</div> : (
            <>
              <section className="ox-credit-balance-card">
                <div className="ox-credit-balance-top"><span className="ox-credit-wallet-icon"><WalletCards size={23} /></span><div><span>OxSteed Credit balance</span><strong>{money(balanceCents, currency)}</strong></div><span className={`ox-credit-status ${account?.status === 'active' ? 'active' : ''}`}>{account?.status || 'active'}</span></div>
                <div className="ox-credit-balance-grid"><div><span>Available to spend</span><strong>{money(availableCents, currency)}</strong></div><div><span>Reserved</span><strong>{money(reservedCents, currency)}</strong></div><div><span>Currency</span><strong>{currency}</strong></div></div>
              </section>

              <div className="ox-credit-sections">
                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Partner network</p><h2>Where you can spend</h2></div><span className="ox-credit-count">{partners.length}</span></div>
                  <p className="ox-credit-panel-copy">Only active restaurants with a current agreement appear here. The list is the source of truth for where your balance can be used today.</p>
                  {!partners.length ? <div className="ox-credit-empty"><Store size={27} /><strong>No partner restaurants yet</strong><span>OxSteed Credit becomes spendable as participating restaurants are activated.</span></div> : <div className="ox-credit-partner-list">{partners.map((partner) => <article className="ox-credit-partner" key={partner.partnerId}><div className="ox-credit-partner-mark">{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <Building2 size={21} />}</div><div className="ox-credit-partner-content"><div className="ox-credit-partner-title"><div><h3>{partner.restaurantName || 'Partner restaurant'}</h3><span>{[partner.city, partner.state].filter(Boolean).join(', ') || 'Location not listed'}</span></div><span className="ox-credit-eligible"><ShieldCheck size={14} /> Eligible</span></div><div className="ox-credit-tags">{(partner.allowedOrderTypes || []).map((type) => <span key={type}>{String(type).replace(/_/g, ' ')}</span>)}{partner.hasCustomerEntitlement && <span>Customer entitlement</span>}</div><p>{partner.customerTerms || 'Use is subject to the active partner agreement and restaurant terms.'}</p><div className="ox-credit-partner-meta">{partnerLimit(partner)}{partner.dailyCustomerLimitCents ? <span>Daily limit {money(partner.dailyCustomerLimitCents, partner.currencyCode)}</span> : null}{partner.allowedCategories?.length ? <span>{partner.allowedCategories.length} covered categories</span> : null}</div></div></article>)}</div>}
                  <Link to="/restaurants" className="ox-credit-secondary-link">Browse participating restaurants <ArrowUpRight size={15} /></Link>
                </section>

                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Statement</p><h2>Recent activity</h2></div><span className="ox-credit-count">{transactions.length}</span></div>
                  <p className="ox-credit-panel-copy">Every balance change is recorded in the OxSteed Credit ledger with a timestamp and transaction type.</p>
                  {!transactions.length ? <div className="ox-credit-empty"><Clock3 size={27} /><strong>No activity yet</strong><span>Your credit activity will appear here when a load, purchase, transfer, or refund is posted.</span></div> : <div className="ox-credit-transaction-list">{transactions.map((transaction) => { const positive = transaction.direction === 'credit' || ['load', 'refund'].includes(transaction.transactionType); return <article key={transaction.id}><span className={`ox-credit-transaction-icon ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{transactionLabel(transaction)}</strong><span>{transaction.description || 'OxSteed Credit ledger entry'}</span><small>{dateTime(transaction.postedAt || transaction.createdAt)}</small><button type="button" className="ox-credit-dispute-button" onClick={() => setDisputeTransactionId(transaction.id)}>Report a problem</button></div><b className={positive ? 'positive' : 'negative'}>{positive ? '+' : '-'}{money(transaction.amountCents, transaction.currencyCode || currency)}</b></article>; })}</div>}
                  {disputeTransactionId && <form className="ox-credit-dispute-form" onSubmit={submitDispute}><strong>Report a transaction problem</strong><span>This creates a review record without changing your balance automatically.</span><select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}><option value="incorrect_amount">Incorrect amount</option><option value="unauthorized">I do not recognize this</option><option value="duplicate">Duplicate transaction</option><option value="restaurant_issue">Restaurant or order issue</option><option value="other">Other</option></select><textarea required maxLength={4000} value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} placeholder="Tell us what happened" rows={3} /><div><button type="button" onClick={() => setDisputeTransactionId(null)}>Cancel</button><button type="submit" disabled={disputeSubmitting}>{disputeSubmitting ? 'Submitting...' : 'Submit dispute'}</button></div></form>}
                  <div className="ox-credit-security-note"><AlertCircle size={15} /> Need help with a transaction? <Link to="/support/escalation">Contact support</Link></div>
                </section>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
