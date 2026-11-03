import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { reasonMessage } from './creditLicenceClient';
import './CreditLicencePanels.css';

/**
 * Open-loop stored-value disclosures (licence readiness §7): the short and
 * long form, the fee schedule and the "not a bank account / not insured"
 * notice, served by the server in the reader's language with the live fee
 * table, and accepted against the exact text hash the person saw.
 */
export default function CreditDisclosuresPanel({ currency = 'USD', context = 'pre_acquisition' }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState(null);
  const [preAcquisition, setPreAcquisition] = useState([]);
  const [agreed, setAgreed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lang = i18n.language;

  const load = useCallback(() => {
    api.get('/payment-layers/credit/disclosures/mine', { params: { lang, currency } })
      .then(({ data }) => { setItems(data.disclosures || []); setPreAcquisition(data.pre_acquisition || []); })
      .catch(() => setItems(null));
  }, [lang, currency]);
  useEffect(() => { load(); }, [load]);
  if (!items || !items.length) return null;

  const required = items.filter((i) => preAcquisition.includes(i.kind));
  const pending = required.filter((i) => !i.accepted);
  const others = items.filter((i) => !preAcquisition.includes(i.kind));

  const accept = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/payment-layers/credit/disclosures/accept', {
        items: pending.map((i) => ({ kind: i.kind, sha256: i.sha256 })), language: lang, currency, context,
      });
      toast.success(t('paymentRail.disclosures.acceptedToast'));
      setAgreed(false);
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
      load();
    } finally { setBusy(false); }
  };

  return (
    <section className="ox-credit-panel ox-licence-panel" aria-labelledby="credit-disclosures-h" dir={i18n.dir?.()}>
      <div className="ox-credit-panel-heading"><div><h2 id="credit-disclosures-h">{t('paymentRail.disclosures.title')}</h2></div></div>
      <p className="ox-credit-panel-copy">{pending.length ? t('paymentRail.disclosures.intro') : t('paymentRail.disclosures.allAccepted')}</p>
      <div className="ox-licence-body">
        {(pending.length ? required : []).concat(open ? (pending.length ? others : items) : []).map((item) => (
          <article key={item.kind} className="ox-licence-terms" lang={item.language}>
            <h3>{item.title}{item.accepted && <span className="ox-licence-status ox-licence-status-verified">{t('paymentRail.disclosures.accepted')}</span>}</h3>
            <p>{item.body}</p>
          </article>
        ))}
        <button type="button" className="ox-licence-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('paymentRail.disclosures.hideAll') : t('paymentRail.disclosures.showAll')}
        </button>
        {pending.length > 0 && (
          <form className="ox-licence-form" onSubmit={accept}>
            <label className="ox-licence-inline">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> {t('paymentRail.disclosures.accept')}
            </label>
            <button type="submit" disabled={busy || !agreed}>{t('paymentRail.disclosures.acceptButton')}</button>
          </form>
        )}
      </div>
    </section>
  );
}
