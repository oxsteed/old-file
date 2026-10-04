import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownLeft,
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
  getOxsteedCreditConversionQuote,
  convertOxsteedCredit,
  getOxsteedCreditFeeQuote,
  requestOxsteedCreditWithdrawal,
  listOxsteedCreditWithdrawals,
  cancelOxsteedCreditWithdrawal,
  createOxsteedCreditRestaurantConversion,
  getRestaurantConversionEligibility,
  issueOxsteedCreditMoneyOutStepup,
} from '../../api/oxsteedCredit';
import toast from 'react-hot-toast';
import './OxsteedCreditPage.css';
import { formatCreditMinorUnits, getCreditMinorUnits, parseCreditMajorAmount } from '../../lib/creditCurrency';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { localizeCreditOrderType, localizeCreditTransactionType } from '../../lib/creditStatus';

const money = formatCreditMinorUnits;

function dateTime(value, t) {
  return formatCreditDateTime(value, t('noDate'), t.lng);
}

function partnerLimit(partner, t) {
  if (!partner.maxTransactionCents) return null;
  return t('upToPerTransaction', { amount: money(partner.maxTransactionCents, partner.currencyCode) });
}

function geographySummary(partner, t) {
  const geography = partner?.geography || {};
  const labels = [
    ['cities', t('cities')],
    ['states', t('states')],
    ['postalCodes', t('postalCodes')],
    ['countries', t('countries')],
  ].flatMap(([key, label]) => Array.isArray(geography[key]) && geography[key].length
    ? [`${label}: ${geography[key].join(', ')}`]
    : []);
  return labels.join(' · ') || t('coverageFallback');
}

function transactionLabel(transaction, t) {
  return localizeCreditTransactionType(transaction.transactionType, t);
}

function disputeReasonLabel(value, t) {
  return {
    incorrect_amount: t('disputeIncorrectAmount'),
    unauthorized: t('disputeUnauthorized'),
    duplicate: t('disputeDuplicate'),
    restaurant_issue: t('disputeRestaurantIssue'),
    other: t('other'),
  }[value] || t('other');
}

function creditStatusLabel(value, t) {
  return {
    active: t('activeStatus'),
    open: t('openStatus'),
    suspended: t('suspendedStatus'),
    closed: t('closedStatus'),
    under_review: t('underReviewStatus'),
    resolved: t('resolvedStatus'),
    rejected: t('rejectedStatus'),
  }[value] || t('statusUnknown');
}

function transactionOrderPath(transaction) {
  return transaction?.orderId ? `/food/orders/${transaction.orderId}` : null;
}

function transactionDetailPath(transaction, currency) {
  const transactionCurrency = transaction?.currencyCode || currency || 'USD';
  return `/oxsteed-credit/transactions/${encodeURIComponent(transaction.id)}?currency=${encodeURIComponent(transactionCurrency)}`;
}

function holdStatusLabel(status, t) {
  return {
    active: t('reservedStatus'),
    captured: t('capturedStatus'),
    released: t('releasedStatus'),
    expired: t('expiredStatus'),
  }[status] || t('reservationStatus');
}

function holdTerminalDate(hold, t) {
  if (hold.status === 'captured' && hold.capturedAt) return t('capturedAt', { date: dateTime(hold.capturedAt, t) });
  if (['released', 'expired'].includes(hold.status) && hold.releasedAt) return t('releasedAt', { status: holdStatusLabel(hold.status, t), date: dateTime(hold.releasedAt, t) });
  return t('expiresAt', { date: dateTime(hold.expiresAt, t) });
}

function amountPlaceholder(currency, metadata) {
  const minorUnits = getCreditMinorUnits(currency, metadata);
  return `${minorUnits ? `0.${'0'.repeat(minorUnits)}` : '0'} ${currency}`;
}

export default function OxsteedCreditPage() {
  const { t } = useTranslation('credit');
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
  const [loadError, setLoadError] = useState(null);
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
  const [conversionQuoteId, setConversionQuoteId] = useState('');
  const [conversionAmount, setConversionAmount] = useState('');
  const [conversionSubmitting, setConversionSubmitting] = useState(false);
  const [createdConversion, setCreatedConversion] = useState(null);
  const [disputeTransactionId, setDisputeTransactionId] = useState(null);
  const [disputeReason, setDisputeReason] = useState('incorrect_amount');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  // Phase 6 money-out state.
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalFeeQuote, setWithdrawalFeeQuote] = useState(null);
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalChallenge, setWithdrawalChallenge] = useState(null);
  const [withdrawalCode, setWithdrawalCode] = useState('');
  const [withdrawals, setWithdrawals] = useState([]);
  const [createdWithdrawal, setCreatedWithdrawal] = useState(null);
  const [cancellingWithdrawalId, setCancellingWithdrawalId] = useState(null);
  const [restaurantConversionDirection, setRestaurantConversionDirection] = useState('to_restaurant');
  const [restaurantConversionRestaurantId, setRestaurantConversionRestaurantId] = useState('');
  const [restaurantConversionAmount, setRestaurantConversionAmount] = useState('');
  const [restaurantConversionSubmitting, setRestaurantConversionSubmitting] = useState(false);
  const [createdRestaurantConversion, setCreatedRestaurantConversion] = useState(null);
  // Null until loaded: the from_restaurant dropdown is filtered to the
  // restaurant ids OxSteed has enabled for conversion into OxSteed Credit.
  const [conversionEligibility, setConversionEligibility] = useState(null);
  const withdrawalQuoteTimerRef = useRef(null);
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
    if (isCurrentRequest()) setLoadError(null);
    try {
      const existingAccounts = await listOxsteedCreditAccounts();
      const preferredCurrency = currencyCode || existingAccounts[0]?.currencyCode || 'USD';
      // Eligible-partner discovery requires an active wallet. Create/load the
      // selected wallet first so a new currency cannot race the directory and
      // render a false empty state.
      const accountResult = await getOxsteedCreditAccount({ currencyCode: preferredCurrency });
      const [partnerResult, holdResult, railResult, statementResult, disputeResult, limitResult, eligibilityResult] = await Promise.all([
        getOxsteedCreditEligiblePartnerPage({ currencyCode: preferredCurrency, limit: 50, offset: 0 }),
        listOxsteedCreditHolds({ currencyCode: preferredCurrency, status: 'all', limit: 50, offset: 0 }).catch(() => null),
        getOxsteedCreditStatus().catch(() => null),
        getOxsteedCreditStatement({ limit: 50, currencyCode: preferredCurrency }).catch(() => null),
        getOxsteedCreditDisputePage({ limit: 50, offset: 0 }).catch(() => null),
        getOxsteedCreditLimitSummary({ currencyCode: preferredCurrency }).catch(() => null),
        // The from_restaurant conversion allowlist; a fetch failure leaves
        // the dropdown unfiltered and the server gate still enforces.
        getRestaurantConversionEligibility().catch(() => null),
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
      if (isCurrentRequest()) {
        const ids = Array.isArray(eligibilityResult?.enabledRestaurantIds)
          ? eligibilityResult.enabledRestaurantIds
          : null;
        setConversionEligibility(ids ? ids.map((id) => String(id)) : null);
      }
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
      if (isCurrentRequest()) {
        const message = safeCreditErrorMessage(error, t('errorLoad'));
        setLoadError(message);
        toast.error(message);
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

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
      if (requestId === partnerPageRequestRef.current) toast.error(safeCreditErrorMessage(error, t('errorLoad')));
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
      if (requestId === holdPageRequestRef.current) toast.error(safeCreditErrorMessage(error, t('errorLoad')));
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
      toast.success(t('statementDownloaded'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
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
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
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
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setLoadingMoreDisputes(false);
    }
  };

  const submitHold = async (event) => {
    event.preventDefault();
    const amountCents = parseCreditMajorAmount(holdAmount, selectedCurrency);
    if (!holdPartnerId || !amountCents) {
      toast.error(t('chooseEligibleAmount'));
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
      toast.success(t('authorizationCreated'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setHoldSubmitting(false);
    }
  };

  const copyHoldId = async () => {
    if (!createdHold?.id || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(createdHold.id);
      toast.success(t('holdIdCopied'));
    } catch {
      toast.error(t('holdIdCopyError'));
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
      toast.success(t('authorizationReleased'));
      await load({ quiet: true, currencyCode: selectedCurrency });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setReleasingHoldId(null);
    }
  };

  const submitConversion = async (event) => {
    event.preventDefault();
    const quoteId = conversionQuoteId.trim();
    const sourceAmountMinorUnits = parseCreditMajorAmount(conversionAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!quoteId || !sourceAmountMinorUnits) {
      toast.error(t('conversionQuoteRequired'));
      return;
    }
    setConversionSubmitting(true);
    try {
      const quote = await getOxsteedCreditConversionQuote(quoteId);
      if (!quote || quote.status !== 'open' || quote.sourceCurrencyCode !== selectedCurrency || quote.sourceAmountMinorUnits !== sourceAmountMinorUnits) {
        throw new Error(t('conversionQuoteMismatch'));
      }
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `credit-conversion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await convertOxsteedCredit({ quoteId, sourceAmountMinorUnits }, idempotencyKey);
      setCreatedConversion(result?.conversion || result || null);
      setConversionQuoteId('');
      setConversionAmount('');
      await load({ quiet: true, currencyCode: selectedCurrency });
      toast.success(t('conversionCompleted'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setConversionSubmitting(false);
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
      toast.success(t('disputeSubmitted'));
      setDisputeTransactionId(null);
      setDisputeDescription('');
      disputeRequestKeyRef.current = '';
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const loadWithdrawals = useCallback(async () => {
    try {
      const rows = await listOxsteedCreditWithdrawals({ limit: 25, offset: 0 });
      setWithdrawals(Array.isArray(rows) ? rows : []);
    } catch {
      // Withdrawal history is non-critical; the page stays usable.
    }
  }, []);

  useEffect(() => {
    loadWithdrawals();
  }, [loadWithdrawals]);

  const refreshWithdrawalFeeQuote = (rawAmount) => {
    if (withdrawalQuoteTimerRef.current) clearTimeout(withdrawalQuoteTimerRef.current);
    const amountCents = parseCreditMajorAmount(rawAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!amountCents) {
      setWithdrawalFeeQuote(null);
      return;
    }
    withdrawalQuoteTimerRef.current = setTimeout(async () => {
      try {
        const quote = await getOxsteedCreditFeeQuote({ operation: 'withdrawal', amountCents, currencyCode: selectedCurrency });
        setWithdrawalFeeQuote(quote);
      } catch {
        setWithdrawalFeeQuote(null);
      }
    }, 500);
  };

  const onWithdrawalAmountChange = (event) => {
    const value = event.target.value;
    setWithdrawalAmount(value);
    setCreatedWithdrawal(null);
    refreshWithdrawalFeeQuote(value);
  };

  const submitWithdrawal = async (event, stepup = null) => {
    if (event) event.preventDefault();
    const amountCents = parseCreditMajorAmount(withdrawalAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!amountCents) {
      toast.error(t('enterValidAmount'));
      return;
    }
    setWithdrawalSubmitting(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `credit-withdrawal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await requestOxsteedCreditWithdrawal({
        amountCents,
        currencyCode: selectedCurrency,
        ...(stepup ? { stepupChallengeId: stepup.challengeId, stepupCode: stepup.code } : {}),
      }, idempotencyKey);
      setCreatedWithdrawal(result?.withdrawal || null);
      setWithdrawalAmount('');
      setWithdrawalFeeQuote(null);
      setWithdrawalChallenge(null);
      setWithdrawalCode('');
      await loadWithdrawals();
      await load({ quiet: true, currencyCode: selectedCurrency });
      toast.success(t('withdrawalRequested'));
    } catch (error) {
      if (error?.response?.data?.code === 'credit_stepup_challenge_required' && !stepup) {
        // Large withdrawal: get a verification code, then resubmit with it.
        try {
          const issued = await issueOxsteedCreditMoneyOutStepup({ actionType: 'withdrawal', amountCents, currencyCode: selectedCurrency });
          setWithdrawalChallenge({ id: issued?.challenge?.id, expiresAt: issued?.challenge?.expiresAt });
          toast.success(t('verificationCodeSent'));
        } catch (issueError) {
          toast.error(safeCreditErrorMessage(issueError, t('errorLoad')));
        }
      } else {
        toast.error(safeCreditErrorMessage(error, t('errorLoad')));
      }
    } finally {
      setWithdrawalSubmitting(false);
    }
  };

  const confirmWithdrawalStepup = (event) => {
    event.preventDefault();
    if (!withdrawalChallenge?.id || !withdrawalCode.trim()) {
      toast.error(t('enterVerificationCode'));
      return;
    }
    submitWithdrawal(null, { challengeId: withdrawalChallenge.id, code: withdrawalCode.trim() });
  };

  const cancelWithdrawal = async (withdrawal) => {
    if (!withdrawal?.id || cancellingWithdrawalId) return;
    setCancellingWithdrawalId(withdrawal.id);
    try {
      await cancelOxsteedCreditWithdrawal(withdrawal.id);
      toast.success(t('withdrawalCancelled'));
      await loadWithdrawals();
      await load({ quiet: true, currencyCode: selectedCurrency });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setCancellingWithdrawalId(null);
    }
  };

  const submitRestaurantConversion = async (event) => {
    event.preventDefault();
    const amountCents = parseCreditMajorAmount(restaurantConversionAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!restaurantConversionRestaurantId || !amountCents) {
      toast.error(t('chooseRestaurantAndAmount'));
      return;
    }
    setRestaurantConversionSubmitting(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `credit-restaurant-conversion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await createOxsteedCreditRestaurantConversion({
        direction: restaurantConversionDirection,
        restaurantId: restaurantConversionRestaurantId,
        amountCents,
        currencyCode: selectedCurrency,
      }, idempotencyKey);
      setCreatedRestaurantConversion(result?.conversion || null);
      setRestaurantConversionAmount('');
      await load({ quiet: true, currencyCode: selectedCurrency });
      toast.success(t('restaurantConversionCompleted'));
    } catch (error) {
      // Both conversion gates fail closed server-side (the from_restaurant
      // allowlist and the to_restaurant active-partner requirement), even
      // when the dropdown was not filtered (e.g. the eligibility fetch
      // failed): surface the friendly message matching the direction, not
      // the raw error.
      const errorCode = error?.response?.data?.code;
      toast.error(errorCode === 'credit_conversion_restaurant_not_enabled'
        ? t(restaurantConversionDirection === 'to_restaurant'
          ? 'restaurantConversionRestaurantNotAccepting'
          : 'restaurantConversionRestaurantNotEnabled')
        : safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setRestaurantConversionSubmitting(false);
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
  // The from_restaurant direction only offers restaurants OxSteed enabled
  // for conversion into OxSteed Credit. The to_restaurant dropdown is
  // untouched (the server enforces the active-partner gate on submit).
  // While the eligibility list is loading (null), the dropdown
  // is unfiltered; the server gate still enforces the allowlist.
  const isFromRestaurantDirection = restaurantConversionDirection === 'from_restaurant';
  const conversionEligiblePartners = isFromRestaurantDirection && Array.isArray(conversionEligibility)
    ? partners.filter((partner) => conversionEligibility.includes(String(partner.restaurantId || partner.partnerId)))
    : partners;
  const noConversionEligiblePartners = isFromRestaurantDirection
    && Array.isArray(conversionEligibility)
    && conversionEligiblePartners.length === 0;
  const holdOrderTypes = selectedHoldPartner?.allowedOrderTypes?.length
    ? selectedHoldPartner.allowedOrderTypes
    : ['pickup', 'dine_in', 'delivery'];

  return (
    <>
      <PageMeta
        title={t('creditTitle')}
        description={t('creditDescription')}
        noIndex
      />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <header className="ox-credit-hero">
            <div>
              <h1>{t('creditTitle')}</h1>
              <p>{t('creditDescription')}</p>
            </div>
            <div className="ox-credit-hero-actions">
              <Link to="/oxsteed-credit/cards" className="ox-credit-refresh"><WalletCards size={16} /> My Cards</Link>
              <label className="ox-credit-currency-picker">{t('currency')}<select value={selectedCurrency} onChange={changeCurrency} disabled={loading || refreshing}>{[...new Set(['USD', ...(railStatus?.supportedCurrencies || []), ...accounts.map((item) => item.currencyCode).filter(Boolean)])].sort().map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
              <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true, currencyCode: selectedCurrency })} disabled={loading || refreshing}>
                <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> {t('refresh')}
              </button>
            </div>
          </header>

          {railStatus && !railStatus.enabled && <section className="ox-credit-rail-note" role="status"><AlertCircle size={19} /><div><strong>{t('pausedTitle')}</strong><span>{t('pausedBody')}</span></div></section>}

          {/* ── Balances at a glance ────────────────────────────────────
            One card per product so the two credit systems are never
            confused: OxSteed Credit (live balance) and restaurant credit
            (per-restaurant wallets, summarized by count — ledgers are
            never merged). */}
          <section aria-label={t('creditTitle')}>
            <div className="ox-credit-balance-strip">
              <div className="ox-credit-balance-card">
                {loading ? (
                  <div className="ox-credit-loading" role="status" aria-live="polite">{t('loadingAccount')}</div>
                ) : loadError && !account ? (
                  <div className="ox-credit-error-panel" role="alert"><AlertCircle size={20} /><strong>{t('errorLoad')}</strong><span>{loadError}</span></div>
                ) : (
                  <>
                    <div className="ox-credit-balance-top"><span className="ox-credit-wallet-icon"><WalletCards size={23} /></span><div><span>{t('balance')}</span><strong>{money(balanceCents, currency)}</strong></div><span className={`ox-credit-status ${accountStatus === 'active' ? 'active' : ''}`}>{creditStatusLabel(accountStatus, t)}</span></div>
                    <div className="ox-credit-balance-grid"><div><span>{t('availableToSpend')}</span><strong>{money(availableCents, currency)}</strong></div><div><span>{t('reserved')}</span><strong>{money(reservedCents, currency)}</strong></div><div><span>{t('currency')}</span><strong>{currency}</strong></div></div>
                  </>
                )}
              </div>
            </div>
          </section>

          {loadError && !loading && <section className="ox-credit-error-panel" role="alert"><AlertCircle size={24} /><strong>{t('errorLoad')}</strong><span>{loadError}</span><button type="button" className="ox-credit-refresh" onClick={() => load({ currencyCode: selectedCurrency })}>{t('retry')}</button></section>}

          {loading ? <div className="ox-credit-loading" role="status" aria-live="polite">{t('loadingAccount')}</div> : loadError && !account ? null : (
            <>
              {limitSummary && <section className="ox-credit-panel ox-credit-limits-panel" aria-labelledby="credit-limits-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('dailyControls')}</p><h2 id="credit-limits-heading">{t('spendingGuardrails')}</h2></div><span className="ox-credit-count">{t('resets', { date: dateTime(limitSummary.resetsAt, t) })}</span></div><p className="ox-credit-panel-copy">{t('guardrailsCopy')}</p><div className="ox-credit-limit-grid"><div><span>{t('spendAmountRemaining')}</span><strong>{money(limitSummary.spending.centsRemaining, currency)}</strong><small>{t('centsCommittedToday', { used: limitSummary.spending.centsUsed.toLocaleString(), limit: limitSummary.spending.centsLimit.toLocaleString() })}</small></div><div><span>{t('spendMovementsRemaining')}</span><strong>{limitSummary.spending.countRemaining}</strong><small>{t('purchasesReservationsToday', { used: limitSummary.spending.countUsed, limit: limitSummary.spending.countLimit })}</small></div>{limitSummary.transfers.enabled && <><div><span>{t('transferAmountRemaining')}</span><strong>{money(limitSummary.transfers.centsRemaining, currency)}</strong><small>{t('centsTransferredToday', { used: limitSummary.transfers.centsUsed.toLocaleString(), limit: limitSummary.transfers.centsLimit.toLocaleString() })}</small></div><div><span>{t('transfersRemaining')}</span><strong>{limitSummary.transfers.countRemaining}</strong><small>{t('transfersToday', { used: limitSummary.transfers.countUsed, limit: limitSummary.transfers.countLimit })}</small></div></>}</div></section>}

              {accountStatus === 'active' && <section className="ox-credit-panel ox-credit-conversion-panel" aria-labelledby="credit-conversion-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('currencyTools')}</p><h2 id="credit-conversion-heading">{t('convertCredit')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('conversionCopy')}</p><form className="ox-credit-authorize-form" onSubmit={submitConversion}><label>{t('quoteId')}<input required inputMode="numeric" value={conversionQuoteId} onChange={(event) => setConversionQuoteId(event.target.value)} placeholder={t('quoteIdPlaceholder')} /></label><label>{t('sourceAmount')}<input required inputMode="decimal" value={conversionAmount} onChange={(event) => setConversionAmount(event.target.value)} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><button type="submit" disabled={conversionSubmitting}>{conversionSubmitting ? t('convertingCredit') : t('convertCredit')}</button></form>{createdConversion?.id && <div className="ox-credit-created-hold"><strong>{t('conversionCompleted')}</strong><span>{t('conversionDetails', { source: money(createdConversion.sourceAmountMinorUnits, createdConversion.sourceCurrencyCode), target: money(createdConversion.targetAmountMinorUnits, createdConversion.targetCurrencyCode) })}</span><code>{createdConversion.id}</code></div>}</section>}

              {accountStatus === 'active' && <section className="ox-credit-panel ox-credit-withdraw-panel" aria-labelledby="credit-withdraw-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('moneyOutEyebrow')}</p><h2 id="credit-withdraw-heading">{t('withdrawToBank')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('withdrawCopy')}</p><form className="ox-credit-authorize-form" onSubmit={(event) => submitWithdrawal(event)}><label>{t('amount')}<input required inputMode="decimal" value={withdrawalAmount} onChange={onWithdrawalAmountChange} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><button type="submit" disabled={withdrawalSubmitting}>{withdrawalSubmitting ? t('requestingWithdrawal') : t('requestWithdrawal')}</button></form>{withdrawalFeeQuote && <div className="ox-credit-fee-quote" role="status"><span>{t('withdrawalFeeBreakdown', { fee: money(withdrawalFeeQuote.feeCents, withdrawalFeeQuote.currencyCode), net: money(Math.max(0, (parseCreditMajorAmount(withdrawalAmount, selectedCurrency, railStatus?.currencyMetadata) || 0) - withdrawalFeeQuote.feeCents), withdrawalFeeQuote.currencyCode) })}</span></div>}{withdrawalChallenge && <form className="ox-credit-stepup-form" onSubmit={confirmWithdrawalStepup}><strong>{t('verificationRequired')}</strong><span>{t('verificationCodeSentCopy')}</span><label>{t('verificationCode')}<input required inputMode="numeric" value={withdrawalCode} onChange={(event) => setWithdrawalCode(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('verificationCodePlaceholder')} /></label><button type="submit" disabled={withdrawalSubmitting}>{withdrawalSubmitting ? t('confirmingWithdrawal') : t('confirmWithdrawal')}</button></form>}{createdWithdrawal?.id && <div className="ox-credit-created-hold"><strong>{t('withdrawalRequested')}</strong><span>{t('withdrawalRequestedCopy', { amount: money(createdWithdrawal.amountCents, createdWithdrawal.currencyCode), net: money(createdWithdrawal.netAmountCents, createdWithdrawal.currencyCode) })}</span><code>{createdWithdrawal.id}</code></div>}{!!withdrawals.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('withdrawalHistory')}</strong><span>{withdrawals.length}</span></div><div className="ox-credit-hold-list">{withdrawals.map((withdrawal) => <article key={withdrawal.id}><div><strong>{money(withdrawal.amountCents, withdrawal.currencyCode)}</strong><span>{t('withdrawalStatusLabel', { status: withdrawal.status })}{withdrawal.feeCents ? ` · ${t('feeLabel', { fee: money(withdrawal.feeCents, withdrawal.currencyCode) })}` : ''}</span><small>{dateTime(withdrawal.createdAt, t)}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${withdrawal.status}`}>{withdrawal.status}</span>{['requested'].includes(withdrawal.status) && <button type="button" onClick={() => cancelWithdrawal(withdrawal)} disabled={cancellingWithdrawalId === withdrawal.id}>{cancellingWithdrawalId === withdrawal.id ? t('cancelling') : t('cancel')}</button>}</div></article>)}</div></div>}</section>}

              {accountStatus === 'active' && <section className="ox-credit-panel ox-credit-restaurant-conversion-panel" aria-labelledby="credit-restaurant-conversion-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('restaurantCreditEyebrow')}</p><h2 id="credit-restaurant-conversion-heading">{t('convertRestaurantCredit')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('restaurantConversionCopy')}</p><form className="ox-credit-authorize-form" onSubmit={submitRestaurantConversion}><label>{t('direction')}<select value={restaurantConversionDirection} onChange={(event) => { setRestaurantConversionDirection(event.target.value); setRestaurantConversionRestaurantId(''); }}><option value="to_restaurant">{t('directionToRestaurant')}</option><option value="from_restaurant">{t('directionFromRestaurant')}</option></select></label><label>{t('restaurant')}<select required value={restaurantConversionRestaurantId} onChange={(event) => setRestaurantConversionRestaurantId(event.target.value)} disabled={noConversionEligiblePartners}><option value="">{t('selectRestaurant')}</option>{conversionEligiblePartners.map((partner) => <option key={partner.partnerId} value={partner.restaurantId || partner.partnerId}>{partner.restaurantName}{partner.city ? ` · ${partner.city}` : ''}</option>)}</select></label>{noConversionEligiblePartners && <p className="ox-credit-panel-copy" role="status">{t('restaurantConversionNoneEligible')}</p>}<label>{t('amount')}<input required inputMode="decimal" value={restaurantConversionAmount} onChange={(event) => { setRestaurantConversionAmount(event.target.value); setCreatedRestaurantConversion(null); }} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><button type="submit" disabled={restaurantConversionSubmitting || noConversionEligiblePartners}>{restaurantConversionSubmitting ? t('convertingRestaurantCredit') : t('convertRestaurantCredit')}</button></form>{createdRestaurantConversion?.id && <div className="ox-credit-created-hold"><strong>{t('restaurantConversionCompleted')}</strong><span>{t('restaurantConversionDetails', { source: money(createdRestaurantConversion.sourceAmountCents, createdRestaurantConversion.currencyCode), target: money(createdRestaurantConversion.convertedAmountCents, createdRestaurantConversion.currencyCode) })}</span><code>{createdRestaurantConversion.id}</code></div>}</section>}

                  {accountStatus === 'active' && partners.length > 0 && <section className="ox-credit-panel ox-credit-authorize-panel" aria-labelledby="credit-authorize-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('customerAuthorization')}</p><h2 id="credit-authorize-heading">{t('authorizeInStorePayment')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('authorizeCopy')}</p><form className="ox-credit-authorize-form" onSubmit={submitHold}><label>{t('restaurant')}<select required value={holdPartnerId} onChange={(event) => { const nextPartnerId = event.target.value; const nextPartner = partners.find((partner) => String(partner.partnerId) === String(nextPartnerId)); setHoldPartnerId(nextPartnerId); setHoldOrderType(nextPartner?.allowedOrderTypes?.[0] || 'pickup'); }}><option value="">{t('selectRestaurant')}</option>{partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName}{partner.city ? ` · ${partner.city}` : ''}</option>)}</select></label><label>{t('orderType')}<select required value={holdOrderType} onChange={(event) => setHoldOrderType(event.target.value)}>{holdOrderTypes.map((type) => <option key={type} value={type}>{localizeCreditOrderType(type, t)}</option>)}</select></label><label>{t('amount')}<input required inputMode="decimal" value={holdAmount} onChange={(event) => setHoldAmount(event.target.value)} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><label>{t('purposeOptional')}<input value={holdPurpose} onChange={(event) => setHoldPurpose(event.target.value)} maxLength={100} placeholder={t('restaurantPurchase')} /></label><button type="submit" disabled={holdSubmitting}>{holdSubmitting ? t('creatingAuthorization') : t('createAuthorization')}</button></form>{createdHold?.id && <div className="ox-credit-created-hold"><strong>{t('holdIdInstruction')}</strong><code>{createdHold.id}</code><span>{t('holdDetails', { amount: money(createdHold.amountCents, createdHold.currencyCode || currency), date: dateTime(createdHold.expiresAt, t) })}</span><button type="button" onClick={copyHoldId}>{t('copyHoldId')}</button></div>}</section>}

              {!!holds.length && <section className="ox-credit-panel ox-credit-holds-panel"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('reservationHistory')}</p><h2>{t('creditHolds')}</h2></div><span className="ox-credit-count">{holds.length}{holdPagination?.hasMore ? '+' : ''}</span></div><p className="ox-credit-panel-copy">{t('holdsCopy')}</p>{!!activeHolds.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('activeReservations')}</strong><span>{activeHolds.length}</span></div><div className="ox-credit-hold-list">{activeHolds.map((hold) => <article key={hold.id}><div><strong>{hold.restaurantName || t('partnerRestaurant')}</strong><span>{hold.purpose || t('authorizeInStorePayment')}</span><small>{holdTerminalDate(hold, t)}</small></div><div className="ox-credit-hold-end"><span className="ox-credit-hold-status active">{holdStatusLabel(hold.status, t)}</span><b>{money(hold.amountCents, hold.currencyCode || currency)}</b></div></article>)}</div></div>}{!!holdHistory.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('completedReservations')}</strong><span>{holdHistory.length}</span></div><div className="ox-credit-hold-list">{holdHistory.map((hold) => <article key={hold.id}><div><strong>{hold.restaurantName || t('partnerRestaurant')}</strong><span>{hold.purpose || t('authorizeInStorePayment')}</span><small>{holdTerminalDate(hold, t)}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${hold.status}`}>{holdStatusLabel(hold.status, t)}</span><b>{money(hold.amountCents, hold.currencyCode || currency)}</b></div></article>)}</div></div>}{holdPagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMoreHolds} disabled={loadingMoreHolds || refreshing}><RefreshCw size={14} className={loadingMoreHolds ? 'ox-credit-spin' : ''} /> {loadingMoreHolds ? t('loadingOlderHolds') : t('loadOlderHolds')}</button>}</section>}

              {!!activeHolds.length && <section className="ox-credit-panel ox-credit-release-panel" aria-labelledby="credit-release-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('authorizationControls')}</p><h2 id="credit-release-heading">{t('unusedAuthorizations')}</h2></div></div><p className="ox-credit-panel-copy">{t('cancelAuthorizationCopy')}</p><div className="ox-credit-release-list">{activeHolds.map((hold) => <div key={hold.id}><div><strong>{hold.restaurantName || t('partnerRestaurant')}</strong><span>{money(hold.amountCents, hold.currencyCode || currency)} · {holdTerminalDate(hold, t)}</span></div><button type="button" onClick={() => releaseHold(hold)} disabled={releasingHoldId === hold.id}>{releasingHoldId === hold.id ? t('releasing') : t('releaseHold')}</button></div>)}</div></section>}

              <div className="ox-credit-sections">
                <section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('partnerNetwork')}</p><h2>{t('whereSpend')}</h2></div><span className="ox-credit-count">{visiblePartners.length}{visiblePartners.length !== partners.length ? ` / ${partners.length}` : ''}</span></div>
                  <p className="ox-credit-panel-copy">{t('partnerNetworkCopy')}</p>
                  {accountStatus === 'active' && <form className="ox-credit-partner-filters" onSubmit={submitPartnerFilters}><label><Search size={15} /><input aria-label={t('searchEligible')} value={partnerSearch} onChange={(event) => setPartnerSearch(event.target.value)} placeholder={t('searchRestaurantCity')} /></label><select aria-label={t('searchEligible')} value={partnerOrderType} onChange={(event) => setPartnerOrderType(event.target.value)}><option value="">{t('allOrderTypes')}</option>{partnerOrderTypes.map((type) => <option key={type} value={type}>{localizeCreditOrderType(type, t)}</option>)}</select><button type="submit" className="ox-credit-partner-search" disabled={refreshing}>{refreshing ? t('searching') : t('search')}</button></form>}
                  {accountStatus !== 'active' || (!partners.length && !hasPartnerFilters) ? <div className="ox-credit-empty"><Store size={27} />{accountStatus !== 'active' ? <><strong>{t('creditAccountStatus', { status: creditStatusLabel(accountStatus, t) })}</strong><span>{t('partnerHidden')}</span></> : <><strong>{t('noPartnerRestaurants')}</strong><span>{t('creditBecomesSpendable')}</span></>}</div> : !visiblePartners.length ? <div className="ox-credit-empty"><Search size={27} /><strong>{t('noEligibleMatch')}</strong><span>{t('tryAnother')}</span><button type="button" className="ox-credit-clear-filters" onClick={clearPartnerFilters}>{t('clearFilters')}</button></div> : <><div className="ox-credit-partner-list">{visiblePartners.map((partner) => <article className="ox-credit-partner" key={partner.partnerId}><div className="ox-credit-partner-mark">{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <Building2 size={21} />}</div><div className="ox-credit-partner-content"><div className="ox-credit-partner-title"><div><h3>{partner.restaurantName || t('partnerRestaurant')}</h3><span>{[partner.city, partner.state].filter(Boolean).join(', ') || t('locationNotListed')}</span></div><span className="ox-credit-eligible"><ShieldCheck size={14} /> {t('eligible')}</span></div><div className="ox-credit-tags">{(partner.allowedOrderTypes || []).map((type) => <span key={type}>{localizeCreditOrderType(type, t)}</span>)}{partner.hasCustomerEntitlement && <span>{t('customerEntitlement')}</span>}</div><p>{partner.customerTerms || t('termsFallback')}</p><div className="ox-credit-partner-meta"><span>{geographySummary(partner, t)}</span>{partnerLimit(partner, t)}{partner.dailyCustomerLimitCents ? <span>{t('dailyLimit', { amount: money(partner.dailyCustomerLimitCents, partner.currencyCode) })}</span> : null}{partner.lifetimeCustomerLimitCents ? <span>{t('lifetimeLimit', { amount: money(partner.lifetimeCustomerLimitCents, partner.currencyCode) })}</span> : null}{partner.allowedCategories?.length ? <span>{t('coveredCategories', { count: partner.allowedCategories.length })}</span> : null}</div>{partner.restaurantId ? <Link className="ox-credit-partner-link" to={`/restaurants/r/${partner.restaurantId}`}>{t('openMenu')} <ArrowUpRight size={14} /></Link> : null}</div></article>)}</div>{partnerPagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMorePartners} disabled={loadingMorePartners}>{loadingMorePartners ? t('loadingMoreRestaurants') : t('showMoreRestaurants')}</button>}</>}
                  <Link to="/restaurants" className="ox-credit-secondary-link">{t('browseParticipating')} <ArrowUpRight size={15} /></Link>
                </section>

                <section className="ox-credit-panel" id="credit-activity">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('statement')}</p><h2>{t('recentActivity')}</h2></div><div className="ox-credit-panel-actions"><span className="ox-credit-count">{transactions.length}</span><button type="button" className="ox-credit-download" onClick={downloadStatement} disabled={downloading || !statement}><Download size={14} /> {downloading ? t('preparing') : t('downloadCsv')}</button></div></div>
                  <p className="ox-credit-panel-copy">{t('statementCopy', { from: statement?.period?.from || 'recent', to: statement?.period?.to || 'today' })}</p>
                  {statement && <div className="ox-credit-statement-summary"><div><span>{t('credits')}</span><strong className="positive">+{money(statement.totalCreditsCents, currency)}</strong></div><div><span>{t('debits')}</span><strong className="negative">-{money(statement.totalDebitsCents, currency)}</strong></div><div><span>{t('closingBalance')}</span><strong>{money(statement.closingBalanceCents, currency)}</strong></div></div>}
                  {!transactions.length ? <div className="ox-credit-empty"><Clock3 size={27} /><strong>{t('noActivity')}</strong><span>{t('activityCopy')}</span></div> : <div className="ox-credit-transaction-list">{transactions.map((transaction) => { const positive = transaction.direction === 'credit' || ['load', 'refund'].includes(transaction.transactionType); const orderPath = transactionOrderPath(transaction); return <article key={transaction.id}><span className={`ox-credit-transaction-icon ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{transactionLabel(transaction, t)}</strong><span>{transaction.description || t('ledgerEntry')}</span><small>{dateTime(transaction.postedAt || transaction.createdAt, t)}{transaction.orderId ? ` · ${t('orderNumber', { id: transaction.orderId })}` : ''}</small><div className="ox-credit-transaction-actions"><Link to={transactionDetailPath(transaction, currency)} className="ox-credit-detail-link"><Receipt size={12} /> {t('viewDetails')}</Link>{orderPath && <Link to={orderPath} className="ox-credit-order-link">{t('viewOrder')}</Link>}<button type="button" className="ox-credit-dispute-button" onClick={() => { if (String(disputeTransactionId) !== String(transaction.id)) disputeRequestKeyRef.current = ''; setDisputeTransactionId(transaction.id); }}>{t('reportProblem')}</button></div></div><b className={positive ? 'positive' : 'negative'}>{positive ? '+' : '-'}{money(transaction.amountCents, transaction.currencyCode || currency)}</b></article>; })}</div>}
                  {statement?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadOlderActivity} disabled={loadingMore || refreshing}><RefreshCw size={14} className={loadingMore ? 'ox-credit-spin' : ''} /> {loadingMore ? t('loadingOlderActivity') : t('loadOlderActivity')}</button>}
                  {disputeTransactionId && <form className="ox-credit-dispute-form" onSubmit={submitDispute}><strong>{t('reportTransactionProblem')}</strong><span>{t('disputeCopy')}</span><select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}><option value="incorrect_amount">{t('disputeIncorrectAmount')}</option><option value="unauthorized">{t('disputeUnauthorized')}</option><option value="duplicate">{t('disputeDuplicate')}</option><option value="restaurant_issue">{t('disputeRestaurantIssue')}</option><option value="other">{t('other')}</option></select><textarea required maxLength={4000} value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} placeholder={t('tellWhatHappened')} rows={3} /><div><button type="button" onClick={() => { setDisputeTransactionId(null); disputeRequestKeyRef.current = ''; }}>{t('cancel')}</button><button type="submit" disabled={disputeSubmitting}>{disputeSubmitting ? t('submitting') : t('submitDispute')}</button></div></form>}
                  <div className="ox-credit-security-note"><AlertCircle size={15} /> {t('needHelpTransaction')} <Link to="/support/escalation">{t('contactSupport')}</Link></div>
                </section>
              </div>
              {disputes.length > 0 && <section className="ox-credit-panel ox-credit-dispute-history"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('reviewHistory')}</p><h2>{t('yourCreditDisputes')}</h2></div><span className="ox-credit-count">{disputes.length}{disputePagination?.hasMore ? '+' : ''}</span></div><p className="ox-credit-panel-copy">{t('disputesCopy')}</p><div className="ox-credit-dispute-list">{disputes.map((dispute) => <article key={dispute.id}><div><div className="ox-credit-dispute-title"><strong>{dispute.restaurantName || t('ledgerEntry')}</strong><span className={`ox-credit-dispute-status ${dispute.status}`}>{creditStatusLabel(dispute.status, t)}</span></div><span>{disputeReasonLabel(dispute.reasonCode, t)}</span>{dispute.amountCents !== null && dispute.amountCents !== undefined && <small>{money(dispute.amountCents, dispute.currencyCode || currency)} · {transactionLabel({ transactionType: dispute.transactionType }, t)}</small>}<small>{t('opened', { date: dateTime(dispute.openedAt, t), id: dispute.transactionId })}</small><p>{dispute.description}</p>{dispute.resolution && <em>{t('resolution', { value: dispute.resolution })}</em>}</div></article>)}</div>{disputePagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMoreDisputes} disabled={loadingMoreDisputes}><RefreshCw size={14} className={loadingMoreDisputes ? 'ox-credit-spin' : ''} /> {loadingMoreDisputes ? t('loadingOlderActivity') : t('loadOlderActivity')}</button>}</section>}
            </>
          )}
          <p className="ox-credit-footnote" role="note"><ShieldCheck size={14} /> <strong>{t('disclaimerTitle')}</strong> {t('disclaimerBody')}</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
