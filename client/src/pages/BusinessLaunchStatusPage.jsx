import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  AlertCircle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Compass,
  FileStack,
  Mail,
  MapPin,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { deliverablesApi } from '../api/consultantDeliverables';
import { changesApi } from '../api/consultantChanges';
import { confidentialityApi, downloadEngagementRecord } from '../api/consultantConfidentiality';
import { closeoutApi } from '../api/consultantCloseout';
import '../styles/BusinessLaunchStatus.css';

const STATUS_PROGRESS = {
  pending: 10,
  contacted: 30,
  kickoff_scheduled: 50,
  in_progress: 75,
  completed: 100,
  cancelled: 0,
};

const STATUS_COLORS = {
  pending: '#F59E0B',
  contacted: '#4F46E5',
  kickoff_scheduled: '#8B5CF6',
  in_progress: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
};

const STATUS_COPY = {
  pending: 'desc_pending',
  contacted: 'desc_contacted',
  kickoff_scheduled: 'desc_kickoff_scheduled',
  in_progress: 'desc_in_progress',
  completed: 'desc_completed',
  cancelled: 'desc_cancelled',
};

const PACKAGE_DISPLAY = {
  initial: 'package_initial',
  foundation: 'package_foundation',
  launch: 'package_launch',
  accelerator: 'package_accelerator',
};

const URGENCY_DISPLAY = {
  exploring: 'urgency_exploring',
  two_weeks: 'urgency_twoWeeks',
  asap: 'urgency_asap',
};

function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        background: `${STATUS_COLORS[status] || '#6B7280'}22`,
        color: STATUS_COLORS[status] || '#CBD5E1',
        border: `1px solid ${STATUS_COLORS[status] || '#6B7280'}55`,
        padding: '0.4rem 0.85rem',
        borderRadius: '999px',
        fontSize: '0.82rem',
        fontWeight: 700,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '999px',
          background: STATUS_COLORS[status] || '#6B7280',
        }}
      />
      {t(`businessLaunchStatus.status_${status}`, {
        defaultValue: status.replace(/_/g, ' '),
      })}
    </span>
  );
}

function ProgressBar({ status, compact = false }) {
  const { t } = useTranslation();
  const pct = STATUS_PROGRESS[status] ?? 0;
  return (
    <div style={{ marginTop: compact ? '0.45rem' : '0.75rem' }}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('businessLaunchStatus.progressAria', {
          defaultValue: 'Progress: {{progress}}%',
          progress: pct,
        })}
        style={{
          width: '100%',
          height: compact ? '7px' : '9px',
          background: 'rgba(148,163,184,0.18)',
          borderRadius: '999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: STATUS_COLORS[status] || '#6B7280',
            borderRadius: '999px',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function StageTimeline({ status }) {
  const { t } = useTranslation();
  const stages = ['pending', 'contacted', 'kickoff_scheduled', 'in_progress', 'completed'];
  const activeIndex = stages.indexOf(status);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: '0.6rem',
      }}
    >
      {stages.map((stage, index) => {
        const done = activeIndex >= index;
        const color = STATUS_COLORS[stage];
        return (
          <div
            key={stage}
            style={{
              border: `1px solid ${done ? `${color}55` : 'rgba(148,163,184,0.15)'}`,
              background: done ? `${color}14` : 'rgba(255,255,255,0.02)',
              borderRadius: '16px',
              padding: '0.8rem',
            }}
          >
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '999px',
                background: done ? color : 'rgba(148,163,184,0.2)',
                color: done ? '#fff' : '#94A3B8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.78rem',
                fontWeight: 700,
                marginBottom: '0.65rem',
              }}
            >
              {index + 1}
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: done ? 'var(--app-text)' : 'var(--muted-text)' }}>
              {t(`businessLaunchStatus.status_${stage}`, {
                defaultValue: stage.replace(/_/g, ' '),
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NextSteps({ status }) {
  const { t } = useTranslation();

  const steps = {
    pending: [
      t('businessLaunchStatus.next_pending_1', { defaultValue: 'Our team reviews your submission (usually within 24 hours)' }),
      t('businessLaunchStatus.next_pending_2', { defaultValue: "You'll receive a scheduling link to book your kickoff call" }),
      t('businessLaunchStatus.next_pending_3', { defaultValue: 'We send you a pre-kickoff questionnaire to complete' }),
    ],
    contacted: [
      t('businessLaunchStatus.next_contacted_1', { defaultValue: "Check your email - we've reached out with next steps" }),
      t('businessLaunchStatus.next_contacted_2', { defaultValue: 'Book your kickoff call using the scheduling link we sent' }),
      t('businessLaunchStatus.next_contacted_3', { defaultValue: 'Complete the pre-kickoff questionnaire before your call' }),
    ],
    kickoff_scheduled: [
      t('businessLaunchStatus.next_kickoff_1', { defaultValue: 'Check your email for the calendar invite and prep materials' }),
      t('businessLaunchStatus.next_kickoff_2', { defaultValue: 'Prepare your government ID for identity verification' }),
      t('businessLaunchStatus.next_kickoff_3', { defaultValue: 'Have 2-3 business name ideas ready' }),
    ],
    in_progress: [
      t('businessLaunchStatus.next_inprogress_1', { defaultValue: 'Your business setup is underway - we will update you by email' }),
      t('businessLaunchStatus.next_inprogress_2', { defaultValue: 'Respond promptly to any information requests from our team' }),
      t('businessLaunchStatus.next_inprogress_3', { defaultValue: 'Review deliverables as they arrive in your email' }),
    ],
    completed: [
      t('businessLaunchStatus.next_completed_1', { defaultValue: 'Your business is fully set up and ready to operate!' }),
      t('businessLaunchStatus.next_completed_2', { defaultValue: 'Check your email for the full handoff document' }),
      t('businessLaunchStatus.next_completed_3', { defaultValue: 'Reach out any time if you have follow-up questions' }),
    ],
    cancelled: [
      t('businessLaunchStatus.next_cancelled_1', { defaultValue: 'This request has been cancelled' }),
      t('businessLaunchStatus.next_cancelled_2', { defaultValue: 'Submit a new intake form any time to restart the process' }),
    ],
  };

  const items = steps[status] || steps.pending;
  return (
    <ol
      style={{
        margin: 0,
        paddingLeft: '1.3rem',
        color: 'var(--muted-text)',
        lineHeight: 1.85,
        fontSize: '0.95rem',
      }}
    >
      {items.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  );
}

function RequestCard({ request, onClick, featured = false }) {
  const { t } = useTranslation();
  const packageName = t(
    `businessLaunchStatus.${PACKAGE_DISPLAY[request.package_selected] || 'selectedPackage'}`,
    {
      defaultValue: request.package_selected,
    },
  );
  const progress = STATUS_PROGRESS[request.status] ?? 0;
  const summary = t(`businessLaunchStatus.${STATUS_COPY[request.status] || 'desc_pending'}`, { defaultValue: '' });
  const title = request.business_name || `${request.first_name} ${request.last_name}`;

  return (
    <article
      onClick={onClick}
      onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onClick()}
      tabIndex={0}
      role="button"
      aria-label={t('businessLaunchStatus.viewDetailsFor', {
        defaultValue: 'View details for {{name}}',
        name: title,
      })}
      style={{
        background: featured
          ? 'linear-gradient(180deg, rgba(79,70,229,0.12), rgba(11,18,32,0.96))'
          : 'rgba(15,23,42,0.72)',
        border: `1px solid ${featured ? 'rgba(79,70,229,0.28)' : 'rgba(148,163,184,0.14)'}`,
        borderRadius: '24px',
        padding: featured ? '1.5rem' : '1.25rem',
        cursor: 'pointer',
        transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
        boxShadow: featured ? '0 18px 50px rgba(2,6,23,0.28)' : 'none',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.borderColor = `${STATUS_COLORS[request.status] || '#94A3B8'}55`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = featured ? 'rgba(79,70,229,0.28)' : 'rgba(148,163,184,0.14)';
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.2)';
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = featured ? '0 18px 50px rgba(2,6,23,0.28)' : 'none';
      }} data-track="ui.478f2e3593.1"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          {featured && (
            <div style={{ marginBottom: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#A5B4FC', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <Rocket size={13} />
              {t('businessLaunchStatus.activeLaunch', { defaultValue: 'Active launch' })}
            </div>
          )}
          <h3 style={{ margin: '0 0 0.3rem', fontSize: featured ? '1.35rem' : '1.08rem', fontWeight: 700, color: 'var(--app-text)' }}>
            {title}
          </h3>
          <p style={{ margin: 0, color: 'var(--muted-text)', fontSize: '0.92rem' }}>{packageName}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.8rem' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted-text)', fontWeight: 600 }}>
              {t('businessLaunchStatus.progressLabel', { defaultValue: 'Launch progress' })}
            </span>
            <span style={{ fontSize: '0.82rem', color: 'var(--app-text)', fontWeight: 700 }}>{progress}%</span>
          </div>
          <ProgressBar status={request.status} compact />
        </div>

        <p style={{ margin: 0, color: 'var(--muted-text)', fontSize: '0.9rem', lineHeight: 1.55 }}>
          {summary}
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: 'var(--muted-text)', fontSize: '0.82rem' }}>
          <span>{t('businessLaunchStatus.submitted', { defaultValue: 'Submitted' })} {fmtDate(request.created_at)}</span>
          {request.current_phase ? <span>{t('businessLaunchStatus.currentPhase', { defaultValue: 'Current Phase' })}: {request.current_phase} / 25</span> : null}
          {request.urgency ? (
            <span>
              {t(
                `businessLaunchStatus.${URGENCY_DISPLAY[request.urgency] || `urgency_${request.urgency}`}`,
                { defaultValue: request.urgency },
              )}
            </span>
          ) : null}
        </div>

        <div style={{ color: '#A5B4FC', fontSize: '0.84rem', fontWeight: 700 }}>
          {t('businessLaunchStatus.viewDetails', { defaultValue: 'View details' })} →
        </div>
      </div>
    </article>
  );
}

function DetailField({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div
      style={{
        border: '1px solid rgba(148,163,184,0.14)',
        background: 'rgba(255,255,255,0.02)',
        borderRadius: '18px',
        padding: '0.9rem 1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem', color: 'var(--muted-text)', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        <Icon size={14} />
        {label}
      </div>
      <div style={{ color: 'var(--app-text)', fontSize: '0.95rem', lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function fmtProposalPrice(priceCents, currency) {
  if (priceCents === null || priceCents === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(priceCents / 100);
}

// Group 10 Slice D (521-525): the client reviews the sent proposal and
// approves or rejects it here, on their launch status page. Approval
// moves the referral to engaged; rejection needs a reason so the
// consultant knows what to change. Earlier versions stay visible as
// history; only the sent version can be decided.
function ProposalReview({ requestId }) {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setForbidden(false);
      const { data } = await api.get(`/consulting/business-launch/requests/${encodeURIComponent(requestId)}/proposals`);
      setProposals(data.proposals || []);
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      else setError(err.response?.data?.error || t('consultantProposal.loadError', { defaultValue: 'Proposals could not be loaded.' }));
    } finally {
      setLoading(false);
    }
  }, [requestId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const sent = proposals.find((proposal) => proposal.status === 'sent') || null;
  const latest = proposals[0] || null;

  async function decide(action) {
    if (!sent) return;
    if (action === 'reject' && rejectReason.trim().length < 10) {
      setError(t('consultantProposal.rejectReasonRequired', { defaultValue: 'Tell the consultant what to change (at least 10 characters).' }));
      return;
    }
    try {
      setBusy(true);
      setError('');
      setNotice('');
      await api.post(
        `/consulting/business-launch/requests/${encodeURIComponent(requestId)}/proposals/${sent.id}/${action}`,
        action === 'reject' ? { reason: rejectReason.trim() } : {},
      );
      setNotice(action === 'approve'
        ? t('consultantProposal.approved', { defaultValue: 'Proposal approved. The engagement is agreed.' })
        : t('consultantProposal.rejected', { defaultValue: 'Proposal rejected. Your consultant can send a revised version.' }));
      setShowReject(false);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consultantProposal.saveError', { defaultValue: 'Could not record your decision.' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bl-proposal">
      <h3 className="bl-proposal__title">
        {t('consultantProposal.title', { defaultValue: 'Engagement proposal' })}
      </h3>
      {loading ? (
        <p className="bl-proposal__note">{t('common.loading', { defaultValue: 'Loading…' })}</p>
      ) : forbidden ? (
        <p className="bl-proposal__note">
          {t('consultantProposal.clientOnly', { defaultValue: 'Proposals are visible to the request owner.' })}
        </p>
      ) : !proposals.length ? (
        <p className="bl-proposal__note">
          {t('consultantProposal.clientEmpty', { defaultValue: 'No proposal yet. Your consultant will send one here once the scope is agreed.' })}
        </p>
      ) : (
        <div className="bl-proposal__stack">
          {error && <p role="alert" className="bl-proposal__error">{error}</p>}
          {notice && <p role="status" className="bl-proposal__notice">{notice}</p>}
          {latest && (
            <div className={`bl-proposal__card bl-proposal__card--${latest.status}`}>
              <div className="bl-proposal__card-head">
                <div>
                  <div className="bl-proposal__card-title">
                    {t('consultantProposal.versionLabel', { defaultValue: 'Version {{version}}', version: latest.version })} • {latest.title}
                  </div>
                  <div className="bl-proposal__card-meta">
                    {fmtProposalPrice(latest.price_cents, latest.currency)}
                    {' • '}
                    {t(`consultantProposal.status.${latest.status}`, { defaultValue: latest.status.replace(/_/g, ' ') })}
                  </div>
                </div>
              </div>
              {latest.scope_summary && (
                <p className="bl-proposal__scope">{latest.scope_summary}</p>
              )}
              {(latest.deliverables || []).length > 0 && (
                <div className="bl-proposal__group">
                  <div className="bl-proposal__group-label">
                    {t('consultantProposal.deliverablesTitle', { defaultValue: 'Deliverables' })}
                  </div>
                  <ul className="bl-proposal__list">
                    {latest.deliverables.map((item) => (
                      <li key={item.id}>
                        {item.title}
                        {item.due_date ? ` • ${t('consultantProposal.dueLabel', { defaultValue: 'due {{date}}', date: String(item.due_date).slice(0, 10) })}` : ''}
                        {item.description ? <span className="bl-proposal__item-desc">{item.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(latest.exclusions || []).length > 0 && (
                <div className="bl-proposal__group">
                  <div className="bl-proposal__group-label">
                    {t('consultantProposal.exclusionsTitle', { defaultValue: 'Scope exclusions' })}
                  </div>
                  <ul className="bl-proposal__list">
                    {latest.exclusions.map((item) => (
                      <li key={item.id}>{item.exclusion_text}</li>
                    ))}
                  </ul>
                </div>
              )}
              {latest.decision_reason && (
                <p className="bl-proposal__reason">
                  {t('consultantProposal.decisionReason', { defaultValue: 'Decision note: {{reason}}', reason: latest.decision_reason })}
                </p>
              )}
              {sent && (
                <div className="bl-proposal__actions">
                  <div className="bl-proposal__action-row">
                    <button
                      type="button"
                      onClick={() => decide('approve')}
                      disabled={busy}
                      className="bl-proposal__btn-approve" data-track="ui.478f2e3593.10"
                    >
                      {t('consultantProposal.approve', { defaultValue: 'Approve proposal' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReject((prev) => !prev)}
                      disabled={busy}
                      className="bl-proposal__btn-reject" data-track="ui.478f2e3593.11"
                    >
                      {t('consultantProposal.reject', { defaultValue: 'Ask for changes' })}
                    </button>
                  </div>
                  {showReject && (
                    <div className="bl-proposal__reject-form">
                      <label className="bl-proposal__reject-label">
                        {t('consultantProposal.rejectReasonLabel', { defaultValue: 'What should change?' })}
                      </label>
                      <textarea
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        rows={3}
                        className="bl-proposal__reject-text"
                        placeholder={t('consultantProposal.rejectReasonPlaceholder', { defaultValue: 'Tell your consultant what to change, so the next version gets it right.' })}
                      />
                      <div>
                        <button
                          type="button"
                          onClick={() => decide('reject')}
                          disabled={busy || rejectReason.trim().length < 10}
                          className="bl-proposal__btn-confirm" data-track="ui.478f2e3593.12"
                        >
                          {t('consultantProposal.rejectConfirm', { defaultValue: 'Send rejection' })}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {proposals.length > 1 && (
            <div>
              <div className="bl-proposal__history-label">
                {t('consultantProposal.historyTitle', { defaultValue: 'Version history' })}
              </div>
              <ul className="bl-proposal__history-list">
                {proposals.slice(1).map((proposal) => (
                  <li key={proposal.id} className="bl-proposal__history-item">
                    <button type="button" onClick={() => setExpandedId((prev) => (prev === proposal.id ? null : proposal.id))} className="bl-proposal__history-button" data-track="ui.478f2e3593.13">
                      {t('consultantProposal.versionLabel', { defaultValue: 'Version {{version}}', version: proposal.version })} • {proposal.title} • {fmtProposalPrice(proposal.price_cents, proposal.currency)} • {t(`consultantProposal.status.${proposal.status}`, { defaultValue: proposal.status.replace(/_/g, ' ') })}
                    </button>
                    {expandedId === proposal.id && proposal.decision_reason && (
                      <p className="bl-proposal__history-reason">{proposal.decision_reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Group 10 Slice E (526-530): the client's milestone board. Loads the
// engagement session behind an engaged referral, shows each milestone
// with its documents, lets the client accept a delivered milestone and
// leave feedback on it, and exchange documents both ways.
function MilestoneBoard({ request }) {
  const { t } = useTranslation();
  const [session, setSession] = useState(null);
  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notStarted, setNotStarted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState({});
  const [feedbackSent, setFeedbackSent] = useState({});
  const [uploadVisibility, setUploadVisibility] = useState({});
  const [uploadBusy, setUploadBusy] = useState('');

  const engaged = request.consultant_assignment_status === 'engaged';

  const load = useCallback(async () => {
    if (!engaged) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const { data } = await deliverablesApi.getEngagementSession(request.id);
      setSession(data.session || null);
      setDeliverables(Array.isArray(data.deliverables) ? data.deliverables : []);
      setNotStarted(false);
    } catch (err) {
      if (err.response?.data?.code === 'session_not_started') {
        setNotStarted(true);
      } else {
        setError(err.response?.data?.error || t('consultantDeliverable.loadError', { defaultValue: 'Could not load the milestone board.' }));
      }
    } finally {
      setLoading(false);
    }
  }, [engaged, request.id, t]);

  useEffect(() => { load(); }, [load]);

  if (!engaged) return null;

  const isOverdue = (item) => {
    if (!item.due_date || !['pending', 'in_progress'].includes(item.status)) return false;
    return String(item.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10);
  };

  const accept = async (item) => {
    if (!session) return;
    try {
      setBusy(`accept-${item.id}`);
      setError('');
      setNotice('');
      await deliverablesApi.acceptDeliverable(session.id, item.id);
      setNotice(t('consultantDeliverable.acceptedNotice', { defaultValue: 'Milestone accepted. Thank you.' }));
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consultantDeliverable.acceptError', { defaultValue: 'Could not accept the milestone.' }));
    } finally {
      setBusy('');
    }
  };

  const sendFeedback = async (item) => {
    if (!session) return;
    const form = feedback[item.id] || {};
    const rating = Number(form.rating || 5);
    try {
      setBusy(`feedback-${item.id}`);
      setError('');
      await deliverablesApi.submitFeedback(session.id, {
        rating, feedback_text: (form.text || '').trim(), deliverable_id: item.id,
      });
      setFeedbackSent((prev) => ({ ...prev, [item.id]: true }));
      setNotice(t('consultantDeliverable.feedbackSent', { defaultValue: 'Feedback sent. Thank you.' }));
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consultantDeliverable.feedbackError', { defaultValue: 'Could not send feedback.' }));
    } finally {
      setBusy('');
    }
  };

  const uploadDocument = async (event, item) => {
    const file = event.target.files?.[0];
    if (!file || !session) return;
    const form = new FormData();
    form.append('file', file);
    form.append('visibility', uploadVisibility[item.id] || 'shared');
    try {
      setUploadBusy(`upload-${item.id}`);
      setError('');
      await deliverablesApi.attachClientDocument(session.id, item.id, form);
      setNotice(t('consultantDeliverable.documentUploaded', { defaultValue: 'Document attached.' }));
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consultantDeliverable.uploadError', { defaultValue: 'Could not attach the document.' }));
    } finally {
      setUploadBusy('');
      event.target.value = '';
    }
  };

  const downloadDocument = async (doc) => {
    try {
      const { data } = await deliverablesApi.downloadClientDocument(doc.id);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('consultantDeliverable.downloadError', { defaultValue: 'Could not prepare the download.' }));
    }
  };

  const feedbackOpen = (item) => ['draft_delivered', 'completed', 'accepted'].includes(item.status);
  const acceptOpen = (item) => ['draft_delivered', 'completed'].includes(item.status);

  return (
    <section className="bl-milestone">
      <h3 className="bl-milestone__title">
        {t('consultantDeliverable.title', { defaultValue: 'Milestone board' })}
      </h3>
      {loading ? (
        <p className="bl-milestone__note">{t('common.loading', { defaultValue: 'Loading…' })}</p>
      ) : notStarted ? (
        <p className="bl-milestone__note">
          {t('consultantDeliverable.notStarted', { defaultValue: 'The engagement is agreed. Your consultant will start it and the milestones will appear here.' })}
        </p>
      ) : (
        <div className="bl-milestone__stack">
          {error && <p role="alert" className="bl-milestone__error">{error}</p>}
          {notice && <p role="status" className="bl-milestone__notice">{notice}</p>}
          {!deliverables.length && (
            <p className="bl-milestone__note">
              {t('consultantDeliverable.noMilestones', { defaultValue: 'No milestones on this engagement yet.' })}
            </p>
          )}
          {deliverables.map((item) => {
            const form = feedback[item.id] || {};
            return (
              <div key={item.id} className="bl-milestone__card">
                <div className="bl-milestone__card-title">{item.name}</div>
                <div className="bl-milestone__card-meta">
                  {t(`consultantProposal.deliverableTypes.${item.deliverable_type}`, { defaultValue: (item.deliverable_type || 'other').replace(/_/g, ' ') })}
                  {' • '}
                  {t('consultantDeliverable.dueLabel', { defaultValue: 'due {{date}}', date: item.due_date ? String(item.due_date).slice(0, 10) : '-' })}
                  {' • '}
                  {isOverdue(item)
                    ? t('consultantDeliverable.overdue', { defaultValue: 'overdue' })
                    : t(`consultantDeliverable.status.${item.status}`, { defaultValue: item.status.replace(/_/g, ' ') })}
                </div>
                {item.description && <p className="bl-milestone__draft">{item.description}</p>}
                {item.draft_note && (
                  <p className="bl-milestone__draft">
                    {t('consultantDeliverable.draftNote', { defaultValue: 'Draft note: {{note}}', note: item.draft_note })}
                  </p>
                )}
                {(item.documents || []).length > 0 && (
                  <ul className="bl-milestone__list">
                    {item.documents.map((doc) => (
                      <li key={doc.id} className="bl-milestone__doc-row">
                        <span className="bl-milestone__doc-name">{doc.originalName}</span>
                        {doc.expired ? (
                          <span className="bl-milestone__doc-expired">{t('consultantConfidentiality.docExpired', { defaultValue: 'Access expired' })}</span>
                        ) : doc.expiresAt ? (
                          <span className="bl-milestone__doc-expiry">{t('consultantConfidentiality.docExpiry', { defaultValue: 'Access until {{date}}', date: String(doc.expiresAt).slice(0, 10) })}</span>
                        ) : null}
                        <button type="button" onClick={() => downloadDocument(doc)} className="bl-milestone__doc-button" data-track="ui.478f2e3593.16">
                          {t('consultantDeliverable.download', { defaultValue: 'Download' })}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="bl-milestone__upload">
                  <span>{t('consultantDeliverable.attachDocument', { defaultValue: 'Attach a document' })}</span>
                  <select
                    value={uploadVisibility[item.id] || 'shared'}
                    onChange={(event) => setUploadVisibility((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    disabled={uploadBusy === `upload-${item.id}`}
                    className="bl-milestone__select"
                  >
                    <option value="shared">{t('consultantDeliverable.visibilityShared', { defaultValue: 'Shared with consultant' })}</option>
                    <option value="client_only">{t('consultantDeliverable.visibilityClientOnly', { defaultValue: 'Only me' })}</option>
                  </select>
                  <input type="file" onChange={(event) => uploadDocument(event, item)} disabled={uploadBusy === `upload-${item.id}`} accept="image/*,application/pdf,.doc,.docx" />
                </label>
                <div className="bl-milestone__actions">
                  {acceptOpen(item) && (
                    <button
                      type="button"
                      onClick={() => accept(item)}
                      disabled={busy === `accept-${item.id}`}
                      className="bl-milestone__btn-accept" data-track="ui.478f2e3593.14"
                    >
                      {t('consultantDeliverable.accept', { defaultValue: 'Accept milestone' })}
                    </button>
                  )}
                  {item.status === 'accepted' && (
                    <p className="bl-milestone__accepted">
                      {t('consultantDeliverable.accepted', { defaultValue: 'Accepted by you' })}
                      {item.accepted_at ? ` • ${new Date(item.accepted_at).toLocaleDateString()}` : ''}
                    </p>
                  )}
                </div>
                {feedbackOpen(item) && !feedbackSent[item.id] && item.feedback_count === 0 && (
                  <div className="bl-milestone__feedback-form">
                    <label className="bl-milestone__feedback-label" htmlFor={`feedback-rating-${item.id}`}>
                      {t('consultantDeliverable.feedbackLabel', { defaultValue: 'How was this milestone?' })}
                    </label>
                    <select
                      id={`feedback-rating-${item.id}`}
                      value={form.rating || '5'}
                      onChange={(event) => setFeedback((prev) => ({ ...prev, [item.id]: { ...form, rating: event.target.value } }))}
                      className="bl-milestone__select"
                    >
                      {[5, 4, 3, 2, 1].map((value) => (
                        <option key={value} value={value}>
                          {t('consultantDeliverable.ratingOption', { defaultValue: '{{rating}} out of 5', rating: value })}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={form.text || ''}
                      onChange={(event) => setFeedback((prev) => ({ ...prev, [item.id]: { ...form, text: event.target.value } }))}
                      rows={3}
                      className="bl-milestone__feedback-text"
                      placeholder={t('consultantDeliverable.feedbackPlaceholder', { defaultValue: 'Tell your consultant what worked and what could be better.' })}
                    />
                    <div>
                      <button
                        type="button"
                        onClick={() => sendFeedback(item)}
                        disabled={busy === `feedback-${item.id}`}
                        className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.15"
                      >
                        {t('consultantDeliverable.sendFeedback', { defaultValue: 'Send feedback' })}
                      </button>
                    </div>
                  </div>
                )}
                {item.feedback_count > 0 && (
                  <p className="bl-milestone__card-meta">
                    {t('consultantDeliverable.feedbackGiven', { defaultValue: 'Feedback sent for this milestone.' })}
                  </p>
                )}
              </div>
            );
          })}
          {session && (
            <>
              <MilestoneChanges session={session} deliverables={deliverables} onChanged={load} />
              <MilestoneConfidentiality session={session} deliverables={deliverables} onChanged={load} />
              <MilestoneCloseout session={session} onChanged={load} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

// Group 10 Slice F (531-535): the client's change-request, history, and
// pause UI on the milestone board. The client files requests, decides
// the consultant's requests, and pauses/resumes the engagement.
function MilestoneChanges({ session, deliverables, onChanged }) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [events, setEvents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('scope_revision');
  const [formDeliverable, setFormDeliverable] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formReason, setFormReason] = useState('');
  const [rejectReasons, setRejectReasons] = useState({});
  const [pauseReason, setPauseReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadChanges = useCallback(async () => {
    try {
      const [reqRes, histRes] = await Promise.all([
        changesApi.listClientChangeRequests(session.id),
        changesApi.getClientHistory(session.id),
      ]);
      setRequests(Array.isArray(reqRes.data?.changeRequests) ? reqRes.data.changeRequests : []);
      setEvents(Array.isArray(histRes.data?.events) ? histRes.data.events : []);
    } catch (err) {
      setError(err.response?.data?.error || t('consultantChange.loadError', { defaultValue: 'Could not load the changes.' }));
    }
  }, [session.id, t]);

  useEffect(() => { loadChanges(); }, [loadChanges]);

  const runAction = async (key, fn, successKey, successDefault) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      if (successKey) setNotice(t(successKey, { defaultValue: successDefault || successKey }));
      await loadChanges();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setBusy('');
    }
  };

  const submitRequest = () => runAction('submit-request', () => changesApi.createClientChangeRequest(session.id, {
    request_type: formType,
    deliverable_id: formDeliverable || null,
    title: null,
    reason: formReason.trim(),
    new_title: formTitle.trim() || null,
    new_description: formDescription.trim() || null,
    new_due_date: formDueDate || null,
    amount_cents: formType === 'additional_fee' ? Math.round(Number(formAmount) * 100) : null,
    currency: 'USD',
  }), 'consultantChange.requested', 'Change request sent.').then(() => {
    setShowForm(false);
    setFormTitle('');
    setFormDescription('');
    setFormDueDate('');
    setFormAmount('');
    setFormReason('');
  });

  const paused = session.status === 'paused';

  return (
    <div className="bl-milestone__changes">
      <h4 className="bl-milestone__changes-title">
        {t('consultantChange.title', { defaultValue: 'Changes' })}
      </h4>
      {error && <p role="alert" className="bl-milestone__error">{error}</p>}
      {notice && <p role="status" className="bl-milestone__notice">{notice}</p>}
      {paused && (
        <p className="bl-milestone__paused">
          {t('consultantChange.pausedNotice', { defaultValue: 'This engagement is paused. Milestone work and change approvals are on hold until it resumes.' })}
        </p>
      )}
      <div className="bl-milestone__actions">
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.23"
        >
          {t('consultantChange.requestChange', { defaultValue: 'Request a change' })}
        </button>
        {paused ? (
          <button
            type="button"
            onClick={() => runAction('resume', () => changesApi.resumeClientEngagement(session.id), 'consultantChange.resumed', 'Engagement resumed.')}
            disabled={busy === 'resume'}
            className="bl-milestone__btn-accept" data-track="ui.478f2e3593.22"
          >
            {t('consultantChange.resume', { defaultValue: 'Resume engagement' })}
          </button>
        ) : (
          <>
            <input
              type="text"
              value={pauseReason}
              onChange={(event) => setPauseReason(event.target.value)}
              placeholder={t('consultantChange.pauseReasonPlaceholder', { defaultValue: 'Why pause? (at least 10 characters)' })}
              className="bl-milestone__feedback-text"
            />
            <button
              type="button"
              onClick={() => runAction('pause', () => changesApi.pauseClientEngagement(session.id, pauseReason.trim()), 'consultantChange.paused', 'Engagement paused.')}
              disabled={busy === 'pause' || pauseReason.trim().length < 10}
              className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.21"
            >
              {t('consultantChange.pause', { defaultValue: 'Pause engagement' })}
            </button>
          </>
        )}
      </div>
      {showForm && (
        <div className="bl-milestone__feedback-form">
          <select
            value={formType}
            onChange={(event) => setFormType(event.target.value)}
            className="bl-milestone__select"
            aria-label={t('consultantChange.requestType', { defaultValue: 'Change type' })}
          >
            <option value="scope_revision">{t('consultantChange.types.scope_revision', { defaultValue: 'Scope revision' })}</option>
            <option value="deadline_adjustment">{t('consultantChange.types.deadline_adjustment', { defaultValue: 'Deadline adjustment' })}</option>
            <option value="additional_fee">{t('consultantChange.types.additional_fee', { defaultValue: 'Additional fee' })}</option>
          </select>
          {formType !== 'additional_fee' && (
            <select
              value={formDeliverable}
              onChange={(event) => setFormDeliverable(event.target.value)}
              className="bl-milestone__select"
              aria-label={t('consultantChange.milestone', { defaultValue: 'Milestone' })}
            >
              <option value="">{t('consultantChange.wholeEngagement', { defaultValue: 'Whole engagement' })}</option>
              {(deliverables || []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          )}
          {formType === 'scope_revision' && (
            <>
              <input
                type="text"
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder={t('consultantChange.newTitlePlaceholder', { defaultValue: 'New milestone title (optional)' })}
                className="bl-milestone__feedback-text"
              />
              <textarea
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                placeholder={t('consultantChange.newDescriptionPlaceholder', { defaultValue: 'New scope or description' })}
                rows={2}
                className="bl-milestone__feedback-text"
              />
            </>
          )}
          {formType === 'deadline_adjustment' && (
            <input
              type="date"
              value={formDueDate}
              onChange={(event) => setFormDueDate(event.target.value)}
              className="bl-milestone__feedback-text"
              aria-label={t('consultantChange.newDueDate', { defaultValue: 'New due date' })}
            />
          )}
          {formType === 'additional_fee' && (
            <input
              type="number"
              min="0"
              step="0.01"
              value={formAmount}
              onChange={(event) => setFormAmount(event.target.value)}
              placeholder={t('consultantChange.amountPlaceholder', { defaultValue: 'Additional fee in dollars' })}
              className="bl-milestone__feedback-text"
            />
          )}
          <textarea
            value={formReason}
            onChange={(event) => setFormReason(event.target.value)}
            placeholder={t('consultantChange.reasonPlaceholder', { defaultValue: 'Why is this change needed? (at least 10 characters)' })}
            rows={2}
            className="bl-milestone__feedback-text"
          />
          <button
            type="button"
            onClick={submitRequest}
            disabled={busy === 'submit-request' || formReason.trim().length < 10}
            className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.17"
          >
            {t('consultantChange.submitRequest', { defaultValue: 'Send change request' })}
          </button>
        </div>
      )}
      {requests.length === 0 && events.length === 0 && (
        <p className="bl-milestone__note">{t('consultantChange.empty', { defaultValue: 'No changes yet.' })}</p>
      )}
      {requests.map((request) => (
        <div key={request.id} className="bl-milestone__card">
          <div className="bl-milestone__card-title">
            {t(`consultantChange.types.${request.requestType}`, { defaultValue: request.requestType.replace(/_/g, ' ') })}
            {request.deliverableName ? ` • ${request.deliverableName}` : ''}
          </div>
          <div className="bl-milestone__card-meta">
            {t(`consultantChange.status.${request.status}`, { defaultValue: request.status })}
            {' • '}
            {t('consultantChange.requestedBy', { defaultValue: 'Requested by {{role}}', role: t(`consultantChange.roles.${request.requestedByRole}`, { defaultValue: request.requestedByRole }) })}
            {request.amountCents != null ? ` • $${(request.amountCents / 100).toFixed(2)}` : ''}
            {request.newDueDate ? ` • ${t('consultantDeliverable.dueLabel', { defaultValue: 'due {{date}}', date: request.newDueDate })}` : ''}
          </div>
          {request.reason && <p className="bl-milestone__draft">{request.reason}</p>}
          {request.decisionReason && (
            <p className="bl-milestone__draft">
              {t('consultantChange.decisionReason', { defaultValue: 'Decision: {{reason}}', reason: request.decisionReason })}
            </p>
          )}
          {request.status === 'pending' && request.requestedByRole === 'consultant' && (
            <div className="bl-milestone__actions">
              <button
                type="button"
                onClick={() => runAction(`approve-${request.id}`, () => changesApi.approveClientChangeRequest(session.id, request.id), 'consultantChange.approved', 'Change request approved.')}
                disabled={busy === `approve-${request.id}`}
                className="bl-milestone__btn-accept" data-track="ui.478f2e3593.18"
              >
                {t('consultantChange.approve', { defaultValue: 'Approve' })}
              </button>
              <input
                type="text"
                value={rejectReasons[request.id] || ''}
                onChange={(event) => setRejectReasons((prev) => ({ ...prev, [request.id]: event.target.value }))}
                placeholder={t('consultantChange.rejectReasonPlaceholder', { defaultValue: 'Reason for declining (required)' })}
                className="bl-milestone__feedback-text"
              />
              <button
                type="button"
                onClick={() => runAction(`reject-${request.id}`, () => changesApi.rejectClientChangeRequest(session.id, request.id, (rejectReasons[request.id] || '').trim()), 'consultantChange.rejected', 'Change request declined.')}
                disabled={busy === `reject-${request.id}` || (rejectReasons[request.id] || '').trim().length < 10}
                className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.19"
              >
                {t('consultantChange.reject', { defaultValue: 'Decline' })}
              </button>
            </div>
          )}
          {request.status === 'pending' && request.requestedByRole === 'client' && (
            <button
              type="button"
              onClick={() => runAction(`withdraw-${request.id}`, () => changesApi.withdrawClientChangeRequest(session.id, request.id), 'consultantChange.withdrawn', 'Change request withdrawn.')}
              disabled={busy === `withdraw-${request.id}`}
              className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.20"
            >
              {t('consultantChange.withdraw', { defaultValue: 'Withdraw request' })}
            </button>
          )}
        </div>
      ))}
      {events.length > 0 && (
        <div>
          <h5 className="bl-milestone__changes-title">{t('consultantChange.history', { defaultValue: 'Change history' })}</h5>
          <ul className="bl-milestone__list">
            {events.map((event) => (
              <li key={event.id} className="bl-milestone__card-meta">
                {event.summary}
                {' • '}
                {event.createdAt ? String(event.createdAt).slice(0, 10) : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Group 10 Slice G (536-540): the client's confidentiality panel on the
// milestone board. The client reads the participant list, acknowledges
// for themselves, exports the engagement record, and changes sharing
// and expiry on the documents they uploaded.
function MilestoneConfidentiality({ session, deliverables, onChanged }) {
  const { t } = useTranslation();
  const [participants, setParticipants] = useState(null);
  const [confidentiality, setConfidentiality] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expiryDrafts, setExpiryDrafts] = useState({});
  const [clearedExpiry, setClearedExpiry] = useState({});
  const [visibilityDrafts, setVisibilityDrafts] = useState({});
  const [shareDrafts, setShareDrafts] = useState({});

  const loadConfidentiality = useCallback(async () => {
    try {
      const [partRes, confRes] = await Promise.all([
        confidentialityApi.listClientParticipants(session.id),
        confidentialityApi.getClientConfidentiality(session.id),
      ]);
      setParticipants(partRes.data);
      setConfidentiality(confRes.data);
    } catch (err) {
      setError(err.response?.data?.error || t('consultantConfidentiality.loadError', { defaultValue: 'Could not load confidentiality details.' }));
    }
  }, [session.id, t]);

  useEffect(() => { loadConfidentiality(); }, [loadConfidentiality]);

  const runAction = async (key, fn, successKey, successDefault) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      if (successKey) setNotice(t(successKey, { defaultValue: successDefault || successKey }));
      await loadConfidentiality();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setBusy('');
    }
  };

  const acknowledge = () => runAction(
    'acknowledge',
    () => confidentialityApi.acknowledgeClientConfidentiality(session.id),
    'consultantConfidentiality.acknowledged',
    'Confidentiality acknowledged.',
  );

  const exportRecord = async () => {
    setBusy('export');
    setError('');
    try {
      const { data } = await confidentialityApi.exportClientRecord(session.id);
      downloadEngagementRecord(data, session.id);
      setNotice(t('consultantConfidentiality.exported', { defaultValue: 'Engagement record downloaded.' }));
    } catch {
      setError(t('consultantConfidentiality.exportError', { defaultValue: 'Could not export the engagement record.' }));
    } finally {
      setBusy('');
    }
  };

  const parties = [
    ...(participants?.core || []),
    ...(participants?.participants || []).filter((party) => party.active),
  ];
  const myAck = (confidentiality?.parties || []).find((party) => party.role === 'client');
  const pending = (confidentiality?.parties || []).filter((party) => !party.acknowledgedAt);
  const fmtName = (party) => [party.firstName, party.lastName].filter(Boolean).join(' ') || party.email || party.userId;
  const myDocs = (deliverables || [])
    .flatMap((item) => (item.documents || []).map((doc) => ({ ...doc, deliverableId: item.id })))
    .filter((doc) => session.user_id && doc.uploadedBy === session.user_id);

  const saveSharing = (doc) => {
    const visibility = visibilityDrafts[doc.id] || doc.visibility;
    const payload = { visibility };
    if (clearedExpiry[doc.id]) {
      payload.expires_at = null;
    } else if (expiryDrafts[doc.id]) {
      payload.expires_at = new Date(`${expiryDrafts[doc.id]}T23:59:59.999Z`).toISOString();
    }
    if (visibility === 'limited') {
      payload.shared_with = shareDrafts[doc.id] ?? doc.sharedWith ?? [];
    }
    return runAction(
      `sharing-${doc.id}`,
      () => confidentialityApi.updateClientDocumentSharing(session.id, doc.deliverableId, doc.id, payload),
      'consultantConfidentiality.sharingUpdated',
      'Document sharing updated.',
    );
  };

  const toggleShare = (doc, userId) => {
    setShareDrafts((prev) => {
      const current = new Set(prev[doc.id] ?? doc.sharedWith ?? []);
      if (current.has(userId)) current.delete(userId);
      else current.add(userId);
      return { ...prev, [doc.id]: [...current] };
    });
  };

  return (
    <div className="bl-milestone__changes">
      <div className="bl-milestone__actions">
        <h4 className="bl-milestone__changes-title">
          {t('consultantConfidentiality.title', { defaultValue: 'Confidentiality' })}
        </h4>
        <button
          type="button"
          onClick={exportRecord}
          disabled={busy === 'export'}
          className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.24"
        >
          {t('consultantConfidentiality.export', { defaultValue: 'Export engagement record' })}
        </button>
      </div>
      {error && <p role="alert" className="bl-milestone__error">{error}</p>}
      {notice && <p role="status" className="bl-milestone__notice">{notice}</p>}
      <div>
        <h5 className="bl-milestone__changes-title">{t('consultantConfidentiality.participantsTitle', { defaultValue: 'Participants' })}</h5>
        <ul className="bl-milestone__list">
          {parties.map((party) => (
            <li key={party.userId} className="bl-milestone__card-meta">
              {fmtName(party)}
              {' • '}
              {t(`consultantConfidentiality.roles.${party.role}`, { defaultValue: party.role.replace(/_/g, ' ') })}
            </li>
          ))}
        </ul>
        {parties.length === 0 && (
          <p className="bl-milestone__card-meta">
            {t('consultantConfidentiality.participantsEmpty', { defaultValue: 'Only the client and the consultant are on this engagement.' })}
          </p>
        )}
      </div>
      <div>
        {pending.length === 0 ? (
          <p className="bl-milestone__card-meta">
            {t('consultantConfidentiality.ackDone', { defaultValue: 'Everyone on this engagement has acknowledged confidentiality.' })}
          </p>
        ) : (
          <p className="bl-milestone__card-meta">
            {pending.map((party) => t('consultantConfidentiality.ackPending', { defaultValue: 'Still waiting on {{name}}.', name: fmtName(party) })).join(' ')}
          </p>
        )}
        {myAck && !myAck.acknowledgedAt && (
          <div className="bl-milestone__feedback-form">
            <p className="bl-milestone__card-meta">
              {t('consultantConfidentiality.ackStatement', { defaultValue: 'I will keep this engagement\u2019s information confidential and share it only with the people on this engagement.' })}
            </p>
            <div>
              <button
                type="button"
                onClick={acknowledge}
                disabled={busy === 'acknowledge'}
                className="bl-milestone__btn-accept" data-track="ui.478f2e3593.25"
              >
                {t('consultantConfidentiality.acknowledge', { defaultValue: 'Acknowledge confidentiality' })}
              </button>
            </div>
          </div>
        )}
        {myAck && myAck.acknowledgedAt && (
          <p className="bl-milestone__card-meta">
            {t('consultantConfidentiality.ackYou', { defaultValue: 'You have acknowledged confidentiality.' })}
          </p>
        )}
      </div>
      {myDocs.length > 0 && (
        <div>
          <h5 className="bl-milestone__changes-title">{t('consultantDeliverable.attachDocument', { defaultValue: 'Attach a document' })}</h5>
          <ul className="bl-milestone__list">
            {myDocs.map((doc) => {
              const visibility = visibilityDrafts[doc.id] || doc.visibility;
              const expiry = expiryDrafts[doc.id] ?? (doc.expired ? '' : (doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : ''));
              return (
                <li key={doc.id} className="bl-milestone__card">
                  <p className="bl-milestone__card-meta">{doc.originalName}</p>
                  <p className="bl-milestone__card-meta">
                    {t(`consultantConfidentiality.visibility${visibility === 'shared' ? 'Shared' : visibility === 'client_only' ? 'ClientOnly' : visibility === 'consultant_only' ? 'ConsultantOnly' : visibility === 'limited' ? 'Limited' : 'Internal'}`, { defaultValue: visibility.replace(/_/g, ' ') })}
                    {doc.expired ? (
                      <span>{` • ${t('consultantConfidentiality.docExpired', { defaultValue: 'Access expired' })}`}</span>
                    ) : doc.expiresAt ? (
                      <span>{` • ${t('consultantConfidentiality.docExpiry', { defaultValue: 'Access until {{date}}', date: String(doc.expiresAt).slice(0, 10) })}`}</span>
                    ) : (
                      <span>{` • ${t('consultantConfidentiality.docNoExpiry', { defaultValue: 'No expiry' })}`}</span>
                    )}
                  </p>
                  <div className="bl-milestone__actions">
                    <select
                      value={visibility}
                      onChange={(event) => setVisibilityDrafts((prev) => ({ ...prev, [doc.id]: event.target.value }))}
                      className="bl-milestone__select"
                      aria-label={t('consultantConfidentiality.visibility', { defaultValue: 'Who can see this' })}
                    >
                      <option value="shared">{t('consultantConfidentiality.visibilityShared', { defaultValue: 'Shared with consultant' })}</option>
                      <option value="client_only">{t('consultantConfidentiality.visibilityClientOnly', { defaultValue: 'Only me' })}</option>
                      <option value="limited">{t('consultantConfidentiality.visibilityLimited', { defaultValue: 'Named people only' })}</option>
                    </select>
                    <input
                      type="date"
                      value={expiry}
                      onChange={(event) => {
                        setExpiryDrafts((prev) => ({ ...prev, [doc.id]: event.target.value }));
                        setClearedExpiry((prev) => ({ ...prev, [doc.id]: false }));
                      }}
                      className="bl-milestone__select"
                      aria-label={t('consultantConfidentiality.setExpiry', { defaultValue: 'Set expiry' })}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setExpiryDrafts((prev) => ({ ...prev, [doc.id]: '' }));
                        setClearedExpiry((prev) => ({ ...prev, [doc.id]: true }));
                      }}
                      className="bl-milestone__btn-feedback" data-track="ui.478f2e3593.26"
                    >
                      {t('consultantConfidentiality.clearExpiry', { defaultValue: 'Clear expiry' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveSharing(doc)}
                      disabled={busy === `sharing-${doc.id}`}
                      className="bl-milestone__btn-accept" data-track="ui.478f2e3593.27"
                    >
                      {t('consultantConfidentiality.saveSharing', { defaultValue: 'Save sharing' })}
                    </button>
                  </div>
                  {visibility === 'limited' && (
                    <div className="bl-milestone__actions">
                      {parties.map((party) => {
                        const selected = (shareDrafts[doc.id] ?? doc.sharedWith ?? []).includes(party.userId);
                        return (
                          <label key={party.userId} className="bl-milestone__card-meta">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleShare(doc, party.userId)} data-track="ui.478f2e3593.28"
                            />
                            {' '}
                            {fmtName(party)}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Group 10 Slice H (541-545): the client's closeout panel on the
// milestone board. The client reads the final deliverable checklist,
// confirms closeout for themselves, sees the feedback request and the
// follow-ups the consultant scheduled, and sees the archived badge.
// The client cannot schedule follow-ups or archive the engagement.
function MilestoneCloseout({ session, onChanged }) {
  const { t } = useTranslation();
  const [closeout, setCloseout] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmNote, setConfirmNote] = useState('');

  const loadCloseout = useCallback(async () => {
    try {
      const { data } = await closeoutApi.getClientCloseout(session.id);
      setCloseout(data);
    } catch (err) {
      setError(err.response?.data?.error || t('consultantCloseout.loadError'));
    }
  }, [session.id, t]);

  useEffect(() => { loadCloseout(); }, [loadCloseout]);

  const confirm = async () => {
    setBusy('confirm');
    setError('');
    setNotice('');
    try {
      await closeoutApi.confirmClientCloseout(session.id, { note: confirmNote.trim() || null });
      setNotice(t('consultantCloseout.confirmedToast'));
      await loadCloseout();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.response?.data?.error || t('common.errorUpdating'));
    } finally {
      setBusy('');
    }
  };

  const record = closeout?.closeout || null;
  const items = closeout?.checklist?.items || [];
  const myConfirmed = Boolean(record?.clientConfirmedAt);
  // S-D3 (D-765): the confirm button stays disabled until the work
  // items are met — the server refuses the confirm otherwise, and the
  // checklist above already names what is still missing. The two
  // confirmation items are excluded: this button is what satisfies them.
  const closeoutReady = items
    .filter((item) => item.required && item.key !== 'consultant_confirmed' && item.key !== 'client_confirmed')
    .every((item) => item.met);
  const canConfirm = session.status === 'completed' && !myConfirmed && closeoutReady;
  const feedbackReceived = Boolean(items.find((item) => item.key === 'feedback_received')?.met);
  const scheduledFollowUps = (closeout?.followUps || []).filter((item) => item.status === 'scheduled');

  return (
    <div className="bl-milestone__changes">
      <div className="bl-milestone__actions">
        <h4 className="bl-milestone__changes-title">{t('consultantCloseout.title')}</h4>
        {session.status === 'archived' && (
          <span className="bl-milestone__card-meta">{t('consultantCloseout.archived')}</span>
        )}
      </div>
      {error && <p role="alert" className="bl-milestone__error">{error}</p>}
      {notice && <p role="status" className="bl-milestone__notice">{notice}</p>}
      {record?.closedAt && (
        <p className="bl-milestone__card-meta">{t('consultantCloseout.closedNote')}</p>
      )}
      <div>
        <h5 className="bl-milestone__changes-title">{t('consultantCloseout.checklistTitle')}</h5>
        <ul className="bl-milestone__list">
          {items.map((item) => (
            <li key={item.key} className="bl-milestone__card-meta">
              {item.met ? '✓ ' : '• '}
              {t(`consultantCloseout.item_${item.key}`)}
              {' — '}
              {item.required ? t('consultantCloseout.required') : t('consultantCloseout.recommended')}
              {' — '}
              {item.met ? t('consultantCloseout.met') : t('consultantCloseout.unmet')}
            </li>
          ))}
        </ul>
      </div>
      {!record?.closedAt && (
        <div className="bl-milestone__feedback-form">
          <input
            type="text"
            value={confirmNote}
            onChange={(event) => setConfirmNote(event.target.value)}
            placeholder={t('consultantCloseout.confirmNotePlaceholder')}
            aria-label={t('consultantCloseout.confirmNotePlaceholder')}
            disabled={!canConfirm}
            className="bl-milestone__feedback-text"
          />
          <div>
            <button
              type="button"
              onClick={confirm}
              disabled={!canConfirm || busy === 'confirm'}
              className="bl-milestone__btn-accept" data-track="ui.478f2e3593.29"
            >
              {t('consultantCloseout.confirm')}
            </button>
          </div>
        </div>
      )}
      {session.status !== 'completed' && session.status !== 'archived' && (
        <p className="bl-milestone__card-meta">{t('consultantCloseout.notCompleted')}</p>
      )}
      {record?.closedAt && !myConfirmed && (
        <p className="bl-milestone__card-meta">{t('consultantCloseout.waitingOther')}</p>
      )}
      <div>
        <h5 className="bl-milestone__changes-title">{t('consultantCloseout.feedbackTitle')}</h5>
        {feedbackReceived ? (
          <p className="bl-milestone__card-meta">{t('consultantCloseout.feedbackReceived')}</p>
        ) : closeout?.feedbackRequest ? (
          <p className="bl-milestone__card-meta">
            {t('consultantCloseout.feedbackPending')}
            {' '}
            {t('consultantCloseout.leaveFeedback')}
          </p>
        ) : (
          <p className="bl-milestone__card-meta">{t('consultantCloseout.feedbackPending')}</p>
        )}
      </div>
      {scheduledFollowUps.length > 0 && (
        <div>
          <h5 className="bl-milestone__changes-title">{t('consultantCloseout.followUpTitle')}</h5>
          <ul className="bl-milestone__list">
            {scheduledFollowUps.map((item) => (
              <li key={item.id} className="bl-milestone__card-meta">
                {t(`consultantCloseout.followUpKind${item.kind === 'check_in' ? 'CheckIn' : item.kind === 'review' ? 'Review' : item.kind === 'renewal' ? 'Renewal' : 'Other'}`)}
                {' • '}
                {t('consultantCloseout.dueLabel', { date: String(item.dueAt).slice(0, 10) })}
                {item.note ? ` • ${item.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DetailModal({ request, onClose }) {
  const { t } = useTranslation();
  const items = safeItems(request.setup_items_selected);
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState(null);
  const [attachmentVisibility, setAttachmentVisibility] = useState('shared');

  const loadAttachments = useCallback(async () => {
    try {
      const { data } = await api.get(`/consulting/business-launch/requests/${encodeURIComponent(request.id)}/attachments`);
      setAttachments(data?.attachments || []);
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(error.response?.data?.error || t('businessLaunchStatus.loadError', { defaultValue: 'Attachments could not be loaded.' }));
    }
  }, [request.id, t]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  const uploadAttachment = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('visibility', attachmentVisibility);
      await api.post(`/consulting/business-launch/requests/${encodeURIComponent(request.id)}/attachments`, form);
      await loadAttachments();
    } catch (error) {
      setAttachmentError(error.response?.data?.error || t('businessLaunchStatus.loadError', { defaultValue: 'Attachment upload failed.' }));
    } finally {
      setAttachmentBusy(false);
    }
  };

  const downloadAttachment = async (attachment) => {
    try {
      const { data } = await api.get(`/consulting/business-launch/attachments/${encodeURIComponent(attachment.id)}/download`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setAttachmentError(error.response?.data?.error || t('businessLaunchStatus.loadError', { defaultValue: 'Attachment download failed.' }));
    }
  };

  const removeAttachment = async (attachment) => {
    setAttachmentBusy(true);
    try {
      await api.delete(`/consulting/business-launch/attachments/${encodeURIComponent(attachment.id)}`);
      await loadAttachments();
    } catch (error) {
      setAttachmentError(error.response?.data?.error || t('businessLaunchStatus.loadError', { defaultValue: 'Attachment removal failed.' }));
    } finally {
      setAttachmentBusy(false);
    }
  };
  const summary = t(`businessLaunchStatus.${STATUS_COPY[request.status] || 'desc_pending'}`, { defaultValue: '' });
  const packageName = t(
    `businessLaunchStatus.${PACKAGE_DISPLAY[request.package_selected] || 'selectedPackage'}`,
    {
      defaultValue: request.package_selected,
    },
  );

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('businessLaunchStatus.requestDetails', { defaultValue: 'Request details' })}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2,6,23,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '980px',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(15,23,42,0.98), rgba(8,13,23,0.98))',
          border: '1px solid rgba(148,163,184,0.18)',
          borderRadius: '28px',
          padding: '1.4rem',
          boxShadow: '0 28px 90px rgba(2,6,23,0.45)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.15rem' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: '#FBBF24', fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
              <Sparkles size={14} />
              {t('businessLaunchStatus.businessLaunchRequest', { defaultValue: 'Business launch request' })}
            </div>
            <h2 style={{ margin: '0 0 0.55rem', fontSize: '1.7rem', fontWeight: 800, color: 'var(--app-text)' }}>
              {request.business_name || `${request.first_name} ${request.last_name}`}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <StatusBadge status={request.status} />
              <span style={{ color: 'var(--muted-text)', fontSize: '0.9rem' }}>
                {packageName}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '999px',
              border: '1px solid rgba(148,163,184,0.16)',
              background: 'rgba(255,255,255,0.03)',
              color: 'var(--muted-text)',
              cursor: 'pointer',
              fontSize: '1.35rem',
              lineHeight: 1,
              flexShrink: 0,
            }} data-track="ui.478f2e3593.2"
          >
            ×
          </button>
        </div>

        <div
          style={{
            border: '1px solid rgba(148,163,184,0.14)',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '22px',
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: 'var(--muted-text)', fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('businessLaunchStatus.progressLabel', { defaultValue: 'Launch progress' })}
              </div>
              <div style={{ color: 'var(--app-text)', fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem' }}>
                {summary}
              </div>
            </div>
            <div style={{ color: 'var(--app-text)', fontSize: '1.3rem', fontWeight: 800 }}>
              {STATUS_PROGRESS[request.status] ?? 0}%
            </div>
          </div>
          <ProgressBar status={request.status} />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <StageTimeline status={request.status} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 320px', gap: '1rem' }}>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <section
              aria-labelledby="business-launch-attachments"
              className="bl-attachments"
            >
              <h3 id="business-launch-attachments" className="bl-attachments__title">
                {t('support.attachments', { defaultValue: 'Attachments' })}
              </h3>
              <div className="bl-attachments__list">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="bl-attachments__row">
                    <span className="bl-attachments__name">{attachment.originalName}</span>
                    <span className="bl-attachments__actions">
                      <button type="button" onClick={() => downloadAttachment(attachment)} className="bl-attachments__download" data-track="ui.478f2e3593.8">
                        {t('businessLaunchAttachments.download')}
                      </button>
                      {String(attachment.uploadedBy) === String(request.user_id) && (
                        <button type="button" disabled={attachmentBusy} onClick={() => removeAttachment(attachment)} className="bl-attachments__remove" data-track="ui.478f2e3593.9">
                          {t('businessLaunchAttachments.remove')}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {!attachments.length && !attachmentError && <p className="bl-attachments__empty">{t('support.noAttachments', { defaultValue: 'No attachments yet.' })}</p>}
                {attachmentError && <p role="alert" className="bl-attachments__error">{attachmentError}</p>}
                <label className="bl-attachments__upload">
                  <span>{t('businessLaunchAttachments.shareWithConsultant')}</span>
                  <select value={attachmentVisibility} onChange={(event) => setAttachmentVisibility(event.target.value)} disabled={attachmentBusy} className="bl-attachments__select">
                    <option value="shared">{t('businessLaunchAttachments.shared')}</option>
                    <option value="applicant_only">{t('businessLaunchAttachments.onlyMe')}</option>
                  </select>
                  <input type="file" onChange={uploadAttachment} disabled={attachmentBusy} accept="image/*,application/pdf,.doc,.docx" />
                </label>
              </div>
            </section>
            <ProposalReview requestId={request.id} />
            <MilestoneBoard request={request} />
            <section
              style={{
                border: '1px solid rgba(148,163,184,0.14)',
                borderRadius: '22px',
                padding: '1rem',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-text)' }}>
                {t('businessLaunchStatus.businessInfo', { defaultValue: 'Business Information' })}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.8rem' }}>
                <DetailField icon={Briefcase} label={t('businessLaunchStatus.skill', { defaultValue: 'Skill / Offer' })} value={request.skill_description} />
                <DetailField icon={Compass} label={t('businessLaunchStatus.targetMarket', { defaultValue: 'Target Market' })} value={request.target_market} />
                <DetailField icon={Rocket} label={t('businessLaunchStatus.businessName', { defaultValue: 'Business Name' })} value={request.business_name} />
                <DetailField icon={MapPin} label={t('businessLaunchStatus.location', { defaultValue: 'Location' })} value={[request.operating_state, request.operating_country].filter(Boolean).join(', ') || null} />
                <DetailField icon={CalendarClock} label={t('businessLaunchStatus.currentPhase', { defaultValue: 'Current Phase' })} value={request.current_phase ? `${request.current_phase} / 25` : null} />
                <DetailField
                  icon={AlertCircle}
                  label={t('businessLaunchStatus.urgency', { defaultValue: 'Urgency' })}
                  value={
                    request.urgency
                      ? t(
                          `businessLaunchStatus.${URGENCY_DISPLAY[request.urgency] || `urgency_${request.urgency}`}`,
                          { defaultValue: request.urgency },
                        )
                      : null
                  }
                />
              </div>
            </section>

            {(items.length > 0 || request.select_all_chosen) && (
              <section
                style={{
                  border: '1px solid rgba(148,163,184,0.14)',
                  borderRadius: '22px',
                  padding: '1rem',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-text)' }}>
                  {t('businessLaunchStatus.setupItems', { defaultValue: 'Selected Setup Items' })}
                </h3>
                {request.select_all_chosen ? (
                  <p style={{ margin: 0, color: 'var(--muted-text)' }}>
                    {t('businessLaunchStatus.allItemsSelected', { defaultValue: 'All available setup items selected' })}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
                    {items.map((item, index) => (
                      <span
                        key={index}
                        style={{
                          border: '1px solid rgba(148,163,184,0.16)',
                          background: 'rgba(255,255,255,0.04)',
                          color: 'var(--app-text)',
                          borderRadius: '999px',
                          padding: '0.42rem 0.8rem',
                          fontSize: '0.84rem',
                        }}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <div style={{ display: 'grid', gap: '1rem' }}>
            <section
              style={{
                border: '1px solid rgba(148,163,184,0.14)',
                borderRadius: '22px',
                padding: '1rem',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-text)' }}>
                {t('businessLaunchStatus.timeline', { defaultValue: 'Timeline' })}
              </h3>
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                <DetailField icon={CalendarClock} label={t('businessLaunchStatus.submitted', { defaultValue: 'Submitted' })} value={fmtDateTime(request.created_at)} />
                {request.updated_at && request.updated_at !== request.created_at ? (
                  <DetailField icon={FileStack} label={t('businessLaunchStatus.lastUpdated', { defaultValue: 'Last Updated' })} value={fmtDateTime(request.updated_at)} />
                ) : null}
              </div>
            </section>

            {request.status !== 'cancelled' && (
              <section
                style={{
                  border: '1px solid rgba(148,163,184,0.14)',
                  borderRadius: '22px',
                  padding: '1rem',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-text)' }}>
                  {t('businessLaunchStatus.whatsNext', { defaultValue: "What's Next?" })}
                </h3>
                <NextSteps status={request.status} />
              </section>
            )}

            <section
              style={{
                border: '1px solid rgba(249,115,22,0.18)',
                borderRadius: '22px',
                padding: '1rem',
                background: 'rgba(249,115,22,0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.7rem', color: '#FDBA74', fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <ShieldCheck size={14} />
                {t('businessLaunchStatus.support', { defaultValue: 'Support' })}
              </div>
              <p style={{ margin: '0 0 0.8rem', color: 'var(--muted-text)', lineHeight: 1.6 }}>
                {t('businessLaunchStatus.contactSupport', { defaultValue: 'Questions? Email us at' })}{' '}
                <a href="mailto:support@oxsteed.com" style={{ color: '#FDBA74', fontWeight: 700, textDecoration: 'none' }} data-track="ui.478f2e3593.3">
                  support@oxsteed.com
                </a>
              </p>
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                <Link
                  to="/consulting"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    color: '#FDBA74',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                  }}
                >
                  {t('businessLaunchStatus.openConsultingWorkspace', { defaultValue: 'Open consulting workspace' })} <ArrowRight size={14} />
                </Link>
                <Link
                  to="/consulting-intake"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    color: 'var(--app-text)',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                  }}
                >
                  {t('businessLaunchStatus.submitNewIntake', { defaultValue: 'Submit a new intake form' })} <ArrowRight size={14} />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tint = '#94A3B8' }) {
  return (
    <div
      style={{
        border: `1px solid ${tint}22`,
        background: 'rgba(15,23,42,0.68)',
        borderRadius: '22px',
        padding: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: tint, fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        <Icon size={14} />
        {label}
      </div>
      <div style={{ marginTop: '0.55rem', color: 'var(--app-text)', fontSize: '1.55rem', fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}

export default function BusinessLaunchStatusPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [emailQuery, setEmailQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const loadMine = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.get('/consulting/business-launch/my-requests');
      setRequests(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || t('businessLaunchStatus.loadError', { defaultValue: 'Failed to load launch requests.' }));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (user?.email) setEmailQuery(user.email);
  }, [user?.email]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const email = emailQuery.trim();
    if (!email) {
      toast.error(t('businessLaunchStatus.enterEmail', { defaultValue: 'Please enter an email address to search' }));
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const { data } = await api.get('/consulting/business-launch/search', {
        params: { email },
      });
      setRequests(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length === 0) {
        toast(t('businessLaunchStatus.noRequests', { defaultValue: 'No intake forms found for this email' }));
      }
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        t('businessLaunchStatus.searchError', {
          defaultValue: 'Error searching for intake forms. Please try again.',
        });
      setError(msg);
      toast.error(msg);
    } finally {
      setSearching(false);
    }
  };

  const activeRequest = useMemo(() => {
    if (!requests.length) return null;
    const order = ['in_progress', 'kickoff_scheduled', 'contacted', 'pending', 'completed', 'cancelled'];
    return [...requests].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
  }, [requests]);

  const stats = useMemo(() => {
    const total = requests.length;
    const completed = requests.filter((request) => request.status === 'completed').length;
    const inMotion = requests.filter((request) => ['contacted', 'kickoff_scheduled', 'in_progress'].includes(request.status)).length;
    const avg = total
      ? Math.round(
          requests.reduce((sum, request) => sum + (STATUS_PROGRESS[request.status] ?? 0), 0) / total,
        )
      : 0;
    return { total, completed, inMotion, avg };
  }, [requests]);

  return (
    <PageShell hideFooter>
      <PageMeta
        title={t('businessLaunchStatus.trackYourBusiness', { defaultValue: 'Track Your Business Launch' })}
        description={t('businessLaunchStatus.checkStatus', { defaultValue: 'Check the status of your intake form and upcoming milestones' })}
      />

      <div
        style={{
          minHeight: '100vh',
          background:
            'radial-gradient(circle at top left, rgba(79,70,229,0.14), transparent 24%), radial-gradient(circle at top right, rgba(14,165,233,0.14), transparent 22%), linear-gradient(180deg, #07101d 0%, #030712 100%)',
          color: 'var(--app-text)',
        }}
      >
        <div style={{ maxWidth: '1260px', margin: '0 auto', padding: '1.25rem 1rem 2rem' }}>
          <section
            style={{
              border: '1px solid rgba(148,163,184,0.16)',
              borderRadius: '30px',
              background:
                'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(7,12,20,0.96))',
              padding: '1.4rem',
              boxShadow: '0 24px 80px rgba(2,6,23,0.34)',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) 360px', gap: '1rem', alignItems: 'stretch' }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: '#A5B4FC', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.9rem' }}>
                  <Rocket size={15} />
                  {t('businessLaunchStatus.launchCommandCenter', { defaultValue: 'Launch command center' })}
                </div>
                <h1 style={{ margin: '0 0 0.6rem', fontSize: 'clamp(2.2rem, 4vw, 4rem)', lineHeight: 0.95, fontWeight: 800, letterSpacing: '-0.04em' }}>
                  {t('businessLaunchStatus.trackYourBusiness', { defaultValue: 'Track Your Business Launch' })}
                </h1>
                <p style={{ margin: '0 0 1.15rem', color: 'var(--muted-text)', fontSize: '1.03rem', lineHeight: 1.65, maxWidth: '52rem' }}>
                  {t('businessLaunchStatus.checkStatus', { defaultValue: 'Check the status of your intake form and upcoming milestones' })}
                </p>

                <form
                  onSubmit={handleSearch}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                    gap: '0.75rem',
                    alignItems: 'center',
                  }} data-track="ui.478f2e3593.4"
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr)',
                      gap: '0.7rem',
                      alignItems: 'center',
                      border: '1px solid rgba(148,163,184,0.16)',
                      borderRadius: '18px',
                      background: 'rgba(255,255,255,0.03)',
                      padding: '0.85rem 0.95rem',
                    }}
                  >
                    <Mail size={17} color="#A5B4FC" aria-hidden="true" />
                    <input
                      id="bls-email-search"
                      type="email"
                      autoComplete="email"
                      aria-label={t('businessLaunchStatus.emailPlaceholder', { defaultValue: 'Enter your email address' })}
                      value={emailQuery}
                      onChange={(event) => setEmailQuery(event.target.value)}
                      placeholder={t('businessLaunchStatus.emailPlaceholder', { defaultValue: 'Enter your email address' })}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: 'var(--app-text)',
                        fontSize: '1rem',
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={searching}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.9rem 1.2rem',
                      borderRadius: '18px',
                      border: 'none',
                      background: '#4F46E5',
                      color: 'white',
                      fontWeight: 700,
                      cursor: searching ? 'wait' : 'pointer',
                    }} data-track="ui.478f2e3593.5"
                  >
                    <Search size={16} />
                    {searching
                      ? t('common.loading', { defaultValue: 'Loading…' })
                      : t('businessLaunchStatus.search', { defaultValue: 'Check Status' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => loadMine()}
                    disabled={loading}
                    style={{
                      padding: '0.9rem 1rem',
                      borderRadius: '18px',
                      border: '1px solid rgba(148,163,184,0.18)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'var(--app-text)',
                      fontWeight: 700,
                      cursor: loading ? 'wait' : 'pointer',
                    }} data-track="ui.478f2e3593.6"
                  >
                    {t('common.retry', { defaultValue: 'Retry' })}
                  </button>
                </form>

                {error ? (
                  <p style={{ color: '#FCA5A5', margin: '0.9rem 0 0', fontSize: '0.95rem' }} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>

              <div
                style={{
                  border: '1px solid rgba(148,163,184,0.16)',
                  borderRadius: '24px',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '1rem',
                  display: 'grid',
                  gap: '0.8rem',
                }}
              >
                <div style={{ color: '#FBBF24', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('businessLaunchStatus.whatThisPageGivesYou', { defaultValue: 'What this page gives you' })}
                </div>
                <div style={{ display: 'grid', gap: '0.7rem' }}>
                  <div style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: '18px', padding: '0.85rem', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                      {t('businessLaunchStatus.featureOneTitle', { defaultValue: 'See the real launch stage' })}
                    </div>
                    <div style={{ color: 'var(--muted-text)', fontSize: '0.84rem', lineHeight: 1.5 }}>
                      {t('businessLaunchStatus.featureOneBody', {
                        defaultValue:
                          'Know whether you are waiting for contact, scheduled for kickoff, or already in execution.',
                      })}
                    </div>
                  </div>
                  <div style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: '18px', padding: '0.85rem', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                      {t('businessLaunchStatus.featureTwoTitle', { defaultValue: 'Review intake details' })}
                    </div>
                    <div style={{ color: 'var(--muted-text)', fontSize: '0.84rem', lineHeight: 1.5 }}>
                      {t('businessLaunchStatus.featureTwoBody', {
                        defaultValue:
                          'Check your package, urgency, setup items, and business details without digging through old emails.',
                      })}
                    </div>
                  </div>
                  <div style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: '18px', padding: '0.85rem', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                      {t('businessLaunchStatus.featureThreeTitle', { defaultValue: 'Know the next action' })}
                    </div>
                    <div style={{ color: 'var(--muted-text)', fontSize: '0.84rem', lineHeight: 1.5 }}>
                      {t('businessLaunchStatus.featureThreeBody', {
                        defaultValue: 'Every status includes a clearer next-steps checklist so the process feels less opaque.',
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.85rem', marginTop: '1rem' }}>
            <StatCard icon={FileStack} label={t('businessLaunchStatus.requestsFound', { defaultValue: 'Requests found' })} value={stats.total} tint="#A5B4FC" />
            <StatCard icon={Rocket} label={t('businessLaunchStatus.inMotion', { defaultValue: 'In motion' })} value={stats.inMotion} tint="#38BDF8" />
            <StatCard icon={CheckCircle2} label={t('businessLaunchStatus.completedLabel', { defaultValue: 'Completed' })} value={stats.completed} tint="#34D399" />
            <StatCard icon={Compass} label={t('businessLaunchStatus.averageProgress', { defaultValue: 'Average progress' })} value={`${stats.avg}%`} tint="#FBBF24" />
          </section>

          {loading ? (
            <div style={{ marginTop: '1.5rem', color: 'var(--muted-text)' }}>
              {t('common.loading', { defaultValue: 'Loading…' })}
            </div>
          ) : requests.length === 0 ? (
            <section
              style={{
                marginTop: '1rem',
                border: '1px dashed rgba(148,163,184,0.22)',
                borderRadius: '28px',
                padding: '2rem',
                textAlign: 'center',
                background: 'rgba(15,23,42,0.48)',
              }}
            >
              <div style={{ width: '58px', height: '58px', margin: '0 auto 1rem', borderRadius: '999px', background: 'rgba(79,70,229,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A5B4FC' }}>
                <Rocket size={26} />
              </div>
              <h2 style={{ margin: '0 0 0.6rem', fontSize: '1.5rem', fontWeight: 800 }}>
                {t('businessLaunchStatus.noRequests', { defaultValue: 'No intake forms found for this email' })}
              </h2>
              <p style={{ margin: '0 auto 1.2rem', maxWidth: '40rem', color: 'var(--muted-text)', lineHeight: 1.65 }}>
                {t('businessLaunchStatus.noRequestsHelper', {
                  defaultValue:
                    'Start the business launch intake to get matched with the right package, planning steps, and launch support.',
                })}
              </p>
              <Link
                to="/consulting-intake"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: '#4F46E5',
                  color: 'white',
                  borderRadius: '16px',
                  padding: '0.95rem 1.25rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                {t('businessLaunchStatus.startLaunch', { defaultValue: 'Start Your Business Launch →' })}
              </Link>
            </section>
          ) : (
            <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 360px', gap: '1rem', alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {activeRequest ? (
                  <RequestCard request={activeRequest} onClick={() => setSelected(activeRequest)} featured />
                ) : null}
                <div style={{ display: 'grid', gap: '0.9rem' }}>
                  {requests
                    .filter((request) => !activeRequest || request.id !== activeRequest.id)
                    .map((request) => (
                      <RequestCard key={request.id} request={request} onClick={() => setSelected(request)} />
                    ))}
                </div>
              </div>

              <aside style={{ display: 'grid', gap: '1rem' }}>
                <div
                  style={{
                    border: '1px solid rgba(148,163,184,0.16)',
                    borderRadius: '24px',
                    background: 'rgba(15,23,42,0.68)',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#FBBF24', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.85rem' }}>
                    <ShieldCheck size={14} />
                    {t('businessLaunchStatus.needHelp', { defaultValue: 'Need help?' })}
                  </div>
                  <p style={{ margin: '0 0 0.9rem', color: 'var(--muted-text)', lineHeight: 1.65 }}>
                    {t('businessLaunchStatus.needHelpBody', {
                      defaultValue:
                        'Questions about your launch request, package, or timeline can go through the consulting team.',
                    })}
                  </p>
                  <a
                    href="mailto:support@oxsteed.com"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      color: '#FDBA74',
                      fontWeight: 700,
                      textDecoration: 'none',
                  }} data-track="ui.478f2e3593.7"
                >
                    {t('businessLaunchStatus.emailSupport', { defaultValue: 'Email support@oxsteed.com' })}{' '}
                    <ArrowRight size={14} />
                  </a>
                </div>

                <div
                  style={{
                    border: '1px solid rgba(148,163,184,0.16)',
                    borderRadius: '24px',
                    background: 'rgba(15,23,42,0.68)',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#38BDF8', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.85rem' }}>
                    <Briefcase size={14} />
                    {t('businessLaunchStatus.relatedWorkspaces', { defaultValue: 'Related workspaces' })}
                  </div>
                  <div style={{ display: 'grid', gap: '0.7rem' }}>
                    <Link to="/consulting" style={{ color: 'var(--app-text)', fontWeight: 700, textDecoration: 'none' }}>
                      {t('businessLaunchStatus.openConsultingWorkspace', { defaultValue: 'Open consulting workspace' })} →
                    </Link>
                    <Link to="/consulting-intake" style={{ color: 'var(--app-text)', fontWeight: 700, textDecoration: 'none' }}>
                      {t('businessLaunchStatus.submitNewIntake', { defaultValue: 'Submit a new intake form' })} →
                    </Link>
                  </div>
                </div>

                <div
                  style={{
                    border: '1px solid rgba(148,163,184,0.16)',
                    borderRadius: '24px',
                    background: 'rgba(15,23,42,0.68)',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#A5B4FC', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.85rem' }}>
                    <Compass size={14} />
                    {t('businessLaunchStatus.processSnapshot', { defaultValue: 'Process snapshot' })}
                  </div>
                  <div style={{ display: 'grid', gap: '0.7rem', color: 'var(--muted-text)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    <div>{t('businessLaunchStatus.processSnapshotStep1', { defaultValue: '1. Intake review and package confirmation' })}</div>
                    <div>{t('businessLaunchStatus.processSnapshotStep2', { defaultValue: '2. Kickoff scheduling and prep' })}</div>
                    <div>{t('businessLaunchStatus.processSnapshotStep3', { defaultValue: '3. Setup execution and milestone updates' })}</div>
                    <div>{t('businessLaunchStatus.processSnapshotStep4', { defaultValue: '4. Final handoff and launch readiness' })}</div>
                  </div>
                </div>
              </aside>
            </div>
          )}

          <div style={{ marginTop: '1.2rem', textAlign: 'center' }}>
            <p style={{ margin: '0 0 0.75rem', color: 'var(--muted-text)', fontSize: '0.95rem' }}>
              {t('businessLaunchStatus.wantAnother', { defaultValue: 'Want to start another business?' })}
            </p>
            <Link
              to="/consulting-intake"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                color: '#A5B4FC',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              {t('businessLaunchStatus.submitNew', { defaultValue: 'Submit a New Intake Form' })}
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {selected ? <DetailModal request={selected} onClose={() => setSelected(null)} /> : null}
    </PageShell>
  );
}
