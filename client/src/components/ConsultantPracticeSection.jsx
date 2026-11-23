import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  BarChart3, CalendarClock, ClipboardList, Wallet, LifeBuoy,
  Loader2, Send, TrendingUp,
} from 'lucide-react';
import { practiceApi } from '../api/consultantPractice';
import { formatCents } from '../lib/format';

// Group 10 Slice I (546-550): operate the practice. The inquiry
// pipeline report, availability utilization, outstanding deliverables
// view, permitted earnings report, and practice support intake on the
// contractor dashboard. All four reports are read-only aggregates over
// the consultant's own engagements; the earnings report is not a payout.
const STAGE_LABELS = {
  assigned: 'consultantPractice.pipeline.stages.assigned',
  intro_pending: 'consultantPractice.pipeline.stages.introPending',
  intro_sent: 'consultantPractice.pipeline.stages.introSent',
  discovery_scheduled: 'consultantPractice.pipeline.stages.discoveryScheduled',
  proposal_sent: 'consultantPractice.pipeline.stages.proposalSent',
  engaged: 'consultantPractice.pipeline.stages.engaged',
  won: 'consultantPractice.pipeline.stages.won',
  lost: 'consultantPractice.pipeline.stages.lost',
  completed: 'consultantPractice.pipeline.stages.completed',
  paused: 'consultantPractice.pipeline.stages.paused',
  declined: 'consultantPractice.pipeline.stages.declined',
};

function money(cents) {
  return formatCents(cents || 0, { maximumFractionDigits: 0 });
}

function hours(minutes) {
  const value = Math.round((Number(minutes) || 0) / 6) / 10;
  return `${value}h`;
}

function Block({ icon: Icon, label, title, children }) {
  return (
    <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
          <Icon className="h-5 w-5 text-gray-300" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <p className="rounded-2xl border border-dashed border-gray-700 bg-[#0d1016] px-4 py-6 text-center text-sm text-gray-400">
      {children}
    </p>
  );
}

export default function ConsultantPracticeSection() {
  const { t } = useTranslation();
  const tx = (key, fallback, options) => t(key, { defaultValue: fallback, ...options });
  const [loading, setLoading] = useState(true);
  const [pipeline, setPipeline] = useState(null);
  const [utilization, setUtilization] = useState(null);
  const [deliverables, setDeliverables] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('normal');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [pipelineRes, utilizationRes, deliverablesRes, earningsRes, ticketsRes] = await Promise.all([
        practiceApi.getInquiryPipeline(),
        practiceApi.getUtilization(),
        practiceApi.getOutstandingDeliverables(),
        practiceApi.getEarnings(),
        practiceApi.listSupportIntakes(),
      ]);
      setPipeline(pipelineRes.data || null);
      setUtilization(utilizationRes.data || null);
      setDeliverables(deliverablesRes.data || null);
      setEarnings(earningsRes.data || null);
      setTickets(Array.isArray(ticketsRes.data?.tickets) ? ticketsRes.data.tickets : []);
    } catch {
      toast.error(t('common.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openStages = useMemo(
    () => (pipeline?.stages || []).filter((stage) => !['lost', 'declined', 'completed'].includes(stage.stage)),
    [pipeline],
  );

  const submitSupport = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error(tx('consultantPractice.support.required', 'Subject and message are required.'));
      return;
    }
    setSubmitting(true);
    try {
      await practiceApi.createSupportIntake({
        subject: subject.trim(),
        message: message.trim(),
        priority,
      });
      toast.success(tx('consultantPractice.support.filed', 'Practice support request filed.'));
      setSubject('');
      setMessage('');
      setPriority('normal');
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-gray-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {tx('consultantPractice.loading', 'Loading practice reports…')}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block
        icon={BarChart3}
        label={tx('consultantPractice.pipeline.label', 'Inquiry Pipeline')}
        title={tx('consultantPractice.pipeline.title', 'Where your inquiries stand')}
      >
        {pipeline?.totals?.count ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {openStages.map((stage) => (
                <span key={stage.stage} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-200">
                  {tx(STAGE_LABELS[stage.stage] || 'consultantPractice.pipeline.stages.assigned', stage.stage)}
                  {' · '}
                  {stage.count}
                  {' · '}
                  {money(stage.estimatedConsultantShareCents)}
                </span>
              ))}
            </div>
            <p className="text-sm text-gray-400">
              {tx('consultantPractice.pipeline.total', 'Open pipeline value (your share)')}
              {': '}
              <span className="font-semibold text-white">
                {money(openStages.reduce((sum, stage) => sum + (stage.estimatedConsultantShareCents || 0), 0))}
              </span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {tx('consultantPractice.pipeline.closedNote', 'Lost, declined, and completed inquiries are not in the open funnel.')}
            </p>
          </>
        ) : (
          <Empty>{tx('consultantPractice.pipeline.empty', 'No assigned inquiries yet.')}</Empty>
        )}
      </Block>

      <Block
        icon={CalendarClock}
        label={tx('consultantPractice.utilization.label', 'Availability Utilization')}
        title={tx('consultantPractice.utilization.title', 'How full your calendar is')}
      >
        {utilization ? (
          <>
            <p className="text-sm text-gray-300">
              {utilization.utilizationPercent == null
                ? tx('consultantPractice.utilization.noAvailability', 'Set your recurring availability to measure utilization.')
                : (
                  <>
                    <span className="text-2xl font-semibold text-white">{utilization.utilizationPercent}%</span>
                    {' '}
                    {tx('consultantPractice.utilization.bookedOf', 'booked')}
                    {' '}
                    {hours(utilization.totalBookedMinutes)}
                    {' / '}
                    {hours(utilization.totalAvailableMinutes)}
                  </>
                )}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {utilization.from}
              {' – '}
              {utilization.to}
              {utilization.timeZone ? ` · ${utilization.timeZone}` : ''}
            </p>
            <div className="mt-3 space-y-1.5">
              {(utilization.days || []).slice(-14).map((day) => (
                <div key={day.date} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-gray-500">{day.date.slice(5)}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className="h-full rounded-full bg-orange-500"
                      style={{ width: `${day.availableMinutes > 0 ? Math.min(100, (day.bookedMinutes / day.availableMinutes) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-gray-400">{hours(day.bookedMinutes)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Empty>{tx('consultantPractice.utilization.empty', 'No utilization data yet.')}</Empty>
        )}
      </Block>

      <Block
        icon={ClipboardList}
        label={tx('consultantPractice.deliverables.label', 'Outstanding Deliverables')}
        title={tx('consultantPractice.deliverables.title', 'Work still open across engagements')}
      >
        {(deliverables?.outstanding?.length || deliverables?.awaitingAcceptance?.length) ? (
          <>
            {deliverables.outstanding.length > 0 && (
              <ul className="space-y-2">
                {deliverables.outstanding.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-gray-800 bg-[#0d1016] px-3 py-2.5 text-sm">
                    <span>
                      <span className="block font-semibold text-white">{item.name}</span>
                      <span className="block text-xs text-gray-500">{item.sessionBusinessName || ''}</span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${item.daysOverdue != null ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-gray-700 bg-gray-900 text-gray-300'}`}>
                      {item.daysOverdue != null
                        ? tx('consultantPractice.deliverables.overdueBy', '{{count}}d overdue', { count: item.daysOverdue })
                        : (item.dueDate || tx('consultantPractice.deliverables.noDueDate', 'No due date'))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {deliverables.awaitingAcceptance.length > 0 && (
              <p className="mt-3 text-sm text-gray-400">
                {tx('consultantPractice.deliverables.awaitingAcceptance', 'Awaiting client acceptance: {{count}}', { count: deliverables.awaitingAcceptance.length })}
              </p>
            )}
          </>
        ) : (
          <Empty>{tx('consultantPractice.deliverables.empty', 'Nothing outstanding. Every milestone is accepted.')}</Empty>
        )}
      </Block>

      <Block
        icon={Wallet}
        label={tx('consultantPractice.earnings.label', 'Permitted Earnings')}
        title={tx('consultantPractice.earnings.title', 'What completed work earned')}
      >
        {earnings?.totals?.completedPayments ? (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-gray-800 bg-[#0d1016] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{tx('consultantPractice.earnings.gross', 'Gross')}</p>
                <p className="mt-1 text-lg font-semibold text-white">{money(earnings.totals.grossCents)}</p>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-[#0d1016] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{tx('consultantPractice.earnings.yourShare', 'Your share')}</p>
                <p className="mt-1 text-lg font-semibold text-emerald-300">{money(earnings.totals.consultantShareCents)}</p>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-[#0d1016] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{tx('consultantPractice.earnings.oxsteedShare', 'OxSteed share')}</p>
                <p className="mt-1 text-lg font-semibold text-gray-300">{money(earnings.totals.oxsteedShareCents)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {tx('consultantPractice.earnings.note', 'Completed payments only, split by the agreed cut on each engagement. This is a report, not a payout.')}
              {earnings.totals.refundedCount > 0 && (
                <>
                  {' '}
                  {tx('consultantPractice.earnings.refunded', 'Refunded: {{amount}} across {{count}} payments.', { amount: money(earnings.totals.refundedCents), count: earnings.totals.refundedCount })}
                </>
              )}
            </p>
            {(earnings.monthly || []).length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {earnings.monthly.slice(0, 6).map((row) => (
                  <li key={row.month} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-400">{row.month}</span>
                    <span className="text-gray-200">{money(row.consultantShareCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Empty>{tx('consultantPractice.earnings.empty', 'No completed payments yet.')}</Empty>
        )}
      </Block>

      <div className="lg:col-span-2">
        <Block
          icon={LifeBuoy}
          label={tx('consultantPractice.support.label', 'Practice Support')}
          title={tx('consultantPractice.support.title', 'Ask OxSteed for help with your practice')}
        >
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600" data-track="ui.8559a716c0.1"
            >
              <LifeBuoy className="h-4 w-4" />
              {tx('consultantPractice.support.newRequest', 'New support request')}
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  {tx('consultantPractice.support.subject', 'Subject')}
                </label>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={500}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  {tx('consultantPractice.support.message', 'Message')}
                </label>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={5000}
                  className="min-h-[100px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  {tx('consultantPractice.support.priority', 'Priority')}
                </label>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none"
                >
                  {['low', 'normal', 'high', 'urgent'].map((value) => (
                    <option key={value} value={value}>
                      {tx(`consultantPractice.support.priorities.${value}`, value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={submitSupport}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.8559a716c0.2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting
                    ? tx('consultantPractice.support.submitting', 'Filing…')
                    : tx('consultantPractice.support.submit', 'File request')}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white" data-track="ui.8559a716c0.3"
                >
                  {tx('consultantPractice.support.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          )}
          {tickets.length > 0 && (
            <ul className="mt-4 space-y-2">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-[#0d1016] px-3 py-2.5 text-sm">
                  <span>
                    <span className="block font-semibold text-white">#{ticket.ticketNumber} {ticket.subject}</span>
                    <span className="block text-xs text-gray-500">{ticket.createdAt ? String(ticket.createdAt).slice(0, 10) : ''}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] font-semibold text-gray-300">
                    {ticket.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500 lg:col-span-2">
        <TrendingUp className="h-4 w-4" />
        {tx('consultantPractice.hint', 'Reports cover your own engagements only. Earnings are completed payments split by the agreed cut.')}
      </div>
    </div>
  );
}
