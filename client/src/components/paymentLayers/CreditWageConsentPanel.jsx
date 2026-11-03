import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatDay, reasonMessage } from './creditLicenceClient';

const ALTERNATIVES = ['bank_transfer', 'cash', 'check', 'other'];

/**
 * Wage-payment consent (licence readiness §7): pay arrives in OxSteed Credit
 * only after the helper agrees to the current terms; they can withdraw at
 * any time and choose another way to be paid.
 *
 * Gap fill 2: rendered on its own (standalone) for every worker, whether or
 * not cash-out is on, because a customer cannot pay them in Credit while
 * OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED is on and no consent is recorded.
 */
export default function CreditWageConsentPanel({ currency, standalone = false }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [alternative, setAlternative] = useState('');
  const [showTerms, setShowTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const lang = i18n.language;

  const load = useCallback(() => {
    api.get('/payment-layers/credit/wage-consent', { params: { lang, currency } })
      .then(({ data }) => setState(data)).catch(() => setState(null));
  }, [lang, currency]);
  useEffect(() => { load(); }, [load]);
  if (!state || state.relevant === false) return null;

  const grant = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/payment-layers/credit/wage-consent', { terms_sha256: state.terms.sha256, language: lang, currency });
      toast.success(t('paymentRail.wage.granted'));
      setAgreed(false);
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
      load();
    } finally { setBusy(false); }
  };

  const withdraw = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/payment-layers/credit/wage-consent/withdraw', { alternative_method: alternative, language: lang });
      toast.success(t('paymentRail.wage.withdrawn'));
      setAlternative('');
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  const granted = state.status === 'granted';
  const Heading = standalone ? 'h2' : 'h3';
  const body = (
    <div className="ox-licence-block" aria-labelledby="wage-consent-h">
      <Heading id="wage-consent-h">{t('paymentRail.wage.title')}</Heading>
      <p className="ox-licence-copy">{t('paymentRail.wage.intro')}</p>
      {state.required && state.status !== 'granted' && (
        <p className="ox-licence-copy" role="note">{t('paymentRail.wage.requiredNote')}</p>
      )}
      <p className="ox-licence-copy" role="status">
        {granted && t('paymentRail.wage.statusGranted', { date: formatDay(state.since, lang) })}
        {state.status === 'withdrawn' && t('paymentRail.wage.statusWithdrawn', { method: t(`paymentRail.wage.alt.${state.alternative_method}`, { defaultValue: state.alternative_method || '' }) })}
        {state.status === 'none' && t('paymentRail.wage.statusNone')}
      </p>
      <button type="button" className="ox-licence-link" aria-expanded={showTerms} onClick={() => setShowTerms((v) => !v)}>{t('paymentRail.wage.readTerms')}</button>
      {showTerms && state.terms && (
        <article className="ox-licence-terms" lang={state.terms.language}>
          <h4>{state.terms.title}</h4>
          <p>{state.terms.body}</p>
        </article>
      )}
      {!granted ? (
        <form className="ox-licence-form" onSubmit={grant}>
          <label className="ox-licence-inline">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> {t('paymentRail.wage.agree')}
          </label>
          <button type="submit" disabled={busy || !agreed}>{t('paymentRail.wage.grant')}</button>
        </form>
      ) : (
        <form className="ox-licence-form" onSubmit={withdraw}>
          <p className="ox-licence-copy">{t('paymentRail.wage.withdrawHelp')}</p>
          <label><span>{t('paymentRail.wage.alternative')}</span>
            <select required value={alternative} onChange={(e) => setAlternative(e.target.value)}>
              <option value="">{t('paymentRail.wage.chooseAlternative')}</option>
              {ALTERNATIVES.map((a) => <option key={a} value={a}>{t(`paymentRail.wage.alt.${a}`)}</option>)}
            </select></label>
          <button type="submit" disabled={busy || !alternative}>{t('paymentRail.wage.withdraw')}</button>
        </form>
      )}
    </div>
  );
  if (!standalone) return body;
  return (
    <section className="ox-credit-panel ox-licence-panel" dir={i18n.dir?.()}>
      <div className="ox-licence-body">{body}</div>
    </section>
  );
}
