import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, inputClass, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';
import { manualRateProblem } from './oversightTemplates';

const EMPTY_MANUAL = { quoteCurrency: 'HTG', unitsPerUsd: '', rateDate: '', note: '' };

/**
 * Official FX reference rates (BRH for HTG; stale rates fail closed) and
 * the limits stored as data. Changes go through the oversight actions
 * credit_limit_rule_update and credit_limit_reference_rate_update.
 */
export default function FxLimitsSection() {
  const { t } = useTranslation('credit');
  const rates = useLicenceGet('/fx/reference-rates');
  const limits = useLicenceGet('/limits');
  const action = useLicenceAction();
  const refresh = async () => { await action.run(() => adminApi.post(`${LICENCE_API}/fx/refresh`), 'adminLicence.done'); rates.reload(); };
  const defaults = limits.data?.codeDefaultsUsdMinor || {};
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const setM = (patch) => setManual((m) => ({ ...m, ...patch }));
  // Gap fill 9: a ready-made form for the two-admin manual reference rate
  // (oversight action credit_fx_reference_rate_entry). A different admin
  // approves it in the oversight queue before the rate is stored.
  const submitManual = async (event) => {
    event.preventDefault();
    const problem = manualRateProblem(manual);
    if (problem) { action.setError(t(`adminLicence.${problem}`)); return; }
    const done = await action.run(() => requestOversight('credit_fx_reference_rate_entry', {
      quoteCurrency: manual.quoteCurrency.trim().toUpperCase(), unitsPerUsd: manual.unitsPerUsd.trim(), rateDate: manual.rateDate, note: manual.note.trim(),
    }), 'adminLicence.requested');
    if (done) setManual(EMPTY_MANUAL);
  };
  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || rates.error || limits.error} />
      <Panel title={t('adminLicence.fxTitle')} detail={t('adminLicence.fxDetail')} actions={<ActionButton disabled={action.busy} onClick={refresh}>{t('adminLicence.refresh')}</ActionButton>}>
        <LicenceTable
          loading={rates.loading}
          error={rates.error}
          onRetry={rates.reload}
          rows={rates.data?.rates || []}
          columns={[
            { key: 'source' }, { key: 'base_currency', label: 'currency' }, { key: 'quote_currency', label: 'quoteCurrency' },
            { key: 'units_per_base', label: 'rate' }, { key: 'rate_date', label: 'date' }, { key: 'fetched_at', label: 'checked', kind: 'date' },
          ]}
        />
      </Panel>
      <Panel title={t('adminLicence.fxManualTitle')} detail={t('adminLicence.fxManualDetail')}>
        <form onSubmit={submitManual} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-form="fx-manual">
          <Field label={t('adminLicence.col.quoteCurrency')}>
            <input required dir="ltr" maxLength={3} value={manual.quoteCurrency} onChange={(e) => setM({ quoteCurrency: e.target.value.toUpperCase() })} className={inputClass} />
          </Field>
          <Field label={t('adminLicence.fxManualUnits')}>
            <input required dir="ltr" inputMode="decimal" value={manual.unitsPerUsd} onChange={(e) => setM({ unitsPerUsd: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t('adminLicence.fxManualDate')}>
            <input required type="date" dir="ltr" value={manual.rateDate} onChange={(e) => setM({ rateDate: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t('adminLicence.fxManualNote')}>
            <input required maxLength={1000} value={manual.note} onChange={(e) => setM({ note: e.target.value })} className={inputClass} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4"><ActionButton type="submit" tone="primary" disabled={action.busy}>{t('adminLicence.fxManualSubmit')}</ActionButton></div>
        </form>
      </Panel>
      <Panel title={t('adminLicence.limitsTitle')} detail={t('adminLicence.limitsDetail')}>
        <LicenceTable
          loading={limits.loading}
          error={limits.error}
          onRetry={limits.reload}
          rows={limits.data?.rules || []}
          columns={[
            { key: 'limitKey', label: 'name' }, { key: 'scope', label: 'type' }, { key: 'scopeCode', label: 'reference' },
            { key: 'kycTier', label: 'tier' }, { key: 'amountMinor', label: 'amount', kind: 'money', currencyKey: 'currencyCode' },
            { key: 'active' }, { key: 'updatedAt', label: 'date', kind: 'date' },
          ]}
        />
        <LicenceTable
          loading={limits.loading}
          error={limits.error}
          onRetry={limits.reload}
          rows={(limits.data?.keys || []).map((key) => ({ id: key, name: key, usd: defaults[key], currency: 'USD' }))}
          columns={[{ key: 'name' }, { key: 'usd', label: 'defaultUsd', kind: 'money' }]}
        />
        <LicenceTable
          loading={limits.loading}
          error={limits.error}
          onRetry={limits.reload}
          rows={(limits.data?.referenceRates || []).map((r) => ({ ...r, id: r.currencyCode }))}
          columns={[{ key: 'currencyCode', label: 'currency' }, { key: 'unitsPerUsd', label: 'rate' }, { key: 'source' }, { key: 'asOf', label: 'date' }]}
        />
      </Panel>
    </div>
  );
}
