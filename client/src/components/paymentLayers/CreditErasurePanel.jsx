import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatMoney } from '../../shared/money.js';
import usePaymentLayersConfig from '../../hooks/usePaymentLayersConfig';
import { reasonMessage } from './creditLicenceClient';
import './CreditLicencePanels.css';

/**
 * A data-erasure request is held while the person still has a Credit
 * balance (licence readiness §8). They choose: cash out or spend it first,
 * or hand it to the unclaimed-property process so erasure can go ahead and
 * the money can still be claimed later.
 */
export default function CreditErasurePanel() {
  const { t, i18n } = useTranslation();
  const flags = usePaymentLayersConfig();
  const enabled = Boolean(flags.PRIVACY_RETENTION);
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!enabled) return;
    api.get('/payment-layers/privacy/erasure').then(({ data }) => setRequest(data.request || null)).catch(() => setRequest(null));
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  if (!enabled || !request || request.blocked_reason !== 'positive_credit_balance') return null;

  const balances = request.credit_balances || [];
  const handOver = async () => {
    if (!window.confirm(t('paymentRail.erasure.unclaimedConfirm'))) return;
    setBusy(true);
    try {
      await api.post('/payment-layers/privacy/erasure/credit-disposition', { choice: 'unclaimed_property' });
      toast.success(t('paymentRail.erasure.unclaimedDone'));
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  return (
    <section className="ox-credit-panel ox-licence-panel" aria-labelledby="credit-erasure-h" dir={i18n.dir?.()}>
      <div className="ox-credit-panel-heading"><div><h2 id="credit-erasure-h">{t('paymentRail.erasure.title')}</h2></div></div>
      <p className="ox-credit-panel-copy">{t('paymentRail.erasure.blocked')}</p>
      <div className="ox-licence-body">
        {balances.length > 0 && (
          <ul className="ox-licence-list">
            {balances.map((b) => (
              <li key={`${b.account_type}-${b.currency}`}><strong>{formatMoney(Number(b.balance_minor), b.currency, i18n.language)}</strong></li>
            ))}
          </ul>
        )}
        <p className="ox-licence-copy">{t('paymentRail.erasure.redeem')}</p>
        <p className="ox-licence-copy">{t('paymentRail.erasure.unclaimedHelp')}</p>
        <div className="ox-licence-actions">
          <button type="button" disabled={busy} onClick={handOver}>{t('paymentRail.erasure.unclaimed')}</button>
        </div>
      </div>
    </section>
  );
}
