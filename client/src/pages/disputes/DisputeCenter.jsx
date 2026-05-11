import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import api from '../../api/axios';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import './DisputeCenter.css';

const STATUS_META = {
  open: { label: 'Open', className: 'is-open' },
  under_review: { label: 'Under review', className: 'is-review' },
  resolved: { label: 'Resolved', className: 'is-resolved' },
  closed: { label: 'Closed', className: 'is-closed' },
};

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatReason(reason) {
  return String(reason || 'General issue').replace(/_/g, ' ');
}

function resolutionLabel(resolution, t) {
  const map = {
    full_refund: 'Full refund issued',
    partial_refund: 'Partial refund issued',
    release_to_helper: 'Payment released to helper',
    dismissed: 'Dismissed',
  };
  return resolution
    ? `${t('disputes.detail.resolutionTitle', { defaultValue: 'Resolution' })}: ${map[resolution] || formatReason(resolution)}`
    : '';
}

export default function DisputeCenter() {
  const { t } = useTranslation();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function fetchDisputes() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get('/disputes/my');
        if (mounted) setDisputes(Array.isArray(data.disputes) ? data.disputes : []);
      } catch (err) {
        console.error(err);
        if (mounted) setError(t('common.errorLoading', { defaultValue: 'Failed to load disputes' }));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchDisputes();
    return () => {
      mounted = false;
    };
  }, [t]);

  const stats = useMemo(() => {
    const open = disputes.filter((d) => d.status === 'open').length;
    const review = disputes.filter((d) => d.status === 'under_review').length;
    const resolved = disputes.filter((d) => ['resolved', 'closed'].includes(d.status)).length;
    return { open, review, resolved, total: disputes.length };
  }, [disputes]);

  return (
    <PageShell>
      <PageMeta
        title={t('disputes.center.title', { defaultValue: 'Disputes' })}
        description="Track OxSteed disputes, evidence, support messages, and resolution outcomes."
        noIndex
      />

      <main className="dispute-center-page">
        <section className="dispute-hero" aria-labelledby="dispute-title">
          <div>
            <p className="dispute-eyebrow">
              <ShieldCheck size={16} aria-hidden="true" />
              Trust and resolution center
            </p>
            <h1 id="dispute-title">{t('disputes.center.title')}</h1>
            <p>
              {t('disputes.center.subtitle')} Keep evidence, support messages, job context, and
              resolution updates in one place so a difficult situation stays organized.
            </p>
            <div className="dispute-hero-actions">
              <Link to="/messages" className="dispute-btn primary">
                <MessageSquare size={17} aria-hidden="true" />
                Open messages
              </Link>
              <Link to="/support/escalation" className="dispute-btn secondary">
                Contact support
              </Link>
            </div>
          </div>

          <div className="dispute-stats" aria-label="Dispute summary">
            <div>
              <span>{stats.open}</span>
              <p>Open</p>
            </div>
            <div>
              <span>{stats.review}</span>
              <p>In review</p>
            </div>
            <div>
              <span>{stats.resolved}</span>
              <p>Resolved</p>
            </div>
          </div>
        </section>

        <section className="dispute-guide" aria-label="How disputes work">
          <GuideCard
            icon={FileText}
            title="Preserve evidence"
            text="Add photos, documents, timelines, and short notes while details are fresh."
          />
          <GuideCard
            icon={MessageSquare}
            title="Keep discussion focused"
            text="Use the dispute thread for clarifications so support can follow the record."
          />
          <GuideCard
            icon={CheckCircle2}
            title="Track the outcome"
            text="Resolution status, refunds, and release decisions stay attached to the job."
          />
        </section>

        {error && (
          <div className="dispute-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="dispute-loading">
            <div className="dispute-loader" aria-hidden="true" />
            <p>{t('disputes.center.loading')}</p>
          </div>
        ) : disputes.length === 0 ? (
          <EmptyDisputes />
        ) : (
          <section className="dispute-list" aria-label="Your disputes">
            {disputes.map((dispute) => {
              const statusMeta = STATUS_META[dispute.status] || STATUS_META.closed;
              return (
                <Link
                  key={dispute.id}
                  to={`/disputes/${dispute.id}`}
                  className="dispute-row"
                >
                  <div className="dispute-row-icon">
                    <Briefcase size={20} aria-hidden="true" />
                  </div>
                  <div className="dispute-row-main">
                    <div className="dispute-row-top">
                      <h2>{dispute.job_title || 'Untitled job'}</h2>
                      <span className={`dispute-status ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <p className="dispute-row-reason">{formatReason(dispute.reason)}</p>
                    {dispute.resolution && (
                      <p className="dispute-row-resolution">
                        {resolutionLabel(dispute.resolution, t)}
                      </p>
                    )}
                    <div className="dispute-row-meta">
                      <span>
                        <Clock3 size={14} aria-hidden="true" />
                        Opened {formatDate(dispute.created_at)}
                      </span>
                      <span>#{String(dispute.id).split('-')[0]}</span>
                    </div>
                  </div>
                  <ArrowRight className="dispute-row-arrow" size={20} aria-hidden="true" />
                </Link>
              );
            })}
          </section>
        )}
      </main>
    </PageShell>
  );
}

function GuideCard({ icon: Icon, title, text }) {
  return (
    <article className="dispute-guide-card">
      <Icon size={22} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function EmptyDisputes() {
  return (
    <section className="dispute-empty">
      <div className="dispute-empty-main">
        <div className="dispute-empty-icon">
          <ShieldCheck size={34} aria-hidden="true" />
        </div>
        <p className="dispute-empty-kicker">No disputes open</p>
        <p>
          This is good. If a job, payment, tool rental, or booking ever needs formal review, it
          will appear here with the evidence timeline and support conversation.
        </p>
        <div className="dispute-empty-actions">
          <Link to="/jobs" className="dispute-btn primary">
            Browse jobs
          </Link>
          <Link to="/features" className="dispute-btn secondary">
            Learn how OxSteed works
          </Link>
        </div>
      </div>
      <div className="dispute-empty-side">
        <strong>Before opening a dispute</strong>
        <ul>
          <li>Try to clarify scope in messages.</li>
          <li>Save photos, receipts, and time details.</li>
          <li>Use support escalation for urgent safety or payment issues.</li>
        </ul>
      </div>
    </section>
  );
}
