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

const TABS = ['ledger', 'transfers', 'requests', 'holds'];

function errorMessage(error, fallback) {
  return error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
    || fallback;
}

function parseAmountCents(value) {
  const normalized = String(value || '').replace(/[^0-9.,-]/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

function requestKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function walletAvailableCents(wallet) {
  const balance = Number(wallet?.balanceCents || 0);
  const reserved = Number(wallet?.reservedCents || 0);
  return Number(wallet?.availableBalanceCents ?? Math.max(0, balance - reserved));
}

function WalletQr({ value }) {
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

  return <div ref={container} className="credit-qr" aria-label="Restaurant credit payment QR code" />;
}

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="credit-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="credit-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="credit-modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <p className="credit-eyebrow">Restaurant credit</p>
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
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRestaurantId = searchParams.get('restaurantId');
  const [wallets, setWallets] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [holds, setHolds] = useState([]);
  const [activeTab, setActiveTab] = useState('ledger');
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
      toast.error(errorMessage(error, 'Unable to load restaurant credit.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
          toast.error(errorMessage(error, 'Unable to load your restaurant wallets.'));
        }
      });
    return () => { active = false; };
  }, [loadWallets, requestedRestaurantId, setSearchParams]);

  useEffect(() => {
    if (selectedRestaurantId) loadSelectedWallet(selectedRestaurantId);
  }, [loadSelectedWallet, selectedRestaurantId]);

  const displayName = wallet?.restaurantName || restaurant?.display_name || restaurant?.displayName || 'Restaurant';
  const currency = wallet?.currencyCode || restaurant?.currency_code || restaurant?.currencyCode || 'USD';
  const postedCents = Number(wallet?.balanceCents || 0);
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
      toast.success('Reservation released.');
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to release the reservation.'));
    }
  };

  const cancelRequest = async (request) => {
    try {
      await cancelFoodWalletCreditRequest(selectedRestaurantId, request.id);
      toast.success('Credit request cancelled.');
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to cancel the request.'));
    }
  };

  return (
    <div className="credit-page-shell">
      <PageMeta title={t('restaurantCredit.title', { defaultValue: 'Restaurant Credit' })} description="Manage restaurant-scoped credit, payments, transfers, and requests." />
      <Navbar />
      <main className="credit-page">
        <header className="credit-hero">
          <div>
            <Link to="/restaurants" className="credit-back"><ArrowLeft size={16} /> Restaurants</Link>
            <p className="credit-eyebrow">Restaurant-scoped wallet</p>
            <h1>Restaurant Credit</h1>
            <p>Each balance belongs to one restaurant. It cannot be spent or transferred at another restaurant.</p>
          </div>
          <div className="credit-hero-actions">
            {wallets.length > 0 && (
              <label>
                <span>Restaurant</span>
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
              <RefreshCw size={18} className={refreshing ? 'credit-spin' : ''} /> Refresh
            </button>
          </div>
        </header>

        {loading ? (
          <div className="credit-loading"><RefreshCw className="credit-spin" /> Loading restaurant credit…</div>
        ) : !selectedRestaurantId ? (
          <EmptyState title="No restaurant selected" detail="Open a restaurant and choose Manage restaurant credit to request your first balance." />
        ) : (
          <>
            <section className="credit-balance-card">
              <div className="credit-balance-heading">
                <div className="credit-restaurant-mark"><Wallet size={26} /></div>
                <div>
                  <span>{displayName}</span>
                  <strong>{wallet ? formatFoodMoney(availableCents, currency) : formatFoodMoney(0, currency)}</strong>
                  <small>Available to spend</small>
                </div>
                <span className={`credit-status credit-status-${wallet?.status || 'new'}`}>{wallet?.status || 'No wallet yet'}</span>
              </div>
              <div className="credit-balance-grid">
                <div><span>Posted balance</span><strong>{formatFoodMoney(postedCents, currency)}</strong></div>
                <div><span>Reserved</span><strong>{formatFoodMoney(reservedCents, currency)}</strong></div>
                <div><span>Available</span><strong>{formatFoodMoney(availableCents, currency)}</strong></div>
              </div>
              <div className="credit-scope-note"><ShieldCheck size={17} /> Credit and transfers remain inside {displayName}.</div>
            </section>

            <section className="credit-actions" aria-label="Restaurant credit actions">
              <button type="button" onClick={() => setModal('pay')} disabled={!wallet || availableCents <= 0}>
                <QrCode size={22} /><span><strong>Pay with QR</strong><small>Reserve credit for 3 minutes</small></span>
              </button>
              <button type="button" onClick={() => setModal('transfer')} disabled={!wallet || availableCents <= 0}>
                <Send size={22} /><span><strong>Send credit</strong><small>Same restaurant only</small></span>
              </button>
              <button type="button" onClick={() => setModal('request')}>
                <Plus size={22} /><span><strong>Request credit</strong><small>Add reference or proof</small></span>
              </button>
            </section>

            <section className="credit-history-panel">
              <div className="credit-tabs" role="tablist">
                {TABS.map((tab) => (
                  <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                    {tab === 'ledger' ? 'Transactions' : tab === 'requests' ? 'Credit requests' : tab[0].toUpperCase() + tab.slice(1)}
                    {tab === 'holds' && activeHolds.length > 0 && <span>{activeHolds.length}</span>}
                  </button>
                ))}
              </div>

              {activeTab === 'ledger' && (
                transactions.length ? <div className="credit-list">{transactions.map((entry) => (
                  <article key={entry.id}>
                    <div className={`credit-entry-icon ${entry.entryType === 'debit' ? 'debit' : 'credit'}`}>{entry.entryType === 'debit' ? '−' : '+'}</div>
                    <div><strong>{entry.description || (entry.entryType === 'debit' ? 'Restaurant purchase' : 'Restaurant credit')}</strong><span>{formatDate(entry.postedAt || entry.createdAt)}</span></div>
                    <div className="credit-entry-amount"><strong>{entry.entryType === 'debit' ? '−' : '+'}{formatFoodMoney(entry.amountCents, entry.currencyCode || currency)}</strong><span>Balance {formatFoodMoney(entry.balanceAfterCents, entry.currencyCode || currency)}</span></div>
                  </article>
                ))}</div> : <EmptyState title="No transactions yet" detail="Approved credit, purchases, transfers, and refunds will appear here." />
              )}

              {activeTab === 'transfers' && (
                transfers.length ? <div className="credit-list">{transfers.map((transfer) => (
                  <article key={transfer.id}>
                    <div className="credit-entry-icon transfer"><Send size={16} /></div>
                    <div><strong>{transfer.direction === 'received' ? 'Credit received' : 'Credit sent'}</strong><span>{transfer.counterpartyEmail || 'OxSteed customer'} · {formatDate(transfer.createdAt)}</span>{transfer.memo && <small>{transfer.memo}</small>}</div>
                    <div className="credit-entry-amount"><strong>{transfer.direction === 'received' ? '+' : '−'}{formatFoodMoney(transfer.amountCents, transfer.currencyCode || currency)}</strong><span>{transfer.status}</span></div>
                  </article>
                ))}</div> : <EmptyState title="No transfers yet" detail="Credit sent or received at this restaurant will appear here." />
              )}

              {activeTab === 'requests' && (
                requests.length ? <div className="credit-list">{requests.map((request) => (
                  <article key={request.id}>
                    <div className={`credit-entry-icon request-${request.status}`}>{request.status === 'approved' ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</div>
                    <div><strong>Credit request · {request.status}</strong><span>{request.referenceId || 'No reference'} · {formatDate(request.createdAt)}</span>{request.note && <small>{request.note}</small>}</div>
                    <div className="credit-entry-amount"><strong>{formatFoodMoney(request.amountCents, request.currencyCode || currency)}</strong>{request.status === 'pending' && <button type="button" onClick={() => cancelRequest(request)}>Cancel</button>}</div>
                  </article>
                ))}</div> : <EmptyState title="No credit requests" detail="Submit a reference, proof, or note for restaurant approval." />
              )}

              {activeTab === 'holds' && (
                holds.length ? <div className="credit-list">{holds.map((hold) => (
                  <article key={hold.id}>
                    <div className={`credit-entry-icon hold-${hold.status}`}><Clock3 size={17} /></div>
                    <div><strong>{hold.purpose?.replaceAll('_', ' ') || 'Credit reservation'}</strong><span>{hold.status} · Expires {formatDate(hold.expiresAt)}</span></div>
                    <div className="credit-entry-amount"><strong>{formatFoodMoney(hold.amountCents, hold.currencyCode || currency)}</strong>{hold.status === 'active' && <button type="button" onClick={() => releaseHold(hold)}>Release</button>}</div>
                  </article>
                ))}</div> : <EmptyState title="No reservations" detail="Short-lived QR payment reservations will appear here." />
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
  const [amount, setAmount] = useState('');
  const [session, setSession] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const restaurantId = wallet?.restaurantId;
  const currency = wallet?.currencyCode || 'USD';

  const createSession = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount);
    if (!amountCents) return toast.error('Enter a valid payment amount.');
    if (amountCents > walletAvailableCents(wallet)) return toast.error('Amount exceeds the available balance.');
    setSubmitting(true);
    try {
      const result = await createFoodWalletPaymentSession(restaurantId, { amountCents, ttlSeconds: 180, app: 'oxsteed_web' });
      setSession(result);
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to create the payment QR.'));
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
      toast.error(errorMessage(error, 'Unable to cancel the payment QR.'));
    }
  };

  return (
    <Modal title="Pay with restaurant credit" subtitle={session ? 'Show this one-time QR to the restaurant. The reserved amount cannot be spent twice.' : `Available: ${formatFoodMoney(walletAvailableCents(wallet), currency)}`} onClose={cancelSession}>
      {!session ? (
        <form className="credit-form" onSubmit={createSession}>
          <label><span>Amount</span><div className="credit-money-input"><span>{currency}</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
          <button type="submit" className="credit-primary" disabled={submitting}>{submitting ? 'Creating secure QR…' : 'Create payment QR'}</button>
        </form>
      ) : (
        <div className="credit-qr-result">
          <WalletQr value={session.qrPayload || session.token} />
          <strong>{formatFoodMoney(session.session?.amountCents, session.session?.currencyCode || currency)}</strong>
          <span>Expires {formatDate(session.session?.expiresAt)}</span>
          <button type="button" className="credit-secondary" onClick={cancelSession}>Cancel and release credit</button>
        </div>
      )}
    </Modal>
  );
}

function TransferModal({ wallet, onClose, onChanged }) {
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const currency = wallet?.currencyCode || 'USD';

  const submit = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount);
    if (!email.trim() || !amountCents) return toast.error('Enter the recipient email and a valid amount.');
    if (amountCents > walletAvailableCents(wallet)) return toast.error('Amount exceeds the available balance.');
    setSubmitting(true);
    try {
      await transferFoodWalletCredit(wallet.restaurantId, {
        recipientEmail: email.trim(),
        amountCents,
        memo: memo.trim() || undefined,
        idempotencyKey: requestKey('web-wallet-transfer'),
      });
      toast.success('Restaurant credit sent.');
      await onChanged();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to send restaurant credit.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Send restaurant credit" subtitle={`The recipient can only spend this credit at ${wallet.restaurantName}.`} onClose={onClose}>
      <form className="credit-form" onSubmit={submit}>
        <label><span>Recipient’s OxSteed email</span><input type="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" /></label>
        <label><span>Amount</span><div className="credit-money-input"><span>{currency}</span><input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
        <label><span>Memo (optional)</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={255} placeholder="What is this transfer for?" /></label>
        <button type="submit" className="credit-primary" disabled={submitting}>{submitting ? 'Sending…' : 'Send credit'}</button>
      </form>
    </Modal>
  );
}

function CreditRequestModal({ restaurantId, restaurantName, currency, onClose, onChanged }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const uploadProof = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'food-wallet-credit-proof');
      setProof({ url: uploaded?.url, name: file.name });
      toast.success('Proof uploaded.');
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to upload proof.'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const amountCents = parseAmountCents(amount);
    if (!amountCents) return toast.error('Enter a valid credit amount.');
    if (!reference.trim() && !note.trim() && !proof?.url) return toast.error('Add a payment reference, proof, or note.');
    setSubmitting(true);
    try {
      await requestFoodWalletCredit(restaurantId, {
        amountCents,
        paymentReference: reference.trim() || undefined,
        proofAttachmentUrl: proof?.url || undefined,
        note: note.trim() || undefined,
        fundingMethod: 'direct_payment',
        idempotencyKey: requestKey('web-wallet-credit-request'),
      });
      toast.success('Credit request sent to the restaurant.');
      await onChanged();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to submit the credit request.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Request restaurant credit" subtitle={`${restaurantName} must verify and approve this request before the balance changes.`} onClose={onClose}>
      <form className="credit-form" onSubmit={submit}>
        <label><span>Credit amount</span><div className="credit-money-input"><span>{currency}</span><input autoFocus inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label>
        <label><span>Payment reference (optional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} placeholder="Confirmation number or sender name" /></label>
        <label><span>Proof (optional)</span><input type="file" accept="image/*,application/pdf" onChange={uploadProof} disabled={uploading} />{proof?.name && <small>Attached: {proof.name}</small>}</label>
        <label><span>Note (optional)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} placeholder="Information the restaurant can use to verify the payment" /></label>
        <button type="submit" className="credit-primary" disabled={submitting || uploading}>{uploading ? 'Uploading proof…' : submitting ? 'Sending request…' : 'Request credit'}</button>
      </form>
    </Modal>
  );
}
