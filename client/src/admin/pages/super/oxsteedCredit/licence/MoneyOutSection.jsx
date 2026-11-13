import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, inputClass, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';

/**
 * In-house bank payout rail (§5, §10): export a batch file for the bank,
 * then two different admins confirm each instruction paid or returned.
 * Held cash-outs are released by oversight or rejected with a reason.
 */
export default function MoneyOutSection() {
  const { t } = useTranslation('credit');
  const [status, setStatus] = useState('pending_export');
  const [corridor, setCorridor] = useState({ countryCode: 'HT', currencyCode: 'HTG' });
  const instructions = useLicenceGet('/bank-payouts', { status: status || undefined, limit: 200 });
  const held = useLicenceGet('/cashouts/held', { limit: 200 });
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();

  const exportBatch = async (event) => {
    event.preventDefault();
    const result = await action.run(() => adminApi.post(`${LICENCE_API}/bank-payouts/export`, corridor), 'adminLicence.exported');
    const csv = result?.data?.csv;
    if (csv) {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.data.filename || `oxsteed-payouts-${corridor.countryCode}-${corridor.currencyCode}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    instructions.reload();
  };

  const confirm = async (row, outcome) => {
    const bankReference = await requestDialog({ kind: 'text', title: outcome === 'paid' ? t('adminLicence.confirmPaid') : t('adminLicence.confirmReturned'), description: t('adminLicence.confirmHelp'), label: t('adminLicence.col.reference'), required: false, maxLength: 120 });
    if (bankReference === null) return;
    await action.run(() => adminApi.post(`${LICENCE_API}/bank-payouts/${encodeURIComponent(row.id)}/confirm`, { outcome, bankReference: bankReference || null }), 'adminLicence.done');
    instructions.reload();
  };

  const release = async (row) => {
    await action.run(() => requestOversight('credit_cashout_release', { cashoutId: row.id }), 'adminLicence.requested');
  };

  const reject = async (row) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminLicence.rejectCashout'), description: t('adminLicence.rejectDescription'), label: t('adminLicence.col.reason'), maxLength: 1000 });
    if (!reason) return;
    await action.run(() => adminApi.post(`${LICENCE_API}/cashouts/${encodeURIComponent(row.id)}/reject`, { reason }), 'adminLicence.done');
    held.reload();
  };

  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || instructions.error || held.error} />
      <Panel title={t('adminLicence.bankTitle')} detail={t('adminLicence.bankDetail')}>
        <form onSubmit={exportBatch} className="flex flex-wrap items-end gap-3">
          <Field label={t('adminLicence.col.country')}><input required maxLength={2} dir="ltr" value={corridor.countryCode} onChange={(e) => setCorridor((c) => ({ ...c, countryCode: e.target.value.toUpperCase() }))} className={inputClass} /></Field>
          <Field label={t('adminLicence.col.currency')}><input required maxLength={3} dir="ltr" value={corridor.currencyCode} onChange={(e) => setCorridor((c) => ({ ...c, currencyCode: e.target.value.toUpperCase() }))} className={inputClass} /></Field>
          <ActionButton type="submit" tone="primary" disabled={action.busy}>{t('adminLicence.exportBatch')}</ActionButton>
          <Field label={t('adminLicence.col.status')}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              {['pending_export', 'exported', 'paid', 'returned', 'canceled', ''].map((s) => <option key={s || 'all'} value={s}>{s ? t(`adminLicence.status.${s}`) : t('adminLicence.status.all')}</option>)}
            </select>
          </Field>
        </form>
        <LicenceTable
          loading={instructions.loading} error={instructions.error}
          rows={instructions.data?.instructions || []}
          columns={[
            { key: 'id' },
            { key: 'purpose', label: 'type' },
            { key: 'status' },
            { key: 'country_code', label: 'country' },
            { key: 'amount_minor', label: 'amount', kind: 'money', currencyKey: 'currency_code' },
            { key: 'payment_reference', label: 'reference' },
            { key: 'first_confirmed_outcome', label: 'firstConfirmation' },
            { key: 'created_at', label: 'created', kind: 'date' },
          ]}
          actions={(row) => row.status === 'exported' && (
            <>
              <ActionButton disabled={action.busy} onClick={() => confirm(row, 'paid')}>{t('adminLicence.confirmPaid')}</ActionButton>
              <ActionButton tone="danger" disabled={action.busy} onClick={() => confirm(row, 'returned')}>{t('adminLicence.confirmReturned')}</ActionButton>
            </>
          )}
        />
      </Panel>
      <Panel title={t('adminLicence.heldTitle')} detail={t('adminLicence.heldDetail')}>
        <LicenceTable
          loading={held.loading} error={held.error}
          rows={held.data?.cashouts || []}
          columns={[
            { key: 'id' },
            { key: 'email', label: 'user' },
            { key: 'amount_minor', label: 'amount', kind: 'money' },
            { key: 'review_reason', label: 'reason' },
            { key: 'created_at', label: 'created', kind: 'date' },
          ]}
          actions={(row) => (
            <>
              <ActionButton disabled={action.busy} onClick={() => release(row)}>{t('adminLicence.requestRelease')}</ActionButton>
              <ActionButton tone="danger" disabled={action.busy} onClick={() => reject(row)}>{t('adminLicence.rejectCashout')}</ActionButton>
            </>
          )}
        />
      </Panel>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}
