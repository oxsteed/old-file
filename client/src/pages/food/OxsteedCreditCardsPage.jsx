import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  getCreditCardHistory, markCreditCardFound, requestCreditCardReplacement,
} from '../../api/oxsteedCredit';
import CardSecurityDialog from '../../components/credit/CardSecurityDialog';
import CardHistory from '../../components/credit/CardHistory';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import './OxsteedCreditCardsPage.css';
import './OxsteedCreditPage.css';
import AddressAutocomplete from '../../components/AddressAutocomplete';

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `credit-card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dateTime(value, t) {
  return formatCreditDateTime(value, t('cards.notAvailable'), t.lng);
}

function statusLabel(status, t) {
  return t(`cards.status.${status}`, { defaultValue: status });
}

function fulfillmentLabel(status, t) {
  return t(`cards.fulfillment.${status}`, { defaultValue: status });
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
  const { t } = useTranslation('credit');
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
  const [securityOperation, setSecurityOperation] = useState(null);

  const beginVerified = (card, action, payload = {}) => {
    setSecurityOperation({ card, action, payload, requestKey: requestId() });
  };
  const completeVerified = async (operation, proof) => {
    const actions = { activate: activateOxsteedCreditCard, unfreeze: unfreezeOxsteedCreditCard, pin_set: setOxsteedCreditCardPin };
    const result = await actions[operation.action](operation.card.id, { ...operation.payload, ...proof }, operation.requestKey);
    if (result?.card?.credential) setRevealedSecret({ cardId: operation.card.id, value: result.card.credential });
    setActivationInputs({}); setPinInputs({}); setPinFormCardId(null);
    toast.success(t('cards.security.completed'));
    await load({ quiet: true });
  };

  const load = async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const result = await listOxsteedCreditCards();
      setCards(Array.isArray(result) ? result : []);
    } catch (error) {
      setLoadError(safeCreditErrorMessage(error, t('cards.errors.load')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submitIssue = async (event) => {
    event.preventDefault();
    if (form.cardType === 'physical' && !form.addressLine1.trim()) {
      toast.error(t('cards.errors.shippingAddress'));
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
      toast.success(isPhysical ? t('cards.success.physicalRequested') : t('cards.success.virtualIssued'));
      setForm(emptyForm);
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('cards.errors.issue')));
    } finally {
      setIssuing(false);
    }
  };

  const submitActivation = async (card) => {
    const code = (activationInputs[card.id] || '').trim();
    if (card.cardType === 'physical' && !code) {
      toast.error(t('cards.errors.activationCode'));
      return;
    }
    beginVerified(card, 'activate', { activationCode: code });
  };

  const toggleFreeze = async (card) => {
    if (card.status === 'frozen') { beginVerified(card, 'unfreeze'); return; }
    setBusyCardId(card.id);
    try {
      await freezeOxsteedCreditCard(card.id);
      toast.success(t('cards.success.frozen'));
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('cards.errors.update')));
    } finally {
      setBusyCardId(null);
    }
  };

  const reportLost = async (card, status = 'lost') => {
    const confirmed = window.confirm(
      t('cards.security.retireWarning')
    );
    if (!confirmed) return;
    setBusyCardId(card.id);
    setRevealedSecret(null);
    try {
      await reportOxsteedCreditCardLost(card.id, { status });
      toast.success(t('cards.security.retired'));
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('cards.errors.reportLost')));
    } finally {
      setBusyCardId(null);
    }
  };

  const submitPin = async (card) => {
    const pin = (pinInputs[card.id] || '').trim();
    if (!/^\d{4,8}$/.test(pin)) {
      toast.error(t('cards.errors.pinDigits'));
      return;
    }
    beginVerified(card, 'pin_set', { pin, resetPin: true });
  };

  const recoverCard = async (card, action) => {
    setBusyCardId(card.id);
    try {
      await (action === 'found' ? markCreditCardFound : requestCreditCardReplacement)(card.id);
      toast.success(t('cards.security.completed'));
      await load({ quiet: true });
    } catch { toast.error(t('cards.security.failed')); }
    finally { setBusyCardId(null); }
  };

  return (
    <>
      <PageMeta title={t('cards.metaTitle')} description={t('cards.metaDescription')} noIndex />
      <Navbar />
      <main className="ox-credit-page">
        <div className="ox-credit-shell">
          <Link to="/oxsteed-credit" className="ox-credit-back"><ArrowLeft size={16} /> {t('cards.backToCredit')}</Link>

          <header className="ox-credit-hero">
            <div>
              <p className="ox-credit-eyebrow">{t('cards.eyebrow')}</p>
              <h1>{t('cards.title')}</h1>
              <p>{t('cards.pageDescription')}</p>
            </div>
            <div className="ox-credit-hero-actions">
              <button type="button" className="ox-credit-refresh" onClick={() => load({ quiet: true })} disabled={loading || refreshing}>
                <RefreshCw size={16} className={refreshing ? 'ox-credit-spin' : ''} /> {t('cards.refresh')}
              </button>
            </div>
          </header>

          {loadError && !loading && (
            <section className="ox-credit-error-panel" role="alert">
              <AlertCircle size={24} />
              <strong>{t('cards.loadErrorTitle')}</strong>
              <span>{loadError}</span>
              <button type="button" className="ox-credit-refresh" onClick={() => load()}>{t('cards.retry')}</button>
            </section>
          )}

          {revealedSecret && (
            <section className="ox-credit-created-hold ox-card-secret" role="alert" aria-live="assertive">
              <strong>{t('cards.secretTitle')}</strong>
              <code>{revealedSecret.value}</code>
              <span>{t('cards.secretDescription')}</span>
            </section>
          )}

          {!loadError && (
            <>
              <section className="ox-credit-panel ox-card-issue-panel" aria-labelledby="issue-card-heading">
                <div className="ox-credit-panel-heading">
                  <div><p className="ox-credit-eyebrow">{t('cards.addCard')}</p><h2 id="issue-card-heading">{t('cards.issueNew')}</h2></div>
                  <CreditCard size={20} />
                </div>
                <p className="ox-credit-panel-copy">{t('cards.issueDescription')}</p>
                <form className="ox-card-form" onSubmit={submitIssue}>
                  <label>{t('cards.cardType')}
                    <select value={form.cardType} onChange={(event) => setForm({ ...form, cardType: event.target.value })}>
                      <option value="virtual">{t('cards.virtualUseNow')}</option>
                      <option value="physical">{t('cards.physicalShips')}</option>
                    </select>
                  </label>
                  <label>{t('cards.nicknameOptional')}
                    <input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} maxLength={80} placeholder={t('cards.nicknamePlaceholder')} />
                  </label>
                  {form.cardType === 'physical' && <>
                    <label className="ox-card-form-wide">{t('cards.shippingAddress')}
                      <AddressAutocomplete
                        value={form.addressLine1}
                        onChange={(value) => setForm((current) => ({ ...current, addressLine1: value }))}
                        onSelect={(place) => setForm((current) => ({
                          ...current,
                          addressLine1: place.addressLine1 || place.display,
                          city: place.city || current.city,
                          state: place.state || current.state,
                          postalCode: place.zip || current.postalCode,
                          country: place.country || current.country,
                        }))}
                        placeholder={t('cards.streetAddress')}
                        autoComplete="shipping street-address"
                        ariaLabel={t('cards.shippingAddress')}
                      />
                    </label>
                    <label>{t('cards.city')}<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
                    <label>{t('cards.stateRegion')}<input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></label>
                    <label>{t('cards.postalCode')}<input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></label>
                    <label>{t('cards.country')}<input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></label>
                  </>}
                  <button type="submit" disabled={issuing}>{issuing ? t('cards.submitting') : form.cardType === 'physical' ? t('cards.requestPhysical') : t('cards.issueVirtual')}</button>
                </form>
              </section>

              <section className="ox-credit-panel ox-card-list-panel" aria-labelledby="my-cards-heading">
                <div className="ox-credit-panel-heading">
                  <div><p className="ox-credit-eyebrow">{t('cards.yourCards')}</p><h2 id="my-cards-heading">{t('cards.allCards')}</h2></div>
                  <span className="ox-credit-count">{cards.length}</span>
                </div>
                {loading ? <div className="ox-credit-loading" role="status" aria-live="polite">{t('cards.loading')}</div>
                  : !cards.length ? (
                    <div className="ox-credit-empty">
                      <CreditCard size={27} />
                      <strong>{t('cards.noCards')}</strong>
                      <span>{t('cards.noCardsDescription')}</span>
                    </div>
                  ) : (
                    <div className="ox-card-grid">
                      {cards.map((card) => (
                        <article key={card.id} className={`ox-card-tile ox-card-tile-${card.status}`}>
                          <div className="ox-card-tile-top">
                            <span className="ox-card-type-icon"><CreditCard size={18} /></span>
                            <div>
                              <strong>{card.nickname || (card.cardType === 'physical' ? t('cards.physicalCard') : t('cards.virtualCard'))}</strong>
                              <span>{card.credentialLast4 ? t('cards.ending', { last4: card.credentialLast4 }) : t('cards.noCredential')}</span>
                            </div>
                            <span className={`ox-card-status ox-card-status-${card.status}`}>{statusLabel(card.status, t)}</span>
                          </div>
                          <div className="ox-card-tile-meta">
                            <span>{card.cardType === 'physical' ? t('cards.fulfillmentLabel', { status: fulfillmentLabel(card.fulfillmentStatus, t) }) : t('cards.virtualCard')}</span>
                            <span>{t('cards.issued', { date: dateTime(card.issuedAt, t) })}</span>
                            {card.hasPin && <span>{t('cards.pinSet')}</span>}
                          </div>

                          {card.status === 'pending' && (card.cardType === 'physical' || card.replacesCardId) && (
                            <div className="ox-card-activate">
                              {card.cardType === 'physical' && <input aria-label={t('cards.activationPlaceholder')} value={activationInputs[card.id] || ''} onChange={(event) => setActivationInputs((current) => ({ ...current, [card.id]: event.target.value }))} placeholder={t('cards.activationPlaceholder')} maxLength={16} />}
                              <button type="button" onClick={() => submitActivation(card)} disabled={busyCardId === card.id}>{busyCardId === card.id ? t('cards.activating') : t('cards.activate')}</button>
                            </div>
                          )}

                          {['pending', 'active', 'frozen'].includes(card.status) && (
                            <div className="ox-card-actions">
                              {card.status !== 'pending' && <button type="button" onClick={() => toggleFreeze(card)} disabled={busyCardId === card.id || (card.status === 'frozen' && card.freezeOrigin !== 'customer')}>
                                {card.status === 'frozen' ? <><Unlock size={13} /> {t('cards.unfreeze')}</> : <><Snowflake size={13} /> {t('cards.freeze')}</>}
                              </button>}
                              {card.status === 'active' && <button type="button" onClick={() => setPinFormCardId((current) => current === card.id ? null : card.id)}><Lock size={13} /> {card.hasPin ? t('cards.security.resetPin') : t('cards.setPin')}</button>}
                              <button type="button" className="ox-card-danger" onClick={() => reportLost(card)} disabled={busyCardId === card.id}><ShieldAlert size={13} /> {t('cards.security.reportLost')}</button>
                              <button type="button" className="ox-card-danger" onClick={() => reportLost(card, 'stolen')} disabled={busyCardId === card.id}>{t('cards.security.reportStolen')}</button>
                            </div>
                          )}

                          {pinFormCardId === card.id && card.status === 'active' && (
                            <div className="ox-card-pin-form">
                              <input aria-label={t('cards.pinPlaceholder')} type="password" inputMode="numeric" value={pinInputs[card.id] || ''} onChange={(event) => setPinInputs((current) => ({ ...current, [card.id]: event.target.value }))} placeholder={t('cards.pinPlaceholder')} maxLength={8} />
                              <button type="button" onClick={() => submitPin(card)} disabled={busyCardId === card.id}>{busyCardId === card.id ? t('cards.saving') : t('cards.savePin')}</button>
                            </div>
                          )}
                          {card.status === 'frozen' && card.freezeOrigin !== 'customer' && <p>{t('cards.security.blocked')}</p>}
                          {['lost', 'stolen'].includes(card.status) && <>
                            <p>{t('cards.security.remainsDisabled')}</p>
                            {card.foundAt ? <p>{t('cards.security.foundRecorded')}</p> : <button type="button" onClick={() => recoverCard(card, 'found')} disabled={busyCardId === card.id}>{t('cards.security.found')}</button>}
                            {card.replacementStatus ? <p>{t(`cards.security.replacement.${card.replacementStatus}`)}</p> : <button type="button" onClick={() => recoverCard(card, 'replacement')} disabled={busyCardId === card.id}>{t('cards.security.requestReplacement')}</button>}
                          </>}
                          <CardHistory cardId={card.id} fetchHistory={getCreditCardHistory} />
                          <Link to="/support">{t('cards.security.support')}</Link>
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
      {securityOperation && <CardSecurityDialog operation={securityOperation} onComplete={completeVerified} onClose={() => setSecurityOperation(null)} />}
    </>
  );
}
