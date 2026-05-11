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
  open: { key: 'open', className: 'is-open' },
  under_review: { key: 'underReview', className: 'is-review' },
  resolved: { key: 'resolved', className: 'is-resolved' },
  closed: { key: 'closed', className: 'is-closed' },
};

function formatDate(value, t) {
  if (!value) return t('disputes.center.dateUnavailable');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('disputes.center.dateUnavailable');
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatReason(reason, t) {
  return String(reason || t('disputes.center.generalIssue')).replace(/_/g, ' ');
}

function resolutionLabel(resolution, t) {
  return resolution
    ? `${t('disputes.detail.resolutionTitle', { defaultValue: 'Resolution' })}: ${t(
        `disputes.center.resolution.${resolution}`,
        { defaultValue: formatReason(resolution, t) }
      )}`
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
        description={t('disputes.center.metaDescription')}
        noIndex
      />

      <main className="dispute-center-page">
        <section className="dispute-hero" aria-labelledby="dispute-title">
          <div>
            <p className="dispute-eyebrow">
              <ShieldCheck size={16} aria-hidden="true" />
              {t('disputes.center.eyebrow')}
            </p>
            <h1 id="dispute-title">{t('disputes.center.title')}</h1>
            <p>
              {t('disputes.center.subtitle')} {t('disputes.center.heroExtra')}
            </p>
            <div className="dispute-hero-actions">
              <Link to="/messages" className="dispute-btn primary">
                <MessageSquare size={17} aria-hidden="true" />
                {t('disputes.center.openMessages')}
              </Link>
              <Link to="/support/escalation" className="dispute-btn secondary">
                {t('disputes.center.contactSupport')}
              </Link>
            </div>
          </div>

          <div className="dispute-stats" aria-label={t('disputes.center.aria.summary')}>
            <div>
              <span>{stats.open}</span>
              <p>{t('disputes.center.stats.open')}</p>
            </div>
            <div>
              <span>{stats.review}</span>
              <p>{t('disputes.center.stats.inReview')}</p>
            </div>
            <div>
              <span>{stats.resolved}</span>
              <p>{t('disputes.center.stats.resolved')}</p>
            </div>
          </div>
        </section>

        <section className="dispute-guide" aria-label={t('disputes.center.aria.guide')}>
          <GuideCard
            icon={FileText}
            title={t('disputes.center.guide.preserveTitle')}
            text={t('disputes.center.guide.preserveText')}
          />
          <GuideCard
            icon={MessageSquare}
            title={t('disputes.center.guide.focusTitle')}
            text={t('disputes.center.guide.focusText')}
          />
          <GuideCard
            icon={CheckCircle2}
            title={t('disputes.center.guide.outcomeTitle')}
            text={t('disputes.center.guide.outcomeText')}
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
          <EmptyDisputes t={t} />
        ) : (
          <section className="dispute-list" aria-label={t('disputes.center.aria.list')}>
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
                      <h2>{dispute.job_title || t('disputes.center.untitledJob')}</h2>
                      <span className={`dispute-status ${statusMeta.className}`}>
                        {t(`disputes.center.status.${statusMeta.key}`)}
                      </span>
                    </div>
                    <p className="dispute-row-reason">{formatReason(dispute.reason, t)}</p>
                    {dispute.resolution && (
                      <p className="dispute-row-resolution">
                        {resolutionLabel(dispute.resolution, t)}
                      </p>
                    )}
                    <div className="dispute-row-meta">
                      <span>
                        <Clock3 size={14} aria-hidden="true" />
                        {t('disputes.center.openedOn', {
                          date: formatDate(dispute.created_at, t),
                        })}
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

function EmptyDisputes({ t }) {
  return (
    <section className="dispute-empty">
      <div className="dispute-empty-main">
        <div className="dispute-empty-icon">
          <ShieldCheck size={34} aria-hidden="true" />
        </div>
        <p className="dispute-empty-kicker">{t('disputes.center.empty.title')}</p>
        <p>{t('disputes.center.empty.body')}</p>
        <div className="dispute-empty-actions">
          <Link to="/jobs" className="dispute-btn primary">
            {t('disputes.center.empty.browseJobs')}
          </Link>
          <Link to="/features" className="dispute-btn secondary">
            {t('disputes.center.empty.learnHow')}
          </Link>
        </div>
      </div>
      <div className="dispute-empty-side">
        <strong>{t('disputes.center.empty.beforeTitle')}</strong>
        <ul>
          <li>{t('disputes.center.empty.bullet1')}</li>
          <li>{t('disputes.center.empty.bullet2')}</li>
          <li>{t('disputes.center.empty.bullet3')}</li>
        </ul>
      </div>
    </section>
  );
}
