import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCodeStyling from 'qr-code-styling';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  CreditCard,
  History,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import {
  cancelFoodWalletCreditRequest,
  cancelFoodWalletPaymentSession,
  createFoodWalletPaymentSession,
  createRestaurantTopupIntent,
  formatFoodMoney,
  getFoodRestaurant,
  getMyFoodRestaurantWallet,
  getRestaurantTopup,
  getRestaurantTopupEligibility,
  issueRestaurantTopupStepupChallenge,
  listFoodWalletCreditRequests,
  listFoodWalletHolds,
  listFoodWalletTransfers,
  listMyFoodRestaurantWallets,
  releaseFoodWalletHold,
  requestFoodWalletCredit,
  transferFoodWalletCredit,
  uploadFoodAsset,
} from '../../api/food';
import './RestaurantCreditPage.css';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { createStableIdempotencyKeyStore } from '../../lib/idempotency';

const TABS = ['activity', 'requests'];

function parseAmountCents(value, currency) {
  return parseCreditMajorAmount(value, currency) || 0;
}

function localizeStatus(t, value) {
  const keyByStatus = {
    active: 'activeStatus',
    open: 'openStatus',
    suspended: 'suspendedStatus',
    closed: 'closedStatus',
    under_review: 'underReviewStatus',
    resolved: 'resolvedStatus',
    rejected: 'rejectedStatus',
    pending: 'partnerLabelPending',
    approved: 'partnerLabelApproved',
    paid: 'partnerLabelPaid',
    disputed: 'partnerLabelDisputed',
    voided: 'partnerLabelVoided',
    reversed: 'partnerLabelReversed',
  };
  const normalized = String(value || '').trim().toLowerCase();
  return keyByStatus[normalized] ? t(keyByStatus[normalized]) : (value || t('statusUnknown'));
}

function formatDate(value, language, fallback = 'Not available') {
  return formatCreditDateTime(value, fallback, language);
}

function walletAvailableCents(wallet) {
  const balance = Number(wallet?.balanceCents || 0);
  const reserved = Number(wallet?.reservedCents || 0);
  return Number(wallet?.availableBalanceCents ?? Math.max(0, balance - reserved));
}

function WalletQr({ value }) {
  const { t } = useTranslation('credit');
  const container = useRef(null);

  useEffect(() => {
    if (!container.current || !value) return undefined;
    container.current.innerHTML = '';
    const qr = new QRCodeStyling({
      width: 240,
      height: 240,
      data: value,
      margin: 8,
      dotsOptions: { color: '#10253f', type: 'rounded' },
      cornersSquareOptions: { color: '#f28a1b', type: 'extra-rounded' },
      backgroundOptions: { color: '#ffffff' },
    });
    qr.append(container.current);
    return () => {
      if (container.current) container.current.innerHTML = '';
    };
  }, [value]);

  return <div ref={container} className="credit-qr" aria-label={t('restaurantWallet.paymentQrAria')} />;
}

function Modal({ title, subtitle, onClose, children }) {
  const { t } = useTranslation('credit');
  return (
    <div className="credit-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="credit-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="credit-modal-close" onClick={onClose} aria-label={t('restaurantWallet.close')}>
          <X size={20} />
        </button>
        <p className="credit-eyebrow">{t('restaurantWallet.restaurantCredit')}</p>
        <h2>{title}</h2>
        {subtitle && <p className="credit-modal-subtitle">{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="credit-empty">
      <History size={28} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export default function RestaurantCreditPage() {
  const { t } = useTranslation('credit');
  const { t: guideT } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRestaurantId = searchParams.get('restaurantId');
  const [wallets, setWallets] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [topupEligibility, setTopupEligibility] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [holds, setHolds] = useState([]);
  const [activeTab, setActiveTab] = useState('activity');
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const selectedRestaurantId = requestedRestaurantId || wallets[0]?.restaurantId || null;

  const loadWallets = useCallback(async () => {
    const result = await listMyFoodRestaurantWallets();
    setWallets(Array.isArray(result) ? result : []);
    return result;
  }, []);

  const loadSelectedWallet = useCallback(async (restaurantId, { quiet = false } = {}) => {
    if (!restaurantId) {
      setWallet(null);
      setRestaurant(null);
      setTopupEligibility(null);
      setTransfers([]);
      setRequests([]);
      setHolds([]);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const [walletResult, transferResult, requestResult, holdResult, restaurantResult, topupEligibilityResult] = await Promise.all([
        getMyFoodRestaurantWallet(restaurantId).catch(() => null),
        listFoodWalletTransfers(restaurantId),
        listFoodWalletCreditRequests(restaurantId),
        listFoodWalletHolds(restaurantId),
        getFoodRestaurant(restaurantId).catch(() => null),
        getRestaurantTopupEligibility(restaurantId).then((data) => data?.eligibility || null).catch(() => null),
      ]);
      setWallet(walletResult);
      setTransfers(transferResult);
      setRequests(requestResult);
      setHolds(holdResult);
      setRestaurant(restaurantResult?.restaurant || restaurantResult || null);
      setTopupEligibility(topupEligibilityResult);
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.loadFailed')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWallets()
      .then((result) => {
        if (!active) return;
        if (!requestedRestaurantId && result?.[0]?.restaurantId) {
          setSearchParams({ restaurantId: String(result[0].restaurantId) }, { replace: true });
        } else if (!requestedRestaurantId && !result?.length) {
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setLoading(false);
          toast.error(safeCreditErrorMessage(error, t('restaurantWallet.walletsLoadFailed')));
        }
      });
    return () => { active = false; };
  }, [loadWallets, requestedRestaurantId, setSearchParams, t]);

  useEffect(() => {
    if (selectedRestaurantId) loadSelectedWallet(selectedRestaurantId);
  }, [loadSelectedWallet, selectedRestaurantId]);

  const displayName = wallet?.restaurantName || restaurant?.display_name || restaurant?.displayName || 'Restaurant';
  const currency = wallet?.currencyCode || restaurant?.currency_code || restaurant?.currencyCode || 'USD';
  const reservedCents = Number(wallet?.reservedCents || 0);
  const availableCents = walletAvailableCents(wallet);
  const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];

  const activeHolds = useMemo(() => holds.filter((hold) => hold.status === 'active'), [holds]);

  // The Add-money button only renders when OxSteed has approved this
  // restaurant for customer card top-ups (fail closed on the client too:
  // the server re-checks approval on intent creation and at webhook time).
  const topupApproved = topupEligibility?.status === 'approved';

  const refresh = async () => {
    if (!selectedRestaurantId) return;
    setRefreshing(true);
    await Promise.all([loadWallets(), loadSelectedWallet(selectedRestaurantId, { quiet: true })]);
  };

  const selectRestaurant = (event) => {
    setSearchParams({ restaurantId: event.target.value });
  };

  const releaseHold = async (hold) => {
    try {
      await releaseFoodWalletHold(selectedRestaurantId, hold.id);
      toast.success(t('restaurantWallet.reservationReleased'));
      await refresh();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.releaseFailed')));
    }
  };

  const cancelRequest = async (request) => {
    try {
      await cancelFoodWalletCreditRequest(selectedRestaurantId, request.id);
      toast.success(t('restaurantWallet.requestCancelled'));
      await refresh();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.cancelRequestFailed')));
    }
  };

  return (
    <div className="credit-page-shell">
      <PageMeta title={t('restaurantWallet.title')} description={t('restaurantWallet.description')} />
      <Navbar />
      <main className="credit-page">
        <header className="credit-hero">
          <div>
            <Link to="/restaurants" className="credit-back"><ArrowLeft size={16} /> {t('restaurantWallet.back')}</Link>
            <p className="credit-eyebrow">{t('restaurantWallet.eyebrow')}</p>
            <h1>{t('restaurantWallet.title')}</h1>
            <p>{t('restaurantWallet.scopeDescription')}</p>
          </div>
          <div className="credit-hero-actions">
            <Link to="/oxsteed-credit" className="credit-icon-button">{t('creditProductName')}</Link>
            {wallets.length > 0 && (
              <label>
                <span>{t('restaurantWallet.restaurant')}</span>
                <select value={selectedRestaurantId || ''} onChange={selectRestaurant}>
                  {wallets.map((entry) => (
                    <option key={entry.restaurantId} value={entry.restaurantId}>{entry.restaurantName}</option>
                  ))}
                  {requestedRestaurantId && !wallets.some((entry) => String(entry.restaurantId) === String(requestedRestaurantId)) && (
                    <option value={requestedRestaurantId}>{displayName}</option>
                  )}
                </select>
              </label>
            )}
            <button type="button" className="credit-icon-button" onClick={refresh} disabled={refreshing || !selectedRestaurantId}>
              <RefreshCw size={18} className={refreshing ? 'credit-spin' : ''} /> {t('restaurantWallet.refresh')}
            </button>
          </div>
        </header>
        <nav className="credit-guide-links" aria-label={guideT('experienceGuides.relatedAria', { defaultValue: 'Related OxSteed experiences' })}>
          <Link to="/how-it-works/restaurant-credit">{guideT('experienceGuides.areas.restaurantCredit.title', { defaultValue: 'Restaurant Credit' })}</Link>
          <Link to="/how-it-works/credit">{guideT('experienceGuides.areas.credit.title', { defaultValue: 'OxSteed Credit' })}</Link>
          <Link to="/how-it-works/food">{guideT('experienceGuides.areas.food.title', { defaultValue: 'Local Food Directory' })}</Link>
        </nav>

        {loading ? (
          <div className="credit-loading"><RefreshCw className="credit-spin" /> {t('restaurantWallet.loading')}</div>
        ) : !selectedRestaurantId ? (
          <EmptyState title={t('restaurantWallet.noSelected')} detail={t('restaurantWallet.noSelectedDetail')} />
        ) : (
          <>
            <section className="credit-balance-card">
              <div className="credit-balance-heading">
                <div className="credit-restaurant-mark"><Wallet size={26} /></div>
                <div>
                  <span>{displayName}</span>
                  <strong>{wallet ? formatFoodMoney(availableCents, currency) : formatFoodMoney(0, currency)}</strong>
                  <small>{t('restaurantWallet.available')}</small>
                </div>
                <span className={`credit-status credit-status-${wallet?.status || 'new'}`}>{wallet?.status ? localizeStatus(t, wallet.status) : t('restaurantWallet.noWallet')}</span>
              </div>
              {reservedCents > 0 && (
                <div className="credit-balance-reserved">
                  <Clock3 size={16} /> {t('restaurantWallet.reservedMessage', { amount: formatFoodMoney(reservedCents, currency) })}
                </div>
              )}
              <div className="credit-scope-note"><ShieldCheck size={17} /> {t('restaurantWallet.scope', { restaurant: displayName })}</div>
            </section>

            <section className="credit-actions" aria-label={t('restaurantWallet.actions')}>
              <button type="button" onClick={() => setModal('pay')} disabled={!wallet || availableCents <= 0}>
                <QrCode size={22} /><span><strong>{t('restaurantWallet.useCredit')}</strong><small>{t('restaurantWallet.useCreditDetail')}</small></span>
              </button>
              <button type="button" onClick={() => setModal('request')}>
                <Plus size={22} /><span><strong>{t('restaurantWallet.addCredit')}</strong><small>{t('restaurantWallet.addCreditDetail')}</small></span>
              </button>
              {topupApproved && (
                <button type="button" onClick={() => setModal('topup')}>
                  <CreditCard size={22} /><span><strong>{t('restaurantTopups.addMoney')}</strong><small>{t('restaurantTopups.addMoneyDetail')}</small></span>
                </button>
              )}
            </section>

            <details className="credit-more-actions">
              <summary>{t('restaurantWallet.moreOptions')}</summary>
              <button type="button" onClick={() => setModal('transfer')} disabled={!wallet || availableCents <= 0}>
                <Send size={18} /> {t('restaurantWallet.sendCredit')}
              </button>
              <span>{t('restaurantWallet.transfersStay', { restaurant: displayName })}</span>
            </details>

            <section className="credit-history-panel">
              <div className="credit-tabs" role="tablist">
                {TABS.map((tab) => (
                  <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                    {tab === 'activity' ? t('restaurantWallet.activity') : t('restaurantWallet.requests')}
                    {tab === 'activity' && activeHolds.length > 0 && <span>{activeHolds.length}</span>}
                  </button>
                ))}
              </div>

              {activeTab === 'activity' && (
                <>
                  {activeHolds.length > 0 && (
                    <div className="credit-active-holds">
                      {activeHolds.map((hold) => (
                        <div key={hold.id}>
                          <Clock3 size={17} />
                          <span><strong>{formatFoodMoney(hold.amountCents, hold.currencyCode || currency)} {t('restaurantWallet.reserved')}</strong><small>{t('restaurantWallet.expires', { date: formatDate(hold.expiresAt, t.lng, t('statusUnknown')) })}</small></span>
                          <button type="button" onClick={() => releaseHold(hold)}>{t('restaurantWallet.release')}</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {transactions.length ? <div className="credit-list">{transactions.map((entry) => (
                    <article key={entry.id}>
                      <div className={`credit-entry-icon ${entry.entryType === 'debit' ? 'debit' : 'credit'}`}>{entry.entryType === 'debit' ? '−' : '+'}</div>
                      <div><strong>{entry.description || (entry.entryType === 'debit' ? t('restaurantWallet.restaurantPurchase') : t('restaurantWallet.restaurantCredit'))}</strong><span>{formatDate(entry.postedAt || entry.createdAt, t.lng, t('statusUnknown'))}</span></div>
                      <div className="credit-entry-amount"><strong>{entry.entryType === 'debit' ? '-' : '+'}{formatFoodMoney(entry.amountCents, entry.currencyCode || currency)}</strong><span>{t('restaurantWallet.balance', { amount: formatFoodMoney(entry.balanceAfterCents, entry.currencyCode || currency) })}</span></div>
                    </article>
                  ))}</div> : <EmptyState title={t('restaurantWallet.noActivity')} detail={t('restaurantWallet.noActivityDetail')} />}
                  {transfers.length > 0 && (
                    <details className="credit-transfer-history">
                      <summary>{t('restaurantWallet.transferHistory', { count: transfers.length })}</summary>
                      <div className="credit-list">{transfers.map((transfer) => (
                        <article key={transfer.id}>
                          <div className="credit-entry-icon transfer"><Send size={16} /></div>
                          <div><strong>{transfer.direction === 'received' ? t('restaurantWallet.received') : t('restaurantWallet.sent')}</strong><span>{transfer.counterpartyEmail || t('restaurantWallet.customer')} · {formatDate(transfer.createdAt, t.lng, t('statusUnknown'))}</span>{transfer.memo && <small>{transfer.memo}</small>}</div>
                          <div className="credit-entry-amount"><strong>{transfer.direction === 'received' ? '+' : '−'}{formatFoodMoney(transfer.amountCents, transfer.currencyCode || currency)}</strong><span>{localizeStatus(t, transfer.status)}</span></div>
                        </article>
                      ))}</div>
                    </details>
                  )}
                </>
              )}

              {activeTab === 'requests' && (
                requests.length ? <div className="credit-list">{requests.map((request) => (
                  <article key={request.id}>
                    <div className={`credit-entry-icon request-${request.status}`}>{request.status === 'approved' ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</div>
                    <div><strong>{t('restaurantWallet.addRequest', { status: localizeStatus(t, request.status) })}</strong><span>{request.referenceId || t('restaurantWallet.receiptAttached')} · {formatDate(request.createdAt, t.lng, t('statusUnknown'))}</span>{request.note && <small>{request.note}</small>}</div>
                    <div className="credit-entry-amount"><strong>{formatFoodMoney(request.amountCents, request.currencyCode || currency)}</strong>{request.status === 'pending' && <button type="button" onClick={() => cancelRequest(request)}>{t('restaurantWallet.cancel')}</button>}</div>
                  </article>
                ))}</div> : <EmptyState title={t('restaurantWallet.requests')} detail={t('restaurantWallet.noSelectedDetail')} />
              )}
            </section>
          </>
        )}
      </main>
      <Footer />

      {modal === 'pay' && <PaymentModal wallet={wallet} onClose={() => setModal(null)} onChanged={refresh} />}
      {modal === 'transfer' && <TransferModal wallet={wallet} onClose={() => setModal(null)} onChanged={refresh} />}
      {modal === 'request' && <CreditRequestModal restaurantId={selectedRestaurantId} restaurantName={displayName} currency={currency} onClose={() => setModal(null)} onChanged={refresh} />}
      {modal === 'topup' && <TopupModal restaurantId={selectedRestaurantId} restaurantName={displayName} currency={currency} onClose={() => setModal(null)} onChanged={refresh} />}
    </div>
  );
}

function PaymentModal({ wallet, onClose, onChanged }) {
  const { t } = useTranslation('credit');
  const [amount, setAmount] = useState('');
  const [session, setSession] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const restaurantId = wallet?.restaurantId;
  const currency = wallet?.currencyCode || 'USD';

  const createSession = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount, currency);
    if (!amountCents) return toast.error(t('restaurantWallet.validPaymentAmount'));
    if (amountCents > walletAvailableCents(wallet)) return toast.error(t('restaurantWallet.amountExceeds'));
    setSubmitting(true);
    try {
      const result = await createFoodWalletPaymentSession(restaurantId, { amountCents, ttlSeconds: 180, app: 'oxsteed_web' });
      setSession(result);
      await onChanged();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.createQrFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelSession = async () => {
    if (!session?.session?.id) return onClose();
    try {
      await cancelFoodWalletPaymentSession(restaurantId, session.session.id);
      await onChanged();
      onClose();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.cancelQrFailed')));
    }
  };

  return (
    <Modal title={t('restaurantWallet.payTitle')} subtitle={session ? t('restaurantWallet.paySubtitle') : t('restaurantWallet.availableAmount', { amount: formatFoodMoney(walletAvailableCents(wallet), currency) })} onClose={cancelSession}>
      {!session ? (
        <form className="credit-form" onSubmit={createSession}>
          <label><span>{t('restaurantWallet.amount')}</span><div className="credit-money-input"><span>{currency}</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
          <button type="submit" className="credit-primary" disabled={submitting}>{submitting ? t('restaurantWallet.creatingQr') : t('restaurantWallet.createQr')}</button>
        </form>
      ) : (
        <div className="credit-qr-result">
          <WalletQr value={session.qrPayload || session.token} />
          <strong>{formatFoodMoney(session.session?.amountCents, session.session?.currencyCode || currency)}</strong>
          <span>{t('restaurantWallet.expires', { date: formatDate(session.session?.expiresAt, t.lng, t('statusUnknown')) })}</span>
          <button type="button" className="credit-secondary" onClick={cancelSession}>{t('restaurantWallet.cancelRelease')}</button>
        </div>
      )}
    </Modal>
  );
}

function TransferModal({ wallet, onClose, onChanged }) {
  const { t } = useTranslation('credit');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());
  const currency = wallet?.currencyCode || 'USD';

  const submit = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount, currency);
    if (!email.trim() || !amountCents) return toast.error(t('restaurantWallet.recipientAndAmount'));
    if (amountCents > walletAvailableCents(wallet)) return toast.error(t('restaurantWallet.amountExceeds'));
    setSubmitting(true);
    const payload = {
      recipientEmail: email.trim(),
      amountCents,
      memo: memo.trim() || undefined,
    };
    const keyPayload = { restaurantId: wallet.restaurantId, ...payload };
    try {
      await transferFoodWalletCredit(wallet.restaurantId, {
        ...payload,
        idempotencyKey: idempotencyKeysRef.current.get('restaurant-wallet-transfer', keyPayload),
      });
      idempotencyKeysRef.current.clear('restaurant-wallet-transfer', keyPayload);
      toast.success(t('restaurantWallet.sentNotice'));
      try {
        await onChanged();
      } catch {
        toast.error(t('restaurantWallet.refreshFailed'));
      }
      onClose();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.sendFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t('restaurantWallet.sendTitle')} subtitle={t('restaurantWallet.sendSubtitle', { restaurant: wallet.restaurantName })} onClose={onClose}>
      <form className="credit-form" onSubmit={submit}>
        <label><span>{t('restaurantWallet.recipientEmail')}</span><input type="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" /></label>
        <label><span>{t('restaurantWallet.amount')}</span><div className="credit-money-input"><span>{currency}</span><input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
        <label><span>{t('restaurantWallet.memo')}</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={255} placeholder={t('restaurantWallet.memoPlaceholder')} /></label>
        <button type="submit" className="credit-primary" disabled={submitting}>{submitting ? t('restaurantWallet.sending') : t('restaurantWallet.sendButton')}</button>
      </form>
    </Modal>
  );
}

function CreditRequestModal({ restaurantId, restaurantName, currency, onClose, onChanged }) {
  const { t } = useTranslation('credit');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState(null);
  const [proofMethod, setProofMethod] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());

  const uploadProof = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'food-wallet-credit-proof');
      setProof({ url: uploaded?.url, name: file.name });
      toast.success(t('restaurantWallet.uploaded'));
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.uploadFailed')));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount, currency);
    if (!amountCents) return toast.error(t('restaurantWallet.validCreditAmount'));
    if (!reference.trim() && !proof?.url) return toast.error(t('restaurantWallet.proofRequired'));
    setSubmitting(true);
    const payload = {
      amountCents,
      paymentReference: reference.trim() || undefined,
      proofAttachmentUrl: proof?.url || undefined,
      note: note.trim() || undefined,
      fundingMethod: 'direct_payment',
    };
    const keyPayload = { restaurantId, ...payload };
    try {
      await requestFoodWalletCredit(restaurantId, {
        ...payload,
        idempotencyKey: idempotencyKeysRef.current.get('restaurant-wallet-credit-request', keyPayload),
      });
      idempotencyKeysRef.current.clear('restaurant-wallet-credit-request', keyPayload);
      toast.success(t('restaurantWallet.requestSent'));
      try {
        await onChanged();
      } catch {
        toast.error(t('restaurantWallet.refreshFailed'));
      }
      onClose();
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantWallet.submitFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t('restaurantWallet.requestTitle')} subtitle={t('restaurantWallet.requestSubtitle', { restaurant: restaurantName })} onClose={onClose}>
      <form className="credit-form" onSubmit={submit}>
        <label><span>{t('restaurantWallet.amountPaid')}</span><div className="credit-money-input"><span>{currency}</span><input autoFocus inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
        <div className="credit-proof-choice" role="group" aria-label={t('restaurantWallet.proofMethod')}>
          <button type="button" className={proofMethod === 'upload' ? 'active' : ''} onClick={() => { setProofMethod('upload'); setReference(''); }}>{t('restaurantWallet.uploadReceipt')}</button>
          <button type="button" className={proofMethod === 'reference' ? 'active' : ''} onClick={() => { setProofMethod('reference'); setProof(null); }}>{t('restaurantWallet.enterConfirmation')}</button>
        </div>
        {proofMethod === 'upload' ? (
          proof?.name ? (
            <div className="credit-proof-attached">
              <span><CheckCircle2 size={17} /><strong>{proof.name}</strong></span>
              <button type="button" onClick={() => setProof(null)}>{t('restaurantWallet.remove')}</button>
            </div>
          ) : (
            <label className="credit-proof-upload"><span>{uploading ? t('restaurantWallet.uploading') : t('restaurantWallet.chooseProof')}</span><input type="file" accept="image/*,application/pdf" onChange={uploadProof} disabled={uploading} /></label>
          )
        ) : (
          <label><span>{t('restaurantWallet.confirmation')}</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} placeholder={t('restaurantWallet.confirmationPlaceholder')} /></label>
        )}
        <details className="credit-form-details">
          <summary>{t('restaurantWallet.noteOptional')}</summary>
          <label><span>{t('restaurantWallet.noteLabel')}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} placeholder={t('restaurantWallet.notePlaceholder')} /></label>
        </details>
        <button type="submit" className="credit-primary" disabled={submitting || uploading}>{uploading ? t('restaurantWallet.uploading') : submitting ? t('restaurantWallet.sending') : t('restaurantWallet.sendApproval')}</button>
      </form>
    </Modal>
  );
}

// ── Customer card top-up (OxSteed-approved restaurants only) ──────────────
// Mirrors the server limits: min $5, max $500 per top-up, step-up email
// challenge at/above $250. The Stripe PaymentIntent is created server-side;
// the client only confirms it with the returned clientSecret, then polls
// the top-up status until the webhook credits the wallet (succeeded) or
// the payment settles as failed/canceled.

const TOPUP_MIN_CENTS = 500;
const TOPUP_MAX_CENTS = 50000;
const TOPUP_STEPUP_CENTS = 25000;
const TOPUP_POLL_INTERVAL_MS = 3000;
const TOPUP_POLL_MAX_ATTEMPTS = 40;

const stripePromise = (() => {
  try {
    const key = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  } catch {
    return null;
  }
})();

function TopupCardForm({ clientSecret, amountCents, currency, onConfirmed }) {
  const { t } = useTranslation('credit');
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setCardError('');
    try {
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (error) {
        setCardError(error.message || t('restaurantTopups.cardFailed'));
        return;
      }
      if (paymentIntent && ['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
        onConfirmed();
      } else {
        setCardError(t('restaurantTopups.cardFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="credit-form" onSubmit={submit}>
      <p className="credit-modal-subtitle">{t('restaurantTopups.cardCopy', { amount: formatFoodMoney(amountCents, currency) })}</p>
      <label>
        <span>{t('restaurantTopups.cardDetails')}</span>
        <div style={{ border: '1px solid #d7dce3', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: '#fff' }}>
          <CardElement options={{ style: { base: { fontSize: '16px', color: '#10253f' } } }} />
        </div>
      </label>
      {cardError && <p role="alert" style={{ color: '#b42318', fontSize: '0.9rem' }}>{cardError}</p>}
      <button type="submit" className="credit-primary" disabled={submitting || !stripe}>
        {submitting ? t('restaurantTopups.processing') : t('restaurantTopups.pay', { amount: formatFoodMoney(amountCents, currency) })}
      </button>
    </form>
  );
}

function TopupModal({ restaurantId, restaurantName, currency, onClose, onChanged }) {
  const { t } = useTranslation('credit');
  const [step, setStep] = useState('amount');
  const [amount, setAmount] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [intent, setIntent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [terminal, setTerminal] = useState(null);
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());
  const pollTimerRef = useRef(null);
  const pollCountRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback((topupId, cents) => {
    stopPolling();
    pollCountRef.current = 0;
    setStep('processing');
    const tick = async () => {
      pollCountRef.current += 1;
      let status = null;
      try {
        const data = await getRestaurantTopup(restaurantId, topupId);
        status = data?.topup?.status || null;
      } catch {
        status = null;
      }
      if (status === 'succeeded') {
        stopPolling();
        idempotencyKeysRef.current.clear('restaurant-topup', { restaurantId, amountCents: cents });
        toast.success(t('restaurantTopups.succeeded'));
        try {
          await onChanged();
        } catch {
          // The wallet refresh failing does not undo the credit; the next
          // page load shows the updated balance.
        }
        onClose();
        return;
      }
      if (status === 'failed' || status === 'canceled') {
        stopPolling();
        setTerminal({ tone: 'error', message: t(status === 'failed' ? 'restaurantTopups.failed' : 'restaurantTopups.canceled') });
        return;
      }
      if (pollCountRef.current >= TOPUP_POLL_MAX_ATTEMPTS) {
        stopPolling();
        setTerminal({ tone: 'info', message: t('restaurantTopups.timeout') });
        return;
      }
      pollTimerRef.current = setTimeout(tick, TOPUP_POLL_INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, TOPUP_POLL_INTERVAL_MS);
  }, [restaurantId, t, onChanged, onClose, stopPolling]);

  const beginIntent = async (cents, stepup) => {
    setSubmitting(true);
    try {
      const idempotencyKey = idempotencyKeysRef.current.get('restaurant-topup', { restaurantId, amountCents: cents });
      const payload = { amountCents: cents };
      if (stepup) {
        payload.stepupChallengeId = stepup.challengeId;
        payload.stepupCode = stepup.code;
      }
      const result = await createRestaurantTopupIntent(restaurantId, payload, idempotencyKey);
      const topupId = result?.topup?.id;
      if (!topupId) throw new Error('topup-intent-missing');
      setIntent({ topupId, clientSecret: result?.clientSecret || null });
      if (result?.replayed || !result?.clientSecret) {
        // Replayed idempotency key (or nothing to confirm): skip the card
        // form and go straight to status polling.
        startPolling(topupId, cents);
      } else {
        setStep('card');
      }
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantTopups.createFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  const submitAmount = async (event) => {
    event.preventDefault();
    const cents = parseAmountCents(amount, currency);
    if (!cents || cents < TOPUP_MIN_CENTS || cents > TOPUP_MAX_CENTS) {
      toast.error(t('restaurantTopups.invalidAmount', {
        min: formatFoodMoney(TOPUP_MIN_CENTS, currency),
        max: formatFoodMoney(TOPUP_MAX_CENTS, currency),
      }));
      return;
    }
    setAmountCents(cents);
    if (cents >= TOPUP_STEPUP_CENTS) {
      setSubmitting(true);
      try {
        const issued = await issueRestaurantTopupStepupChallenge(restaurantId, { amountCents: cents });
        if (!issued?.challenge?.id) throw new Error('challenge-missing');
        setChallenge({ id: issued.challenge.id, expiresAt: issued.challenge.expiresAt });
        setCode('');
        setStep('stepup');
        toast.success(t('restaurantTopups.challengeSent'));
      } catch (error) {
        toast.error(safeCreditErrorMessage(error, t('restaurantTopups.challengeFailed')));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    await beginIntent(cents, null);
  };

  const submitStepup = async (event) => {
    event.preventDefault();
    if (!challenge?.id || !code.trim()) {
      toast.error(t('restaurantTopups.invalidCode'));
      return;
    }
    await beginIntent(amountCents, { challengeId: challenge.id, code: code.trim() });
  };

  const close = () => {
    stopPolling();
    onClose();
  };

  if (!stripePromise) {
    return (
      <Modal title={t('restaurantTopups.modalTitle')} onClose={close}>
        <p role="alert" className="credit-modal-subtitle">{t('restaurantTopups.stripeUnavailable')}</p>
        <button type="button" className="credit-secondary" onClick={close}>{t('restaurantTopups.close')}</button>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('restaurantTopups.modalTitle')}
      subtitle={t('restaurantTopups.modalSubtitle', { restaurant: restaurantName })}
      onClose={close}
    >
      {terminal ? (
        <div>
          <p role={terminal.tone === 'error' ? 'alert' : 'status'} className="credit-modal-subtitle">{terminal.message}</p>
          <button type="button" className="credit-secondary" onClick={close}>{t('restaurantTopups.close')}</button>
        </div>
      ) : step === 'amount' ? (
        <form className="credit-form" onSubmit={submitAmount}>
          <label>
            <span>{t('restaurantTopups.amount')}</span>
            <div className="credit-money-input">
              <span>{currency}</span>
              <input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
            </div>
          </label>
          <p className="credit-modal-subtitle">{t('restaurantTopups.amountHint', {
            min: formatFoodMoney(TOPUP_MIN_CENTS, currency),
            max: formatFoodMoney(TOPUP_MAX_CENTS, currency),
          })}</p>
          <button type="submit" className="credit-primary" disabled={submitting}>
            {submitting ? t('restaurantTopups.processing') : t('restaurantTopups.continue')}
          </button>
        </form>
      ) : step === 'stepup' ? (
        <form className="credit-form" onSubmit={submitStepup}>
          <p className="credit-modal-subtitle"><strong>{t('restaurantTopups.stepupTitle')}</strong><br />{t('restaurantTopups.stepupCopy')}</p>
          <label>
            <span>{t('restaurantTopups.stepupCode')}</span>
            <input autoFocus inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('restaurantTopups.stepupCodePlaceholder')} />
          </label>
          <button type="submit" className="credit-primary" disabled={submitting}>
            {submitting ? t('restaurantTopups.processing') : t('restaurantTopups.verifyAndContinue')}
          </button>
        </form>
      ) : step === 'card' && intent?.clientSecret ? (
        <Elements stripe={stripePromise}>
          <TopupCardForm
            clientSecret={intent.clientSecret}
            amountCents={amountCents}
            currency={currency}
            onConfirmed={() => startPolling(intent.topupId, amountCents)}
          />
        </Elements>
      ) : (
        <div>
          <p role="status" className="credit-modal-subtitle"><Clock3 size={16} /> {t('restaurantTopups.confirming')}</p>
          <button type="button" className="credit-secondary" onClick={close}>{t('restaurantTopups.close')}</button>
        </div>
      )}
    </Modal>
  );
}
