import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CalendarClock, CheckCircle2, XCircle } from 'lucide-react';
import { schedulingApi } from '../api/scheduling';
import ConsultantRescheduleDialog from './ConsultantRescheduleDialog';
import ConsultantCancelSessionDialog from './ConsultantCancelSessionDialog';

// Group 10 Slice C (518-520): the consultant's own appointments on the
// contractor dashboard. Answers reschedule proposals from clients, confirms
// the consultant's own attendance once a session has started, and cancels
// appointments. The list comes from GET /consulting/contractor/sessions,
// which carries each row's open proposals and attendance confirmations.
export default function ConsultantSessionsSection() {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const dateLocale = i18n.language || 'en';

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await schedulingApi.listMyConsultantSessions();
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t('common.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startPassed = (row) => {
    if (!row.scheduled_date) return false;
    return new Date(`${row.scheduled_date}T${row.scheduled_time || '00:00'}`).getTime() <= Date.now();
  };

  const runAction = async (key, fn, successKey) => {
    setBusy(key);
    try {
      await fn();
      if (successKey) toast.success(t(successKey));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.errorUpdating'));
    } finally {
      setBusy('');
    }
  };

  const fmtWhen = (row) => {
    if (!row.scheduled_date) return '—';
    try {
      return new Date(`${row.scheduled_date}T${row.scheduled_time || '09:00'}`).toLocaleString(dateLocale, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch { return row.scheduled_date; }
  };

  // Status badge colors as classes (no inline styles, per the CSP gate).
  const statusBadgeClass = (status) => {
    if (status === 'confirmed') return 'bg-emerald-500/15 text-emerald-300';
    if (status === 'cancelled') return 'bg-red-500/15 text-red-300';
    return 'bg-gray-500/15 text-gray-400';
  };

  const visible = sessions.filter((s) => ['pending_confirmation', 'confirmed', 'completed'].includes(s.status));

  return (
    <div>
      {loading ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-[#111318] px-4 py-10 text-center text-sm text-gray-400">
          {t('consultantContractorDashboard.sessions.loading')}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[26px] border border-dashed border-gray-700 bg-[#111318] px-5 py-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/80">
            <CalendarClock className="h-6 w-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">{t('consultantContractorDashboard.sessions.emptyTitle')}</h3>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            {t('consultantContractorDashboard.sessions.emptyDescription')}
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {visible.map((row) => {
            const proposals = (row.proposals || []).filter((p) => p.status === 'proposed');
            const attendance = row.attendance || [];
            const iConfirmed = attendance.some((a) => a.role === 'consultant');
            const clientConfirmed = attendance.some((a) => a.role === 'client');
            const actionable = row.status === 'confirmed' || row.status === 'pending_confirmation';
            return (
              <li key={row.scheduled_id} className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {row.client_name || row.client_email || t('consultantContractorDashboard.sessions.clientFallback')}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {fmtWhen(row)}
                      {row.timezone ? ` · ${row.timezone}` : ''}
                      {row.duration_minutes ? ` · ${row.duration_minutes} ${t('scheduling.minutes')}` : ''}
                    </div>
                    {row.meeting_type && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {t(`scheduling.meetingTypes.${row.meeting_type === 'google_meet' ? 'googleMeet' : row.meeting_type === 'in_person' ? 'inPerson' : row.meeting_type}`)}
                      </div>
                    )}
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${statusBadgeClass(row.status)}`}>
                    {t(`consultantContractorDashboard.sessions.status.${row.status}`)}
                  </span>
                </div>

                {proposals.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200 mb-2">
                      {t('consultantContractorDashboard.sessions.pendingProposals')}
                    </div>
                    <ul className="space-y-2">
                      {proposals.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-xs text-gray-300">
                            <span className="font-semibold text-white">
                              {new Date(`${p.proposed_date}T${p.proposed_time}`).toLocaleString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                            {' · '}
                            {t('consultantContractorDashboard.sessions.proposedBy', { role: p.proposed_by_role })}
                            {p.reason ? ` · ${p.reason}` : ''}
                          </div>
                          <div className="flex gap-1.5">
                            {p.proposed_by_role === 'consultant' ? (
                              <button
                                type="button"
                                disabled={busy === `withdraw-${p.id}`}
                                onClick={() => runAction(`withdraw-${p.id}`, () => schedulingApi.withdrawReschedule(row.scheduled_id, p.id), 'scheduling.rescheduleWithdrawn')}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:bg-white/5 disabled:opacity-60" data-track="ui.08fbc95ba9.1"
                              >
                                {t('scheduling.withdraw')}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busy === `accept-${p.id}`}
                                  onClick={() => runAction(`accept-${p.id}`, () => schedulingApi.acceptReschedule(row.scheduled_id, p.id), 'scheduling.rescheduleAccepted')}
                                  className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60" data-track="ui.08fbc95ba9.2"
                                >
                                  {t('scheduling.accept')}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy === `decline-${p.id}`}
                                  onClick={() => runAction(`decline-${p.id}`, () => schedulingApi.declineReschedule(row.scheduled_id, p.id), 'scheduling.rescheduleDeclined')}
                                  className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:bg-white/5 disabled:opacity-60" data-track="ui.08fbc95ba9.3"
                                >
                                  {t('scheduling.decline')}
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {actionable && (
                    <button
                      type="button"
                      onClick={() => setRescheduleTarget(row)}
                      className="text-xs font-semibold px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white" data-track="ui.08fbc95ba9.4"
                    >
                      {t('scheduling.proposeNewTime')}
                    </button>
                  )}
                  {actionable && startPassed(row) && !iConfirmed && (
                    <button
                      type="button"
                      disabled={busy === `attend-${row.scheduled_id}`}
                      onClick={() => runAction(`attend-${row.scheduled_id}`, () => schedulingApi.confirmAttendance(row.scheduled_id), 'scheduling.attendanceConfirmed')}
                      className="text-xs font-semibold px-3 py-2 rounded-md border border-emerald-600 text-emerald-300 hover:bg-emerald-600/10 disabled:opacity-60" data-track="ui.08fbc95ba9.5"
                    >
                      <CheckCircle2 size={12} className="inline mr-1" />
                      {t('scheduling.confirmAttendance')}
                    </button>
                  )}
                  {iConfirmed && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                      <CheckCircle2 size={12} /> {t('scheduling.attendanceConfirmedByYou')}
                    </span>
                  )}
                  {clientConfirmed && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <CheckCircle2 size={12} /> {t('scheduling.attendanceConfirmedByClient')}
                    </span>
                  )}
                  {actionable && (
                    <button
                      type="button"
                      onClick={() => setCancelTarget(row)}
                      className="text-xs font-semibold px-3 py-2 rounded-md border border-red-700 text-red-300 hover:bg-red-600/10" data-track="ui.08fbc95ba9.6"
                    >
                      <XCircle size={12} className="inline mr-1" />
                      {t('scheduling.cancelSession')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rescheduleTarget && (
        <ConsultantRescheduleDialog
          consultantId={rescheduleTarget.consultant_assigned_id}
          scheduledSession={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onDone={() => { setRescheduleTarget(null); load(); }}
        />
      )}
      {cancelTarget && (
        <ConsultantCancelSessionDialog
          scheduledSession={cancelTarget}
          canRequestRefund={false}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); load(); }}
        />
      )}
    </div>
  );
}
