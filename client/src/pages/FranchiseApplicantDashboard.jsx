import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock3,
  Compass,
  FileText,
  Flag,
  MapPin,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { ALL_COUNTRIES } from '../lib/countries';

const STATUS_PROGRESS = {
  inquiry: 12,
  screening: 24,
  application_review: 40,
  diligence: 58,
  agreement_pending: 76,
  approved: 88,
  launched: 100,
  rejected: 0,
  archived: 0,
};

const READINESS_LABELS = {
  not_started: 'Not started',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  draft: 'Draft',
  sent: 'Sent',
  signed: 'Signed',
  waived: 'Waived',
  not_ready: 'Not ready',
  planning: 'Planning',
  ready: 'Ready',
  launched: 'Launched',
};

const STATUS_LABELS = (t) => ({
  inquiry: t('dashboards.franchise.statusInquiry', { defaultValue: 'Inquiry received' }),
  screening: t('dashboards.franchise.statusScreening', { defaultValue: 'Screening' }),
  application_review: t('dashboards.franchise.statusApplicationReview', { defaultValue: 'Application review' }),
  diligence: t('dashboards.franchise.statusDiligence', { defaultValue: 'Diligence' }),
  agreement_pending: t('dashboards.franchise.statusAgreementPending', { defaultValue: 'Agreement pending' }),
  approved: t('dashboards.franchise.statusApproved', { defaultValue: 'Approved' }),
  rejected: t('dashboards.franchise.statusRejected', { defaultValue: 'Not approved' }),
  archived: t('dashboards.franchise.statusArchived', { defaultValue: 'Archived' }),
  launched: t('dashboards.franchise.statusLaunched', { defaultValue: 'Launched' }),
});

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMoney(cents) {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(cents) / 100);
}

function ProgressRing({ pct }) {
  const radius = 42;
  const stroke = 7;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, pct)) / 100) * circumference;

  return (
    <div className="relative" style={{ width: 112, height: 112 }}>
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={radius} stroke="rgba(148,163,184,0.18)" strokeWidth={stroke} fill="none" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          stroke="#f97316"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 56 56)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold">{Math.round(pct)}%</div>
        <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-muted)' }}>
          Progress
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ icon: Icon, label, value, accent = '#93c5fd' }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
        <Icon size={13} style={{ color: accent }} />
        {label}
      </div>
      <div className="text-base font-semibold mt-2">{value || '—'}</div>
    </div>
  );
}

export default function FranchiseApplicantDashboard() {
  const { t } = useTranslation();
  const [applications, setApplications] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/franchise/my-applications')
      .then((response) => {
        if (cancelled) return;
        setApplications(Array.isArray(response.data?.applications) ? response.data.applications : []);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setApplications([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedApplications = useMemo(
    () => [...applications].sort((a, b) => new Date(b.submitted_at || b.updated_at || 0) - new Date(a.submitted_at || a.updated_at || 0)),
    [applications]
  );

  const primary = sortedApplications[0] || null;
  const labels = STATUS_LABELS(t);

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#020617' }}>
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  if (!primary) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#020617', color: 'var(--color-text, #f8fafc)' }}>
        <Navbar />
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-16">
          <section className="rounded-[28px] border p-8 text-center" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(15,23,42,0.86))' }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold" style={{ background: 'rgba(249,115,22,0.14)', color: '#fdba74' }}>
              <Flag size={15} />
              Franchise mode
            </div>
            <h1 className="text-4xl font-bold tracking-tight mt-5">
              {t('dashboards.franchise.heroTitle', { defaultValue: 'Start your OxSteed franchise application' })}
            </h1>
            <p className="text-base mt-4 max-w-2xl mx-auto" style={{ color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.75 }}>
              {t('dashboards.franchise.heroSubtitle', { defaultValue: 'Apply for franchise expansion with your own territory, capital plan, and launch timeline. This path is separate from the business-launch consulting intake.' })}
            </p>
            <div className="flex justify-center gap-3 flex-wrap mt-8">
              <Link to="/franchise/apply" className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition">
                {t('dashboards.franchise.startApp', { defaultValue: 'Start franchise intake' })} <ArrowRight size={16} />
              </Link>
              <Link to="/consulting" className="inline-flex items-center gap-2 px-5 py-3 rounded-full border text-sm font-semibold transition hover:bg-white/5" style={{ borderColor: 'rgba(148,163,184,0.16)' }}>
                {t('dashboards.franchise.bookCall', { defaultValue: 'Book a strategy call' })}
              </Link>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  const progress = STATUS_PROGRESS[primary.status] ?? 0;
  const checklistValue = primary.checklist_total ? `${primary.checklist_completed || 0}/${primary.checklist_total}` : 'Pending';
  const territory = [primary.desired_city, primary.desired_region, primary.desired_country ? ALL_COUNTRIES[primary.desired_country] || primary.desired_country : null]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'radial-gradient(circle at top left, rgba(249,115,22,0.14), transparent 30%), #020617', color: 'var(--color-text, #f8fafc)' }}>
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <section className="rounded-[30px] border p-6 lg:p-8" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(15,23,42,0.88))' }}>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-[0.2em]" style={{ background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}>
                <ShieldCheck size={14} />
                Franchise applicant
              </div>
              <h1 className="text-4xl font-bold tracking-tight mt-4">
                {t('dashboards.franchise.title', { defaultValue: 'Your franchise journey' })}
              </h1>
              <p className="text-sm mt-3 max-w-2xl" style={{ color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.7 }}>
                {t('dashboards.franchise.subtitle', { defaultValue: 'Track application review, diligence, agreement progress, and launch readiness without mixing in business-launch consulting requests.' })}
              </p>
              <div className="flex flex-wrap gap-3 mt-6">
                <Link to="/franchise/apply" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition">
                  Submit another territory <ArrowRight size={15} />
                </Link>
                <Link to="/support/escalation" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-semibold transition hover:bg-white/5" style={{ borderColor: 'rgba(148,163,184,0.16)' }}>
                  Contact support
                </Link>
              </div>
            </div>
            <ProgressRing pct={progress} />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[1.3fr,0.7fr] gap-4">
          <article className="rounded-[28px] border p-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)' }}>
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: '#fdba74' }}>
              Current application
            </div>
            <div className="text-2xl font-bold mt-2">
              {primary.desired_brand_name || primary.current_company_name || 'OxSteed franchise application'}
            </div>
            <div className="text-sm mt-2" style={{ color: 'var(--color-text-muted, #94a3b8)' }}>
              {labels[primary.status] || primary.status} · submitted {formatDate(primary.submitted_at)}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-6">
              <MiniMetric icon={MapPin} label="Territory" value={territory} accent="#93c5fd" />
              <MiniMetric icon={CheckCircle2} label="Checklist" value={checklistValue} accent="#34d399" />
              <MiniMetric icon={FileText} label="Agreement" value={READINESS_LABELS[primary.agreement_status] || primary.agreement_status || 'Pending'} accent="#fca5a5" />
              <MiniMetric icon={Rocket} label="Launch readiness" value={READINESS_LABELS[primary.launch_readiness_status] || primary.launch_readiness_status || 'Pending'} accent="#c4b5fd" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div className="rounded-2xl border p-4" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <Briefcase size={15} className="text-orange-400" />
                  Capital profile
                </div>
                <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  Available capital: <strong style={{ color: 'var(--color-text)' }}>{formatMoney(primary.available_capital_cents)}</strong>
                </div>
                <div className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  Liquid capital: <strong style={{ color: 'var(--color-text)' }}>{formatMoney(primary.liquid_capital_cents)}</strong>
                </div>
                <div className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  Store goal: <strong style={{ color: 'var(--color-text)' }}>{primary.preferred_store_count || 1}</strong>
                </div>
              </div>

              <div className="rounded-2xl border p-4" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <Compass size={15} className="text-orange-400" />
                  Next milestone
                </div>
                <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                  {primary.status === 'inquiry' && 'We are reviewing your territory and initial fit.'}
                  {primary.status === 'screening' && 'Expect screening questions about your background and capital readiness.'}
                  {primary.status === 'application_review' && 'Your formal application is under review by the franchise team.'}
                  {primary.status === 'diligence' && 'We are working through diligence, validation, and operating readiness.'}
                  {primary.status === 'agreement_pending' && 'Agreement documents and signing steps are now the main blocker.'}
                  {primary.status === 'approved' && 'You are approved. Training and launch-readiness work remain.'}
                  {primary.status === 'launched' && 'This franchise has moved into launch mode.'}
                  {primary.status === 'rejected' && 'This application is closed. Contact support if you believe more context is needed.'}
                  {primary.status === 'archived' && 'This application is archived.'}
                </p>
              </div>
            </div>
          </article>

          <aside className="rounded-[28px] border p-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)' }}>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Clock3 size={15} className="text-orange-400" />
              Timeline
            </div>
            <div className="mt-4 grid gap-3">
              {[
                ['Submitted', formatDate(primary.submitted_at)],
                ['Last updated', formatDate(primary.updated_at)],
                ['Launch target', primary.timeline_window || 'Not specified'],
                ['Training', READINESS_LABELS[primary.training_status] || primary.training_status || 'Pending'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border p-3" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
                  <div className="text-sm font-semibold mt-1">{value}</div>
                </div>
              ))}
            </div>
          </aside>
        </section>

        {sortedApplications.length > 1 && (
          <section className="rounded-[28px] border overflow-hidden" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)' }}>
            <header className="px-6 py-4 border-b" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
              <h2 className="text-lg font-semibold">All franchise applications</h2>
            </header>
            <div className="divide-y" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
              {sortedApplications.map((application) => (
                <div key={application.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-semibold">
                      {application.desired_brand_name || application.current_company_name || `Application #${application.id}`}
                    </div>
                    <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {(labels[application.status] || application.status)} · {formatDate(application.submitted_at)}
                    </div>
                  </div>
                  <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {application.desired_country ? ALL_COUNTRIES[application.desired_country] || application.desired_country : '—'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
