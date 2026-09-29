// client/src/admin/pages/super/ModeApprovals.jsx
//
// Super-admin review queue for pending platform-approval requests.
// Approve / reject inline; on approve, the user's gated actions unlock.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Check, X, User, Mail, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';
import {
  adminApprove,
  adminReject,
} from '../../../api/modePlatformApprovals';

function ApprovalCard({ approval, onChange }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(null);     // 'reject' | null
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const handleApprove = async () => {
    try {
      await adminApprove(approval.id);
      toast.success(t('adminModeApprovalsApproved'));
      onChange?.(approval.id);
    } catch (err) {
      throw new Error(err?.response?.data?.error || t('adminModeApprovalsActionFailed'));
    }
  };

  const handleReject = async () => {
    if (!reason.trim()) { toast.error(t('adminModeApprovalsReasonRequired')); return; }
    setBusy('reject');
    try {
      await adminReject(approval.id, reason.trim());
      toast.success(t('adminModeApprovalsRejected'));
      onChange?.(approval.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminModeApprovalsActionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const data = approval.application_data || {};
  const fields = Object.entries(data);

  return (
    <article className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <User size={14} className="text-gray-400" />
              {approval.first_name} {approval.last_name}
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider font-bold bg-orange-500/15 text-orange-300">
              {approval.mode}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1"><Mail size={11} /> {approval.email}</span>
            <span className="flex items-center gap-1"><Clock size={11} /> {t('adminModeApprovalsSubmitted', { date: new Date(approval.requested_at).toLocaleString() })}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!showReject && (
            <>
              <button
                type="button"
                onClick={() => setConfirmApprove(true)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                <Check size={14} />
                {t('common.approve')}
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-700 hover:border-red-500 hover:text-red-400 text-gray-300 text-sm font-semibold disabled:opacity-50"
              >
                <X size={14} /> {t('adminModeApprovalsReject')}
              </button>
            </>
          )}
        </div>
      </header>

      {showReject && (
        <div className="rounded-md p-3 bg-red-900/10 border border-red-800/40">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t('adminModeApprovalsReasonPlaceholder')}
            className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-md text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500"
          />
          <div className="mt-2 flex gap-2 justify-end">
            <button onClick={() => { setShowReject(false); setReason(''); }} className="text-xs text-gray-400 hover:text-white px-2 py-1">{t('common.cancel')}</button>
            <button
              onClick={handleReject}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {busy === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              {t('adminModeApprovalsConfirmRejection')}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 text-xs">
        {fields.length === 0 ? (
          <div className="text-gray-500">{t('adminModeApprovalsNoData')}</div>
        ) : (
          fields.map(([key, val]) => (
            <div key={key}>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{key.replace(/_/g, ' ')}</div>
              <div className="text-gray-200 whitespace-pre-wrap mt-0.5">{String(val || '—')}</div>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={confirmApprove}
        title="Approve mode request"
        message={`Approve ${approval.first_name || ''} ${approval.last_name || ''} for ${approval.mode} mode? Their gated actions will unlock.`}
        confirmLabel={t('common.approve')}
        onConfirm={handleApprove}
        onClose={() => setConfirmApprove(false)}
      />
    </article>
  );
}

export default function ModeApprovals() {
  const { t } = useTranslation();
  const [filterMode, setFilterMode] = useState('');

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const res = await api.get('/admin/mode-approvals', {
      signal,
      params: filterMode ? { mode: filterMode } : {},
    });
    return res.data.approvals || [];
  }, [filterMode]);
  const approvals = data || [];

  const handleDecided = (approvalId) => {
    reload();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{t('adminModeApprovalsTitle')}</h1>
          <p className="text-sm text-gray-400 mt-1">{t('adminModeApprovalsSubtitle')}</p>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-gray-500 mr-2">{t('adminModeApprovalsFilterByMode')}</label>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-md text-white text-sm"
          >
            <option value="">{t('common.all')}</option>
            <option value="consultant">{t('adminModeApprovalsModeConsultant')}</option>
            <option value="helper">{t('adminModeApprovalsModeHelper')}</option>
            <option value="business_owner">{t('adminModeApprovalsModeBusinessOwner')}</option>
            <option value="tool_owner">{t('adminModeApprovalsModeToolOwner')}</option>
            <option value="franchise_applicant">{t('adminModeApprovalsModeFranchiseApplicant')}</option>
          </select>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-orange-500" />
        </div>
      ) : error ? (
        <AdminErrorState onRetry={reload} />
      ) : approvals.length === 0 ? (
        <div className="rounded-xl border border-gray-800 p-12 text-center text-gray-400">
          {t('adminModeApprovalsEmptyQueue')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {approvals.map(a => (
            <ApprovalCard key={a.id} approval={a} onChange={handleDecided} />
          ))}
        </div>
      )}
    </div>
  );
}
