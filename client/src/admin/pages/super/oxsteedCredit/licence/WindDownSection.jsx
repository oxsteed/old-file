import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, inputClass, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';

/**
 * Orderly wind-down and redemption (§10). Start needs at least 30 days'
 * notice; every step (start, issue redemptions, hand unpaid holders to
 * unclaimed property, complete, cancel) is a two-admin oversight action.
 */
export default function WindDownSection() {
  const { t } = useTranslation('credit');
  const status = useLicenceGet('/wind-down');
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const [form, setForm] = useState({ reason: '', redemptionDeadline: '' });
  const [holdersFor, setHoldersFor] = useState(null);
  const plan = status.data?.plan;
  const active = plan?.status === 'active';

  const start = async (event) => {
    event.preventDefault();
    const ok = await requestDialog({ kind: 'confirm', title: t('adminLicence.windDownStart'), description: t('adminLicence.windDownStartConfirm', { date: form.redemptionDeadline }) });
    if (!ok) return;
    await action.run(() => requestOversight('credit_wind_down_start', form), 'adminLicence.requested');
  };
  const step = (type) => action.run(() => requestOversight(type, { planId: plan.id }), 'adminLicence.requested');
  const cancel = async () => {
    const reason = await requestDialog({ kind: 'text', title: t('adminLicence.windDownCancel'), description: t('adminLicence.windDownCancelHelp'), label: t('adminLicence.col.reason'), maxLength: 4000 });
    if (!reason) return;
    await action.run(() => requestOversight('credit_wind_down_cancel', { planId: plan.id, reason }), 'adminLicence.requested');
  };
  const notify = async () => {
    await action.run(() => adminApi.post(`${LICENCE_API}/wind-down/${encodeURIComponent(plan.id)}/notify`, { limit: 500 }), 'adminLicence.done');
    status.reload();
  };

  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || status.error} />
      <Panel title={t('adminLicence.windDownTitle')} detail={t('adminLicence.windDownDetail')}>
        {plan ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-gray-500">{t('adminLicence.col.status')}</dt><dd>{t(`adminLicence.status.${plan.status}`, { defaultValue: plan.status })}</dd></div>
            <div><dt className="text-xs text-gray-500">{t('adminLicence.col.deadline')}</dt><dd>{String(plan.redemption_deadline || '').slice(0, 10)}</dd></div>
            <div><dt className="text-xs text-gray-500">{t('adminLicence.col.holders')}</dt><dd>{plan.holder_count}</dd></div>
            <div><dt className="text-xs text-gray-500">{t('adminLicence.col.reason')}</dt><dd>{plan.reason}</dd></div>
          </dl>
        ) : <p className="text-sm text-gray-500">{t('adminLicence.windDownNone')}</p>}
        {active && (
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={action.busy} onClick={notify}>{t('adminLicence.notifyHolders')}</ActionButton>
            <ActionButton disabled={action.busy} onClick={() => step('credit_wind_down_issue_redemptions')}>{t('adminLicence.issueRedemptions')}</ActionButton>
            <ActionButton disabled={action.busy} onClick={() => step('credit_wind_down_mark_unclaimed')}>{t('adminLicence.markUnclaimed')}</ActionButton>
            <ActionButton disabled={action.busy} onClick={() => step('credit_wind_down_complete')}>{t('adminLicence.windDownComplete')}</ActionButton>
            <ActionButton tone="danger" disabled={action.busy} onClick={cancel}>{t('adminLicence.windDownCancel')}</ActionButton>
            <ActionButton onClick={() => setHoldersFor(holdersFor ? null : plan.id)}>{holdersFor ? t('adminLicence.hide') : t('adminLicence.viewHolders')}</ActionButton>
          </div>
        )}
        <LicenceTable
          loading={status.loading}
          error={status.error}
          onRetry={status.reload}
          rows={(status.data?.byStatus || []).map((r) => ({ ...r, id: `${r.status}-${r.currency}` }))}
          columns={[
            { key: 'status' }, { key: 'currency' }, { key: 'holders' },
            { key: 'snapshot_minor', label: 'amount', kind: 'money' },
            { key: 'redeemed_minor', label: 'redeemed', kind: 'money' },
          ]}
        />
      </Panel>
      {holdersFor && <Holders planId={holdersFor} />}
      <Panel title={t('adminLicence.redeemableTitle')} detail={t('adminLicence.redeemableDetail')}>
        <LicenceTable
          loading={status.loading}
          error={status.error}
          onRetry={status.reload}
          rows={(status.data?.redeemable?.totals || []).map((r) => ({ ...r, id: `${r.account_type}-${r.currency}` }))}
          columns={[
            { key: 'account_type', label: 'type' }, { key: 'currency' }, { key: 'holders' },
            { key: 'total_minor', label: 'amount', kind: 'money' },
            { key: 'reserved_minor', label: 'reserved', kind: 'money' },
          ]}
        />
      </Panel>
      {!active && (
        <Panel title={t('adminLicence.windDownStart')} detail={t('adminLicence.windDownStartHelp')}>
          <form onSubmit={start} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label={t('adminLicence.col.reason')}><input required minLength={10} maxLength={4000} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className={inputClass} /></Field>
            <Field label={t('adminLicence.col.deadline')}><input required type="date" value={form.redemptionDeadline} onChange={(e) => setForm((f) => ({ ...f, redemptionDeadline: e.target.value }))} className={inputClass} /></Field>
            <ActionButton type="submit" tone="danger" disabled={action.busy}>{t('adminLicence.windDownStart')}</ActionButton>
          </form>
        </Panel>
      )}
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}

const HOLDER_PAGE = 200;

function Holders({ planId }) {
  const { t } = useTranslation('credit');
  const [afterId, setAfterId] = useState(null);
  const holders = useLicenceGet(`/wind-down/${encodeURIComponent(planId)}/holders`, { limit: HOLDER_PAGE, after_id: afterId || undefined });
  const rows = holders.data?.holders || [];
  return (
    <Panel
      title={t('adminLicence.holdersTitle')}
      actions={(
        <>
          {afterId && <ActionButton onClick={() => setAfterId(null)}>{t('adminLicence.firstPage')}</ActionButton>}
          {rows.length === HOLDER_PAGE && <ActionButton onClick={() => setAfterId(rows[rows.length - 1].id)}>{t('adminLicence.nextPage')}</ActionButton>}
        </>
      )}
    >
      <LicenceTable
        loading={holders.loading}
        error={holders.error}
        onRetry={holders.reload}
        rows={rows}
        columns={[
          { key: 'account_type', label: 'type' }, { key: 'status' },
          { key: 'snapshot_balance_minor', label: 'amount', kind: 'money', currencyKey: 'currency_code' },
          { key: 'redeemed_minor', label: 'redeemed', kind: 'money', currencyKey: 'currency_code' },
          { key: 'notice_sent_at', label: 'notified', kind: 'date' },
          { key: 'paid_at', label: 'date', kind: 'date' },
        ]}
      />
    </Panel>
  );
}
