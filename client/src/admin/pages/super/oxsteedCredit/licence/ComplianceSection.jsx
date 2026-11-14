import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, downloadLicenceFile, inputClass, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';

function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Sanctions lists, safeguarding reconciliation, KYC requirements and the
 * suspicious-activity report workflow (§1–§4). Custom-list changes, KYC
 * waivers, safeguarding accounts and SAR approval are oversight actions.
 */
export default function ComplianceSection() {
  const { t } = useTranslation('credit');
  const sources = useLicenceGet('/sanctions/sources');
  const custom = useLicenceGet('/sanctions/custom');
  const safeguarding = useLicenceGet('/safeguarding');
  const kyc = useLicenceGet('/kyc/requirements', { limit: 200 });
  const sar = useLicenceGet('/sar', { limit: 200 });
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const [range, setRange] = useState({ from: isoDay(-30), to: isoDay(0) });
  const [editing, setEditing] = useState(null);

  const refreshSource = async (row) => { await action.run(() => adminApi.post(`${LICENCE_API}/sanctions/sources/${encodeURIComponent(row.id)}/refresh`), 'adminLicence.done'); sources.reload(); };
  const search = async (event) => {
    event.preventDefault();
    const result = await action.run(() => adminApi.get(`${LICENCE_API}/sanctions/search`, { params: { q: query } }));
    if (result) setMatches(result.data?.matches || []);
  };
  const removeEntry = async (row) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminLicence.removeEntry'), description: t('adminLicence.rejectDescription'), label: t('adminLicence.col.reason'), maxLength: 1000 });
    if (!reason) return;
    await action.run(() => requestOversight('credit_sanctions_custom_entry_remove', { entryId: row.id, reason }), 'adminLicence.requested');
  };
  const reconcile = async () => { await action.run(() => adminApi.post(`${LICENCE_API}/safeguarding/reconcile`, {}), 'adminLicence.done'); safeguarding.reload(); };
  const exportSafeguarding = () => action.run(() => downloadLicenceFile('/safeguarding/export', `safeguarding-${range.from}-${range.to}.csv`, range));
  const waive = async (row) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminLicence.waive'), description: t('adminLicence.waiveHelp'), label: t('adminLicence.col.reason'), maxLength: 1000 });
    if (!reason) return;
    await action.run(() => requestOversight('credit_kyc_requirement_waive', { requirementId: row.id, reason }), 'adminLicence.requested');
  };

  const newSar = async () => {
    const caseIds = await requestDialog({ kind: 'text', title: t('adminLicence.newSar'), description: t('adminLicence.caseIdsHelp'), label: t('adminLicence.caseIds'), maxLength: 2000 });
    if (!caseIds) return;
    const narrative = await requestDialog({ kind: 'text', title: t('adminLicence.newSar'), description: t('adminLicence.narrativeHelp'), label: t('adminLicence.narrative'), maxLength: 4000 });
    if (!narrative) return;
    await action.run(() => adminApi.post(`${LICENCE_API}/sar`, { caseIds: caseIds.split(/[\s,]+/).filter(Boolean), narrative }), 'adminLicence.done');
    sar.reload();
  };
  // Gap fill 10: edit a draft report (PATCH /sar/:id; the server only
  // accepts drafts). Amounts are integers in minor units of the currency.
  const startEdit = (row) => setEditing({
    id: row.id, narrative: row.narrative || '', activityFrom: String(row.activity_from || '').slice(0, 10), activityTo: String(row.activity_to || '').slice(0, 10),
    amountMinor: row.amount_minor == null ? '' : String(row.amount_minor), currencyCode: row.currency_code || '',
  });
  const saveDraft = async (event) => {
    event.preventDefault();
    const e = editing;
    if (e.amountMinor !== '' && !/^\d{1,15}$/.test(e.amountMinor)) { action.setError(t('adminLicence.sarBadAmount')); return; }
    if (e.currencyCode && !/^[A-Z]{3}$/.test(e.currencyCode)) { action.setError(t('adminLicence.sarBadCurrency')); return; }
    if (e.activityFrom && e.activityTo && e.activityFrom > e.activityTo) { action.setError(t('adminLicence.sarBadRange')); return; }
    const done = await action.run(() => adminApi.patch(`${LICENCE_API}/sar/${encodeURIComponent(e.id)}`, {
      narrative: e.narrative, activityFrom: e.activityFrom || null, activityTo: e.activityTo || null,
      amountMinor: e.amountMinor === '' ? null : Number(e.amountMinor), currencyCode: e.currencyCode || null,
    }), 'adminLicence.draftSaved');
    if (done) { setEditing(null); sar.reload(); }
  };
  const setE = (patch) => setEditing((x) => ({ ...x, ...patch }));
  const sarStep = async (row, step) => {
    let body = {};
    if (step === 'file') {
      const filingReference = await requestDialog({ kind: 'text', title: t('adminLicence.markFiled'), description: t('adminLicence.filingHelp'), label: t('adminLicence.col.reference'), maxLength: 200 });
      if (!filingReference) return;
      body = { filingReference };
    }
    if (step === 'withdraw') {
      const reason = await requestDialog({ kind: 'text', title: t('adminLicence.withdraw'), description: t('adminLicence.rejectDescription'), label: t('adminLicence.col.reason'), maxLength: 1000 });
      if (!reason) return;
      body = { reason };
    }
    await action.run(() => adminApi.post(`${LICENCE_API}/sar/${encodeURIComponent(row.id)}/${step}`, body), 'adminLicence.done');
    sar.reload();
  };

  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || sources.error || custom.error || safeguarding.error || kyc.error || sar.error} />
      <Panel title={t('adminLicence.sourcesTitle')} detail={sources.data?.staleRequired?.length ? t('adminLicence.sourcesStale', { count: sources.data.staleRequired.length }) : t('adminLicence.sourcesFresh')}>
        <LicenceTable
          loading={sources.loading} error={sources.error}
          rows={sources.data?.sources || []}
          columns={[
            { key: 'display_name', label: 'name' },
            { key: 'authority' },
            { key: 'fresh' },
            { key: 'entry_count', label: 'count' },
            { key: 'last_success_at', label: 'date', kind: 'date' },
            { key: 'last_error', label: 'result' },
          ]}
          actions={(row) => <ActionButton disabled={action.busy} onClick={() => refreshSource(row)}>{t('adminLicence.refresh')}</ActionButton>}
        />
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <Field label={t('adminLicence.searchName')}><input required minLength={2} maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} /></Field>
          <ActionButton type="submit" disabled={action.busy}>{t('adminLicence.search')}</ActionButton>
        </form>
        {matches && (
          <LicenceTable
            rows={matches.map((m, i) => ({ ...m, id: m.id || `${i}` }))}
            columns={[{ key: 'matched_name', label: 'name' }, { key: 'source_id', label: 'source' }, { key: 'score' }]}
          />
        )}
      </Panel>
      <Panel title={t('adminLicence.customTitle')} detail={t('adminLicence.customDetail')}>
        <LicenceTable
          loading={custom.loading} error={custom.error}
          rows={(custom.data?.entries || []).filter((e) => !e.removed_at)}
          columns={[
            { key: 'primary_name', label: 'name' }, { key: 'entry_type', label: 'type' }, { key: 'countries', label: 'country' },
            { key: 'legal_basis', label: 'reference' }, { key: 'created_at', label: 'created', kind: 'date' },
          ]}
          actions={(row) => <ActionButton tone="danger" disabled={action.busy} onClick={() => removeEntry(row)}>{t('adminLicence.removeEntry')}</ActionButton>}
        />
      </Panel>
      <Panel
        title={t('adminLicence.safeguardingTitle')}
        detail={t('adminLicence.safeguardingDetail')}
        actions={<ActionButton disabled={action.busy} onClick={reconcile}>{t('adminLicence.reconcile')}</ActionButton>}
      >
        <LicenceTable
          loading={safeguarding.loading} error={safeguarding.error}
          rows={safeguarding.data?.accounts || []}
          columns={[
            { key: 'label', label: 'name' }, { key: 'institution_name', label: 'authority' }, { key: 'account_reference_masked', label: 'reference' },
            { key: 'currency_code', label: 'currency' }, { key: 'status' },
          ]}
          empty={t('adminLicence.noSafeguardingAccounts')}
        />
        <LicenceTable
          loading={safeguarding.loading} error={safeguarding.error}
          rows={safeguarding.data?.latest || []}
          columns={[
            { key: 'run_date', label: 'date', kind: 'date' }, { key: 'currency_code', label: 'currency' }, { key: 'status' },
            { key: 'liabilities_minor', label: 'liabilities', kind: 'money', currencyKey: 'currency_code' },
            { key: 'safeguarded_minor', label: 'safeguarded', kind: 'money', currencyKey: 'currency_code' },
            { key: 'difference_minor', label: 'difference', kind: 'money', currencyKey: 'currency_code' },
          ]}
        />
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('adminLicence.from')}><input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={inputClass} /></Field>
          <Field label={t('adminLicence.to')}><input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={inputClass} /></Field>
          <ActionButton disabled={action.busy} onClick={exportSafeguarding}>{t('adminLicence.exportCsv')}</ActionButton>
        </div>
      </Panel>
      <Panel title={t('adminLicence.kycTitle')} detail={t('adminLicence.kycDetail')}>
        <LicenceTable
          loading={kyc.loading} error={kyc.error}
          rows={kyc.data?.requirements || []}
          columns={[
            { key: 'email', label: 'user' }, { key: 'trigger', label: 'type' }, { key: 'required_tier', label: 'tier' },
            { key: 'status' }, { key: 'created_at', label: 'created', kind: 'date' },
          ]}
          actions={(row) => row.status === 'open' && <ActionButton disabled={action.busy} onClick={() => waive(row)}>{t('adminLicence.waive')}</ActionButton>}
        />
      </Panel>
      <Panel title={t('adminLicence.sarTitle')} detail={t('adminLicence.sarDetail')} actions={<ActionButton disabled={action.busy} onClick={newSar}>{t('adminLicence.newSar')}</ActionButton>}>
        <LicenceTable
          loading={sar.loading} error={sar.error}
          rows={sar.data?.reports || []}
          columns={[
            { key: 'status' }, { key: 'regulator', label: 'authority' }, { key: 'narrative', label: 'reason' },
            { key: 'due_at', label: 'due', kind: 'date' }, { key: 'filed_at', label: 'date', kind: 'date' },
          ]}
          actions={(row) => (
            <>
              {row.status === 'draft' && <ActionButton disabled={action.busy} onClick={() => startEdit(row)}>{t('adminLicence.editDraft')}</ActionButton>}
              {row.status === 'draft' && <ActionButton disabled={action.busy} onClick={() => sarStep(row, 'submit')}>{t('adminLicence.submitForApproval')}</ActionButton>}
              {row.status === 'pending_approval' && (
                <>
                  <ActionButton tone="primary" disabled={action.busy} onClick={() => action.run(() => requestOversight('credit_sar_approve', { sarId: row.id }), 'adminLicence.requested')}>{t('adminLicence.requestApproval')}</ActionButton>
                  <ActionButton disabled={action.busy} onClick={() => sarStep(row, 'return')}>{t('adminLicence.returnToDraft')}</ActionButton>
                </>
              )}
              {row.status === 'approved' && <ActionButton disabled={action.busy} onClick={() => sarStep(row, 'file')}>{t('adminLicence.markFiled')}</ActionButton>}
              {['draft', 'pending_approval'].includes(row.status) && <ActionButton tone="danger" disabled={action.busy} onClick={() => sarStep(row, 'withdraw')}>{t('adminLicence.withdraw')}</ActionButton>}
              {['approved', 'filed'].includes(row.status) && <ActionButton disabled={action.busy} onClick={() => action.run(() => downloadLicenceFile(`/sar/${encodeURIComponent(row.id)}/pack`, `sar-${row.id}.json`))}>{t('adminLicence.downloadPack')}</ActionButton>}
            </>
          )}
        />
        {editing && (
          <form onSubmit={saveDraft} className="grid gap-3 sm:grid-cols-2" data-form="sar-edit">
            <h3 className="sm:col-span-2 text-sm font-semibold text-gray-900 dark:text-white">{t('adminLicence.editDraftTitle')}</h3>
            <div className="sm:col-span-2">
              <Field label={t('adminLicence.narrative')}>
                <textarea required rows={6} maxLength={20000} value={editing.narrative} onChange={(ev) => setE({ narrative: ev.target.value })} className={inputClass} />
              </Field>
              <p className="mt-1 text-xs text-gray-500">{t('adminLicence.narrativeHelp')}</p>
            </div>
            <Field label={t('adminLicence.sarActivityFrom')}><input type="date" dir="ltr" value={editing.activityFrom} onChange={(ev) => setE({ activityFrom: ev.target.value })} className={inputClass} /></Field>
            <Field label={t('adminLicence.sarActivityTo')}><input type="date" dir="ltr" value={editing.activityTo} onChange={(ev) => setE({ activityTo: ev.target.value })} className={inputClass} /></Field>
            <Field label={t('adminLicence.sarAmountMinor')}><input dir="ltr" inputMode="numeric" value={editing.amountMinor} onChange={(ev) => setE({ amountMinor: ev.target.value.trim() })} className={inputClass} /></Field>
            <Field label={t('adminLicence.col.currency')}><input dir="ltr" maxLength={3} value={editing.currencyCode} onChange={(ev) => setE({ currencyCode: ev.target.value.toUpperCase().trim() })} className={inputClass} /></Field>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <ActionButton type="submit" tone="primary" disabled={action.busy || editing.narrative.trim().length === 0}>{t('adminLicence.saveDraft')}</ActionButton>
              <ActionButton disabled={action.busy} onClick={() => setEditing(null)}>{t('adminLicence.cancelEdit')}</ActionButton>
            </div>
          </form>
        )}
      </Panel>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}
