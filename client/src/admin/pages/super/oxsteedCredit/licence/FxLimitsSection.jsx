import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import {
  ActionButton, LICENCE_API, LicenceTable, Notices, Panel, useLicenceAction, useLicenceGet,
} from './licenceShared';

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
  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || rates.error || limits.error} />
      <Panel title={t('adminLicence.fxTitle')} detail={t('adminLicence.fxDetail')} actions={<ActionButton disabled={action.busy} onClick={refresh}>{t('adminLicence.refresh')}</ActionButton>}>
        <LicenceTable
          rows={rates.data?.rates || []}
          columns={[
            { key: 'source' }, { key: 'base_currency', label: 'currency' }, { key: 'quote_currency', label: 'quoteCurrency' },
            { key: 'units_per_base', label: 'rate' }, { key: 'rate_date', label: 'date' }, { key: 'fetched_at', label: 'checked', kind: 'date' },
          ]}
        />
      </Panel>
      <Panel title={t('adminLicence.limitsTitle')} detail={t('adminLicence.limitsDetail')}>
        <LicenceTable
          rows={limits.data?.rules || []}
          columns={[
            { key: 'limitKey', label: 'name' }, { key: 'scope', label: 'type' }, { key: 'scopeCode', label: 'reference' },
            { key: 'kycTier', label: 'tier' }, { key: 'amountMinor', label: 'amount', kind: 'money', currencyKey: 'currencyCode' },
            { key: 'active' }, { key: 'updatedAt', label: 'date', kind: 'date' },
          ]}
        />
        <LicenceTable
          rows={(limits.data?.keys || []).map((key) => ({ id: key, name: key, usd: defaults[key], currency: 'USD' }))}
          columns={[{ key: 'name' }, { key: 'usd', label: 'defaultUsd', kind: 'money' }]}
        />
        <LicenceTable
          rows={(limits.data?.referenceRates || []).map((r) => ({ ...r, id: r.currencyCode }))}
          columns={[{ key: 'currencyCode', label: 'currency' }, { key: 'unitsPerUsd', label: 'rate' }, { key: 'source' }, { key: 'asOf', label: 'date' }]}
        />
      </Panel>
    </div>
  );
}
