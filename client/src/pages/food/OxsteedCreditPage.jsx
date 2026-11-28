import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAppResume from '../../hooks/useAppResume';
import { useSocket } from '../../hooks/useSocket';
import { CREDIT_BALANCE_EVENT } from '../../lib/realtime';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  AlertCircle,
  Clock3,
  CreditCard,
  Download,
  MoreHorizontal,
  Plus,
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
  getOxsteedCreditAccountDetails,
  getOxsteedCreditLimitSummary,
  listOxsteedCreditAccounts,
  getOxsteedCreditStatus,
  listOxsteedCreditHolds,
  getOxsteedCreditEligiblePartnerPage,
  getOxsteedCreditStatement,
  getOxsteedCreditStatementPeriods,
  downloadOxsteedCreditStatement,
  downloadOxsteedCreditAccountLetter,
  getOxsteedCreditTransactionPage,
  openOxsteedCreditDispute,
  getOxsteedCreditDisputePage,
  listOxsteedCreditDisputeEvidence,
  submitOxsteedCreditDisputeEvidence,
  createOxsteedCreditHold,
  releaseOxsteedCreditHold,
  reauthorizeOxsteedCreditHold,
  getOxsteedCreditConversionQuote,
  createOxsteedCreditConversionQuote,
  convertOxsteedCredit,
  getOxsteedCreditFeeQuote,
  requestOxsteedCreditWithdrawal,
  createOxsteedCreditTransfer,
  getOxsteedCreditTransferRecipient,
  resolveOxsteedCreditTransferRecipient,
  listOxsteedCreditWithdrawals,
  cancelOxsteedCreditWithdrawal,
  listOxsteedCreditTopups,
  listOxsteedCreditCards,
  getConsentHistory,
  createOxsteedCreditRestaurantConversion,
  getRestaurantConversionEligibility,
  issueOxsteedCreditMoneyOutStepup,
} from '../../api/oxsteedCredit';
import toast from 'react-hot-toast';
import './OxsteedCreditPage.css';
import { listArchive, downloadArchiveDocument } from '../../api/creditStatements';
import { formatCreditMinorUnits, getCreditMinorUnits, parseCreditMajorAmount } from '../../lib/creditCurrency';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { localizeCreditOrderType, localizeCreditTransactionType } from '../../lib/creditStatus';
import { canConfirmTransfer, canEnterTransferReview } from '../../lib/transferReviewGuards';
import {
  CREDIT_ACTIVITY_TABS,
  classifyRecipientInput,
  formatMaskedCardNumber,
  moneyOutBlockReason,
  readCreditUiState,
  writeCreditUiState,
} from '../../lib/creditRedesignUi';
import CreditWindDownBanner from '../../components/paymentLayers/CreditWindDownBanner';
import CreditDisclosuresPanel from '../../components/paymentLayers/CreditDisclosuresPanel';
import CreditDomainRecoveryLinks from '../../components/credit/CreditDomainRecoveryLinks';
import CreditDrawer from '../../components/credit/CreditDrawer';
import CreditCardsDrawer from '../../components/credit/CreditCardsDrawer';
import OxsteedCreditTopupPanel from '../../components/credit/OxsteedCreditTopupPanel';

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

// Group 13 Slice 4j (697): the consent history labels the stored type and
// disclosure kind verbatim; an unknown value falls back to the stored
// string itself rather than inventing a label.
function consentTypeLabel(value, t) {
  return {
    terms_of_service: t('consentHistory.type.terms_of_service'),
    privacy_policy: t('consentHistory.type.privacy_policy'),
    tier3_payment_agreement: t('consentHistory.type.tier3_payment_agreement'),
    background_check_consent: t('consentHistory.type.background_check_consent'),
    w9_certification: t('consentHistory.type.w9_certification'),
  }[value] || value;
}

function disclosureKindLabel(value, t) {
  return {
    short_form: t('consentHistory.disclosureKind.short_form'),
    long_form: t('consentHistory.disclosureKind.long_form'),
    fee_schedule: t('consentHistory.disclosureKind.fee_schedule'),
    not_insured: t('consentHistory.disclosureKind.not_insured'),
    safeguarding: t('consentHistory.disclosureKind.safeguarding'),
    wage_payment_terms: t('consentHistory.disclosureKind.wage_payment_terms'),
    error_resolution: t('consentHistory.disclosureKind.error_resolution'),
  }[value] || value;
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

// Group 13 Slice 4b (657): top-up statuses reuse the walletTopup.status
// labels the top-up panel already localizes.
function topupStatusLabel(status, t) {
  return {
    pending: t('walletTopup.status.pending'),
    completed: t('walletTopup.status.completed'),
    failed: t('walletTopup.status.failed'),
    requires_attention: t('walletTopup.status.requires_attention'),
  }[status] || t('walletTopup.status.pending');
}

// Group 13 Slice 4e (673, D-370): the customer view exposes the stored
// adjustment status verbatim; the page labels pending/approved as Pending,
// applied as Applied, and rejected/cancelled as Not applied. There is no
// 'reversed' state in the adjustment records.
function adjustmentStatusLabel(status, t) {
  return {
    pending: t('disputeAdjustmentPending'),
    approved: t('disputeAdjustmentPending'),
    applied: t('disputeAdjustmentApplied'),
    rejected: t('disputeAdjustmentNotApplied'),
    cancelled: t('disputeAdjustmentNotApplied'),
  }[status] || t('disputeAdjustmentPending');
}

// G13-A2: reservation line items carry the planned need's title, not a
// restaurant; the subtitle names the row a planned-need reservation.
function holdTitle(hold, t) {
  if (hold.kind === 'reservation') return hold.plannedNeedTitle || t('plannedNeedReservation');
  return hold.restaurantName || t('partnerRestaurant');
}

function holdSubtitle(hold, t) {
  if (hold.kind === 'reservation') return t('plannedNeedReservation');
  return hold.purpose || t('authorizeInStorePayment');
}

function holdTerminalDate(hold, t) {
  if (hold.status === 'captured' && hold.capturedAt) return t('capturedAt', { date: dateTime(hold.capturedAt, t) });
  if (['released', 'expired'].includes(hold.status) && hold.releasedAt) return t('releasedAt', { status: holdStatusLabel(hold.status, t), date: dateTime(hold.releasedAt, t) });
  // G13-A2: reservations never expire; an active one shows when it was
  // reserved, not "Expires No date".
  if (hold.kind === 'reservation') return t('reservedAt', { date: dateTime(hold.createdAt, t) });
  return t('expiresAt', { date: dateTime(hold.expiresAt, t) });
}

function amountPlaceholder(currency, metadata) {
  const minorUnits = getCreditMinorUnits(currency, metadata);
  return `${minorUnits ? `0.${'0'.repeat(minorUnits)}` : '0'} ${currency}`;
}

export default function OxsteedCreditPage() {
  const { t } = useTranslation('credit');
  const [searchParams] = useSearchParams();
  // Credit redesign (D-802): the currency and activity tab persist per
  // browser profile in localStorage; the first load honors the stored
  // currency instead of defaulting to the first account's.
  const [account, setAccount] = useState(null);
  const [limitSummary, setLimitSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState(() => readCreditUiState(globalThis.localStorage).currency);
  const [partners, setPartners] = useState([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerOrderType, setPartnerOrderType] = useState('');
  const [partnerPagination, setPartnerPagination] = useState(null);
  const [holds, setHolds] = useState([]);
  const [holdPagination, setHoldPagination] = useState(null);
  const [railStatus, setRailStatus] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [statement, setStatement] = useState(null);
  const [statementPeriods, setStatementPeriods] = useState([]);
  const [statementPeriodsOpen, setStatementPeriodsOpen] = useState(false);
  // Issued monthly documents by "year-month": when a closed month has an
  // issued original, View/Download serve the immutable document (with its
  // amendment state) instead of re-rendering the live interim report.
  const [issuedStatements, setIssuedStatements] = useState({});
  const [issuedStatementsLoading, setIssuedStatementsLoading] = useState(false);
  const [viewingPeriod, setViewingPeriod] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [disputePagination, setDisputePagination] = useState(null);
  // Group 13 Slice 4j (697): the customer's consent history, derived from
  // the existing acceptance records; a failed load leaves the section
  // empty rather than blocking the wallet.
  const [consentHistory, setConsentHistory] = useState(null);
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
  const [reauthorizingHoldId, setReauthorizingHoldId] = useState(null);
  const [conversionQuoteId, setConversionQuoteId] = useState('');
  const [conversionAmount, setConversionAmount] = useState('');
  const [conversionSubmitting, setConversionSubmitting] = useState(false);
  const [createdConversion, setCreatedConversion] = useState(null);
  const [disputeTransactionId, setDisputeTransactionId] = useState(null);
  const [disputeReason, setDisputeReason] = useState('incorrect_amount');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  // Group 13 Slice 4e (673/674): per-dispute adjustment state rides the
  // dispute list itself; evidence is loaded lazily per case when the
  // customer opens its evidence section.
  const [evidenceByDispute, setEvidenceByDispute] = useState({});
  const [evidenceOpenId, setEvidenceOpenId] = useState(null);
  const [evidenceLoadingId, setEvidenceLoadingId] = useState(null);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceSubmitting, setEvidenceSubmitting] = useState(false);
  // Phase 6 money-out state.
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalFeeQuote, setWithdrawalFeeQuote] = useState(null);
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalChallenge, setWithdrawalChallenge] = useState(null);
  const [withdrawalCode, setWithdrawalCode] = useState('');
  const [withdrawals, setWithdrawals] = useState([]);
  const [createdWithdrawal, setCreatedWithdrawal] = useState(null);
  const [cancellingWithdrawalId, setCancellingWithdrawalId] = useState(null);
  // Group 13 Slice 4b (657): pending top-ups on the pending-activity list.
  const [pendingTopups, setPendingTopups] = useState([]);
  // Group 13 Slice 4f (680): failed top-ups are listed beside the pending
  // ones so the failed record — and its retry — is reachable; the record
  // itself opens on the Wallet page panel, like a pending top-up.
  const [failedTopups, setFailedTopups] = useState([]);
  // Customer-to-customer transfer state.
  const [transferRecipientId, setTransferRecipientId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('');
  const [transferFeeQuote, setTransferFeeQuote] = useState(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferChallenge, setTransferChallenge] = useState(null);
  const [transferCode, setTransferCode] = useState('');
  const [transferReview, setTransferReview] = useState(false);
  const [createdTransfer, setCreatedTransfer] = useState(null);
  // Recipient resolution (audit item 4): the review panel may only show a
  // resolved display name, never a bare pasted UUID.
  const [transferRecipient, setTransferRecipient] = useState(null);
  const [transferRecipientError, setTransferRecipientError] = useState('');
  const [transferRecipientLoading, setTransferRecipientLoading] = useState(false);
  const recipientLookupTimerRef = useRef(null);
  // Fee-quote failure (audit item 11): a failed quote must block review
  // and confirm, since the fee is still charged server-side on POST.
  const [transferFeeQuoteError, setTransferFeeQuoteError] = useState('');
  const [transferFeeQuoteLoading, setTransferFeeQuoteLoading] = useState(false);
  const transferQuoteTimerRef = useRef(null);
  const transferIdempotencyRef = useRef(null);
  const [restaurantConversionDirection, setRestaurantConversionDirection] = useState('to_restaurant');
  const [restaurantConversionRestaurantId, setRestaurantConversionRestaurantId] = useState('');
  const [restaurantConversionAmount, setRestaurantConversionAmount] = useState('');
  const [restaurantConversionSubmitting, setRestaurantConversionSubmitting] = useState(false);
  const [createdRestaurantConversion, setCreatedRestaurantConversion] = useState(null);
  // Null until loaded: the from_restaurant dropdown is filtered to the
  // restaurant ids OxSteed has enabled for conversion into OxSteed Credit.
  const [conversionEligibility, setConversionEligibility] = useState(null);
  // Credit redesign (D-806): progressive disclosure. One drawer at a time;
  // the main column keeps the hero, the attention strip, the activity
  // tabs, and the right rail. A ?topupId= deep link opens the Add Credit
  // drawer on that top-up record.
  const [activeDrawer, setActiveDrawer] = useState(() => (searchParams.get('topupId') ? 'topup' : null));
  const [drawerTopupId, setDrawerTopupId] = useState(() => searchParams.get('topupId') || null);
  const [activityTab, setActivityTab] = useState(() => readCreditUiState(globalThis.localStorage).activityTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cards, setCards] = useState([]);
  const [accountDetails, setAccountDetails] = useState(null);
  const [accountDetailsLoading, setAccountDetailsLoading] = useState(false);
  // Self-serve conversion quote (D-794): the quote the drawer requested,
  // shown with rate, fee, and expiry before the customer confirms.
  const [conversionTargetCurrency, setConversionTargetCurrency] = useState('');
  const [conversionQuote, setConversionQuote] = useState(null);
  const [conversionQuoteLoading, setConversionQuoteLoading] = useState(false);
  const [conversionQuoteError, setConversionQuoteError] = useState('');
  // Account letter step-up (D-797/D-803): a fresh 'account_letter'
  // challenge, verified before the letter downloads.
  const [letterChallenge, setLetterChallenge] = useState(null);
  const [letterCode, setLetterCode] = useState('');
  const [letterBusy, setLetterBusy] = useState(false);
  const withdrawalQuoteTimerRef = useRef(null);
  const loadRequestRef = useRef(0);
  const initialCurrencyRef = useRef(selectedCurrency);
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
      const [partnerResult, holdResult, railResult, statementResult, disputeResult, limitResult, eligibilityResult, periodsResult, consentResult] = await Promise.all([
        getOxsteedCreditEligiblePartnerPage({ currencyCode: preferredCurrency, limit: 50, offset: 0 }),
        listOxsteedCreditHolds({ currencyCode: preferredCurrency, status: 'all', limit: 50, offset: 0 }).catch(() => null),
        getOxsteedCreditStatus().catch(() => null),
        getOxsteedCreditStatement({ limit: 50, currencyCode: preferredCurrency }).catch(() => null),
        getOxsteedCreditDisputePage({ limit: 50, offset: 0 }).catch(() => null),
        getOxsteedCreditLimitSummary({ currencyCode: preferredCurrency }).catch(() => null),
        // The from_restaurant conversion allowlist; a fetch failure leaves
        // the dropdown unfiltered and the server gate still enforces.
        getRestaurantConversionEligibility().catch(() => null),
        getOxsteedCreditStatementPeriods({ currencyCode: preferredCurrency }).catch(() => []),
        getConsentHistory().catch(() => null),
      ]);
      if (!isCurrentRequest()) return;
      setStatementPeriods(Array.isArray(periodsResult) ? periodsResult : []);
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
      setConsentHistory(consentResult && Array.isArray(consentResult.consents) && Array.isArray(consentResult.disclosures) ? consentResult : null);
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
    load({ currencyCode: initialCurrencyRef.current });
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  // D-802: the currency and activity tab persist per browser profile.
  useEffect(() => {
    writeCreditUiState(globalThis.localStorage, { currency: selectedCurrency, activityTab });
  }, [selectedCurrency, activityTab]);

  // The hero card thumbnail needs the customer's cards; a failed load
  // leaves the thumbnail in its "get a card" state, never an error page.
  const loadCards = useCallback(async () => {
    try {
      const rows = await listOxsteedCreditCards();
      setCards(Array.isArray(rows) ? rows : []);
    } catch {
      // Non-critical: the hero thumbnail falls back to "Get a card".
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // Account details (number, member code) load lazily when the Account
  // drawer opens; a currency change under it reloads the right account.
  useEffect(() => {
    if (activeDrawer !== 'account') return undefined;
    let cancelled = false;
    setAccountDetailsLoading(true);
    getOxsteedCreditAccountDetails({ currencyCode: selectedCurrency })
      .then((details) => { if (!cancelled) setAccountDetails(details); })
      .catch(() => { /* Non-critical: the drawer shows the empty state. */ })
      .finally(() => { if (!cancelled) setAccountDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [activeDrawer, selectedCurrency]);

  // The statements drawer opens onto the monthly archive directly; the
  // toggle inside still collapses it.
  useEffect(() => {
    if (activeDrawer === 'statements') setStatementPeriodsOpen(true);
  }, [activeDrawer]);

  // Live balance (D-445): re-fetch quietly on resume, the way WalletPage
  // does, and on the server's balance nudge. The payload carries no amounts,
  // so this always re-fetches authoritative state.
  useAppResume(() => load({ quiet: true }));

  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return undefined;
    const handler = () => load({ quiet: true });
    socket.on(CREDIT_BALANCE_EVENT, handler);
    return () => { socket.off(CREDIT_BALANCE_EVENT, handler); };
  }, [socket, load]);

  const changeCurrency = (event) => {
    const currencyCode = event.target.value;
    setSelectedCurrency(currencyCode);
    setIssuedStatements({});
    setAccountDetails(null);
    setConversionQuote(null);
    setConversionQuoteId('');
    setConversionTargetCurrency('');
    load({ quiet: true, currencyCode });
  };

  // Credit redesign (D-806): drawer navigation. Opening a drawer closes
  // the header menu; closing one returns focus to its opener through the
  // drawer's own cleanup.
  const openDrawer = (name) => {
    setMenuOpen(false);
    setActiveDrawer(name);
  };
  const closeDrawer = () => setActiveDrawer(null);
  const openTopupDrawer = (topupId = null) => {
    setMenuOpen(false);
    setDrawerTopupId(topupId);
    setActiveDrawer('topup');
  };

  const copyText = async (value, successMessage) => {
    if (!value || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(t('redesign.copyFailed'));
    }
  };

  // Self-serve conversion quote (D-794): the customer asks for a quote
  // from the live FX feed; the Convert drawer confirms against the
  // returned quote instead of an admin-issued Quote ID.
  const requestConversionQuote = async (event) => {
    event.preventDefault();
    const sourceAmountMinorUnits = parseCreditMajorAmount(conversionAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!sourceAmountMinorUnits || !conversionTargetCurrency || conversionTargetCurrency === selectedCurrency) {
      toast.error(t('conversionQuoteRequired'));
      return;
    }
    setConversionQuoteLoading(true);
    setConversionQuoteError('');
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `credit-conversion-quote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await createOxsteedCreditConversionQuote({
        sourceCurrencyCode: selectedCurrency,
        targetCurrencyCode: conversionTargetCurrency,
        sourceAmountMinorUnits,
      }, idempotencyKey);
      const quote = result?.quote || null;
      if (!quote?.id) throw new Error(t('conversionQuoteRequired'));
      setConversionQuote(quote);
      setConversionQuoteId(String(quote.id));
    } catch (error) {
      setConversionQuote(null);
      setConversionQuoteError(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setConversionQuoteLoading(false);
    }
  };

  // Account letter (D-797/D-803): a fresh 'account_letter' step-up
  // challenge, verified before the letter downloads.
  const requestAccountLetterChallenge = async () => {
    setLetterBusy(true);
    try {
      const issued = await issueOxsteedCreditMoneyOutStepup({ actionType: 'account_letter', amountCents: 1, currencyCode: selectedCurrency });
      setLetterChallenge({ id: issued?.challenge?.id, expiresAt: issued?.challenge?.expiresAt });
      toast.success(t('verificationCodeSent'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setLetterBusy(false);
    }
  };

  const confirmAccountLetter = async (event) => {
    event.preventDefault();
    if (!letterChallenge?.id || !letterCode.trim()) {
      toast.error(t('enterVerificationCode'));
      return;
    }
    setLetterBusy(true);
    try {
      await downloadOxsteedCreditAccountLetter({ currencyCode: selectedCurrency, stepupChallengeId: letterChallenge.id, stepupCode: letterCode.trim() });
      setLetterChallenge(null);
      setLetterCode('');
      toast.success(t('redesign.accountLetterDownloaded'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setLetterBusy(false);
    }
  };

  // Issued-document index for the Monthly statements panel: one archive
  // lookup per panel open (not per row), keyed by year-month so each row
  // can show whether an immutable original exists and its amendment state.
  const loadIssuedStatements = useCallback(async (currencyCode) => {
    setIssuedStatementsLoading(true);
    try {
      const result = await listArchive({ product: 'oxsteed', currency: currencyCode, perPage: 100 });
      const index = {};
      for (const item of (result?.items || [])) {
        const from = String(item?.period?.from || '');
        const match = /^(\d{4})-(\d{2})-01$/.exec(from);
        if (!match) continue;
        index[`${Number(match[1])}-${Number(match[2])}`] = {
          documentId: item.id,
          corrected: Boolean(item.corrected),
          superseded: Boolean(item.superseded),
        };
      }
      setIssuedStatements(index);
    } catch {
      // Non-critical: rows without an issued document keep the interim view.
      setIssuedStatements({});
    } finally {
      setIssuedStatementsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (statementPeriodsOpen) loadIssuedStatements(selectedCurrency);
  }, [statementPeriodsOpen, selectedCurrency, loadIssuedStatements]);

  const downloadIssuedStatement = async (issued, period) => {
    setDownloading(true);
    try {
      const response = await downloadArchiveDocument(issued.documentId);
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-statement-${period.year}-${String(period.month).padStart(2, '0')}.pdf`;
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

  const downloadPeriodStatement = async (period) => {
    setDownloading(true);
    try {
      const response = await downloadOxsteedCreditStatement({ from: period.from, to: period.to, currencyCode: selectedCurrency });
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-statement-${period.from}-${period.to}.csv`;
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

  const viewPeriodStatement = async (period) => {
    setRefreshing(true);
    try {
      const periodStatement = await getOxsteedCreditStatement({ from: period.from, to: period.to, limit: 50, offset: 0, currencyCode: selectedCurrency });
      setStatement(periodStatement);
      setTransactions(Array.isArray(periodStatement?.transactions) ? periodStatement.transactions : []);
      setViewingPeriod(period);
      document.getElementById('credit-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setRefreshing(false);
    }
  };

  const clearPeriodView = () => {
    setViewingPeriod(null);
    load({ quiet: true, currencyCode: selectedCurrency });
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

  // Group 13, item 670 (D-367): one-click re-authorization from an expired
  // hold — same amount and restaurant, fresh hold, same gates as a fresh
  // authorization. The list reloads so the fresh hold appears as active.
  const reauthorizeHold = async (hold) => {
    if (!hold?.id || reauthorizingHoldId) return;
    setReauthorizingHoldId(hold.id);
    try {
      await reauthorizeOxsteedCreditHold(hold.id);
      toast.success(t('authorizationReauthorized'));
      await load({ quiet: true, currencyCode: selectedCurrency });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setReauthorizingHoldId(null);
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
      setConversionQuote(null);
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

  // Group 13 Slice 4e (674): load a case's evidence when the customer
  // opens its evidence section, and attach a note and/or one file to
  // their own open dispute. Only open/in_review disputes offer the form;
  // the server enforces the same window and ownership.
  const toggleDisputeEvidence = async (dispute) => {
    if (evidenceOpenId === dispute.id) {
      setEvidenceOpenId(null);
      return;
    }
    setEvidenceOpenId(dispute.id);
    setEvidenceNote('');
    setEvidenceFile(null);
    if (evidenceByDispute[dispute.id] || evidenceLoadingId === dispute.id) return;
    setEvidenceLoadingId(dispute.id);
    try {
      const evidence = await listOxsteedCreditDisputeEvidence(dispute.id);
      setEvidenceByDispute((current) => ({ ...current, [dispute.id]: evidence }));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setEvidenceLoadingId(null);
    }
  };

  const submitDisputeEvidence = async (event, dispute) => {
    event.preventDefault();
    if (!evidenceNote.trim() && !evidenceFile) return;
    setEvidenceSubmitting(true);
    try {
      const formData = new FormData();
      if (evidenceNote.trim()) formData.append('note', evidenceNote.trim());
      if (evidenceFile) formData.append('file', evidenceFile);
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `credit-dispute-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await submitOxsteedCreditDisputeEvidence(dispute.id, formData, idempotencyKey);
      const evidence = await listOxsteedCreditDisputeEvidence(dispute.id);
      setEvidenceByDispute((current) => ({ ...current, [dispute.id]: evidence }));
      const refreshedDisputes = await getOxsteedCreditDisputePage({ limit: 50, offset: 0 });
      setDisputes(Array.isArray(refreshedDisputes?.disputes) ? refreshedDisputes.disputes : []);
      setDisputePagination(refreshedDisputes?.pagination || null);
      toast.success(t('disputeEvidenceSubmitted'));
      setEvidenceNote('');
      setEvidenceFile(null);
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('errorLoad')));
    } finally {
      setEvidenceSubmitting(false);
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

  // Group 13 Slice 4b (657): pending top-ups are listed from the existing
  // top-up read path; completed top-ups stay out of the pending list and
  // are visible on the Wallet page panel instead. Failed top-ups get their
  // own list beside it (680) so the failed record and its retry are
  // reachable from this page.
  const loadPendingTopups = useCallback(async () => {
    try {
      const rows = await listOxsteedCreditTopups({ status: 'pending', limit: 25, offset: 0 });
      setPendingTopups(Array.isArray(rows) ? rows : []);
    } catch {
      // Pending top-ups are non-critical; the page stays usable.
    }
  }, []);

  const loadFailedTopups = useCallback(async () => {
    try {
      const rows = await listOxsteedCreditTopups({ status: 'failed', limit: 25, offset: 0 });
      setFailedTopups(Array.isArray(rows) ? rows : []);
    } catch {
      // Failed top-ups are non-critical; the page stays usable.
    }
  }, []);

  useEffect(() => {
    loadPendingTopups();
    loadFailedTopups();
  }, [loadPendingTopups, loadFailedTopups]);

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

  // Credit redesign (D-798): the recipient is resolved by customer UUID,
  // by 10-digit account number, or by 16-digit card number (typed or
  // scanned). An account/card resolution stamps the exact input it
  // resolved (resolvedFor) so the review gate only unlocks that input.
  const scheduleTransferRecipientLookup = (rawId) => {
    if (recipientLookupTimerRef.current) clearTimeout(recipientLookupTimerRef.current);
    const id = String(rawId || '').trim();
    setTransferRecipient(null);
    setTransferRecipientError('');
    const kind = classifyRecipientInput(id);
    if (kind === 'unknown') {
      setTransferRecipientLoading(false);
      return;
    }
    setTransferRecipientLoading(true);
    recipientLookupTimerRef.current = setTimeout(async () => {
      try {
        const recipient = kind === 'customerId'
          ? await getOxsteedCreditTransferRecipient(id)
          : await resolveOxsteedCreditTransferRecipient(
            kind === 'accountNumber'
              ? { accountNumber: id.replace(/[\s-]/g, '') }
              : { cardNumber: id.replace(/[\s-]/g, '') },
          );
        if (recipient && recipient.displayName && (kind !== 'customerId' || String(recipient.customerId) === id)) {
          setTransferRecipient(kind === 'customerId' ? recipient : { ...recipient, resolvedFor: id });
        } else {
          // No name came back: fail closed with the generic load message
          // rather than guessing a recipient.
          setTransferRecipientError(t('errorLoad'));
        }
      } catch (error) {
        // Surface the server message verbatim: a not-found recipient and
        // a failed lookup must not look alike.
        setTransferRecipientError(error?.response?.data?.message || error?.response?.data?.error || t('errorLoad'));
      } finally {
        setTransferRecipientLoading(false);
      }
    }, 400);
  };

  const refreshTransferFeeQuote = (rawAmount, { immediate = false } = {}) => {
    if (transferQuoteTimerRef.current) clearTimeout(transferQuoteTimerRef.current);
    const amountCents = parseCreditMajorAmount(rawAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!amountCents) {
      setTransferFeeQuote(null);
      setTransferFeeQuoteError('');
      setTransferFeeQuoteLoading(false);
      return;
    }
    const fetchQuote = async () => {
      // Clear any stale quote for the previous amount: the review panel
      // must never show a fee that belongs to a different amount.
      setTransferFeeQuote(null);
      setTransferFeeQuoteError('');
      setTransferFeeQuoteLoading(true);
      try {
        const quote = await getOxsteedCreditFeeQuote({ operation: 'transfer', amountCents, currencyCode: selectedCurrency });
        setTransferFeeQuote(quote);
      } catch (error) {
        setTransferFeeQuote(null);
        setTransferFeeQuoteError(error?.response?.data?.message || error?.response?.data?.error || t('errorLoad'));
      } finally {
        setTransferFeeQuoteLoading(false);
      }
    };
    if (immediate) {
      fetchQuote();
    } else {
      transferQuoteTimerRef.current = setTimeout(fetchQuote, 500);
    }
  };

  const onTransferAmountChange = (event) => {
    const value = event.target.value;
    setTransferAmount(value);
    setCreatedTransfer(null);
    setTransferReview(false);
    // A pending challenge is bound to the previous amount; drop it so an
    // edited transfer cannot resubmit against a stale amount binding.
    setTransferChallenge(null);
    setTransferCode('');
    refreshTransferFeeQuote(value);
  };

  const submitTransfer = async (event, stepup = null) => {
    if (event) event.preventDefault();
    const amountCents = parseCreditMajorAmount(transferAmount, selectedCurrency, railStatus?.currencyMetadata);
    if (!amountCents) {
      toast.error(t('enterValidAmount'));
      return;
    }
    // No UUID-format check here: the review gate below requires a
    // resolved recipient (by UUID, account number, or card number) and a
    // loaded fee quote before any POST path, for any identifier kind.
    // Fail closed on both review gates before any POST path: an unresolved
    // recipient (valid-but-wrong UUID, audit item 4) or a failed fee quote
    // (fee still charged server-side, audit item 11) never reaches confirm.
    const transferGateArgs = {
      amountCents,
      recipient: transferRecipient,
      recipientId: transferRecipientId,
      feeQuote: transferFeeQuote,
      feeQuoteError: transferFeeQuoteError,
      currencyCode: selectedCurrency,
    };
    if (!canEnterTransferReview(transferGateArgs)) {
      if (transferFeeQuoteLoading) {
        toast.error(t('transferFeeQuoteLoading'));
      } else if (transferFeeQuoteError || !transferFeeQuote) {
        toast.error(t('transferFeeQuoteFailed'));
      } else {
        toast.error(transferRecipientError || t('transferRecipientNotResolved'));
      }
      return;
    }
    // First submit shows the review panel; only the confirm button posts.
    if (!stepup && !transferReview) {
      setTransferReview(true);
      return;
    }
    if (!stepup) {
      transferIdempotencyRef.current = globalThis.crypto?.randomUUID?.()
        || `credit-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setTransferSubmitting(true);
    try {
      const result = await createOxsteedCreditTransfer({
        recipientCustomerId: transferRecipient.customerId,
        amountCents,
        currencyCode: selectedCurrency,
        ...(transferDescription.trim() ? { description: transferDescription.trim() } : {}),
        ...(stepup ? { stepupChallengeId: stepup.challengeId, stepupCode: stepup.code } : {}),
      }, transferIdempotencyRef.current);
      setCreatedTransfer(result || null);
      setTransferAmount('');
      setTransferDescription('');
      setTransferFeeQuote(null);
      setTransferChallenge(null);
      setTransferCode('');
      setTransferReview(false);
      await load({ quiet: true, currencyCode: selectedCurrency });
      toast.success(t('transferSent'));
    } catch (error) {
      if (error?.response?.data?.code === 'credit_stepup_challenge_required' && !stepup) {
        // Large transfer: get a verification code, then resubmit with it.
        try {
          const issued = await issueOxsteedCreditMoneyOutStepup({ actionType: 'customer_transfer', amountCents, currencyCode: selectedCurrency });
          setTransferChallenge({ id: issued?.challenge?.id, expiresAt: issued?.challenge?.expiresAt });
          setTransferReview(false);
          toast.success(t('verificationCodeSent'));
        } catch (issueError) {
          toast.error(safeCreditErrorMessage(issueError, t('errorLoad')));
        }
      } else {
        toast.error(safeCreditErrorMessage(error, t('errorLoad')));
      }
    } finally {
      setTransferSubmitting(false);
    }
  };

  const confirmTransferStepup = (event) => {
    event.preventDefault();
    if (!transferChallenge?.id || !transferCode.trim()) {
      toast.error(t('enterVerificationCode'));
      return;
    }
    submitTransfer(null, { challengeId: transferChallenge.id, code: transferCode.trim() });
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
  const releasableHolds = activeHolds.filter((hold) => hold.kind !== 'reservation');
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
  // Review/confirm gating (audit items 4 and 11): the review button stays
  // enabled for an unparseable amount so the existing invalid-amount toast
  // still fires; once an amount parses, review requires a resolved
  // recipient name and a loaded fee quote.
  const transferAmountCents = parseCreditMajorAmount(transferAmount, selectedCurrency, railStatus?.currencyMetadata);
  const transferGateArgs = {
    amountCents: transferAmountCents,
    recipient: transferRecipient,
    recipientId: transferRecipientId,
    feeQuote: transferFeeQuote,
    feeQuoteError: transferFeeQuoteError,
    currencyCode: selectedCurrency,
  };
  const transferReviewBlocked = Boolean(transferAmountCents) && !canEnterTransferReview(transferGateArgs);
  const transferConfirmBlocked = !canConfirmTransfer(transferGateArgs);

  // Credit redesign (D-806): money-out gating for the hero actions, the
  // first active card for the thumbnail, and the attention counts.
  const moneyOutReason = moneyOutBlockReason({ railEnabled: railStatus?.enabled, accountStatus });
  const sendBlockedReason = moneyOutReason
    || (limitSummary && !limitSummary.transfers?.enabled ? 'transfersDisabled' : null);
  const primaryCard = cards.find((card) => card.status === 'active') || cards[0] || null;
  const hasAttention = pendingTopups.length > 0 || failedTopups.length > 0 || releasableHolds.length > 0;
  const conversionTargetOptions = [...new Set([
    ...(railStatus?.supportedCurrencies || []),
    ...accounts.map((item) => item.currencyCode).filter(Boolean),
  ])].filter((code) => code && code !== selectedCurrency);

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
              <label className="ox-credit-currency-picker">{t('currency')}<select value={selectedCurrency} onChange={changeCurrency} disabled={loading || refreshing}>{[...new Set(['USD', ...(railStatus?.supportedCurrencies || []), ...accounts.map((item) => item.currencyCode).filter(Boolean)])].sort().map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
              <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true, currencyCode: selectedCurrency })} disabled={loading || refreshing}>
                <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> {t('refresh')}
              </button>
              <div className="ox-credit-menu-wrap">
                <button type="button" className="ox-credit-refresh" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)}>
                  <MoreHorizontal size={16} aria-hidden="true" /> {t('redesign.menu')}
                </button>
                {menuOpen && (
                  <>
                    <button type="button" className="ox-credit-menu-backdrop" aria-label={t('redesign.closeMenu')} onClick={() => setMenuOpen(false)} />
                    <div className="ox-credit-menu" role="menu">
                      <Link role="menuitem" to="/wallet" onClick={() => setMenuOpen(false)}><ArrowDownLeft size={16} aria-hidden="true" /> {t('backToWallet')}</Link>
                      <button type="button" role="menuitem" onClick={() => openDrawer('statements')}><Receipt size={16} aria-hidden="true" /> {t('statements.link', { defaultValue: 'Statements' })}</button>
                      <button type="button" role="menuitem" onClick={() => openDrawer('account')}><WalletCards size={16} aria-hidden="true" /> {t('redesign.cardsAndAccount')}</button>
                      <Link role="menuitem" to="/credit/apply" onClick={() => setMenuOpen(false)}><ArrowUpRight size={16} aria-hidden="true" /> {t('creditApplyTitle')}</Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          <CreditWindDownBanner />
          <CreditDisclosuresPanel currency={selectedCurrency} />

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
            {!loading && account && (
              <>
                <div className="ox-credit-hero-action-row">
                  <button type="button" className="ox-credit-hero-primary" onClick={() => openTopupDrawer()}>
                    <Plus size={18} aria-hidden="true" /> {t('redesign.addCredit')}
                  </button>
                  <button type="button" className="ox-credit-hero-action" disabled={Boolean(sendBlockedReason)} onClick={() => openDrawer('send')}>
                    <ArrowUpRight size={18} aria-hidden="true" /> {t('redesign.send')}
                  </button>
                  <button type="button" className="ox-credit-hero-action" disabled={Boolean(moneyOutReason)} onClick={() => openDrawer('withdraw')}>
                    <ArrowDownLeft size={18} aria-hidden="true" /> {t('redesign.withdraw')}
                  </button>
                  <button type="button" className="ox-credit-hero-action" disabled={Boolean(moneyOutReason)} onClick={() => openDrawer('pay')}>
                    <Store size={18} aria-hidden="true" /> {t('redesign.payInStore')}
                  </button>
                  <button type="button" className="ox-credit-hero-action" onClick={() => openDrawer('more')}>
                    <MoreHorizontal size={18} aria-hidden="true" /> {t('redesign.more')}
                  </button>
                  <button type="button" className="ox-credit-card-thumb" onClick={() => openDrawer('cards')}>
                    <CreditCard size={20} aria-hidden="true" />
                    <span>{primaryCard ? (formatMaskedCardNumber(primaryCard.credentialLast4) || t('cards.noCredential')) : t('redesign.getCard')}</span>
                    <small>{primaryCard ? (primaryCard.nickname || (primaryCard.cardType === 'physical' ? t('cards.physicalCard') : t('cards.virtualCard'))) : t('redesign.noCardYet')}</small>
                  </button>
                </div>
                {moneyOutReason && <p className="ox-credit-blocked-note" role="status">{t(moneyOutReason === 'railPaused' ? 'redesign.moneyOutBlockedRail' : 'redesign.moneyOutBlockedAccount')}</p>}
                {sendBlockedReason === 'transfersDisabled' && <p className="ox-credit-blocked-note" role="status">{t('redesign.transfersDisabledNote')}</p>}
              </>
            )}
          </section>

          {loadError && !loading && <section className="ox-credit-error-panel" role="alert"><AlertCircle size={24} /><strong>{t('errorLoad')}</strong><span>{loadError}</span><button type="button" className="ox-credit-refresh" onClick={() => load({ currencyCode: selectedCurrency })}>{t('retry')}</button></section>}

          {loading ? <div className="ox-credit-loading" role="status" aria-live="polite">{t('loadingAccount')}</div> : loadError && !account ? null : (
            <>
              {limitSummary && <section className="ox-credit-panel ox-credit-limits-panel" aria-labelledby="credit-limits-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('dailyControls')}</p><h2 id="credit-limits-heading">{t('spendingGuardrails')}</h2></div><span className="ox-credit-count">{t('resets', { date: dateTime(limitSummary.resetsAt, t) })}</span></div><p className="ox-credit-panel-copy">{t('guardrailsCopy')}</p><div className="ox-credit-limit-grid"><div><span>{t('spendAmountRemaining')}</span><strong>{money(limitSummary.spending.centsRemaining, currency)}</strong><small>{t('centsCommittedToday', { used: limitSummary.spending.centsUsed.toLocaleString(), limit: limitSummary.spending.centsLimit.toLocaleString() })}</small></div><div><span>{t('spendMovementsRemaining')}</span><strong>{limitSummary.spending.countRemaining}</strong><small>{t('purchasesReservationsToday', { used: limitSummary.spending.countUsed, limit: limitSummary.spending.countLimit })}</small></div>{limitSummary.transfers.enabled && <><div><span>{t('transferAmountRemaining')}</span><strong>{money(limitSummary.transfers.centsRemaining, currency)}</strong><small>{t('centsTransferredToday', { used: limitSummary.transfers.centsUsed.toLocaleString(), limit: limitSummary.transfers.centsLimit.toLocaleString() })}</small></div><div><span>{t('transfersRemaining')}</span><strong>{limitSummary.transfers.countRemaining}</strong><small>{t('transfersToday', { used: limitSummary.transfers.countUsed, limit: limitSummary.transfers.countLimit })}</small></div></>}</div></section>}

              
            {hasAttention && (
              <section className="ox-credit-panel ox-credit-attention-panel" aria-labelledby="credit-attention-heading">
                <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('redesign.attentionEyebrow')}</p><h2 id="credit-attention-heading">{t('redesign.needsAttention')}</h2></div></div>
                <p className="ox-credit-panel-copy">{t('redesign.attentionCopy')}</p>
                <div className="ox-credit-hold-list">
                  {pendingTopups.length > 0 && (
                    <article><div><strong>{t('redesign.attentionPendingTopups', { count: pendingTopups.length })}</strong><span>{money(pendingTopups[0].amountCents, pendingTopups[0].currencyCode || currency)}</span><small>{t('redesign.attentionPendingTopupsCopy')}</small></div><div className="ox-credit-hold-end"><button type="button" className="ox-credit-hold-action" onClick={() => setActivityTab('pending')}>{t('redesign.viewActivity')}</button></div></article>
                  )}
                  {failedTopups.length > 0 && (
                    <article><div><strong>{t('redesign.attentionFailedTopups', { count: failedTopups.length })}</strong><span>{money(failedTopups[0].amountCents, failedTopups[0].currencyCode || currency)}</span><small>{t('redesign.attentionFailedTopupsCopy')}</small></div><div className="ox-credit-hold-end"><button type="button" className="ox-credit-hold-action" onClick={() => openTopupDrawer(failedTopups[0].id)}>{t('viewTopup')}</button></div></article>
                  )}
                  {releasableHolds.length > 0 && (
                    <article><div><strong>{t('redesign.attentionReleasableHolds', { count: releasableHolds.length })}</strong><span>{money(releasableHolds[0].amountCents, releasableHolds[0].currencyCode || currency)}</span><small>{t('redesign.attentionReleasableHoldsCopy')}</small></div><div className="ox-credit-hold-end"><button type="button" className="ox-credit-hold-action" onClick={() => setActivityTab('holds')}>{t('redesign.viewActivity')}</button></div></article>
                  )}
                </div>
              </section>
            )}

            <div className="ox-credit-sections">
              <section className="ox-credit-panel" id="credit-activity">
                <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('statement')}</p><h2>{t('recentActivity')}</h2></div><div className="ox-credit-panel-actions"><span className="ox-credit-count">{transactions.length}</span><button type="button" className="ox-credit-download" onClick={downloadStatement} disabled={downloading || !statement}><Download size={14} /> {downloading ? t('preparing') : t('downloadCsv')}</button></div></div>
                <div className="ox-credit-tabs" role="tablist" aria-label={t('recentActivity')}>
                  {CREDIT_ACTIVITY_TABS.map((tab) => (
                    <button key={tab} type="button" role="tab" aria-selected={activityTab === tab} onClick={() => setActivityTab(tab)}>{t(`redesign.tab.${tab}`)}</button>
                  ))}
                </div>
                {activityTab === 'all' && (
                  <>
{viewingPeriod
                    ? <p className="ox-credit-panel-copy" role="status">{t('viewingPeriodStatement', { month: new Date(viewingPeriod.year, viewingPeriod.month - 1, 1).toLocaleDateString(t.lng || undefined, { month: 'long', year: 'numeric' }) })} <button type="button" className="ox-credit-detail-link" onClick={clearPeriodView}>{t('backToRecentActivity')}</button></p>
                    : <p className="ox-credit-panel-copy">{t('statementCopy', { from: statement?.period?.from || 'recent', to: statement?.period?.to || 'today' })}</p>}
                  {statement && <div className="ox-credit-statement-summary"><div><span>{t('credits')}</span><strong className="positive">+{money(statement.totalCreditsCents, currency)}</strong></div><div><span>{t('debits')}</span><strong className="negative">-{money(statement.totalDebitsCents, currency)}</strong></div><div><span>{t('closingBalance')}</span><strong>{money(statement.closingBalanceCents, currency)}</strong></div></div>}
                  {!transactions.length ? <div className="ox-credit-empty"><Clock3 size={27} /><strong>{t('noActivity')}</strong><span>{t('activityCopy')}</span></div> : <div className="ox-credit-transaction-list">{transactions.map((transaction) => { const positive = transaction.direction === 'credit' || ['load', 'refund'].includes(transaction.transactionType); const orderPath = transactionOrderPath(transaction); return <article key={transaction.id}><span className={`ox-credit-transaction-icon ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{transactionLabel(transaction, t)}</strong><span>{transaction.description || t('ledgerEntry')}</span><small>{dateTime(transaction.postedAt || transaction.createdAt, t)}{transaction.orderId ? ` · ${t('orderNumber', { id: transaction.orderId })}` : ''}</small><div className="ox-credit-transaction-actions"><Link to={transactionDetailPath(transaction, currency)} className="ox-credit-detail-link"><Receipt size={12} /> {t('viewDetails')}</Link>{orderPath && <Link to={orderPath} className="ox-credit-order-link">{t('viewOrder')}</Link>}<button type="button" className="ox-credit-dispute-button" onClick={() => { if (String(disputeTransactionId) !== String(transaction.id)) disputeRequestKeyRef.current = ''; setDisputeTransactionId(transaction.id); }}>{t('reportProblem')}</button></div></div><div className="ox-credit-transaction-amount"><b className={positive ? 'positive' : 'negative'}>{positive ? '+' : '-'}{money(transaction.amountCents, transaction.currencyCode || currency)}</b>{transaction.balanceAfterCents !== null && transaction.balanceAfterCents !== undefined && <small className="ox-credit-running-balance">{t('balanceAfterLabel', { balance: money(transaction.balanceAfterCents, transaction.currencyCode || currency) })}</small>}</div></article>; })}</div>}
                  {statement?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadOlderActivity} disabled={loadingMore || refreshing}><RefreshCw size={14} className={loadingMore ? 'ox-credit-spin' : ''} /> {loadingMore ? t('loadingOlderActivity') : t('loadOlderActivity')}</button>}
                  {disputeTransactionId && <form className="ox-credit-dispute-form" onSubmit={submitDispute}><strong>{t('reportTransactionProblem')}</strong><span>{t('disputeCopy')}</span><select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}><option value="incorrect_amount">{t('disputeIncorrectAmount')}</option><option value="unauthorized">{t('disputeUnauthorized')}</option><option value="duplicate">{t('disputeDuplicate')}</option><option value="restaurant_issue">{t('disputeRestaurantIssue')}</option><option value="other">{t('other')}</option></select><textarea required maxLength={4000} value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} placeholder={t('tellWhatHappened')} rows={3} /><div><button type="button" onClick={() => { setDisputeTransactionId(null); disputeRequestKeyRef.current = ''; }}>{t('cancel')}</button><button type="submit" disabled={disputeSubmitting}>{disputeSubmitting ? t('submitting') : t('submitDispute')}</button></div></form>}
                  <div className="ox-credit-security-note"><AlertCircle size={15} /> {t('needHelpTransaction')} <Link to="/support/escalation">{t('contactSupport')}</Link></div>
                  </>
                )}
                {activityTab === 'holds' && (
                  holds.length || releasableHolds.length ? (
                    <>
<div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('reservationHistory')}</p><h2>{t('creditHolds')}</h2></div><span className="ox-credit-count">{holds.length}{holdPagination?.hasMore ? '+' : ''}</span></div><p className="ox-credit-panel-copy">{t('holdsCopy')}</p>{!!activeHolds.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('activeReservations')}</strong><span>{activeHolds.length}</span></div><div className="ox-credit-hold-list">{activeHolds.map((hold) => <article key={hold.id}><div><strong>{holdTitle(hold, t)}</strong><span>{holdSubtitle(hold, t)}</span><small>{holdTerminalDate(hold, t)}</small></div><div className="ox-credit-hold-end"><span className="ox-credit-hold-status active">{holdStatusLabel(hold.status, t)}</span><b>{money(hold.amountCents, hold.currencyCode || currency)}</b></div></article>)}</div></div>}{!!holdHistory.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('completedReservations')}</strong><span>{holdHistory.length}</span></div><div className="ox-credit-hold-list">{holdHistory.map((hold) => <article key={hold.id}><div><strong>{holdTitle(hold, t)}</strong><span>{holdSubtitle(hold, t)}</span><small>{holdTerminalDate(hold, t)}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${hold.status}`}>{holdStatusLabel(hold.status, t)}</span><b>{money(hold.amountCents, hold.currencyCode || currency)}</b>{hold.status === 'expired' && hold.kind !== 'reservation' && <button type="button" className="ox-credit-hold-action" onClick={() => reauthorizeHold(hold)} disabled={reauthorizingHoldId === hold.id}>{reauthorizingHoldId === hold.id ? t('reauthorizing') : t('reauthorizeHold')}</button>}</div></article>)}</div></div>}{holdPagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMoreHolds} disabled={loadingMoreHolds || refreshing}><RefreshCw size={14} className={loadingMoreHolds ? 'ox-credit-spin' : ''} /> {loadingMoreHolds ? t('loadingOlderHolds') : t('loadOlderHolds')}</button>}
<div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('authorizationControls')}</p><h2 id="credit-release-heading">{t('unusedAuthorizations')}</h2></div></div><p className="ox-credit-panel-copy">{t('cancelAuthorizationCopy')}</p><div className="ox-credit-release-list">{releasableHolds.map((hold) => <div key={hold.id}><div><strong>{hold.restaurantName || t('partnerRestaurant')}</strong><span>{money(hold.amountCents, hold.currencyCode || currency)} · {holdTerminalDate(hold, t)}</span></div><button type="button" onClick={() => releaseHold(hold)} disabled={releasingHoldId === hold.id}>{releasingHoldId === hold.id ? t('releasing') : t('releaseHold')}</button></div>)}</div>
                    </>
                  ) : (
                    <div className="ox-credit-empty"><Clock3 size={27} /><strong>{t('redesign.noHolds')}</strong><span>{t('redesign.noHoldsCopy')}</span></div>
                  )
                )}
                {activityTab === 'pending' && (
                  pendingTopups.length || failedTopups.length ? (
                    <>
<div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('pendingActivity')}</p><h2 id="credit-pending-topups-heading">{t('pendingTopups')}</h2></div><span className="ox-credit-count">{pendingTopups.length}</span></div><p className="ox-credit-panel-copy">{t('pendingTopupsCopy')}</p><div className="ox-credit-hold-list">{pendingTopups.map((topup) => <article key={topup.id}><div><strong>{money(topup.amountCents, topup.currencyCode || currency)}</strong><span>{topupStatusLabel(topup.status, t)}</span><small>{t('requestedAt', { date: dateTime(topup.createdAt, t) })}{topup.expiresAt ? ` · ${t('expiresAt', { date: dateTime(topup.expiresAt, t) })}` : ''}{topup.fundedByBusinessId && topup.fundingState ? ` · ${t(`walletTopup.fundingState_${topup.fundingState}`)}` : ''}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${topup.status}`}>{topupStatusLabel(topup.status, t)}</span><button type="button" className="ox-credit-detail-link" onClick={() => openTopupDrawer(topup.id)}>{t('viewTopup')}</button></div></article>)}</div>
<div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('pendingActivity')}</p><h2 id="credit-failed-topups-heading">{t('failedTopups')}</h2></div><span className="ox-credit-count">{failedTopups.length}</span></div><p className="ox-credit-panel-copy">{t('failedTopupsCopy')}</p><div className="ox-credit-hold-list">{failedTopups.map((topup) => <article key={topup.id}><div><strong>{money(topup.amountCents, topup.currencyCode || currency)}</strong><span>{topupStatusLabel(topup.status, t)}</span><small>{t('requestedAt', { date: dateTime(topup.createdAt, t) })}{topup.fundedByBusinessId && topup.fundingState ? ` · ${t(`walletTopup.fundingState_${topup.fundingState}`)}` : ''}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${topup.status}`}>{topupStatusLabel(topup.status, t)}</span><button type="button" className="ox-credit-detail-link" onClick={() => openTopupDrawer(topup.id)}>{t('viewTopup')}</button></div></article>)}</div>
                    </>
                  ) : (
                    <div className="ox-credit-empty"><Clock3 size={27} /><strong>{t('redesign.noPendingActivity')}</strong><span>{t('redesign.noPendingActivityCopy')}</span></div>
                  )
                )}
                {activityTab === 'disputes' && (
                  disputes.length ? (
                    <>
<div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('reviewHistory')}</p><h2>{t('yourCreditDisputes')}</h2></div><span className="ox-credit-count">{disputes.length}{disputePagination?.hasMore ? '+' : ''}</span></div><p className="ox-credit-panel-copy">{t('disputesCopy')}</p><div className="ox-credit-dispute-list">{disputes.map((dispute) => <article key={dispute.id}><div><div className="ox-credit-dispute-title"><strong>{dispute.restaurantName || t('ledgerEntry')}</strong><span className={`ox-credit-dispute-status ${dispute.status}`}>{creditStatusLabel(dispute.status, t)}</span></div><span>{disputeReasonLabel(dispute.reasonCode, t)}</span>{dispute.amountCents !== null && dispute.amountCents !== undefined && <small>{money(dispute.amountCents, dispute.currencyCode || currency)} · {transactionLabel({ transactionType: dispute.transactionType }, t)}</small>}<small>{t('opened', { date: dateTime(dispute.openedAt, t), id: dispute.transactionId })}</small><p>{dispute.description}</p>{dispute.resolution && <em>{t('resolution', { value: dispute.resolution })}{dispute.resolvedAt ? ` · ${t('resolvedAt', { date: dateTime(dispute.resolvedAt, t) })}` : ''}</em>}
                  {(dispute.adjustments?.length > 0 || Number(dispute.provisionalCreditCents || 0) > 0 || dispute.resolutionEntries?.compensation) && <div className="ox-credit-dispute-adjustments"><strong>{t('disputeAdjustmentsTitle')}</strong>
                    {Number(dispute.provisionalCreditCents || 0) > 0 && <span>{t('disputeProvisionalCreditLine', { amount: money(dispute.provisionalCreditCents, dispute.currencyCode || currency) })}</span>}
                    {dispute.resolutionEntries?.compensation && <span>{t('disputeCompensationLine', { amount: money(dispute.resolutionEntries.compensation.amountCents, dispute.currencyCode || currency), date: dateTime(dispute.resolutionEntries.compensation.decidedAt, t) })}</span>}
                    {(dispute.adjustments || []).map((adjustment) => <div key={adjustment.id} className="ox-credit-dispute-adjustment"><span>{money(adjustment.amountCents, adjustment.currencyCode || currency)} · {adjustmentStatusLabel(adjustment.status, t)}</span><small>{adjustment.appliedAt ? t('disputeAdjustmentAppliedAt', { date: dateTime(adjustment.appliedAt, t) }) : adjustment.decidedAt ? t('disputeAdjustmentDecidedAt', { date: dateTime(adjustment.decidedAt, t) }) : t('disputeAdjustmentProposedAt', { date: dateTime(adjustment.proposedAt, t) })}</small></div>)}
                  </div>}
                  <div className="ox-credit-dispute-evidence">
                    <button type="button" className="ox-credit-evidence-toggle" onClick={() => toggleDisputeEvidence(dispute)}>{evidenceOpenId === dispute.id ? t('disputeEvidenceHide') : t('disputeEvidenceShow', { count: dispute.evidenceCount || 0 })}</button>
                    {evidenceOpenId === dispute.id && <div className="ox-credit-evidence-body">
                      {evidenceLoadingId === dispute.id ? <span>{t('loadingOlderActivity')}</span> : ((evidenceByDispute[dispute.id] || []).length === 0 ? <span>{t('disputeEvidenceEmpty')}</span> : (evidenceByDispute[dispute.id] || []).map((item) => <div key={item.id} className="ox-credit-evidence-item">{item.kind === 'file' ? <a href={item.downloadUrl} target="_blank" rel="noreferrer">{t('disputeEvidenceDownload', { filename: item.originalFilename })}</a> : <span>{item.note}</span>}{item.kind === 'file' && item.note && <span>{item.note}</span>}<small>{dateTime(item.submittedAt, t)}</small></div>))}
                      {['open', 'in_review'].includes(dispute.status) && <form className="ox-credit-evidence-form" onSubmit={(event) => submitDisputeEvidence(event, dispute)}>
                        <label><span>{t('disputeEvidenceNoteLabel')}</span><textarea value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} maxLength={2000} rows={2} placeholder={t('disputeEvidenceNotePlaceholder')} /></label>
                        <label><span>{t('disputeEvidenceFileLabel')}</span><input type="file" accept="image/*,.pdf,.txt,.doc,.docx" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} /></label>
                        <div><button type="submit" disabled={evidenceSubmitting || (!evidenceNote.trim() && !evidenceFile)}>{evidenceSubmitting ? t('submitting') : t('disputeEvidenceSubmit')}</button></div>
                      </form>}
                    </div>}
                  </div>
                </div></article>)}</div>{disputePagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMoreDisputes} disabled={loadingMoreDisputes}><RefreshCw size={14} className={loadingMoreDisputes ? 'ox-credit-spin' : ''} /> {loadingMoreDisputes ? t('loadingOlderActivity') : t('loadOlderActivity')}</button>}
                    </>
                  ) : (
                    <div className="ox-credit-empty"><ShieldCheck size={27} /><strong>{t('redesign.noDisputes')}</strong><span>{t('redesign.noDisputesCopy')}</span></div>
                  )
                )}
              </section>

              <div className="ox-credit-rail-stack">
                <section className="ox-credit-panel ox-credit-rail-card" aria-labelledby="credit-rail-directory-heading">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('partnerNetwork')}</p><h2 id="credit-rail-directory-heading">{t('whereSpend')}</h2></div><span className="ox-credit-count">{visiblePartners.length}</span></div>
                  {visiblePartners.length ? (
                    <div className="ox-credit-hold-list">{visiblePartners.slice(0, 3).map((partner) => (
                      <article key={partner.partnerId}><div><strong>{partner.restaurantName || t('partnerRestaurant')}</strong><span>{[partner.city, partner.state].filter(Boolean).join(', ') || t('locationNotListed')}</span></div></article>
                    ))}</div>
                  ) : (
                    <div className="ox-credit-empty"><Store size={27} /><strong>{t('noPartnerRestaurants')}</strong><span>{t('creditBecomesSpendable')}</span></div>
                  )}
                  <button type="button" className="ox-credit-secondary-link" onClick={() => openDrawer('directory')}>{t('redesign.browseAllDirectory')} <ArrowUpRight size={15} /></button>
                </section>

                <section className="ox-credit-panel ox-credit-rail-card" aria-labelledby="credit-rail-statements-heading">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('statementArchiveEyebrow')}</p><h2 id="credit-rail-statements-heading">{t('monthlyStatements')}</h2></div><span className="ox-credit-count">{statementPeriods.length}</span></div>
                  <p className="ox-credit-panel-copy">{t('monthlyStatementsCopy')}</p>
                  <button type="button" className="ox-credit-load-more" onClick={() => openDrawer('statements')}>{t('redesign.viewStatements')}</button>
                </section>

                <section className="ox-credit-panel ox-credit-rail-card" aria-labelledby="credit-rail-help-heading">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('redesign.helpEyebrow')}</p><h2 id="credit-rail-help-heading">{t('redesign.helpTitle')}</h2></div></div>
                  <p className="ox-credit-panel-copy">{t('redesign.helpCopy')}</p>
                  <p className="ox-credit-panel-copy"><Link to="/support/escalation" className="ox-credit-detail-link">{t('contactSupport')} <ArrowUpRight size={14} /></Link></p>
                </section>
              </div>
            </div>

            </>
          )}

          <CreditDrawer open={activeDrawer === 'topup'} onClose={closeDrawer} title={t('redesign.addCredit')}>
            {railStatus && !railStatus.enabled && <p className="ox-credit-panel-copy" role="status">{t('pausedBody')}</p>}
            <OxsteedCreditTopupPanel key={drawerTopupId || 'new'} currency={selectedCurrency} disabled={railStatus?.enabled === false} initialTopupId={drawerTopupId} onCredited={() => load({ quiet: true, currencyCode: selectedCurrency })} />
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'send'} onClose={closeDrawer} title={t('transferTitle')}>
            {accountStatus === 'active' && limitSummary?.transfers?.enabled ? (
/* Nov 10 #3: the whole transfer panel is gated on
                transfers.enabled, not just the limits row: a disabled
                transfer rail never shows a transfer form. When the limits
                summary failed to load, limitSummary is null and the panel
                stays hidden (fail closed); the server gate still enforces
                on submit. */
accountStatus === 'active' && limitSummary?.transfers?.enabled && <section className="ox-credit-panel ox-credit-transfer-panel" aria-labelledby="credit-transfer-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('transferEyebrow')}</p><h2 id="credit-transfer-heading">{t('transferTitle')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('transferCopy')}</p><form className="ox-credit-authorize-form" onSubmit={(event) => submitTransfer(event)}><label>{t('transferRecipientLabel')}<input required value={transferRecipientId} onChange={(event) => { setTransferRecipientId(event.target.value); setTransferReview(false); setCreatedTransfer(null); setTransferChallenge(null); setTransferCode(''); scheduleTransferRecipientLookup(event.target.value); }} placeholder={t('redesign.transferRecipientPlaceholder')} /></label>{transferRecipientLoading && <p className="ox-credit-panel-copy" role="status">{t('transferRecipientLookingUp')}</p>}{transferRecipient?.displayName && <p className="ox-credit-panel-copy" role="status">{t('transferRecipientResolved', { name: transferRecipient.displayName })}</p>}{transferRecipientError && <p className="ox-credit-panel-copy" role="alert">{transferRecipientError}</p>}{transferRecipientId.trim() && classifyRecipientInput(transferRecipientId) === 'unknown' && <p className="ox-credit-panel-copy" role="alert">{t('transferRecipientInvalid')}</p>}<label>{t('amount')}<input required inputMode="decimal" value={transferAmount} onChange={onTransferAmountChange} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><label>{t('transferDescriptionLabel')}<input value={transferDescription} onChange={(event) => setTransferDescription(event.target.value)} maxLength={200} placeholder={t('transferDescriptionPlaceholder')} /></label><button type="submit" disabled={transferSubmitting || transferReviewBlocked}>{transferSubmitting ? t('transferringTransfer') : t('transferReviewButton')}</button></form><p className="ox-credit-panel-copy">{t('redesign.transferRecipientHint')}</p>{transferFeeQuoteError && <div className="ox-credit-fee-quote" role="alert"><span>{t('transferFeeQuoteFailed')}</span><span>{transferFeeQuoteError}</span><button type="button" className="ox-credit-refresh" onClick={() => refreshTransferFeeQuote(transferAmount, { immediate: true })}>{t('retry')}</button></div>}{transferFeeQuoteLoading && !transferFeeQuoteError && <div className="ox-credit-fee-quote" role="status"><span>{t('transferFeeQuoteLoading')}</span></div>}{transferFeeQuote && <div className="ox-credit-fee-quote" role="status"><span>{t('transferFeeBreakdown', { fee: money(transferFeeQuote.feeCents, transferFeeQuote.currencyCode), net: money(Math.max(0, (parseCreditMajorAmount(transferAmount, selectedCurrency, railStatus?.currencyMetadata) || 0) - transferFeeQuote.feeCents), transferFeeQuote.currencyCode) })}</span></div>}{transferReview && <div className="ox-credit-created-hold" role="status"><strong>{t('transferConfirmTitle')}</strong><span>{t('transferConfirmCopy', { recipient: transferRecipient?.displayName || transferRecipientId.trim(), amount: money(parseCreditMajorAmount(transferAmount, selectedCurrency, railStatus?.currencyMetadata) || 0, selectedCurrency) })}</span><span>{t('transferRecipientIdDetail', { recipientId: transferRecipientId.trim() })}</span>{transferFeeQuote && <span>{t('transferFeeBreakdown', { fee: money(transferFeeQuote.feeCents, transferFeeQuote.currencyCode), net: money(Math.max(0, (parseCreditMajorAmount(transferAmount, selectedCurrency, railStatus?.currencyMetadata) || 0) - transferFeeQuote.feeCents), transferFeeQuote.currencyCode) })}</span>}<button type="button" onClick={(event) => submitTransfer(event)} disabled={transferSubmitting || transferConfirmBlocked}>{transferSubmitting ? t('transferringTransfer') : t('transferConfirmButton')}</button><button type="button" onClick={() => setTransferReview(false)}>{t('transferEditButton')}</button></div>}{transferChallenge && <form className="ox-credit-stepup-form" onSubmit={confirmTransferStepup}><strong>{t('verificationRequired')}</strong><span>{t('verificationCodeSentCopy')}</span><label>{t('verificationCode')}<input required inputMode="numeric" value={transferCode} onChange={(event) => setTransferCode(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('verificationCodePlaceholder')} /></label><button type="submit" disabled={transferSubmitting}>{transferSubmitting ? t('transferConfirming') : t('transferConfirmStepup')}</button></form>}{createdTransfer?.transaction?.id && <div className="ox-credit-created-hold"><strong>{t('transferSent')}</strong><span>{t('transferSentCopy', { amount: money(createdTransfer.transaction.amountCents, createdTransfer.transaction.currencyCode) })}</span><code>{createdTransfer.transaction.id}</code></div>}</section>
              
            ) : (
              <p className="ox-credit-panel-copy" role="status">{t('redesign.transfersUnavailable')}</p>
            )}
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'withdraw'} onClose={closeDrawer} title={t('withdrawToBank')}>
            {accountStatus === 'active' ? (
accountStatus === 'active' && <section className="ox-credit-panel ox-credit-withdraw-panel" aria-labelledby="credit-withdraw-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('moneyOutEyebrow')}</p><h2 id="credit-withdraw-heading">{t('withdrawToBank')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('withdrawCopy')}</p><form className="ox-credit-authorize-form" onSubmit={(event) => submitWithdrawal(event)}><label>{t('amount')}<input required inputMode="decimal" value={withdrawalAmount} onChange={onWithdrawalAmountChange} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><button type="submit" disabled={withdrawalSubmitting}>{withdrawalSubmitting ? t('requestingWithdrawal') : t('requestWithdrawal')}</button></form>{withdrawalFeeQuote && <div className="ox-credit-fee-quote" role="status"><span>{t('withdrawalFeeBreakdown', { fee: money(withdrawalFeeQuote.feeCents, withdrawalFeeQuote.currencyCode), net: money(Math.max(0, (parseCreditMajorAmount(withdrawalAmount, selectedCurrency, railStatus?.currencyMetadata) || 0) - withdrawalFeeQuote.feeCents), withdrawalFeeQuote.currencyCode) })}</span></div>}{withdrawalChallenge && <form className="ox-credit-stepup-form" onSubmit={confirmWithdrawalStepup}><strong>{t('verificationRequired')}</strong><span>{t('verificationCodeSentCopy')}</span><label>{t('verificationCode')}<input required inputMode="numeric" value={withdrawalCode} onChange={(event) => setWithdrawalCode(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('verificationCodePlaceholder')} /></label><button type="submit" disabled={withdrawalSubmitting}>{withdrawalSubmitting ? t('confirmingWithdrawal') : t('confirmWithdrawal')}</button></form>}{createdWithdrawal?.id && <div className="ox-credit-created-hold"><strong>{t('withdrawalRequested')}</strong><span>{t('withdrawalRequestedCopy', { amount: money(createdWithdrawal.amountCents, createdWithdrawal.currencyCode), net: money(createdWithdrawal.netAmountCents, createdWithdrawal.currencyCode) })}</span><code>{createdWithdrawal.id}</code></div>}{!!withdrawals.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('withdrawalHistory')}</strong><span>{withdrawals.length}</span></div><div className="ox-credit-hold-list">{withdrawals.map((withdrawal) => <article key={withdrawal.id}><div><strong>{money(withdrawal.amountCents, withdrawal.currencyCode)}</strong><span>{t('withdrawalStatusLabel', { status: withdrawal.status })}{withdrawal.feeCents ? ` · ${t('feeLabel', { fee: money(withdrawal.feeCents, withdrawal.currencyCode) })}` : ''}</span><small>{dateTime(withdrawal.createdAt, t)}</small></div><div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${withdrawal.status}`}>{withdrawal.status}</span>{['requested'].includes(withdrawal.status) && <button type="button" onClick={() => cancelWithdrawal(withdrawal)} disabled={cancellingWithdrawalId === withdrawal.id}>{cancellingWithdrawalId === withdrawal.id ? t('cancelling') : t('cancel')}</button>}</div></article>)}</div></div>}</section>

              
            ) : (
              <p className="ox-credit-panel-copy" role="status">{t('redesign.moneyOutBlockedAccount')}</p>
            )}
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'pay'} onClose={closeDrawer} title={t('authorizeInStorePayment')}>
            {accountStatus === 'active' && partners.length > 0 ? (
accountStatus === 'active' && partners.length > 0 && <section className="ox-credit-panel ox-credit-authorize-panel" aria-labelledby="credit-authorize-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('customerAuthorization')}</p><h2 id="credit-authorize-heading">{t('authorizeInStorePayment')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('authorizeCopy')}</p><form className="ox-credit-authorize-form" onSubmit={submitHold}><label>{t('restaurant')}<select required value={holdPartnerId} onChange={(event) => { const nextPartnerId = event.target.value; const nextPartner = partners.find((partner) => String(partner.partnerId) === String(nextPartnerId)); setHoldPartnerId(nextPartnerId); setHoldOrderType(nextPartner?.allowedOrderTypes?.[0] || 'pickup'); }}><option value="">{t('selectRestaurant')}</option>{partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName}{partner.city ? ` · ${partner.city}` : ''}</option>)}</select></label><label>{t('orderType')}<select required value={holdOrderType} onChange={(event) => setHoldOrderType(event.target.value)}>{holdOrderTypes.map((type) => <option key={type} value={type}>{localizeCreditOrderType(type, t)}</option>)}</select></label><label>{t('amount')}<input required inputMode="decimal" value={holdAmount} onChange={(event) => setHoldAmount(event.target.value)} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><label>{t('purposeOptional')}<input value={holdPurpose} onChange={(event) => setHoldPurpose(event.target.value)} maxLength={100} placeholder={t('restaurantPurchase')} /></label><button type="submit" disabled={holdSubmitting}>{holdSubmitting ? t('creatingAuthorization') : t('createAuthorization')}</button></form>{createdHold?.id && <div className="ox-credit-created-hold"><strong>{t('holdIdInstruction')}</strong><code>{createdHold.id}</code><span>{t('holdDetails', { amount: money(createdHold.amountCents, createdHold.currencyCode || currency), date: dateTime(createdHold.expiresAt, t) })}</span><button type="button" onClick={copyHoldId}>{t('copyHoldId')}</button></div>}</section>

              
            ) : (
              <p className="ox-credit-panel-copy" role="status">{t('redesign.payUnavailable')}</p>
            )}
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'convert'} onClose={closeDrawer} title={t('convertCredit')}>
            {accountStatus === 'active' ? (
              <>
                <p className="ox-credit-panel-copy">{t('conversionCopy')}</p>
                {!conversionTargetOptions.length ? (
                  <p className="ox-credit-panel-copy" role="status">{t('redesign.noConversionTargets')}</p>
                ) : (
                  <form className="ox-credit-authorize-form" onSubmit={requestConversionQuote}>
                    <label>{t('sourceAmount')}<input required inputMode="decimal" value={conversionAmount} onChange={(event) => { setConversionAmount(event.target.value); setConversionQuote(null); setConversionQuoteId(''); }} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label>
                    <label>{t('redesign.targetCurrency')}<select required value={conversionTargetCurrency} onChange={(event) => setConversionTargetCurrency(event.target.value)}><option value="">{t('redesign.selectCurrency')}</option>{conversionTargetOptions.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                    <button type="submit" disabled={conversionQuoteLoading || !conversionTargetCurrency}>{conversionQuoteLoading ? t('redesign.requestingQuote') : t('redesign.getQuote')}</button>
                  </form>
                )}
                {conversionQuoteError && <div className="ox-credit-fee-quote" role="alert"><span>{conversionQuoteError}</span></div>}
                {conversionQuote && (
                  <div className="ox-credit-created-hold" role="status">
                    <strong>{t('redesign.quoteReady')}</strong>
                    <span>{t('redesign.quoteDetails', { source: money(conversionQuote.sourceAmountMinorUnits, conversionQuote.sourceCurrencyCode), target: money(conversionQuote.targetAmountMinorUnits, conversionQuote.targetCurrencyCode), fee: money(conversionQuote.feeAmountMinorUnits, conversionQuote.sourceCurrencyCode), expires: dateTime(conversionQuote.expiresAt, t) })}</span>
                    <code>{conversionQuote.id}</code>
                  </div>
                )}
                {conversionQuote && (
                  <form className="ox-credit-confirm-form" onSubmit={submitConversion}>
                    <button type="submit" disabled={conversionSubmitting}>{conversionSubmitting ? t('convertingCredit') : t('convertCredit')}</button>
                  </form>
                )}
                {createdConversion?.id && (
                  <div className="ox-credit-created-hold">
                    <strong>{t('conversionCompleted')}</strong>
                    <span>{t('conversionDetails', { source: money(createdConversion.sourceAmountMinorUnits, createdConversion.sourceCurrencyCode), target: money(createdConversion.targetAmountMinorUnits, createdConversion.targetCurrencyCode) })}</span>
                    <code>{createdConversion.id}</code>
                  </div>
                )}
                <details className="ox-credit-admin-quote">
                  <summary>{t('redesign.adminQuoteTitle')}</summary>
                  <p className="ox-credit-panel-copy">{t('redesign.adminQuoteCopy')}</p>
                  <form className="ox-credit-authorize-form" onSubmit={submitConversion}>
                    <label>{t('quoteId')}<input required inputMode="numeric" value={conversionQuoteId} onChange={(event) => { setConversionQuoteId(event.target.value); setConversionQuote(null); }} placeholder={t('quoteIdPlaceholder')} /></label>
                    <button type="submit" disabled={conversionSubmitting}>{conversionSubmitting ? t('convertingCredit') : t('convertCredit')}</button>
                  </form>
                </details>
              </>
            ) : (
              <p className="ox-credit-panel-copy" role="status">{t('redesign.moneyOutBlockedAccount')}</p>
            )}
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'restaurantConvert'} onClose={closeDrawer} title={t('convertRestaurantCredit')}>
            {accountStatus === 'active' ? (
accountStatus === 'active' && <section className="ox-credit-panel ox-credit-restaurant-conversion-panel" aria-labelledby="credit-restaurant-conversion-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('restaurantCreditEyebrow')}</p><h2 id="credit-restaurant-conversion-heading">{t('convertRestaurantCredit')}</h2></div><ShieldCheck size={20} /></div><p className="ox-credit-panel-copy">{t('restaurantConversionCopy')}</p><form className="ox-credit-authorize-form" onSubmit={submitRestaurantConversion}><label>{t('direction')}<select value={restaurantConversionDirection} onChange={(event) => { setRestaurantConversionDirection(event.target.value); setRestaurantConversionRestaurantId(''); }}><option value="to_restaurant">{t('directionToRestaurant')}</option><option value="from_restaurant">{t('directionFromRestaurant')}</option></select></label><label>{t('restaurant')}<select required value={restaurantConversionRestaurantId} onChange={(event) => setRestaurantConversionRestaurantId(event.target.value)} disabled={noConversionEligiblePartners}><option value="">{t('selectRestaurant')}</option>{conversionEligiblePartners.map((partner) => <option key={partner.partnerId} value={partner.restaurantId || partner.partnerId}>{partner.restaurantName}{partner.city ? ` · ${partner.city}` : ''}</option>)}</select></label>{noConversionEligiblePartners && <p className="ox-credit-panel-copy" role="status">{t('restaurantConversionNoneEligible')}</p>}<label>{t('amount')}<input required inputMode="decimal" value={restaurantConversionAmount} onChange={(event) => { setRestaurantConversionAmount(event.target.value); setCreatedRestaurantConversion(null); }} placeholder={amountPlaceholder(currency, railStatus?.currencyMetadata)} /></label><button type="submit" disabled={restaurantConversionSubmitting || noConversionEligiblePartners}>{restaurantConversionSubmitting ? t('convertingRestaurantCredit') : t('convertRestaurantCredit')}</button></form>{createdRestaurantConversion?.id && <div className="ox-credit-created-hold"><strong>{t('restaurantConversionCompleted')}</strong><span>{t('restaurantConversionDetails', { source: money(createdRestaurantConversion.sourceAmountCents, createdRestaurantConversion.currencyCode), target: money(createdRestaurantConversion.convertedAmountCents, createdRestaurantConversion.currencyCode) })}</span><code>{createdRestaurantConversion.id}</code></div>}</section>

                  
            ) : (
              <p className="ox-credit-panel-copy" role="status">{t('redesign.moneyOutBlockedAccount')}</p>
            )}
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'cards'} onClose={closeDrawer} title={t('cards.title')}>
            <CreditCardsDrawer currencyCode={selectedCurrency} />
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'account'} onClose={closeDrawer} title={t('redesign.cardsAndAccount')}>
            {accountDetailsLoading ? (
              <div className="ox-credit-loading" role="status" aria-live="polite">{t('loadingAccount')}</div>
            ) : accountDetails ? (
              <dl className="ox-credit-details-list">
                <div><dt>{t('redesign.accountNumber')}</dt><dd>{accountDetails.accountNumber || '—'}</dd><button type="button" className="ox-credit-detail-link" onClick={() => copyText(accountDetails.accountNumber, t('redesign.copied'))}>{t('redesign.copy')}</button></div>
                <div><dt>{t('redesign.memberCode')}</dt><dd>{accountDetails.memberCode || '—'}</dd><button type="button" className="ox-credit-detail-link" onClick={() => copyText(accountDetails.memberCode, t('redesign.copied'))}>{t('redesign.copy')}</button></div>
                <div><dt>{t('redesign.accountHolder')}</dt><dd>{accountDetails.accountHolderName || '—'}</dd></div>
              </dl>
            ) : (
              <div className="ox-credit-empty"><ShieldCheck size={27} /><strong>{t('redesign.accountDetailsUnavailable')}</strong></div>
            )}
            <p className="ox-credit-panel-copy">{t('redesign.accountNumberNote')}</p>
            {accountDetails && !letterChallenge && (
              <button type="button" className="ox-credit-refresh" onClick={requestAccountLetterChallenge} disabled={letterBusy}>{letterBusy ? t('redesign.requestingCode') : t('redesign.downloadAccountLetter')}</button>
            )}
            {accountDetails && letterChallenge && (
              <form className="ox-credit-stepup-form" onSubmit={confirmAccountLetter}>
                <strong>{t('verificationRequired')}</strong>
                <span>{t('verificationCodeSentCopy')}</span>
                <label>{t('verificationCode')}<input required inputMode="numeric" value={letterCode} onChange={(event) => setLetterCode(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('verificationCodePlaceholder')} /></label>
                <button type="submit" disabled={letterBusy}>{letterBusy ? t('confirmingWithdrawal') : t('redesign.downloadLetter')}</button>
              </form>
            )}
{consentHistory && <section className="ox-credit-panel" aria-labelledby="credit-consent-history-heading"><div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('consentHistory.eyebrow')}</p><h2 id="credit-consent-history-heading">{t('consentHistory.title')}</h2></div></div><p className="ox-credit-panel-copy">{t('consentHistory.copy')}</p>{!consentHistory.consents.length && !consentHistory.disclosures.length ? <div className="ox-credit-empty"><ShieldCheck size={27} /><strong>{t('consentHistory.empty')}</strong></div> : <>{!!consentHistory.consents.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('consentHistory.consentsTitle')}</strong><span>{consentHistory.consents.length}</span></div><div className="ox-credit-hold-list">{consentHistory.consents.map((row, index) => <article key={`${row.consentType}-${row.acceptedAt}-${index}`}><div><strong>{consentTypeLabel(row.consentType, t)}</strong><span>{t('consentHistory.versionLabel', { version: row.version })}</span><small>{t('consentHistory.acceptedAtLabel', { date: dateTime(row.acceptedAt, t) })}</small></div></article>)}</div></div>}{!!consentHistory.disclosures.length && <div className="ox-credit-hold-group"><div className="ox-credit-hold-group-title"><strong>{t('consentHistory.disclosuresTitle')}</strong><span>{consentHistory.disclosures.length}</span></div><div className="ox-credit-hold-list">{consentHistory.disclosures.map((row, index) => <article key={`${row.disclosureKind}-${row.acceptedAt}-${index}`}><div><strong>{disclosureKindLabel(row.disclosureKind, t)}</strong><span>{row.version !== null && row.version !== undefined ? t('consentHistory.versionLabel', { version: row.version }) : t('consentHistory.versionPending')}</span><small>{t('consentHistory.acceptedAtLabel', { date: dateTime(row.acceptedAt, t) })}</small></div></article>)}</div></div>}</>}</section>}
          <section className="ox-credit-panel ox-credit-error-policy" aria-labelledby="credit-error-policy-heading">
            <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('errorPolicyEyebrow')}</p><h2 id="credit-error-policy-heading">{t('errorPolicyTitle')}</h2></div><ShieldCheck size={20} /></div>
            <p className="ox-credit-panel-copy">{t('errorPolicyIntro')}</p>
            <ul className="ox-credit-policy-list">
              <li><strong>{t('errorPolicyReportTitle')}</strong><span>{t('errorPolicyReportBody')}</span></li>
              <li><strong>{t('errorPolicyInfoTitle')}</strong><span>{t('errorPolicyInfoBody')}</span></li>
              <li><strong>{t('errorPolicyReviewTitle')}</strong><span>{t('errorPolicyReviewBody')}</span></li>
              <li><strong>{t('errorPolicyOutcomeTitle')}</strong><span>{t('errorPolicyOutcomeBody')}</span></li>
            </ul>
            <p className="ox-credit-panel-copy"><Link to="/support/escalation" className="ox-credit-detail-link">{t('contactSupport')} <ArrowUpRight size={14} /></Link></p>
          </section>

          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'directory'} onClose={closeDrawer} title={t('whereSpend')}>
<section className="ox-credit-panel">
                  <div className="ox-credit-panel-heading"><div><p className="ox-credit-eyebrow">{t('partnerNetwork')}</p><h2>{t('whereSpend')}</h2></div><span className="ox-credit-count">{visiblePartners.length}{visiblePartners.length !== partners.length ? ` / ${partners.length}` : ''}</span></div>
                  <p className="ox-credit-panel-copy">{t('partnerNetworkCopy')}</p>
                  {accountStatus === 'active' && <form className="ox-credit-partner-filters" onSubmit={submitPartnerFilters}><label><Search size={15} /><input aria-label={t('searchEligible')} value={partnerSearch} onChange={(event) => setPartnerSearch(event.target.value)} placeholder={t('searchRestaurantCity')} /></label><select aria-label={t('searchEligible')} value={partnerOrderType} onChange={(event) => setPartnerOrderType(event.target.value)}><option value="">{t('allOrderTypes')}</option>{partnerOrderTypes.map((type) => <option key={type} value={type}>{localizeCreditOrderType(type, t)}</option>)}</select><button type="submit" className="ox-credit-partner-search" disabled={refreshing}>{refreshing ? t('searching') : t('search')}</button></form>}
                  {accountStatus !== 'active' || (!partners.length && !hasPartnerFilters) ? <div className="ox-credit-empty"><Store size={27} />{accountStatus !== 'active' ? <><strong>{t('creditAccountStatus', { status: creditStatusLabel(accountStatus, t) })}</strong><span>{t('partnerHidden')}</span>{account?.statusReason && <span>{t('creditAccountStatusReason', { reason: account.statusReason })}</span>}{account?.statusChangedAt && <span>{t('creditAccountStatusChangedAt', { date: dateTime(account.statusChangedAt, t) })}</span>}<CreditDomainRecoveryLinks /></> : <><strong>{t('noPartnerRestaurants')}</strong><span>{t('creditBecomesSpendable')}</span></>}</div> : !visiblePartners.length ? <div className="ox-credit-empty"><Search size={27} /><strong>{t('noEligibleMatch')}</strong><span>{t('tryAnother')}</span><button type="button" className="ox-credit-clear-filters" onClick={clearPartnerFilters}>{t('clearFilters')}</button></div> : <><div className="ox-credit-partner-list">{visiblePartners.map((partner) => <article className="ox-credit-partner" key={partner.partnerId}><div className="ox-credit-partner-mark">{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <Building2 size={21} />}</div><div className="ox-credit-partner-content"><div className="ox-credit-partner-title"><div><h3>{partner.restaurantName || t('partnerRestaurant')}</h3><span>{[partner.city, partner.state].filter(Boolean).join(', ') || t('locationNotListed')}</span></div><span className="ox-credit-eligible"><ShieldCheck size={14} /> {t('eligible')}</span></div><div className="ox-credit-tags">{(partner.allowedOrderTypes || []).map((type) => <span key={type}>{localizeCreditOrderType(type, t)}</span>)}{partner.hasCustomerEntitlement && <span>{t('customerEntitlement')}</span>}</div><p>{partner.customerTerms || t('termsFallback')}</p><div className="ox-credit-partner-meta"><span>{geographySummary(partner, t)}</span>{partnerLimit(partner, t)}{partner.dailyCustomerLimitCents ? <span>{t('dailyLimit', { amount: money(partner.dailyCustomerLimitCents, partner.currencyCode) })}</span> : null}{partner.lifetimeCustomerLimitCents ? <span>{t('lifetimeLimit', { amount: money(partner.lifetimeCustomerLimitCents, partner.currencyCode) })}</span> : null}{partner.allowedCategories?.length ? <span>{t('coveredCategories', { count: partner.allowedCategories.length })}</span> : null}</div>{partner.restaurantId ? <Link className="ox-credit-partner-link" to={`/restaurants/r/${partner.restaurantId}`}>{t('openMenu')} <ArrowUpRight size={14} /></Link> : null}</div></article>)}</div>{partnerPagination?.hasMore && <button type="button" className="ox-credit-load-more" onClick={loadMorePartners} disabled={loadingMorePartners}>{loadingMorePartners ? t('loadingMoreRestaurants') : t('showMoreRestaurants')}</button>}</>}
                  <Link to="/restaurants" className="ox-credit-secondary-link">{t('browseParticipating')} <ArrowUpRight size={15} /></Link>
                </section>

                
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'statements'} onClose={closeDrawer} title={t('monthlyStatements')}>
            {statementPeriods.length ? (
!!statementPeriods.length && (
                  <section className="ox-credit-panel ox-credit-statements-panel" aria-labelledby="credit-statements-heading">
                    <div className="ox-credit-panel-heading">
                      <div><p className="ox-credit-eyebrow">{t('statementArchiveEyebrow')}</p><h2 id="credit-statements-heading">{t('monthlyStatements')}</h2></div>
                      <button type="button" className="ox-credit-load-more" onClick={() => setStatementPeriodsOpen((open) => !open)} aria-expanded={statementPeriodsOpen}>
                        {statementPeriodsOpen ? t('hideStatements') : t('showStatements')}
                      </button>
                    </div>
                    <p className="ox-credit-panel-copy">{t('monthlyStatementsCopy')}</p>
                    {statementPeriodsOpen && (() => {
                      const byYear = {};
                      statementPeriods.forEach((period) => {
                        (byYear[period.year] = byYear[period.year] || []).push(period);
                      });
                      return Object.keys(byYear).sort((a, b) => Number(b) - Number(a)).map((year) => (
                        <div key={year} className="ox-credit-statement-year">
                          <strong className="ox-credit-statement-year-label">{year}</strong>
                          {byYear[year].map((period) => {
                            // An issued original exists for this month: View
                            // opens the immutable document (with amendment
                            // state) and Download serves it, instead of
                            // re-rendering the live interim report.
                            const issued = issuedStatements[`${period.year}-${period.month}`];
                            return (
                              <div key={`${period.year}-${period.month}`} className="ox-credit-statement-row">
                                <span>{new Date(period.year, period.month - 1, 1).toLocaleDateString(t.lng || undefined, { month: 'long' })} · {t('transactionsInMonth', { count: period.transactionCount })}</span>
                                {issued && (
                                  <span className={`ox-credit-statement-badge${issued.corrected || issued.superseded ? ' amended' : ''}`}>
                                    {issued.corrected || issued.superseded ? t('statementAmended') : t('statementIssued')}
                                  </span>
                                )}
                                <div className="ox-credit-statement-actions">
                                  {issued ? (
                                    <>
                                      <Link
                                        className="ox-credit-detail-link"
                                        to={`/oxsteed-credit/statements/archive?currency=${encodeURIComponent(selectedCurrency)}&year=${period.year}&month=${period.month}`}
                                      >{t('viewStatement')}</Link>
                                      <button type="button" className="ox-credit-download" onClick={() => downloadIssuedStatement(issued, period)} disabled={downloading}><Download size={14} /> {t('downloadIssued')}</button>
                                    </>
                                  ) : (
                                    <>
                                      <button type="button" className="ox-credit-detail-link" onClick={() => viewPeriodStatement(period)}>{t('viewStatement')}</button>
                                      <button type="button" className="ox-credit-download" onClick={() => downloadPeriodStatement(period)} disabled={downloading}><Download size={14} /> {t('downloadCsv')}</button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ));
                    })()}
                  </section>
                )

                
            ) : (
              <div className="ox-credit-empty"><Receipt size={27} /><strong>{t('redesign.noStatements')}</strong><span>{t('redesign.noStatementsCopy')}</span></div>
            )}
          </CreditDrawer>

          <CreditDrawer open={activeDrawer === 'more'} onClose={closeDrawer} title={t('redesign.more')}>
            <div className="ox-credit-menu-list">
              <button type="button" disabled={Boolean(moneyOutReason)} onClick={() => openDrawer('convert')}>{t('convertCredit')}</button>
              <button type="button" disabled={Boolean(moneyOutReason)} onClick={() => openDrawer('restaurantConvert')}>{t('convertRestaurantCredit')}</button>
              <button type="button" onClick={() => openDrawer('statements')}>{t('monthlyStatements')}</button>
              <button type="button" onClick={() => openDrawer('account')}>{t('redesign.cardsAndAccount')}</button>
            </div>
            {moneyOutReason && <p className="ox-credit-blocked-note" role="status">{t(moneyOutReason === 'railPaused' ? 'redesign.moneyOutBlockedRail' : 'redesign.moneyOutBlockedAccount')}</p>}
          </CreditDrawer>

          <p className="ox-credit-footnote" role="note"><ShieldCheck size={14} /> <strong>{t('disclaimerTitle')}</strong> {t('disclaimerBody')}</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
