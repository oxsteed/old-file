// client/src/admin/pages/super/ModeApprovals.jsx
//
// Super-admin decision UI for mode-platform approvals (PR #804 R-2/H4).
// The request flow and admin API stayed live after the page was deleted,
// so pending requests had no way to be decided. This page restores the
// queue over the live endpoints:
//
//   GET  /api/admin/mode-approvals
//   GET  /api/admin/mode-approvals/:id
//   POST /api/admin/mode-approvals/:id/approve
//   POST /api/admin/mode-approvals/:id/reject    (rejection reason required)
//   POST /api/admin/mode-approvals/:id/revoke    (approved rows only)
//
// The pending queue only returns requested rows, so revoke is reached
// through the look-up-by-ID panel, which fetches one approval and offers
// the action its status allows.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  adminListApprovals,
  adminGetApproval,
  adminApprove,
  adminReject,
  adminRevoke,
} from '../../../api/modePlatformApprovals';

const MODES = ['consultant', 'helper', 'business', 'franchise', 'investor', 'tool_owner'];

function applicantName(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return name || row.email || String(row.user_id);
}

export default function ModeApprovals() {
  const { t } = useTranslation();
  const [mode, setMode] = useState('');
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [notes, setNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [lookupRow, setLookupRow] = useState(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await adminListApprovals(mode ? { mode } : {});
      setApprovals(data.approvals || []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  const selected = approvals.find((row) => String(row.id) === String(selectedId)) || lookupRow;

  const decide = async (decision) => {
    if (!selected || busy) return;
    if (decision === 'reject' && !rejectionReason.trim()) return;
    setBusy(true);
    try {
      if (decision === 'approve') await adminApprove(selected.id, notes.trim() || undefined);
      else if (decision === 'reject') await adminReject(selected.id, rejectionReason.trim());
      else await adminRevoke(selected.id, notes.trim() || undefined);
      toast.success(t('superModeApprovals.decided'));
      setNotes('');
      setRejectionReason('');
      setSelectedId(null);
      setLookupRow(null);
      await load();
    } catch (err) {
      const code = err?.response?.data?.error;
      toast.error(code === 'approval_state_conflict'
        ? t('superModeApprovals.stateConflict')
        : code === 'rejection_reason_required'
          ? t('superModeApprovals.reasonRequired')
          : t('superModeApprovals.decideFailed'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const lookup = async () => {
    const id = lookupId.trim();
    if (!id || lookupBusy) return;
    setLookupBusy(true);
    setLookupFailed(false);
    setLookupRow(null);
    setSelectedId(null);
    try {
      const data = await adminGetApproval(id);
      setLookupRow(data.approval || null);
      if (!data.approval) setLookupFailed(true);
    } catch {
      setLookupFailed(true);
    } finally {
      setLookupBusy(false);
    }
  };

  const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
  const selectCls = 'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('superModeApprovals.title')}</h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{t('superModeApprovals.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="text-sm text-gray-700 dark:text-gray-200">
          {t('superModeApprovals.modeFilter')}
          <select className={`${selectCls} block`} value={mode} onChange={(e) => { setMode(e.target.value); setSelectedId(null); }}>
            <option value="">{t('superModeApprovals.allModes')}</option>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          {failed ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{t('superModeApprovals.loadFailed')}</p>
              <button type="button" onClick={() => load()} className="rounded-lg border border-gray-300 px-3 py-1.5" data-track="ui.admin.mode_approvals.retry">{t('superModeApprovals.retry')}</button>
            </div>
          ) : approvals.length === 0 && !loading ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('superModeApprovals.empty')}</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700" aria-busy={loading}>
              {approvals.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => { setSelectedId(row.id); setLookupRow(null); }}
                    aria-current={selectedId === row.id ? 'true' : undefined}
                    className={`w-full px-3 py-2 text-start text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${selectedId === row.id ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                    data-track="ui.admin.mode_approvals.open"
                  >
                    <span className="block font-medium text-gray-900 dark:text-white">{applicantName(row)}</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-300">
                      {row.mode}
                      {row.requested_at ? ` · ${new Date(row.requested_at).toLocaleDateString()}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('superModeApprovals.select')}</p>
          ) : (
            <div className="space-y-5">
              <header>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{applicantName(selected)}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {selected.mode} · {t(`superModeApprovals.status.${selected.status}`)}
                </p>
                {selected.requested_at && (
                  <p className="text-xs text-gray-500">{t('superModeApprovals.requestedOn', { date: new Date(selected.requested_at).toLocaleString() })}</p>
                )}
              </header>
              {selected.application_data && (
                <section aria-labelledby="ma-application-data">
                  <h3 id="ma-application-data" className="text-sm font-semibold text-gray-900 dark:text-white">{t('superModeApprovals.applicationData')}</h3>
                  <pre className="mt-1 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">{JSON.stringify(selected.application_data, null, 2)}</pre>
                </section>
              )}
              <section aria-labelledby="ma-decide" className="space-y-3">
                <h3 id="ma-decide" className="sr-only">{t('superModeApprovals.title')}</h3>
                <label className="block text-sm text-gray-700 dark:text-gray-200">
                  {t('superModeApprovals.notes')}
                  <textarea className={inputCls} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('superModeApprovals.notesPlaceholder')} />
                </label>
                {selected.status === 'requested' && (
                  <label className="block text-sm text-gray-700 dark:text-gray-200">
                    {t('superModeApprovals.rejectionReason')}
                    <input className={inputCls} maxLength={1000} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder={t('superModeApprovals.rejectionReasonPlaceholder')} />
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  {selected.status === 'requested' && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide('approve')}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        data-track="ui.admin.mode_approvals.approve"
                      >
                        {t('superModeApprovals.approve')}
                      </button>
                      <button
                        type="button"
                        disabled={busy || !rejectionReason.trim()}
                        onClick={() => decide('reject')}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        data-track="ui.admin.mode_approvals.reject"
                      >
                        {t('superModeApprovals.reject')}
                      </button>
                    </>
                  )}
                  {selected.status === 'approved' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide('revoke')}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      data-track="ui.admin.mode_approvals.revoke"
                    >
                      {t('superModeApprovals.revoke')}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      <section aria-labelledby="ma-lookup-title" className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
        <h2 id="ma-lookup-title" className="text-lg font-semibold text-gray-900 dark:text-white">{t('superModeApprovals.lookupTitle')}</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{t('superModeApprovals.lookupHelp')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-gray-700 dark:text-gray-200">
            {t('superModeApprovals.lookupLabel')}
            <input
              className={`${inputCls} block w-48`}
              inputMode="numeric"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder={t('superModeApprovals.lookupPlaceholder')}
            />
          </label>
          <button
            type="button"
            disabled={lookupBusy || !lookupId.trim()}
            onClick={lookup}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100"
            data-track="ui.admin.mode_approvals.lookup"
          >
            {t('superModeApprovals.lookupButton')}
          </button>
        </div>
        {lookupFailed && <p role="alert" className="mt-2 text-sm text-gray-600 dark:text-gray-300">{t('superModeApprovals.lookupNotFound')}</p>}
        {lookupRow && (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {applicantName(lookupRow)} · {lookupRow.mode} · {t(`superModeApprovals.status.${lookupRow.status}`)}
          </p>
        )}
      </section>
    </div>
  );
}
