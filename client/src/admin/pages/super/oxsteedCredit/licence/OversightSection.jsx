import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, inputClass, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';
import { actionTypeLabel, templateFor } from './oversightTemplates';

/**
 * Two-administrator oversight queue for every licence control: request an
 * action with its payload, then a different admin approves (with a fresh
 * step-up code) or rejects with a reason. Self-approval is refused by the
 * server.
 */
export default function OversightSection() {
  const { t } = useTranslation('credit');
  const [status, setStatus] = useState('pending');
  const types = useLicenceGet('/oversight-actions/types');
  const list = useLicenceGet('/oversight-actions', { status: status || undefined, limit: 100 });
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const [actionType, setActionType] = useState('');
  const [payload, setPayload] = useState('{}');

  const chooseType = (value) => { setActionType(value); setPayload(templateFor(value)); };

  const submit = async (event) => {
    event.preventDefault();
    let parsed;
    try { parsed = JSON.parse(payload); } catch { action.setError(t('adminLicence.invalidJson')); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { action.setError(t('adminLicence.invalidJson')); return; }
    const done = await action.run(() => requestOversight(actionType, parsed), 'adminLicence.requested');
    if (done) list.reload();
  };

  const approve = async (row) => {
    await action.run(async () => {
      const { data } = await adminApi.post('/admin/super/oxsteed-credit/stepup-challenges', { actionType: 'pending_action_approve', pendingActionId: row.id });
      const code = await requestDialog({ kind: 'text', title: t('agentAdjQueueStepupTitle'), description: t('adminLicence.stepupDescription', { type: actionTypeLabel(t, row.actionType) }), label: t('agentAdjQueueStepupLabel') });
      if (!code) throw Object.assign(new Error('cancelled'), { response: { data: { code: 'credit_stepup_challenge_required' } } });
      await adminApi.post(`${LICENCE_API}/oversight-actions/${encodeURIComponent(row.id)}/decision`, {
        decision: 'approve', stepupChallengeId: data?.challenge?.id, stepupCode: code,
      });
    }, 'adminLicence.decided');
    list.reload();
  };

  const reject = async (row) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminLicence.reject'), description: t('adminLicence.rejectDescription'), label: t('adminLicence.col.reason'), maxLength: 2000 });
    if (!reason) return;
    await action.run(() => adminApi.post(`${LICENCE_API}/oversight-actions/${encodeURIComponent(row.id)}/decision`, { decision: 'reject', reason }), 'adminLicence.decided');
    list.reload();
  };

  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || types.error || list.error} />
      <Panel title={t('adminLicence.requestTitle')} detail={t('adminLicence.twoAdminNote')}>
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label={t('adminLicence.col.type')}>
            <select required value={actionType} onChange={(e) => chooseType(e.target.value)} className={inputClass}>
              <option value="">{t('adminLicence.chooseType')}</option>
              {(types.data?.actionTypes || []).map((type) => <option key={type} value={type}>{actionTypeLabel(t, type)}</option>)}
            </select>
          </Field>
          <Field label={t('adminLicence.payload')}>
            <textarea required rows={8} dir="ltr" spellCheck={false} value={payload} onChange={(e) => setPayload(e.target.value)} className={`${inputClass} font-mono`} />
          </Field>
          <div><ActionButton type="submit" tone="primary" disabled={action.busy || !actionType}>{t('adminLicence.submitRequest')}</ActionButton></div>
        </form>
      </Panel>
      <Panel
        title={t('adminLicence.queueTitle')}
        actions={(
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} aria-label={t('adminLicence.col.status')}>
            {['pending', 'approved', 'rejected', 'expired', ''].map((s) => <option key={s || 'all'} value={s}>{s ? t(`adminLicence.status.${s}`) : t('adminLicence.status.all')}</option>)}
          </select>
        )}
      >
        <LicenceTable
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rows={list.data?.pendingActions || []}
          columns={[
            { key: 'actionType', label: 'type', render: (v) => <span title={v}>{actionTypeLabel(t, v)}</span> },
            { key: 'status' },
            { key: 'payload', render: (v) => <code dir="ltr" className="whitespace-pre-wrap break-all">{JSON.stringify(Object.fromEntries(Object.entries(v || {}).filter(([k]) => k !== 'idempotencyKey')))}</code> },
            { key: 'requestedBy', label: 'requestedBy' },
            { key: 'requestedAt', label: 'created', kind: 'date' },
            { key: 'decisionReason', label: 'reason' },
          ]}
          actions={(row) => row.status === 'pending' && (
            <>
              <ActionButton tone="primary" disabled={action.busy} onClick={() => approve(row)}>{t('adminLicence.approve')}</ActionButton>
              <ActionButton tone="danger" disabled={action.busy} onClick={() => reject(row)}>{t('adminLicence.reject')}</ActionButton>
            </>
          )}
        />
      </Panel>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}
