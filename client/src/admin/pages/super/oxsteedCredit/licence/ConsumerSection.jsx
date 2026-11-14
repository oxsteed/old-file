import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, LICENCE_API, LicenceTable, Notices, Panel, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';

const RESOLUTIONS = ['resolved_paid_confirmed', 'resolved_reissued', 'rejected'];

/**
 * Consumer protection (§7): dispute clocks (10 business days to
 * provisional credit, 45/90 days to a final answer), cash-out "not
 * received" reports, disclosure versions and wage-consent counts.
 */
export default function ConsumerSection() {
  const { t } = useTranslation('credit');
  const clocks = useLicenceGet('/disputes/clocks', { limit: 200 });
  const cashoutDisputes = useLicenceGet('/cashout-disputes', { limit: 200 });
  const disclosures = useLicenceGet('/disclosures', { lang: 'en' });
  const wage = useLicenceGet('/wage-consent/summary');
  const holidays = useLicenceGet('/business-holidays');
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();

  const sweep = async () => {
    await action.run(() => adminApi.post(`${LICENCE_API}/disputes/sweep`), 'adminLicence.done');
    clocks.reload();
  };

  const resolve = async (row) => {
    const outcome = await requestDialog({
      kind: 'text', title: t('adminLicence.resolveDispute'), label: t('adminLicence.col.result'),
      description: t('adminLicence.resolveOutcomeHelp', { options: RESOLUTIONS.join(' / ') }), defaultValue: RESOLUTIONS[0],
    });
    if (!outcome) return;
    if (!RESOLUTIONS.includes(outcome)) { action.setError(t('adminLicence.invalidChoice')); return; }
    const resolution = await requestDialog({ kind: 'text', title: t('adminLicence.resolveDispute'), description: t('adminLicence.resolutionHelp'), label: t('adminLicence.col.reason'), maxLength: 2000 });
    if (!resolution) return;
    await action.run(() => requestOversight('credit_cashout_dispute_resolve', {
      disputeId: row.id, outcome, resolution, ...(outcome === 'resolved_reissued' && row.destination_id ? { destinationId: row.destination_id } : {}),
    }), 'adminLicence.requested');
  };

  const counts = wage.data?.counts || {};
  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || clocks.error || cashoutDisputes.error} />
      <Panel
        title={t('adminLicence.clocksTitle')}
        detail={t('adminLicence.clocksDetail')}
        actions={<ActionButton disabled={action.busy} onClick={sweep}>{t('adminLicence.runSweep')}</ActionButton>}
      >
        <LicenceTable
          loading={clocks.loading}
          error={clocks.error}
          onRetry={clocks.reload}
          rows={clocks.data?.disputes || []}
          columns={[
            { key: 'dispute_type', label: 'type' },
            { key: 'status' },
            { key: 'amount_minor', label: 'amount', kind: 'money' },
            { key: 'notified_at', label: 'created', kind: 'date' },
            { key: 'provisional_due_at', label: 'provisionalDue', kind: 'date' },
            { key: 'provisional_credit_minor', label: 'provisionalCredit', kind: 'money' },
            { key: 'resolution_due_at', label: 'due', kind: 'date' },
            { key: 'provisional_overdue', label: 'overdue', render: (v, row) => (v || row.final_overdue ? t('adminLicence.overdue') : '—') },
          ]}
        />
      </Panel>
      <Panel title={t('adminLicence.cashoutDisputesTitle')} detail={t('adminLicence.cashoutDisputesDetail')}>
        <LicenceTable
          loading={cashoutDisputes.loading}
          error={cashoutDisputes.error}
          onRetry={cashoutDisputes.reload}
          rows={cashoutDisputes.data?.disputes || []}
          columns={[
            { key: 'cashout_id', label: 'reference' },
            { key: 'status' },
            { key: 'amount_minor', label: 'amount', kind: 'money' },
            { key: 'description', label: 'reason' },
            { key: 'acknowledge_due_at', label: 'acknowledgeDue', kind: 'date' },
            { key: 'resolution_due_at', label: 'due', kind: 'date' },
            { key: 'resolution', label: 'result' },
          ]}
          actions={(row) => ['open', 'investigating'].includes(row.status) && (
            <ActionButton disabled={action.busy} onClick={() => resolve(row)}>{t('adminLicence.resolveDispute')}</ActionButton>
          )}
        />
      </Panel>
      <Panel title={t('adminLicence.disclosuresTitle')} detail={t('adminLicence.disclosuresDetail')}>
        <LicenceTable
          loading={disclosures.loading}
          error={disclosures.error}
          onRetry={disclosures.reload}
          rows={disclosures.data?.versions || []}
          columns={[
            { key: 'disclosure_kind', label: 'type' },
            { key: 'language' },
            { key: 'version' },
            { key: 'status' },
            { key: 'approved_reference', label: 'reference' },
            { key: 'published_at', label: 'date', kind: 'date' },
          ]}
          empty={t('adminLicence.placeholderDisclosures')}
        />
      </Panel>
      <Panel title={t('adminLicence.wageTitle')} detail={wage.data?.required ? t('adminLicence.wageRequired') : t('adminLicence.wageOptional')}>
        <LicenceTable
          loading={wage.loading}
          error={wage.error}
          onRetry={wage.reload}
          rows={Object.entries(counts).map(([status, count]) => ({ id: status, status, count }))}
          columns={[{ key: 'status' }, { key: 'count' }]}
        />
      </Panel>
      <Panel title={t('adminLicence.holidaysTitle')} detail={t('adminLicence.holidaysDetail')}>
        <LicenceTable
          loading={holidays.loading}
          error={holidays.error}
          onRetry={holidays.reload}
          rows={(holidays.data?.holidays || []).map((h) => ({ ...h, id: `${h.country_code}-${h.date}` }))}
          columns={[{ key: 'country_code', label: 'country' }, { key: 'date' }, { key: 'name' }]}
        />
      </Panel>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}
