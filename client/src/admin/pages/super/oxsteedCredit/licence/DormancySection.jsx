import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, inputClass, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';

const CASE_STATUSES = ['notified', 'escheat_due', 'escheated', 'remitted', 'reclaimed', 'reactivated', ''];

/**
 * Dormancy and unclaimed property (§8): per-jurisdiction policies, the
 * daily sweep that notifies holders, then escheat, remittance to the
 * authority and reclaim, each approved by two admins.
 */
export default function DormancySection() {
  const { t } = useTranslation('credit');
  const [status, setStatus] = useState('escheat_due');
  const [selected, setSelected] = useState([]);
  const data = useLicenceGet('/dormancy', { status: status || undefined, limit: 200 });
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();

  const sweep = async () => {
    await action.run(() => adminApi.post(`${LICENCE_API}/dormancy/sweep`), 'adminLicence.done');
    data.reload();
  };
  const escheat = (row) => action.run(() => requestOversight('credit_escheat_execute', { caseId: row.id }), 'adminLicence.requested');
  const reclaim = async (row) => {
    const verificationNote = await requestDialog({ kind: 'text', title: t('adminLicence.reclaim'), description: t('adminLicence.reclaimHelp'), label: t('adminLicence.col.reason'), maxLength: 1000 });
    if (!verificationNote) return;
    await action.run(() => requestOversight('credit_escheat_reclaim', { caseId: row.id, verificationNote }), 'adminLicence.requested');
  };
  const remit = async () => {
    const authorityReference = await requestDialog({ kind: 'text', title: t('adminLicence.remit'), description: t('adminLicence.remitHelp', { count: selected.length }), label: t('adminLicence.col.reference'), maxLength: 200 });
    if (!authorityReference) return;
    const done = await action.run(() => requestOversight('credit_escheat_remit', { caseIds: selected, authorityReference }), 'adminLicence.requested');
    if (done) setSelected([]);
  };
  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const summary = data.data?.summary;
  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || data.error} />
      <Panel
        title={t('adminLicence.dormancyTitle')}
        detail={summary?.enabled ? t('adminLicence.dormancyEnabled') : t('adminLicence.dormancyDisabled')}
        actions={<ActionButton disabled={action.busy} onClick={sweep}>{t('adminLicence.runSweep')}</ActionButton>}
      >
        <LicenceTable
          rows={(summary?.byStatus || []).map((r) => ({ ...r, id: `${r.status}-${r.currency}` }))}
          columns={[{ key: 'status' }, { key: 'currency' }, { key: 'count' }, { key: 'total_minor', label: 'amount', kind: 'money' }]}
        />
      </Panel>
      <Panel title={t('adminLicence.policiesTitle')} detail={t('adminLicence.policiesDetail')}>
        <LicenceTable
          rows={(data.data?.policies || []).map((p) => ({ ...p, id: p.country_code }))}
          columns={[
            { key: 'country_code', label: 'country' },
            { key: 'enabled' },
            { key: 'dormant_after_days', label: 'dormantAfterDays' },
            { key: 'notice_period_days', label: 'noticeDays' },
            { key: 'authority_name', label: 'authority' },
            { key: 'legal_reference', label: 'reference' },
            { key: 'updated_at', label: 'date', kind: 'date' },
          ]}
        />
      </Panel>
      <Panel
        title={t('adminLicence.casesTitle')}
        actions={(
          <>
            <Field label={t('adminLicence.col.status')}>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setSelected([]); }} className={inputClass}>
                {CASE_STATUSES.map((s) => <option key={s || 'all'} value={s}>{s ? t(`adminLicence.status.${s}`) : t('adminLicence.status.all')}</option>)}
              </select>
            </Field>
            <ActionButton tone="primary" disabled={action.busy || selected.length === 0} onClick={remit}>{t('adminLicence.remit')}</ActionButton>
          </>
        )}
      >
        <LicenceTable
          rows={data.data?.cases || []}
          columns={[
            { key: 'select', label: 'select', render: (v, row) => row.status === 'escheated' && <input type="checkbox" aria-label={t('adminLicence.col.select')} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /> },
            { key: 'id' },
            { key: 'status' },
            { key: 'country_code', label: 'country' },
            { key: 'balance_minor', label: 'amount', kind: 'money' },
            { key: 'source' },
            { key: 'last_activity_at', label: 'lastActivity', kind: 'date' },
            { key: 'deadline_at', label: 'deadline', kind: 'date' },
          ]}
          actions={(row) => (
            <>
              {row.status === 'escheat_due' && <ActionButton disabled={action.busy} onClick={() => escheat(row)}>{t('adminLicence.escheat')}</ActionButton>}
              {['escheated', 'remitted'].includes(row.status) && <ActionButton disabled={action.busy} onClick={() => reclaim(row)}>{t('adminLicence.reclaim')}</ActionButton>}
            </>
          )}
        />
      </Panel>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}
