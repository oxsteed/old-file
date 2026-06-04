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
      }}
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

function DetailModal({ request, onClose }) {
  const { t } = useTranslation();
  const items = safeItems(request.setup_items_selected);
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
            }}
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
                <a href="mailto:support@oxsteed.com" style={{ color: '#FDBA74', fontWeight: 700, textDecoration: 'none' }}>
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
                  }}
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
                    }}
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
                    }}
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
                  }}
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
