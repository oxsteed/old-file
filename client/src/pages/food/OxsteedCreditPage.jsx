import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  AlertCircle,
  Clock3,
  Download,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  WalletCards,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import {
  getOxsteedCreditAccount,
  getOxsteedCreditLimitSummary,
  listOxsteedCreditAccounts,
  getOxsteedCreditStatus,
  listOxsteedCreditHolds,
  getOxsteedCreditEligiblePartnerPage,
  getOxsteedCreditStatement,
  downloadOxsteedCreditStatement,
  getOxsteedCreditTransactionPage,
  openOxsteedCreditDispute,
  getOxsteedCreditDisputePage,
  createOxsteedCreditHold,
  releaseOxsteedCreditHold,
} from '../../api/oxsteedCredit';
import toast from 'react-hot-toast';
import './OxsteedCreditPage.css';
import { formatCreditMinorUnits, parseCreditMajorAmount } from '../../lib/creditCurrency';

const money = formatCreditMinorUnits;

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

function geographySummary(partner) {
  const geography = partner?.geography || {};
  const labels = [
    ['cities', 'Cities'],
    ['states', 'States'],
    ['postalCodes', 'Postal codes'],
    ['countries', 'Countries'],
  ].flatMap(([key, label]) => Array.isArray(geography[key]) && geography[key].length
    ? [`${label}: ${geography[key].join(', ')}`]
    : []);
  return labels.join(' · ') || 'Coverage follows the restaurant location';
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

function transactionOrderPath(transaction) {
  return transaction?.orderId ? `/food/orders/${transaction.orderId}` : null;
}

function transactionDetailPath(transaction, currency) {
  const transactionCurrency = transaction?.currencyCode || currency || 'USD';
  return `/oxsteed-credit/transactions/${encodeURIComponent(transaction.id)}?currency=${encodeURIComponent(transactionCurrency)}`;
}

function holdStatusLabel(status) {
  return {
    active: 'Reserved',
    captured: 'Captured',
    released: 'Released',
    expired: 'Expired',
  }[status] || 'Reservation';
}

function holdTerminalDate(hold) {
  if (hold.status === 'captured' && hold.capturedAt) return `Captured ${dateTime(hold.capturedAt)}`;
  if (['released', 'expired'].includes(hold.status) && hold.releasedAt) return `${holdStatusLabel(hold.status)} ${dateTime(hold.releasedAt)}`;
  return `Expires ${dateTime(hold.expiresAt)}`;
}

export default function OxsteedCreditPage() {
  const [account, setAccount] = useState(null);
  const [limitSummary, setLimitSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [partners, setPartners] = useState([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerOrderType, setPartnerOrderType] = useState('');
  const [partnerPagination, setPartnerPagination] = useState(null);
  const [holds, setHolds] = useState([]);
  const [holdPagination, setHoldPagination] = useState(null);
  const [railStatus, setRailStatus] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [statement, setStatement] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [disputePagination, setDisputePagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMorePartners, setLoadingMorePartners] = useState(false);
  const [loadingMoreHolds, setLoadingMoreHolds] = useState(false);
  const [loadingMoreDisputes, setLoadingMoreDisputes] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [holdPartnerId, setHoldPartnerId] = useState('');
  const [holdOrderType, setHoldOrderType] = useState('pickup');
  const [holdAmount, setHoldAmount] = useState('');
  const [holdPurpose, setHoldPurpose] = useState('');
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [createdHold, setCreatedHold] = useState(null);
  const [releasingHoldId, setReleasingHoldId] = useState(null);
  const [disputeTransactionId, setDisputeTransactionId] = useState(null);
  const [disputeReason, setDisputeReason] = useState('incorrect_amount');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const loadRequestRef = useRef(0);
  const partnerPageRequestRef = useRef(0);
  const holdPageRequestRef = useRef(0);
  const disputeRequestKeyRef = useRef('');

  const load = useCallback(async ({ quiet = false, currencyCode } = {}) => {
    const requestId = ++loadRequestRef.current;
    const partnerRequestId = ++partnerPageRequestRef.current;
    const holdRequestId = ++holdPageRequestRef.current;
    const isCurrentRequest = () => requestId === loadRequestRef.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const existingAccounts = await listOxsteedCreditAccounts();
      const preferredCurrency = currencyCode || existingAccounts[0]?.currencyCode || 'USD';
      // Eligible-partner discovery requires an active wallet. Create/load the
      // selected wallet first so a new currency cannot race the directory and
      // render a false empty state.
      const accountResult = await getOxsteedCreditAccount({ currencyCode: preferredCurrency });
      const [partnerResult, holdResult, railResult, statementResult, disputeResult, limitResult] = await Promise.all([
        getOxsteedCreditEligiblePartnerPage({ currencyCode: preferredCurrency, limit: 50, offset: 0 }),
        listOxsteedCreditHolds({ currencyCode: preferredCurrency, status: 'all', limit: 50, offset: 0 }).catch(() => null),
        getOxsteedCreditStatus().catch(() => null),
        getOxsteedCreditStatement({ limit: 50, currencyCode: preferredCurrency }).catch(() => null),
        getOxsteedCreditDisputePage({ limit: 50, offset: 0 }).catch(() => null),
        getOxsteedCreditLimitSummary({ currencyCode: preferredCurrency }).catch(() => null),
      ]);
      if (!isCurrentRequest()) return;
      const knownAccounts = Array.isArray(existingAccounts) ? existingAccounts : [];
      const hasSelectedAccount = knownAccounts.some((item) => item.currencyCode === accountResult?.currencyCode);
      setAccounts(hasSelectedAccount || !accountResult ? knownAccounts : [...knownAccounts, accountResult]);
      setSelectedCurrency(accountResult?.currencyCode || preferredCurrency);
      setAccount(accountResult);
      setHolds(Array.isArray(holdResult?.holds) ? holdResult.holds : []);
      if (holdRequestId === holdPageRequestRef.current) setHoldPagination(holdResult?.pagination || null);
      setRailStatus(railResult);
      setLimitSummary(limitResult);
      if (partnerRequestId === partnerPageRequestRef.current) {
        setPartners(Array.isArray(partnerResult?.partners) ? partnerResult.partners : []);
        setPartnerPagination(partnerResult?.pagination || null);
      }
      setDisputes(Array.isArray(disputeResult?.disputes) ? disputeResult.disputes : []);
      setDisputePagination(disputeResult?.pagination || null);
      if (statementResult) {
        setStatement(statementResult);
        setTransactions(Array.isArray(statementResult.transactions) ? statementResult.transactions : []);
      } else {
        const transactionResult = await getOxsteedCreditTransactionPage({ limit: 50, currencyCode: preferredCurrency });
        if (!isCurrentRequest()) return;
        setStatement(null);
        setTransactions(Array.isArray(transactionResult?.transactions) ? transactionResult.transactions : []);
      }
    } catch (error) {
      if (isCurrentRequest()) toast.error(errorMessage(error));
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  const changeCurrency = (event) => {
    const currencyCode = event.target.value;
    setSelectedCurrency(currencyCode);
    load({ quiet: true, currencyCode });
  };

  const refreshPartnerDirectory = async ({ append = false, offset = 0, search = partnerSearch, orderType = partnerOrderType } = {}) => {
    if (append && (loadingMorePartners || !partnerPagination?.hasMore)) return;
    const requestId = ++partnerPageRequestRef.current;
    if (append) setLoadingMorePartners(true);
    else setRefreshing(true);
    try {
      const page = await getOxsteedCreditEligiblePartnerPage({
        currencyCode: selectedCurrency,
        search: search.trim() || undefined,
        orderType: orderType || undefined,
        limit: 50,
        offset,
      });
      if (requestId !== partnerPageRequestRef.current) return;
      const nextPartners = Array.isArray(page?.partners) ? page.partners : [];
      setPartners((current) => append ? [...current, ...nextPartners] : nextPartners);
      setPartnerPagination(page?.pagination || null);
    } catch (error) {
      if (requestId === partnerPageRequestRef.current) toast.error(errorMessage(error));
    } finally {
      if (requestId === partnerPageRequestRef.current) {
        if (append) setLoadingMorePartners(false);
        else setRefreshing(false);
      }
    }
  };

  const submitPartnerFilters = (event) => {
    event.preventDefault();
    refreshPartnerDirectory();
  };

  const clearPartnerFilters = () => {
    setPartnerSearch('');
    setPartnerOrderType('');
    refreshPartnerDirectory({ search: '', orderType: '' });
  };

  const loadMorePartners = () => refreshPartnerDirectory({ append: true, offset: partnerPagination?.nextOffset || partners.length });

  const loadMoreHolds = async () => {
    if (!holdPagination?.hasMore || loadingMoreHolds) return;
    const requestId = ++holdPageRequestRef.current;
    setLoadingMoreHolds(true);
    try {
      const page = await listOxsteedCreditHolds({
        currencyCode: selectedCurrency,
        status: 'all',
        limit: 50,
        offset: holdPagination.nextOffset || holds.length,
      });
      if (requestId !== holdPageRequestRef.current) return;
      const nextHolds = Array.isArray(page?.holds) ? page.holds : [];
      setHolds((current) => [...current, ...nextHolds]);
      setHoldPagination(page?.pagination || null);
    } catch (error) {
      if (requestId === holdPageRequestRef.current) toast.error(errorMessage(error));
    } finally {
      if (requestId === holdPageRequestRef.current) setLoadingMoreHolds(false);
    }
  };

  const downloadStatement = async () => {
    setDownloading(true);
    try {
      const response = await downloadOxsteedCreditStatement({ ...(statement?.period || {}), currencyCode: selectedCurrency });
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-statement-${statement?.period?.from || 'recent'}-${statement?.period?.to || 'today'}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Statement downloaded.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  const loadOlderActivity = async () => {
    if (!statement?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextStatement = await getOxsteedCreditStatement({
        from: statement.period.from,
        to: statement.period.to,
        limit: 50,
        offset: transactions.length,
        currencyCode: selectedCurrency,
      });
      const nextTransactions = Array.isArray(nextStatement?.transactions) ? nextStatement.transactions : [];
      setTransactions((current) => [...current, ...nextTransactions]);
      setStatement((current) => current ? { ...nextStatement, transactions: [...(current.transactions || []), ...nextTransactions] } : nextStatement);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreDisputes = async () => {
    if (!disputePagination?.hasMore || loadingMoreDisputes) return;
    setLoadingMoreDisputes(true);
    try {
      const page = await getOxsteedCreditDisputePage({
        limit: 50,
        offset: disputePagination.nextOffset || disputes.length,
      });
      const nextDisputes = Array.isArray(page?.disputes) ? page.disputes : [];
      setDisputes((current) => [...current, ...nextDisputes]);
      setDisputePagination(page?.pagination || null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoadingMoreDisputes(false);
    }
  };

  const submitHold = async (event) => {
    event.preventDefault();
    const amountCents = parseCreditMajorAmount(holdAmount, selectedCurrency);
    if (!holdPartnerId || !amountCents) {
      toast.error('Choose an eligible restaurant and enter a valid amount.');
      return;
    }
    setHoldSubmitting(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `credit-hold-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await createOxsteedCreditHold({
        partnerId: holdPartnerId,
        amountCents,
        currencyCode: selectedCurrency,
        purpose: holdPurpose.trim() || 'In-store restaurant authorization',
        orderType: holdOrderType || undefined,
      }, idempotencyKey);
      setCreatedHold(result?.hold || result || null);
      setHoldAmount('');
      setHoldPurpose('');
      await load({ quiet: true, currencyCode: selectedCurrency });
      toast.success('Authorization created. Give the hold ID to the cashier.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setHoldSubmitting(false);
    }
  };

  const copyHoldId = async () => {
    if (!createdHold?.id || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(createdHold.id);
      toast.success('Hold ID copied.');
    } catch {
      toast.error('Unable to copy the hold ID.');
    }
  };

  const releaseHold = async (hold) => {
    if (!hold?.id || releasingHoldId) return;
    setReleasingHoldId(hold.id);
    try {
      await releaseOxsteedCreditHold(hold.id, { reason: 'Customer canceled in-store authorization' });
      setHolds((current) => current.map((item) => item.id === hold.id
        ? { ...item, status: 'released', releasedAt: new Date().toISOString() }
        : item));
      setCreatedHold((current) => current?.id === hold.id ? null : current);
      toast.success('Authorization released.');
      await load({ quiet: true, currencyCode: selectedCurrency });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setReleasingHoldId(null);
    }
  };

  const submitDispute = async (event) => {
    event.preventDefault();
    if (!disputeTransactionId || !disputeDescription.trim()) return;
    setDisputeSubmitting(true);
    try {
      if (!disputeRequestKeyRef.current) {
        disputeRequestKeyRef.current = globalThis.crypto?.randomUUID?.()
          || `credit-dispute-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      await openOxsteedCreditDispute({ transactionId: disputeTransactionId, reasonCode: disputeReason, description: disputeDescription.trim() }, disputeRequestKeyRef.current);
      const refreshedDisputes = await getOxsteedCreditDisputePage({ limit: 50, offset: 0 });
      setDisputes(Array.isArray(refreshedDisputes?.disputes) ? refreshedDisputes.disputes : []);
      setDisputePagination(refreshedDisputes?.pagination || null);
      toast.success('Your dispute was submitted for review.');
      setDisputeTransactionId(null);
      setDisputeDescription('');
      disputeRequestKeyRef.current = '';
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const currency = account?.currencyCode || 'USD';
  const accountStatus = account?.status || 'active';
  const balanceCents = Number(account?.balanceCents || 0);
  const reservedCents = Number(account?.reservedCents || 0);
  const availableCents = Number(account?.availableBalanceCents ?? Math.max(0, balanceCents - reservedCents));
  const partnerOrderTypes = [...new Set(partners.flatMap((partner) => partner.allowedOrderTypes || []))]
    .filter(Boolean)
    .sort();
  const hasPartnerFilters = Boolean(partnerSearch.trim() || partnerOrderType);
  const normalizedPartnerSearch = partnerSearch.trim().toLowerCase();
  const activeHolds = holds.filter((hold) => hold.status === 'active');
  const holdHistory = holds.filter((hold) => hold.status !== 'active');
  const visiblePartners = partners.filter((partner) => {
    const searchableText = [partner.restaurantName, partner.city, partner.state].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = !normalizedPartnerSearch || searchableText.includes(normalizedPartnerSearch);
    const allowedOrderTypes = partner.allowedOrderTypes || [];
    const matchesOrderType = !partnerOrderType || !allowedOrderTypes.length || allowedOrderTypes.includes(partnerOrderType);
    return matchesSearch && matchesOrderType;
  });
  const selectedHoldPartner = partners.find((partner) => String(partner.partnerId) === String(holdPartnerId));
  const holdOrderTypes = selectedHoldPartner?.allowedOrderTypes?.length
    ? selectedHoldPartner.allowedOrderTypes
    : ['pickup', 'dine_in', 'delivery'];

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
              <p className="ox-credit-eyebrow">OxSteed partner credit</p>
              <h1>OxSteed Credit</h1>
              <p>One restricted credit balance you can use at participating restaurants under their current partner agreements.</p>
            </div>
            <div className="ox-credit-hero-actions">
              <label className="ox-credit-currency-picker">Currency<select value={selectedCurrency} onChange={changeCurrency} disabled={loading || refreshing}>{[...new Set(['USD', ...accounts.map((item) => item.currencyCode).filter(Boolean)])].sort().map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
              <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true, currencyCode: selectedCurrency })} disabled={loading || refreshing}>
                <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> Refresh
              </button>
            </div>
          </header>

          <section className="ox-credit-disclaimer" role="note">
            <ShieldCheck size={19} />
            <div><strong>Stored-value credit, not a bank account</strong><span>OxSteed Credit is not a deposit account, cash balance, or promise of bank services. Spending is limited to the partners and terms shown below.</span></div>
          </section>

          {railStatus && !railStatus.enabled && <section className="ox-credit-rail-note" role="status"><AlertCircle size={19} /><div><strong>OxSteed Credit is temporarily paused</strong><span>Your balance and history remain available. New Credit spending is paused while the network is being reviewed.</span></div></section>}

          {loading ? <div className="ox-credit-loading">Loading your credit account...</div> : (
            <>
              <section className="ox-credit-balance-card">
                <div className="ox-credit-balance-top"><span className="ox-credit-wallet-icon"><WalletCards size={23} /></span><div><span>OxSteed Credit balance</span><strong>{money(balanceCents, currency)}</strong></div><span className={`ox-credit-status ${accountStatus === 'active' ? 'active' : ''}`}>{accountStatus}</span></div>
                <div className="ox-credit-balance-grid"><div><span>Available to spend</span><strong>{money(availableCents, currency)}</strong></div><div><span>Reserved</span><strong>{money(reservedCents, currency)}</strong></div><div><span>Currency</span><strong>{currency}</strong></div></div>
              </section>

              {limitSummary && <section className="ox-credit-panel ox-credit-limits-panel" aria-labelledby="credit-limits-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Daily controls</p><h2 id="credit-limits-heading">Your spending guardrails</h2></div><span className="ox-credit-count">Resets {dateTime(limitSummary.resetsAt)}</span></div><p className="ox-credit-panel-copy">These limits help protect your restricted balance. Reservations count toward spending until they are captured, released, or expired.</p><div className="ox-credit-limit-grid"><div><span>Spend amount remaining</span><strong>{money(limitSummary.spending.centsRemaining, currency)}</strong><small>{limitSummary.spending.centsUsed.toLocaleString()} of {limitSummary.spending.centsLimit.toLocaleString()} cents committed today</small></div><div><span>Spend movements remaining</span><strong>{limitSummary.spending.countRemaining}</strong><small>{limitSummary.spending.countUsed} of {limitSummary.spending.countLimit} purchases or reservations today</small></div>{limitSummary.transfers.enabled && <><div><span>Transfer amount remaining</span><strong>{money(limitSummary.transfers.centsRemaining, currency)}</strong><small>{limitSummary.transfers.centsUsed.toLocaleString()} of {limitSummary.transfers.centsLimit.toLocaleString()} cents transferred today</small></div><div><span>Transfers remaining</span><strong>{limitSummary.transfers.countRemaining}</strong><small>{limitSummary.transfers.countUsed} of {limitSummary.transfers.countLimit} transfers today</small></div></>}</div></section>}

              {accountStatus === 'active' && partners.length > 0 && <section className="ox-credit-panel ox-credit-authorize-panel" aria-labelledby="credit-authorize-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Customer authorization</p><h2 id="credit-authorize-heading">Authorize an in-store payment</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">Choose a participating restaurant and reserve the exact amount. The cashier can capture it once, and the hold expires automatically if it is not used.</p><form className="ox-credit-authorize-form" onSubmit={submitHold}><label>Restaurant<select required value={holdPartnerId} onChange={(event) => { const nextPartnerId = event.target.value; const nextPartner = partners.find((partner) => String(partner.partnerId) === String(nextPartnerId)); setHoldPartnerId(nextPartnerId); setHoldOrderType(nextPartner?.allowedOrderTypes?.[0] || 'pickup'); }}><option value="">Select a participating restaurant</option>{partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName}{partner.city ? ` · ${partner.city}` : ''}</option>)}</select></label><label>Order type<select required value={holdOrderType} onChange={(event) => setHoldOrderType(event.target.value)}>{holdOrderTypes.map((type) => <option key={type} value={type}>{String(type).replace(/_/g, ' ')}</option>)}</select></label><label>Amount<input required inputMode="decimal" value={holdAmount} onChange={(event) => setHoldAmount(event.target.value)} placeholder={`0.00 ${currency}`} /></label><label>Purpose <span>(optional)</span><input value={holdPurpose} onChange={(event) => setHoldPurpose(event.target.value)} maxLength={100} placeholder="Restaurant purchase" /></label><button type="submit" disabled={holdSubmitting}>{holdSubmitting ? 'Creating authorization...' : 'Create authorization'}</button></form>{createdHold?.id && <div className="ox-credit-created-hold"><strong>Give this hold ID to the cashier</strong><code>{createdHold.id}</code><span>It is for {money(createdHold.amountCents, createdHold.currencyCode || currency)} and expires {dateTime(createdHold.expiresAt)}. Never share your account password.</span><button type="button" onClick={copyHoldId}>Copy hold ID</button></div>}</section>}

              {!!holds.length && <section className="ox-credit-panel ox-credit-holds-panel"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Reservation history</p><h2>Credit holds</h2></div><span className="ox-credit-count">{holds.length}{holdPagination?.hasMore ? '+' : ''}</span></div><p className="ox-credit-panel-copy">Active reservations reduce your spendable balance until captured, released, or expired. Completed reservations stay here so you can reconcile every temporary balance change.</p>{!!activeHolds.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>Active reservations</strong><span>{activeHolds.length}</span></div><div className="ox-credit-hold-list">{activeHolds.map((hold) => <article key={hold.id}><div><strong>{hold.restaurantName || 'Partner restaurant'}</strong><span>{hold.purpose || 'Partner order authorization'}</span><small>{holdTerminalDate(hold)}</small></div><div className="ox-credit-hold-end"><span className="ox-credit-hold-status active">{holdStatusLabel(hold.status)}</span><b>{money(hold.amountCents, hold.currencyCode || currency)}</b></div></article>)}</div></div>}{!!holdHistory.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>Completed reservations</strong><span>{holdHistory.length}</span></div><div className="ox-credit-hold-list">{holdHistory.map((hold) => <article key={hold.id}><div><strong>{hold.restaurantName || 'Partner restaurant'}</strong><span>{hold.purpose || 'Partner order authorization'}</span><small>{holdTerminalDate(hold)}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${hold.status}`}>{holdStatusLabel(hold.status)}</span><b>{money(hold.amountCents, hold.currencyCode || currency)}</b></div></article>)}</div></div>}{holdPagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMoreHolds} disabled={loadingMoreHolds || refreshing}><RefreshCw size={14} className={loadingMoreHolds ? 'ox-credit-spin' : ''} /> {loadingMoreHolds ? 'Loading older holds...' : 'Load older holds'}</button>}</section>}

              {!!activeHolds.length && <section className="ox-credit-panel ox-credit-release-panel" aria-labelledby="credit-release-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Authorization controls</p><h2 id="credit-release-heading">Unused authorizations</h2></div></div><p className="ox-credit-panel-copy">Cancel an authorization if you will not use it. This immediately returns the reserved amount to your spendable balance.</p><div className="ox-credit-release-list">{activeHolds.map((hold) => <div key={hold.id}><div><strong>{hold.restaurantName || 'Partner restaurant'}</strong><span>{money(hold.amountCents, hold.currencyCode || currency)} · {holdTerminalDate(hold)}</span></div><button type="button" onClick={() => releaseHold(hold)} disabled={releasingHoldId === hold.id}>{releasingHoldId === hold.id ? 'Releasing...' : 'Release hold'}</button></div>)}</div></section>}

              <div className="ox-credit-sections">
                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Partner network</p><h2>Where you can spend</h2></div><span className="ox-credit-count">{visiblePartners.length}{visiblePartners.length !== partners.length ? ` / ${partners.length}` : ''}</span></div>
                  <p className="ox-credit-panel-copy">Only active restaurants with a current agreement appear here. The list is the source of truth for where your balance can be used today.</p>
                  {accountStatus === 'active' && <form className="ox-credit-partner-filters" onSubmit={submitPartnerFilters}><label><Search size={15} /><input aria-label="Search eligible restaurants" value={partnerSearch} onChange={(event) => setPartnerSearch(event.target.value)} placeholder="Search restaurant or city" /></label><select aria-label="Filter eligible restaurants by order type" value={partnerOrderType} onChange={(event) => setPartnerOrderType(event.target.value)}><option value="">All order types</option>{partnerOrderTypes.map((type) => <option key={type} value={type}>{String(type).replace(/_/g, ' ')}</option>)}</select><button type="submit" className="ox-credit-partner-search" disabled={refreshing}>{refreshing ? 'Searching...' : 'Search'}</button></form>}
                  {accountStatus !== 'active' || (!partners.length && !hasPartnerFilters) ? <div className="ox-credit-empty"><Store size={27} />{accountStatus !== 'active' ? <><strong>Credit account {accountStatus}</strong><span>Partner restaurants are hidden until your OxSteed Credit account is active. Contact support if you need help.</span></> : <><strong>No partner restaurants yet</strong><span>OxSteed Credit becomes spendable as participating restaurants are activated.</span></>}</div> : !visiblePartners.length ? <div className="ox-credit-empty"><Search size={27} /><strong>No eligible restaurants match</strong><span>Try another restaurant, city, or order type.</span><button type="button" className="ox-credit-clear-filters" onClick={clearPartnerFilters}>Clear filters</button></div> : <><div className="ox-credit-partner-list">{visiblePartners.map((partner) => <article className="ox-credit-partner" key={partner.partnerId}><div className="ox-credit-partner-mark">{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <Building2 size={21} />}</div><div className="ox-credit-partner-content"><div className="ox-credit-partner-title"><div><h3>{partner.restaurantName || 'Partner restaurant'}</h3><span>{[partner.city, partner.state].filter(Boolean).join(', ') || 'Location not listed'}</span></div><span className="ox-credit-eligible"><ShieldCheck size={14} /> Eligible</span></div><div className="ox-credit-tags">{(partner.allowedOrderTypes || []).map((type) => <span key={type}>{String(type).replace(/_/g, ' ')}</span>)}{partner.hasCustomerEntitlement && <span>Customer entitlement</span>}</div><p>{partner.customerTerms || 'Use is subject to the active partner agreement and restaurant terms.'}</p><div className="ox-credit-partner-meta"><span>{geographySummary(partner)}</span>{partnerLimit(partner)}{partner.dailyCustomerLimitCents ? <span>Daily limit {money(partner.dailyCustomerLimitCents, partner.currencyCode)}</span> : null}{partner.lifetimeCustomerLimitCents ? <span>Lifetime limit {money(partner.lifetimeCustomerLimitCents, partner.currencyCode)}</span> : null}{partner.allowedCategories?.length ? <span>{partner.allowedCategories.length} covered categories</span> : null}</div>{partner.restaurantId ? <Link className="ox-credit-partner-link" to={`/restaurants/r/${partner.restaurantId}`}>Open restaurant menu <ArrowUpRight size={14} /></Link> : null}</div></article>)}</div>{partnerPagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMorePartners} disabled={loadingMorePartners}>{loadingMorePartners ? 'Loading more restaurants...' : 'Show more eligible restaurants'}</button>}</>}
                  <Link to="/restaurants" className="ox-credit-secondary-link">Browse participating restaurants <ArrowUpRight size={15} /></Link>
                </section>

                <section className="ox-credit-panel" id="credit-activity">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Statement</p><h2>Recent activity</h2></div><div className="ox-credit-panel-actions"><span className="ox-credit-count">{transactions.length}</span><button type="button" className="ox-credit-download" onClick={downloadStatement} disabled={downloading || !statement}><Download size={14} /> {downloading ? 'Preparing...' : 'Download CSV'}</button></div></div>
                  <p className="ox-credit-panel-copy">Every balance change is recorded in the OxSteed Credit ledger with a timestamp and transaction type. Showing {statement?.period?.from || 'recent'} through {statement?.period?.to || 'today'}.</p>
                  {statement && <div className="ox-credit-statement-summary"><div><span>Credits</span><strong className="positive">+{money(statement.totalCreditsCents, currency)}</strong></div><div><span>Debits</span><strong className="negative">-{money(statement.totalDebitsCents, currency)}</strong></div><div><span>Closing balance</span><strong>{money(statement.closingBalanceCents, currency)}</strong></div></div>}
                  {!transactions.length ? <div className="ox-credit-empty"><Clock3 size={27} /><strong>No activity yet</strong><span>Your credit activity will appear here when a load, purchase, transfer, or refund is posted.</span></div> : <div className="ox-credit-transaction-list">{transactions.map((transaction) => { const positive = transaction.direction === 'credit' || ['load', 'refund'].includes(transaction.transactionType); const orderPath = transactionOrderPath(transaction); return <article key={transaction.id}><span className={`ox-credit-transaction-icon ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{transactionLabel(transaction)}</strong><span>{transaction.description || 'OxSteed Credit ledger entry'}</span><small>{dateTime(transaction.postedAt || transaction.createdAt)}{transaction.orderId ? ` · Order #${transaction.orderId}` : ''}</small><div className="ox-credit-transaction-actions"><Link to={transactionDetailPath(transaction, currency)} className="ox-credit-detail-link"><Receipt size={12} /> View details</Link>{orderPath && <Link to={orderPath} className="ox-credit-order-link">View order</Link>}<button type="button" className="ox-credit-dispute-button" onClick={() => { if (String(disputeTransactionId) !== String(transaction.id)) disputeRequestKeyRef.current = ''; setDisputeTransactionId(transaction.id); }}>Report a problem</button></div></div><b className={positive ? 'positive' : 'negative'}>{positive ? '+' : '-'}{money(transaction.amountCents, transaction.currencyCode || currency)}</b></article>; })}</div>}
                  {statement?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadOlderActivity} disabled={loadingMore || refreshing}><RefreshCw size={14} className={loadingMore ? 'ox-credit-spin' : ''} /> {loadingMore ? 'Loading older activity...' : 'Load older activity'}</button>}
                  {disputeTransactionId && <form className="ox-credit-dispute-form" onSubmit={submitDispute}><strong>Report a transaction problem</strong><span>This creates a review record without changing your balance automatically. If the connection drops, submitting the same form again is safe.</span><select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}><option value="incorrect_amount">Incorrect amount</option><option value="unauthorized">I do not recognize this</option><option value="duplicate">Duplicate transaction</option><option value="restaurant_issue">Restaurant or order issue</option><option value="other">Other</option></select><textarea required maxLength={4000} value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} placeholder="Tell us what happened" rows={3} /><div><button type="button" onClick={() => { setDisputeTransactionId(null); disputeRequestKeyRef.current = ''; }}>Cancel</button><button type="submit" disabled={disputeSubmitting}>{disputeSubmitting ? 'Submitting...' : 'Submit dispute'}</button></div></form>}
                  <div className="ox-credit-security-note"><AlertCircle size={15} /> Need help with a transaction? <Link to="/support/escalation">Contact support</Link></div>
                </section>
              </div>
              {disputes.length > 0 && <section className="ox-credit-panel ox-credit-dispute-history"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">Review history</p><h2>Your Credit disputes</h2></div><span className="ox-credit-count">{disputes.length}{disputePagination?.hasMore ? '+' : ''}</span></div><p className="ox-credit-panel-copy">Disputes are reviewed separately from your balance. A status change never edits the original ledger entry.</p><div className="ox-credit-dispute-list">{disputes.map((dispute) => <article key={dispute.id}><div><div className="ox-credit-dispute-title"><strong>{dispute.restaurantName || 'OxSteed Credit transaction'}</strong><span className={`ox-credit-dispute-status ${dispute.status}`}>{String(dispute.status || 'open').replace(/_/g, ' ')}</span></div><span>{String(dispute.reasonCode || 'other').replace(/_/g, ' ')}</span>{dispute.amountCents !== null && dispute.amountCents !== undefined && <small>{money(dispute.amountCents, dispute.currencyCode || currency)} · {String(dispute.transactionType || 'transaction').replace(/_/g, ' ')}</small>}<small>Opened {dateTime(dispute.openedAt)} · Transaction {dispute.transactionId}</small><p>{dispute.description}</p>{dispute.resolution && <em>Resolution: {dispute.resolution}</em>}</div></article>)}</div>{disputePagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMoreDisputes} disabled={loadingMoreDisputes}><RefreshCw size={14} className={loadingMoreDisputes ? 'ox-credit-spin' : ''} /> {loadingMoreDisputes ? 'Loading older disputes...' : 'Load older disputes'}</button>}</section>}
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
