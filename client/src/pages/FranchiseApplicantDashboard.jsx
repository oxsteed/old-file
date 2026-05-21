// client/src/pages/FranchiseApplicantDashboard.jsx
//
// First-screen experience for users in the `franchise_applicant` mode.
//
// Combines:
//   GET /consulting/business-launch/my-requests   (the "I want to launch / franchise" intake)
//   GET /franchise/applications?mine=true         (formal franchise applications, if any)
//
// Behavior:
//   * Zero applications  → hero CTA to start one.
//   * One or more        → status card for the most recent, plus a list of
//                          past requests, with quick links into messages
//                          and the consultant.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import {
  Flag, CheckCircle2, Clock, MessageSquare, FileText,
  ArrowRight, User, AlertCircle,
} from 'lucide-react';

const STATUS_PROGRESS = {
  pending:           10,
  contacted:         30,
  kickoff_scheduled: 50,
  in_progress:       75,
  completed:         100,
  cancelled:         0,
};

const STATUS_LABELS = (t) => ({
  pending:            t('dashboards.franchise.statusPending', { defaultValue: 'Awaiting review' }),
  contacted:          t('dashboards.franchise.statusContacted', { defaultValue: 'Consultant contacted you' }),
  kickoff_scheduled:  t('dashboards.franchise.statusKickoff', { defaultValue: 'Kickoff scheduled' }),
  in_progress:        t('dashboards.franchise.statusInProgress', { defaultValue: 'In progress' }),
  completed:          t('dashboards.franchise.statusCompleted', { defaultValue: 'Launched' }),
  cancelled:          t('dashboards.franchise.statusCancelled', { defaultValue: 'Cancelled' }),
});

function ProgressRing({ pct }) {
  const radius = 38;
  const stroke = 6;
  const c = 2 * Math.PI * radius;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="relative" style={{ width: 100, height: 100 }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} stroke="rgba(148,163,184,0.2)" strokeWidth={stroke} fill="none" />
        <circle
          cx="50" cy="50" r={radius}
          stroke="#F97316" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold">{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

export default function FranchiseApplicantDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [launches, setLaunches] = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const safe = (url) => api.get(url).then(r => r.data).catch(() => null);
    Promise.all([
      safe('/consulting/business-launch/my-requests'),
      safe('/franchise/applications?mine=true'),
    ]).then(([l, f]) => {
      if (cancelled) return;
      setLaunches(Array.isArray(l?.requests) ? l.requests : (Array.isArray(l) ? l : []));
      setFranchises(Array.isArray(f?.applications) ? f.applications : (Array.isArray(f) ? f : []));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const all = useMemo(() => {
    // Merge + tag for unified display, newest first.
    const tagged = [
      ...launches.map(x => ({ ...x, _kind: 'launch' })),
      ...franchises.map(x => ({ ...x, _kind: 'franchise' })),
    ];
    return tagged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [launches, franchises]);

  const primary = all[0] || null;
  const labels = STATUS_LABELS(t);

  // Empty state
  if (loaded && all.length === 0) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
        <Navbar />
        <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-16 flex flex-col gap-6 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mx-auto" style={{ background: 'rgba(249,115,22,0.12)' }}>
            <Flag size={32} className="text-orange-500" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('dashboards.franchise.heroTitle', { defaultValue: 'Start your OxSteed franchise application' })}
          </h1>
          <p className="text-base" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
            {t('dashboards.franchise.heroSubtitle', { defaultValue: 'Tell us about your background, capital, and target territory. A consultant will review your application and walk you through the next steps.' })}
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link
              to="/consulting"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
            >
              {t('dashboards.franchise.startApp', { defaultValue: 'Start application' })} <ArrowRight size={16} />
            </Link>
            <Link
              to="/business-launch-status"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-semibold transition hover:bg-orange-500/5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {t('dashboards.franchise.learnMore', { defaultValue: 'Learn more' })}
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!loaded || !primary) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)' }}>
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  const pct = STATUS_PROGRESS[primary.status] ?? 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('dashboards.franchise.title', { defaultValue: 'Your franchise journey' })}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
            {t('dashboards.franchise.subtitle', { defaultValue: 'Track your application, talk to your consultant, complete your checklist.' })}
          </p>
        </section>

        <section
          className="rounded-xl border p-6 flex gap-6 items-center flex-wrap"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <ProgressRing pct={pct} />
          <div className="flex-1 min-w-[240px]">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              {primary._kind === 'franchise' ? 'Franchise application' : 'Business launch'}
            </div>
            <div className="text-xl font-bold mt-0.5">
              {primary.desired_brand_name || primary.business_idea || primary.preferred_package || 'Application'}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {labels[primary.status] || primary.status}
              {primary.created_at && ` · ${t('dashboards.franchise.submitted', { defaultValue: 'submitted' })} ${new Date(primary.created_at).toLocaleDateString()}`}
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Link
                to={`/consulting/portal`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              >
                <MessageSquare size={13} /> {t('dashboards.franchise.openPortal', { defaultValue: 'Open portal' })}
              </Link>
              <Link
                to="/business-launch-status"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border font-semibold hover:bg-orange-500/5"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <FileText size={13} /> {t('dashboards.franchise.viewDetails', { defaultValue: 'View details' })}
              </Link>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <CheckCircle2 size={16} className="text-orange-500" />
              {t('dashboards.franchise.nextSteps', { defaultValue: 'What happens next' })}
            </h3>
            <ol className="flex flex-col gap-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-orange-400">1.</span>
                <span style={{ color: pct >= 30 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                  {t('dashboards.franchise.step1', { defaultValue: 'A consultant reviews your application and reaches out.' })}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-400">2.</span>
                <span style={{ color: pct >= 50 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                  {t('dashboards.franchise.step2', { defaultValue: 'You meet for a kickoff call to plan the launch.' })}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-400">3.</span>
                <span style={{ color: pct >= 75 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                  {t('dashboards.franchise.step3', { defaultValue: 'Work through the launch checklist together.' })}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-400">4.</span>
                <span style={{ color: pct >= 100 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                  {t('dashboards.franchise.step4', { defaultValue: 'Your store goes live on OxSteed.' })}
                </span>
              </li>
            </ol>
          </section>

          <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <User size={16} className="text-orange-500" />
              {t('dashboards.franchise.consultant', { defaultValue: 'Your consultant' })}
            </h3>
            {primary.consultant_name ? (
              <div>
                <div className="text-base font-semibold">{primary.consultant_name}</div>
                {primary.consultant_email && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{primary.consultant_email}</div>
                )}
                <Link
                  to="/consulting/portal"
                  className="inline-flex items-center gap-1.5 text-xs mt-3 text-orange-400 hover:text-orange-300"
                >
                  <MessageSquare size={12} /> {t('dashboards.franchise.message', { defaultValue: 'Open conversation' })}
                </Link>
              </div>
            ) : (
              <div className="text-xs flex items-start gap-2" style={{ color: 'var(--color-text-muted)' }}>
                <Clock size={14} className="text-orange-400 mt-0.5" />
                <span>{t('dashboards.franchise.consultantPending', { defaultValue: 'A consultant will be assigned shortly. You\'ll get an email when they reach out.' })}</span>
              </div>
            )}
          </section>
        </div>

        {all.length > 1 && (
          <section className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <header className="px-5 pt-4 pb-2">
              <h3 className="text-sm font-semibold">{t('dashboards.franchise.allApplications', { defaultValue: 'All applications' })}</h3>
            </header>
            <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {all.slice(1).map((x) => (
                <li key={`${x._kind}-${x.id}`} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {x.desired_brand_name || x.business_idea || 'Application'}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {labels[x.status] || x.status} · {x.created_at ? new Date(x.created_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <Link to="/business-launch-status" className="text-xs text-orange-400 hover:text-orange-300">
                    {t('common.view', { defaultValue: 'View' })}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
