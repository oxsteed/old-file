import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  ArrowLeft,
  CreditCard,
  Lock,
  RefreshCw,
  ShieldAlert,
  Snowflake,
  Unlock,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import {
  listOxsteedCreditCards,
  issueOxsteedCreditVirtualCard,
  requestOxsteedCreditPhysicalCard,
  activateOxsteedCreditCard,
  freezeOxsteedCreditCard,
  unfreezeOxsteedCreditCard,
  reportOxsteedCreditCardLost,
  setOxsteedCreditCardPin,
} from '../../api/oxsteedCredit';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import './OxsteedCreditCardsPage.css';

// NOTE: like the admin card console, this page is not yet part of the credit
// i18n contract (client/scripts/verify-i18n.mjs verifyCreditTranslationSurface
// lists specific files only) and intentionally ships in English first.
// Localize alongside the rest of the still-unlocalized Credit surfaces.

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `credit-card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dateTime(value) {
  return formatCreditDateTime(value, 'Not available');
}

function statusLabel(status) {
  return { pending: 'Pending', active: 'Active', frozen: 'Frozen', lost: 'Reported lost', stolen: 'Reported stolen', revoked: 'Revoked', expired: 'Expired' }[status] || status;
}

const emptyForm = {
  cardType: 'virtual',
  nickname: '',
  currencyCode: 'USD',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US',
};

export default function OxsteedCreditCardsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [issuing, setIssuing] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState(null);
  const [busyCardId, setBusyCardId] = useState(null);
  const [activationInputs, setActivationInputs] = useState({});
  const [pinInputs, setPinInputs] = useState({});
  const [pinFormCardId, setPinFormCardId] = useState(null);

  const load = async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const result = await listOxsteedCreditCards();
      setCards(Array.isArray(result) ? result : []);
    } catch (error) {
      setLoadError(safeCreditErrorMessage(error, 'Unable to load your OxSteed Credit cards.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submitIssue = async (event) => {
    event.preventDefault();
    if (form.cardType === 'physical' && !form.addressLine1.trim()) {
      toast.error('A shipping address is required for a physical card.');
      return;
    }
    setIssuing(true);
    setRevealedSecret(null);
    try {
      const isPhysical = form.cardType === 'physical';
      const basePayload = { currencyCode: form.currencyCode, nickname: form.nickname.trim() || undefined };
      const payload = isPhysical ? {
        ...basePayload,
        shippingAddress: {
          line1: form.addressLine1.trim(),
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          postalCode: form.postalCode.trim() || undefined,
          country: form.country.trim() || 'US',
        },
      } : basePayload;
      const result = isPhysical
        ? await requestOxsteedCreditPhysicalCard(payload, requestId())
        : await issueOxsteedCreditVirtualCard(payload, requestId());
      if (result?.card?.credential) {
        setRevealedSecret({ cardId: result.card.id, value: result.card.credential });
      }
      toast.success(isPhysical ? 'Physical card requested. We will notify you once it ships.' : 'Virtual card issued -- ready to use now.');
      setForm(emptyForm);
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, 'Unable to issue this card.'));
    } finally {
      setIssuing(false);
    }
  };

  const submitActivation = async (card) => {
    const code = (activationInputs[card.id] || '').trim();
    if (!code) {
      toast.error('Enter the activation code printed with your card.');
      return;
    }
    setBusyCardId(card.id);
    try {
      const result = await activateOxsteedCreditCard(card.id, { activationCode: code });
      if (result?.card?.credential) {
        setRevealedSecret({ cardId: card.id, value: result.card.credential });
      }
      toast.success('Card activated -- it is ready to use.');
      setActivationInputs((current) => ({ ...current, [card.id]: '' }));
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, 'Unable to activate this card.'));
    } finally {
      setBusyCardId(null);
    }
  };

  const toggleFreeze = async (card) => {
    setBusyCardId(card.id);
    try {
      if (card.status === 'frozen') {
        await unfreezeOxsteedCreditCard(card.id, { reason: 'Customer unfroze card' });
        toast.success('Card unfrozen.');
      } else {
        await freezeOxsteedCreditCard(card.id, { reason: 'Customer froze card' });
        toast.success('Card frozen -- it cannot be used until you unfreeze it.');
      }
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, 'Unable to update this card.'));
    } finally {
      setBusyCardId(null);
    }
  };

  const reportLost = async (card) => {
    const confirmed = window.confirm(
      'Report this card lost or stolen? It will be permanently disabled and, unless you cancel, a replacement virtual card will be issued immediately.'
    );
    if (!confirmed) return;
    setBusyCardId(card.id);
    setRevealedSecret(null);
    try {
      const result = await reportOxsteedCreditCardLost(card.id, { status: 'lost', reason: 'Customer reported card lost' });
      if (result?.replacementCard?.credential) {
        setRevealedSecret({ cardId: result.replacementCard.id, value: result.replacementCard.credential });
      }
      toast.success(result?.replacementCard ? 'Card reported lost. A replacement card is ready below.' : 'Card reported lost.');
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, 'Unable to report this card lost.'));
    } finally {
      setBusyCardId(null);
    }
  };

  const submitPin = async (card) => {
    const pin = (pinInputs[card.id] || '').trim();
    if (!/^\d{4,8}$/.test(pin)) {
      toast.error('PIN must be 4-8 digits.');
      return;
    }
    setBusyCardId(card.id);
    try {
      await setOxsteedCreditCardPin(card.id, { pin });
      toast.success('PIN saved. Use it at a kiosk to cash out this card.');
      setPinInputs((current) => ({ ...current, [card.id]: '' }));
      setPinFormCardId(null);
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, 'Unable to set this PIN.'));
    } finally {
      setBusyCardId(null);
    }
  };

  return (
    <>
      <PageMeta title="My OxSteed Credit Cards" description="Issue, manage, and secure your OxSteed Credit cards." noIndex />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <Link to="/oxsteed-credit" className="ox-credit-back"><ArrowLeft size={16} /> Back to OxSteed Credit</Link>

          <header className="ox-credit-hero">
            <div>
              <p className="ox-credit-eyebrow">OxSteed Credit</p>
              <h1>My Cards</h1>
              <p>Issue a virtual card for instant use, or request a physical card. A card is just a way to spend the same balance shown on your OxSteed Credit account -- it never creates a second balance.</p>
            </div>
            <div className="ox-credit-hero-actions">
              <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true })} disabled={loading || refreshing}>
                <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> Refresh
              </button>
            </div>
          </header>

          {loadError && !loading && (
            <section className="ox-credit-error-panel" role="alert">
              <AlertCircle size={24} />
              <strong>Unable to load your cards</strong>
              <span>{loadError}</span>
              <button type="button" className="ox-credit-refresh" onClick={() => load()}>Retry</button>
            </section>
          )}

          {revealedSecret && (
            <section className="ox-credit-created-hold ox-card-secret" role="alert" aria-live="assertive">
              <strong>One-time card credential -- shown only now</strong>
              <code>{revealedSecret.value}</code>
              <span>Save this somewhere safe. It cannot be shown again -- if you lose it, report the card lost to get a replacement.</span>
            </section>
          )}

          {!loadError && (
            <>
              <section className="ox-credit-panel ox-card-issue-panel" aria-labelledby="issue-card-heading">
                <div className="ox-credit-panel-heading">
                  <div><p className="ox-credit-eyebrow">Add a card</p><h2 id="issue-card-heading">Issue a new card</h2></div>
                  <CreditCard size={20} />
                </div>
                <p className="ox-credit-panel-copy">A virtual card is active immediately. A physical card ships to your address and you activate it with a code once it arrives.</p>
                <form className="ox-card-form" onSubmit={submitIssue}>
                  <label>Card type
                    <select value={form.cardType} onChange={(event) => setForm({ ...form, cardType: event.target.value })}>
                      <option value="virtual">Virtual (use it right away)</option>
                      <option value="physical">Physical (ships to me)</option>
                    </select>
                  </label>
                  <label>Nickname (optional)
                    <input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} maxLength={80} placeholder="e.g. Main card" />
                  </label>
                  {form.cardType === 'physical' && <>
                    <label className="ox-card-form-wide">Shipping address
                      <input required value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} placeholder="Street address" />
                    </label>
                    <label>City<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
                    <label>State / region<input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></label>
                    <label>Postal code<input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></label>
                    <label>Country<input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></label>
                  </>}
                  <button type="submit" disabled={issuing}>{issuing ? 'Submitting...' : form.cardType === 'physical' ? 'Request physical card' : 'Issue virtual card'}</button>
                </form>
              </section>

              <section className="ox-credit-panel ox-card-list-panel" aria-labelledby="my-cards-heading">
                <div className="ox-credit-panel-heading">
                  <div><p className="ox-credit-eyebrow">Your cards</p><h2 id="my-cards-heading">All cards</h2></div>
                  <span className="ox-credit-count">{cards.length}</span>
                </div>
                {loading ? <div className="ox-credit-loading" role="status" aria-live="polite">Loading your cards...</div>
                  : !cards.length ? (
                    <div className="ox-credit-empty">
                      <CreditCard size={27} />
                      <strong>No cards yet</strong>
                      <span>Issue a virtual card above to start spending your OxSteed Credit balance with a card instead of the wallet screen.</span>
                    </div>
                  ) : (
                    <div className="ox-card-grid">
                      {cards.map((card) => (
                        <article key={card.id} className={`ox-card-tile ox-card-tile-${card.status}`}>
                          <div className="ox-card-tile-top">
                            <span className="ox-card-type-icon"><CreditCard size={18} /></span>
                            <div>
                              <strong>{card.nickname || (card.cardType === 'physical' ? 'Physical card' : 'Virtual card')}</strong>
                              <span>{card.credentialLast4 ? `Ending ${card.credentialLast4}` : 'No credential yet'}</span>
                            </div>
                            <span className={`ox-card-status ox-card-status-${card.status}`}>{statusLabel(card.status)}</span>
                          </div>
                          <div className="ox-card-tile-meta">
                            <span>{card.cardType === 'physical' ? `Fulfillment: ${card.fulfillmentStatus}` : 'Virtual'}</span>
                            <span>Issued {dateTime(card.issuedAt)}</span>
                            {card.hasPin && <span>PIN set</span>}
                          </div>

                          {card.cardType === 'physical' && card.status === 'pending' && (
                            <div className="ox-card-activate">
                              <input value={activationInputs[card.id] || ''} onChange={(event) => setActivationInputs((current) => ({ ...current, [card.id]: event.target.value }))} placeholder="Enter activation code" maxLength={16} />
                              <button type="button" onClick={() => submitActivation(card)} disabled={busyCardId === card.id}>{busyCardId === card.id ? 'Activating...' : 'Activate'}</button>
                            </div>
                          )}

                          {['active', 'frozen'].includes(card.status) && (
                            <div className="ox-card-actions">
                              <button type="button" onClick={() => toggleFreeze(card)} disabled={busyCardId === card.id}>
                                {card.status === 'frozen' ? <><Unlock size={13} /> Unfreeze</> : <><Snowflake size={13} /> Freeze</>}
                              </button>
                              <button type="button" onClick={() => setPinFormCardId((current) => current === card.id ? null : card.id)}><Lock size={13} /> {card.hasPin ? 'Change PIN' : 'Set PIN'}</button>
                              <button type="button" className="ox-card-danger" onClick={() => reportLost(card)} disabled={busyCardId === card.id}><ShieldAlert size={13} /> Report lost/stolen</button>
                            </div>
                          )}

                          {pinFormCardId === card.id && (
                            <div className="ox-card-pin-form">
                              <input type="password" inputMode="numeric" value={pinInputs[card.id] || ''} onChange={(event) => setPinInputs((current) => ({ ...current, [card.id]: event.target.value }))} placeholder="4-8 digit PIN" maxLength={8} />
                              <button type="button" onClick={() => submitPin(card)} disabled={busyCardId === card.id}>{busyCardId === card.id ? 'Saving...' : 'Save PIN'}</button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
              </section>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
