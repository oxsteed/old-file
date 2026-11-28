// Credit redesign (D-798/D-799/D-800/D-806): the Cards drawer. The full
// cards page (/oxsteed-credit/cards) stays for activation, PIN, physical
// requests, and history; the drawer covers the daily surface: the masked
// card face, Reveal, Freeze/Unfreeze, per-card limits, Report lost, and
// issuing a virtual card. Every privileged action runs through the same
// CardSecurityDialog step-up the full page uses. A revealed number or a
// fresh security code is shown once, in memory only, and dies when the
// drawer closes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CreditCard, Lock, ShieldAlert, Snowflake, Unlock } from 'lucide-react';
import {
  listOxsteedCreditCards,
  issueOxsteedCreditVirtualCard,
  freezeOxsteedCreditCard,
  unfreezeOxsteedCreditCard,
  reportOxsteedCreditCardLost,
  revealOxsteedCreditCard,
  resetOxsteedCreditCardSecurityCode,
  setOxsteedCreditCardLimits,
} from '../../api/oxsteedCredit';
import CardSecurityDialog from './CardSecurityDialog';
import { safeCreditErrorMessage } from '../../lib/creditErrors';
// The drawer renders ox-card-* tiles, so it imports the cards stylesheet
// itself: Vite code-splits CSS per chunk, and the full cards page's chunk
// is not loaded when this drawer opens from /oxsteed-credit.
import '../../pages/food/OxsteedCreditCardsPage.css';
import { formatCreditMinorUnits, parseCreditMajorAmount } from '../../lib/creditCurrency';
import { formatMaskedCardNumber, groupCardNumber } from '../../lib/creditRedesignUi';

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `credit-card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusLabel(status, t) {
  return t(`cards.status.${status}`, { defaultValue: status });
}

const LIMIT_TYPES = ['pickup', 'dine_in', 'delivery'];

export default function CreditCardsDrawer({ currencyCode = 'USD' }) {
  const { t } = useTranslation('credit');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [busyCardId, setBusyCardId] = useState(null);
  const [securityOperation, setSecurityOperation] = useState(null);
  const [limitsInputs, setLimitsInputs] = useState({});

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

  const beginVerified = (card, action, payload = {}) => {
    setSecurityOperation({ card, action, payload, requestKey: requestId() });
  };

  const completeVerified = async (operation, proof) => {
    const actions = {
      reveal: revealOxsteedCreditCard,
      security_code_reset: resetOxsteedCreditCardSecurityCode,
      limits_set: setOxsteedCreditCardLimits,
      unfreeze: unfreezeOxsteedCreditCard,
    };
    const result = await actions[operation.action](operation.card.id, { ...operation.payload, ...proof }, operation.requestKey);
    if (operation.action === 'reveal' && result?.cardNumber) {
      setRevealed({ cardId: operation.card.id, kind: 'number', value: result.cardNumber });
    } else if (operation.action === 'security_code_reset' && result?.securityCode) {
      setRevealed({ cardId: operation.card.id, kind: 'code', value: result.securityCode });
    } else {
      setRevealed(null);
    }
    toast.success(t(operation.action === 'limits_set' ? 'cards.limitsSaved' : 'cards.security.completed'));
    await load({ quiet: true });
  };

  const submitIssueVirtual = async (event) => {
    event.preventDefault();
    setIssuing(true);
    setRevealed(null);
    try {
      const result = await issueOxsteedCreditVirtualCard(
        { currencyCode, nickname: nickname.trim() || undefined },
        requestId(),
      );
      if (result?.card?.credential) {
        setRevealed({ cardId: result.card.id, kind: 'number', value: result.card.credential, securityCode: result.card.securityCode || null });
      }
      toast.success(t('cards.success.virtualIssued'));
      setNickname('');
      await load({ quiet: true });
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('cards.errors.issue')));
    } finally {
      setIssuing(false);
    }
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
    if (!window.confirm(t('cards.security.retireWarning'))) return;
    setBusyCardId(card.id);
    setRevealed(null);
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

  const submitLimits = (card) => {
    const inputs = limitsInputs[card.id] || {};
    const dailyLimitCents = inputs.daily ? parseCreditMajorAmount(inputs.daily, currencyCode) : null;
    const merchantTypeLimits = {};
    for (const type of LIMIT_TYPES) {
      const cents = inputs[type] ? parseCreditMajorAmount(inputs[type], currencyCode) : null;
      if (cents) merchantTypeLimits[type] = cents;
    }
    if (dailyLimitCents === null && Object.keys(merchantTypeLimits).length === 0) {
      // Clearing every limit is a real choice, not a no-op: the server
      // treats nulls as "remove the cap". Confirm through step-up anyway.
    }
    beginVerified(card, 'limits_set', {
      dailyLimitCents,
      merchantTypeLimits: Object.keys(merchantTypeLimits).length ? merchantTypeLimits : null,
    });
  };

  const setLimitInput = (cardId, field, value) => {
    setLimitsInputs((current) => ({ ...current, [cardId]: { ...(current[cardId] || {}), [field]: value } }));
  };

  return (
    <>
      {loadError && (
        <div className="ox-credit-error-panel" role="alert">
          <strong>{t('cards.loadErrorTitle')}</strong>
          <span>{loadError}</span>
          <button type="button" className="ox-credit-refresh" onClick={() => load()}>{t('cards.retry')}</button>
        </div>
      )}

      {revealed && (
        <div className="ox-credit-created-hold ox-card-secret" role="alert" aria-live="assertive">
          <strong>{revealed.kind === 'number' ? t('cards.revealTitle') : t('cards.newSecurityCodeTitle')}</strong>
          <code>{revealed.kind === 'number' ? groupCardNumber(revealed.value) : revealed.value}</code>
          {revealed.kind === 'number' && revealed.securityCode && (
            <span>{t('cards.newSecurityCodeLine', { code: revealed.securityCode })}</span>
          )}
          <span>{t(revealed.kind === 'number' ? 'cards.revealDescription' : 'cards.newSecurityCodeCopy')}</span>
        </div>
      )}

      {!loadError && (
        <>
          <section aria-labelledby="credit-cards-issue-heading">
            <div className="ox-credit-panel-heading">
              <div><p className="ox-credit-eyebrow">{t('cards.addCard')}</p><h2 id="credit-cards-issue-heading">{t('cards.issueNew')}</h2></div>
              <CreditCard size={20} />
            </div>
            <p className="ox-credit-panel-copy">{t('cards.issueDescription')}</p>
            <form className="ox-credit-authorize-form" onSubmit={submitIssueVirtual}>
              <label>{t('cards.nicknameOptional')}
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={80} placeholder={t('cards.nicknamePlaceholder')} />
              </label>
              <button type="submit" disabled={issuing}>{issuing ? t('cards.submitting') : t('cards.issueVirtual')}</button>
            </form>
          </section>

          {loading ? (
            <div className="ox-credit-loading" role="status" aria-live="polite">{t('cards.loading')}</div>
          ) : !cards.length ? (
            <div className="ox-credit-empty">
              <CreditCard size={27} />
              <strong>{t('cards.noCards')}</strong>
              <span>{t('cards.noCardsDescription')}</span>
            </div>
          ) : (
            <div className="ox-card-grid">
              {cards.map((card) => {
                const masked = formatMaskedCardNumber(card.credentialLast4);
                const inputs = limitsInputs[card.id] || {};
                return (
                  <article key={card.id} className={`ox-card-tile ox-card-tile-${card.status}`}>
                    <div className="ox-card-tile-top">
                      <span className="ox-card-type-icon"><CreditCard size={18} /></span>
                      <div>
                        <strong>{card.nickname || (card.cardType === 'physical' ? t('cards.physicalCard') : t('cards.virtualCard'))}</strong>
                        <span>{masked || t('cards.noCredential')}</span>
                      </div>
                      <span className={`ox-card-status ox-card-status-${card.status}`}>{statusLabel(card.status, t)}</span>
                    </div>
                    {card.dailyLimitCents !== null && card.dailyLimitCents !== undefined && (
                      <p className="ox-card-status-reason">{t('cards.dailyLimitSet', { amount: formatCreditMinorUnits(card.dailyLimitCents, currencyCode) })}</p>
                    )}

                    {card.status === 'active' && (
                      <div className="ox-card-actions">
                        {card.hasRevealableNumber && (
                          <button type="button" onClick={() => beginVerified(card, 'reveal')} disabled={busyCardId === card.id}>
                            {t('cards.reveal')}
                          </button>
                        )}
                        {card.hasSecurityCode && (
                          <button type="button" onClick={() => beginVerified(card, 'security_code_reset')} disabled={busyCardId === card.id}>
                            <Lock size={13} /> {t('cards.resetSecurityCode')}
                          </button>
                        )}
                        <button type="button" onClick={() => toggleFreeze(card)} disabled={busyCardId === card.id}>
                          <Snowflake size={13} /> {t('cards.freeze')}
                        </button>
                        <button type="button" className="ox-card-danger" onClick={() => reportLost(card)} disabled={busyCardId === card.id}>
                          <ShieldAlert size={13} /> {t('cards.security.reportLost')}
                        </button>
                      </div>
                    )}
                    {card.status === 'frozen' && (
                      <div className="ox-card-actions">
                        <button type="button" onClick={() => toggleFreeze(card)} disabled={busyCardId === card.id || card.freezeOrigin !== 'customer'}>
                          <Unlock size={13} /> {t('cards.unfreeze')}
                        </button>
                        {card.freezeOrigin !== 'customer' && <p>{t('cards.security.blocked')}</p>}
                      </div>
                    )}
                    {['lost', 'stolen'].includes(card.status) && <p>{t('cards.security.remainsDisabled')}</p>}

                    {card.status === 'active' && (
                      <div className="ox-card-limits-form">
                        <strong>{t('cards.limitsTitle')}</strong>
                        <span>{t('cards.limitsCopy')}</span>
                        <label>{t('cards.dailyLimitLabel')}
                          <input inputMode="decimal" value={inputs.daily || ''} onChange={(event) => setLimitInput(card.id, 'daily', event.target.value)} placeholder={card.dailyLimitCents ? formatCreditMinorUnits(card.dailyLimitCents, currencyCode) : t('cards.noLimit')} />
                        </label>
                        {LIMIT_TYPES.map((type) => (
                          <label key={type}>{t(`cards.limitType.${type}`)}
                            <input inputMode="decimal" value={inputs[type] || ''} onChange={(event) => setLimitInput(card.id, type, event.target.value)} placeholder={card.merchantTypeLimits?.[type] ? formatCreditMinorUnits(card.merchantTypeLimits[type], currencyCode) : t('cards.noLimit')} />
                          </label>
                        ))}
                        <button type="button" onClick={() => submitLimits(card)} disabled={busyCardId === card.id}>{t('cards.saveLimits')}</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <p className="ox-credit-panel-copy">
            <Link to="/oxsteed-credit/cards" className="ox-credit-detail-link">{t('cards.openFullCardsPage')}</Link>
          </p>
        </>
      )}
      {securityOperation && (
        <CardSecurityDialog
          operation={securityOperation}
          onComplete={completeVerified}
          onClose={() => setSecurityOperation(null)}
        />
      )}
    </>
  );
}
