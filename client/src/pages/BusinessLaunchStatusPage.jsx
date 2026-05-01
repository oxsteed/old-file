import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';

// ---------- constants ----------

const STATUS_PROGRESS = {
  pending:           10,
  contacted:         30,
  kickoff_scheduled: 50,
  in_progress:       75,
  completed:         100,
  cancelled:         0,
};

const STATUS_COLORS = {
  pending:           '#F59E0B',
  contacted:         '#4F46E5',
  kickoff_scheduled: '#8B5CF6',
  in_progress:       '#0EA5E9',
  completed:         '#10B981',
  cancelled:         '#EF4444',
};

const PACKAGE_DISPLAY = {
  initial:     'Initial Consultation ($100)',
  foundation:  'Business Foundation ($750)',
  launch:      'Business Launch ($1,500)',
  accelerator: 'Business Accelerator ($3,000)',
};

const URGENCY_DISPLAY = {
  exploring:  'Just exploring',
  two_weeks:  'Within two weeks',
  asap:       'As soon as possible',
};

// ---------- helpers ----------

function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function safeItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

// ---------- sub-components ----------

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const label = t(`businessLaunchStatus.status_${status}`, {
    defaultValue: status.replace(/_/g, ' '),
  });
  return (
    <span style={{
      display: 'inline-block',
      background: STATUS_COLORS[status] || '#6B7280',
      color: 'white',
      padding: '0.35rem 0.9rem',
      borderRadius: '999px',
      fontSize: '0.85rem',
      fontWeight: 600,
      textTransform: 'capitalize',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function ProgressBar({ status }) {
  const pct = STATUS_PROGRESS[status] ?? 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progress: ${pct}%`}
      style={{
        width: '100%',
        height: '8px',
        background: 'var(--border-color)',
        borderRadius: '4px',
        overflow: 'hidden',
        marginTop: '0.75rem',
      }}
    >
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: STATUS_COLORS[status] || '#6B7280',
        borderRadius: '4px',
        transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

function NextSteps({ status }) {
  const { t } = useTranslation();

  const STEPS = {
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

  const items = STEPS[status] || STEPS.pending;
  return (
    <ol style={{
      margin: 0,
      paddingLeft: '1.5rem',
      color: 'var(--muted-text)',
      lineHeight: 1.8,
      fontSize: '0.95rem',
    }}>
      {items.map((step, i) => <li key={i}>{step}</li>)}
    </ol>
  );
}

function RequestCard({ request, onClick }) {
  const { t } = useTranslation();

  const STATUS_DESC_DEFAULTS = {
    pending:           'Your intake form has been received. Our team is reviewing it.',
    contacted:         'We have reviewed your submission and will be reaching out soon.',
    kickoff_scheduled: 'Your kickoff call is scheduled. Check your email for details.',
    in_progress:       'Your business setup is underway. We are implementing your services.',
    completed:         'Your Business Launch Program is complete! Welcome to your new business.',
    cancelled:         'This request has been cancelled.',
  };

  return (
    <article
      onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
      tabIndex={0}
      role="button"
      aria-label={t('businessLaunchStatus.viewDetailsFor', {
        defaultValue: 'View details for {{name}}',
        name: request.business_name || `${request.first_name} ${request.last_name}`,
      })}
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        padding: '1.5rem',
        cursor: 'pointer',
        transition: 'box-shadow 0.18s, border-color 0.18s',
        outline: 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.09)';
        e.currentTarget.style.borderColor = STATUS_COLORS[request.status] || '#d1d5db';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = 'var(--border-color)';
      }}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.2)'; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '1rem',
        flexWrap: 'wrap',
        marginBottom: '1rem',
      }}>
        <div>
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.15rem', fontWeight: 600 }}>
            {request.business_name || `${request.first_name} ${request.last_name}`}
          </h3>
          <p style={{ margin: '0 0 0.2rem', color: 'var(--muted-text)', fontSize: '0.9rem' }}>
            {PACKAGE_DISPLAY[request.package_selected] || request.package_selected}
          </p>
          <p style={{ margin: 0, color: 'var(--muted-text)', fontSize: '0.85rem' }}>
            {t('businessLaunchStatus.submitted', { defaultValue: 'Submitted' })}{' '}
            {fmtDate(request.created_at)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <ProgressBar status={request.status} />

      <p style={{ margin: '0.85rem 0 0', color: 'var(--muted-text)', fontSize: '0.9rem' }}>
        {t(`businessLaunchStatus.desc_${request.status}`, {
          defaultValue: STATUS_DESC_DEFAULTS[request.status] || '',
        })}
      </p>

      <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: '#4F46E5', fontWeight: 500 }}>
        {t('businessLaunchStatus.viewDetails', { defaultValue: 'View details' })} →
      </p>
    </article>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{
        margin: '0 0 0.75rem',
        fontSize: '0.8rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: 'var(--muted-text)',
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      gap: '0.5rem',
      marginBottom: '0.5rem',
      fontSize: '0.9rem',
    }}>
      <span style={{ color: 'var(--muted-text)', fontWeight: 500 }}>{label}</span>
      <span style={{ color: 'var(--app-text)' }}>{value}</span>
    </div>
  );
}

function DetailModal({ request, onClose }) {
  const { t } = useTranslation();
  const items = safeItems(request.setup_items_selected);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
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
        background: 'rgba(0,0,0,0.55)',
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
          background: 'var(--card-bg)',
          borderRadius: '12px',
          padding: '2rem',
          maxWidth: '640px',
          width: '100%',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title row */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1.25rem',
          gap: '1rem',
        }}>
          <div>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.3rem', fontWeight: 700 }}>
              {request.business_name || `${request.first_name} ${request.last_name}`}
            </h2>
            <StatusBadge status={request.status} />
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1.5rem', color: 'var(--muted-text)', lineHeight: 1,
              padding: '0 4px', borderRadius: '4px', flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <ProgressBar status={request.status} />

        <p style={{ margin: '0.75rem 0 1.5rem', color: 'var(--muted-text)', fontSize: '0.95rem' }}>
          {t(`businessLaunchStatus.desc_${request.status}`, { defaultValue: '' })}
        </p>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', marginBottom: '1.5rem' }} />

        {/* Package */}
        <Section title={t('businessLaunchStatus.selectedPackage', { defaultValue: 'Selected Package' })}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {PACKAGE_DISPLAY[request.package_selected] || request.package_selected}
          </p>
        </Section>

        {/* Business info */}
        <Section title={t('businessLaunchStatus.businessInfo', { defaultValue: 'Business Information' })}>
          <InfoRow label={t('businessLaunchStatus.skill',        { defaultValue: 'Skill / Offer' })}   value={request.skill_description} />
          <InfoRow label={t('businessLaunchStatus.targetMarket', { defaultValue: 'Target Market' })}   value={request.target_market} />
          <InfoRow label={t('businessLaunchStatus.businessName', { defaultValue: 'Business Name' })}   value={request.business_name} />
          <InfoRow
            label={t('businessLaunchStatus.location', { defaultValue: 'Location' })}
            value={[request.operating_state, request.operating_country].filter(Boolean).join(', ') || null}
          />
          <InfoRow
            label={t('businessLaunchStatus.currentPhase', { defaultValue: 'Current Phase' })}
            value={request.current_phase ? `${request.current_phase} / 25` : null}
          />
          <InfoRow
            label={t('businessLaunchStatus.urgency', { defaultValue: 'Urgency' })}
            value={request.urgency ? (URGENCY_DISPLAY[request.urgency] || request.urgency) : null}
          />
        </Section>

        {/* Setup items */}
        {(items.length > 0 || request.select_all_chosen) && (
          <Section title={t('businessLaunchStatus.setupItems', { defaultValue: 'Selected Setup Items' })}>
            {request.select_all_chosen ? (
              <p style={{ margin: 0, color: 'var(--muted-text)' }}>
                {t('businessLaunchStatus.allItemsSelected', { defaultValue: 'All available setup items selected' })}
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {items.map((item, i) => (
                  <span key={i} style={{
                    background: 'var(--app-bg)',
                    border: '1px solid var(--border-color)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '999px',
                    fontSize: '0.85rem',
                    color: 'var(--app-text)',
                  }}>
                    {item}
                  </span>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Timeline */}
        <Section title={t('businessLaunchStatus.timeline', { defaultValue: 'Timeline' })}>
          <InfoRow label={t('businessLaunchStatus.submitted',   { defaultValue: 'Submitted' })}   value={fmtDateTime(request.created_at)} />
          {request.updated_at && request.updated_at !== request.created_at && (
            <InfoRow label={t('businessLaunchStatus.lastUpdated', { defaultValue: 'Last Updated' })} value={fmtDateTime(request.updated_at)} />
          )}
        </Section>

        {/* Status-specific next steps */}
        {request.status !== 'cancelled' && (
          <Section title={t('businessLaunchStatus.whatsNext', { defaultValue: "What's Next?" })}>
            <NextSteps status={request.status} />
          </Section>
        )}

        {/* Support footer */}
        <div style={{
          padding: '1rem',
          background: 'var(--app-bg)',
          borderRadius: '8px',
          fontSize: '0.9rem',
          color: 'var(--muted-text)',
          textAlign: 'center',
          marginBottom: '1.25rem',
        }}>
          {t('businessLaunchStatus.contactSupport', { defaultValue: 'Questions? Email us at' })}{' '}
          <a href="mailto:support@oxsteed.com" style={{ color: '#4F46E5', fontWeight: 600, textDecoration: 'none' }}>
            support@oxsteed.com
          </a>
        </div>

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
      setError(e.response?.data?.error || e.message || 'Failed to load');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (user?.email) setEmailQuery(user.email);
  }, [user?.email]);

  const handleSearch = async e => {
    e.preventDefault();
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
      const msg = err.response?.data?.error || t('businessLaunchStatus.searchError', { defaultValue: 'Error searching for intake forms. Please try again.' });
      setError(msg);
      toast.error(msg);
    } finally {
      setSearching(false);
    }
  };

  return (
    <PageShell>
      <PageMeta
        title={t('businessLaunchStatus.trackYourBusiness', { defaultValue: 'Track Your Business Launch' })}
        description={t('businessLaunchStatus.checkStatus', { defaultValue: 'Check the status of your intake form and upcoming milestones' })}
      />
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.25rem' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem', fontWeight: 700 }}>
          {t('businessLaunchStatus.trackYourBusiness', { defaultValue: 'Track Your Business Launch' })}
        </h1>
        <p style={{ margin: '0 0 1.5rem', color: 'var(--muted-text)', fontSize: '1rem', lineHeight: 1.5 }}>
          {t('businessLaunchStatus.checkStatus', { defaultValue: 'Check the status of your intake form and upcoming milestones' })}
        </p>

        <form
          onSubmit={handleSearch}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <input
            id="bls-email-search"
            type="email"
            autoComplete="email"
            aria-label={t('businessLaunchStatus.emailPlaceholder', { defaultValue: 'Enter your email address' })}
            value={emailQuery}
            onChange={e => setEmailQuery(e.target.value)}
            placeholder={t('businessLaunchStatus.emailPlaceholder', { defaultValue: 'Enter your email address' })}
            style={{
              flex: '1 1 220px',
              minWidth: 0,
              padding: '0.65rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--card-bg)',
              color: 'var(--app-text)',
              fontSize: '1rem',
            }}
          />
          <button
            type="submit"
            disabled={searching}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              background: '#4F46E5',
              color: 'white',
              fontWeight: 600,
              cursor: searching ? 'wait' : 'pointer',
            }}
          >
            {searching
              ? t('common.loading', { defaultValue: 'Loading…' })
              : t('businessLaunchStatus.search', { defaultValue: 'Check Status' })}
          </button>
          <button
            type="button"
            onClick={() => loadMine()}
            disabled={loading}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--app-bg)',
              color: 'var(--app-text)',
              fontWeight: 500,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {t('common.retry', { defaultValue: 'Retry' })}
          </button>
        </form>

        {error && (
          <p style={{ color: '#DC2626', marginBottom: '1rem', fontSize: '0.95rem' }} role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p style={{ color: 'var(--muted-text)' }}>{t('common.loading', { defaultValue: 'Loading…' })}</p>
        ) : requests.length === 0 ? (
          <div
            style={{
              padding: '1.5rem',
              borderRadius: '10px',
              border: '1px dashed var(--border-color)',
              textAlign: 'center',
              color: 'var(--muted-text)',
            }}
          >
            <p style={{ margin: '0 0 1rem' }}>
              {t('businessLaunchStatus.noRequests', { defaultValue: 'No intake forms found for this email' })}
            </p>
            <Link
              to="/consulting-intake"
              style={{ color: '#4F46E5', fontWeight: 600, textDecoration: 'none' }}
            >
              {t('businessLaunchStatus.startLaunch', { defaultValue: 'Start Your Business Launch →' })}
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {requests.map(req => (
              <RequestCard key={req.id} request={req} onClick={() => setSelected(req)} />
            ))}
          </div>
        )}

        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.75rem', color: 'var(--muted-text)', fontSize: '0.95rem' }}>
            {t('businessLaunchStatus.wantAnother', { defaultValue: 'Want to start another business?' })}
          </p>
          <Link
            to="/consulting-intake"
            style={{ color: '#4F46E5', fontWeight: 600, textDecoration: 'none' }}
          >
            {t('businessLaunchStatus.submitNew', { defaultValue: 'Submit a New Intake Form' })}
          </Link>
        </div>
      </div>

      {selected && (
        <DetailModal request={selected} onClose={() => setSelected(null)} />
      )}
    </PageShell>
  );
}