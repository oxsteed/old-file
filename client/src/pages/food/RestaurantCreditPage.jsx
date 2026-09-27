import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCodeStyling from 'qr-code-styling';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
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
  formatFoodMoney,
  getFoodRestaurant,
  getMyFoodRestaurantWallet,
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
      setTransfers([]);
      setRequests([]);
      setHolds([]);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const [walletResult, transferResult, requestResult, holdResult, restaurantResult] = await Promise.all([
        getMyFoodRestaurantWallet(restaurantId).catch(() => null),
        listFoodWalletTransfers(restaurantId),
        listFoodWalletCreditRequests(restaurantId),
        listFoodWalletHolds(restaurantId),
        getFoodRestaurant(restaurantId).catch(() => null),
      ]);
      setWallet(walletResult);
      setTransfers(transferResult);
      setRequests(requestResult);
      setHolds(holdResult);
      setRestaurant(restaurantResult?.restaurant || restaurantResult || null);
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
