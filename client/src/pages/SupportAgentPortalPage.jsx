import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe2,
  Headphones,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  SendHorizonal,
  ShieldCheck,
  Users,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

function kindLabel(kind, t) {
  if (kind === 'business') return t('supportAgentPortal.kindBusiness');
  if (kind === 'helper') return t('supportAgentPortal.kindHelper');
  if (kind === 'platform') return t('supportAgentPortal.kindPlatform');
  return kind || '-';
}

function titleCase(value) {
  if (!value) return '-';
  return String(value)
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatLocation(city, state) {
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}

function formatDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'hired' || normalized === 'approved' || normalized === 'active') {
    return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200';
  }
  if (normalized === 'rejected' || normalized === 'inactive') {
    return 'border-red-500/30 bg-red-500/15 text-red-200';
  }
  if (normalized === 'paused' || normalized === 'training') {
    return 'border-amber-500/30 bg-amber-500/15 text-amber-200';
  }
  return 'border-sky-500/30 bg-sky-500/15 text-sky-200';
}

function supportSignalLabel(signal) {
  if (signal === 'published_hiring_profile') return 'Published hiring profile';
  if (signal === 'support_team') return 'Existing support team';
  return 'Support ready';
}

function defaultFormState() {
  return {
    jobTitle: 'Support Agent',
    experienceLevel: 'intermediate',
    availability: 'Flexible weekday coverage',
    languages: 'English',
    resumeUrl: '',
    coverLetter: '',
  };
}

function profileFormFromBusiness(item) {
  return {
    business_id: item.business_id,
    business_name: item.business_name,
    business_type: item.business_type,
    address_city: item.address_city,
    address_state: item.address_state,
    logo_url: item.logo_url,
    is_accepting_applications: Boolean(item.is_accepting_applications),
    hiring_title: item.hiring_title || 'Support Agent',
    hiring_description: item.hiring_description || '',
    desired_languages: Array.isArray(item.desired_languages) ? item.desired_languages.join(', ') : '',
    desired_shift_coverage: item.desired_shift_coverage || '',
    remote_allowed: item.remote_allowed !== false,
    compensation_summary: item.compensation_summary || '',
    response_time_expectation: item.response_time_expectation || '',
    updated_at: item.updated_at || null,
  };
}

function OpportunityCard({ item, onApply }) {
  const location = formatLocation(item.address_city, item.address_state);
  const hasPending = item.my_application_status === 'pending';
  const isApplied = Boolean(item.my_application_status);
  const isAlreadyAgent = Boolean(item.existing_agent_id);

  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-white">{item.business_name}</h3>
            {item.is_business_verified && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                <ShieldCheck size={12} />
                Verified
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-300">
            {item.business_type && (
              <span className="inline-flex items-center gap-2">
                <Building2 size={14} />
                {item.business_type}
              </span>
            )}
            {location && (
              <span className="inline-flex items-center gap-2">
                <MapPin size={14} />
                {location}
              </span>
            )}
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-100">
              {supportSignalLabel(item.support_signal)}
            </span>
          </div>
        </div>
        <div className="text-right">
          {isAlreadyAgent ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              <CheckCircle2 size={14} />
              Active role
            </span>
          ) : isApplied ? (
            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge(item.my_application_status)}`}>
              <Clock3 size={14} />
              {titleCase(item.my_application_status)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100">
              <BadgeCheck size={14} />
              Accepting applicants
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-300">
        {item.hiring_description || item.description || 'This business has published a support-agent opening on OxSteed and is actively reviewing applications.'}
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
        {item.hiring_title && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            Role: {item.hiring_title}
          </span>
        )}
        {item.remote_allowed && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            Remote-friendly
          </span>
        )}
        {item.desired_languages?.length > 0 && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            Languages: {item.desired_languages.join(', ')}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">30-day support volume</p>
          <p className="mt-2 text-2xl font-semibold text-white">{item.conversation_count_30d || 0}</p>
          <p className="mt-1 text-xs text-slate-400">Support conversations handled in the last 30 days</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Current support team</p>
          <p className="mt-2 text-2xl font-semibold text-white">{item.active_agents_count || 0}</p>
          <p className="mt-1 text-xs text-slate-400">Active agents already staffing this business</p>
        </div>
      </div>

      {(item.desired_shift_coverage || item.compensation_summary || item.response_time_expectation) && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
          {item.desired_shift_coverage && (
            <p className="leading-6">
              <span className="font-medium text-white">Shift coverage:</span> {item.desired_shift_coverage}
            </p>
          )}
          {item.compensation_summary && (
            <p className="mt-2 leading-6">
              <span className="font-medium text-white">Compensation:</span> {item.compensation_summary}
            </p>
          )}
          {item.response_time_expectation && (
            <p className="mt-2 leading-6">
              <span className="font-medium text-white">Expected response:</span> {item.response_time_expectation}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">
        {item.website && (
          <a
            href={item.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 hover:border-orange-400/50 hover:text-white"
          >
            <Globe2 size={14} />
            Website
            <ExternalLink size={13} />
          </a>
        )}
        {item.phone && (
          <a
            href={`tel:${item.phone}`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 hover:border-orange-400/50 hover:text-white"
          >
            <Phone size={14} />
            {item.phone}
          </a>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <div className="text-xs text-slate-400">
          {hasPending
            ? `Applied ${formatDate(item.my_application_created_at) || 'recently'}`
            : isApplied
              ? `Last application ${formatDate(item.my_application_created_at) || 'recently'}`
              : 'Submit your support profile and availability for review.'}
        </div>
        <button
          type="button"
          disabled={isAlreadyAgent || hasPending || item.my_application_status === 'hired'}
          onClick={() => onApply(item)}
          className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          <SendHorizonal size={15} />
          {isAlreadyAgent ? 'Already on team' : hasPending ? 'Application pending' : 'Apply now'}
        </button>
      </div>
    </article>
  );
}

export default function SupportAgentPortalPage() {
  const { t } = useTranslation();
  const { isHelper } = useAuth();
  const [employments, setEmployments] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [applications, setApplications] = useState([]);
  const [managedBusinesses, setManagedBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [savingBusinessId, setSavingBusinessId] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [applyTarget, setApplyTarget] = useState(null);
  const [form, setForm] = useState(defaultFormState);
  const [submittingApplication, setSubmittingApplication] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employmentRes, opportunitiesRes, applicationsRes, managedBusinessesRes] = await Promise.all([
        api.get('/support/agent/me'),
        api.get('/support/agent/opportunities'),
        api.get('/support/agent/applications'),
        api.get('/support/hiring/my-businesses'),
      ]);

      setEmployments(Array.isArray(employmentRes?.data?.data) ? employmentRes.data.data : []);
      setOpportunities(Array.isArray(opportunitiesRes?.data?.data) ? opportunitiesRes.data.data : []);
      setApplications(Array.isArray(applicationsRes?.data?.data) ? applicationsRes.data.data : []);
      setManagedBusinesses(
        Array.isArray(managedBusinessesRes?.data?.data)
          ? managedBusinessesRes.data.data.map(profileFormFromBusiness)
          : []
      );
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error');
      setEmployments([]);
      setOpportunities([]);
      setApplications([]);
      setManagedBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setGlobalAvailability = async (isAvailable) => {
    setSavingAvailability(true);
    setError(null);
    try {
      await api.patch('/support/agent/me/availability', { is_available: isAvailable });
      toast.success(isAvailable ? 'You are live for support work.' : 'You are offline for support work.');
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error');
    } finally {
      setSavingAvailability(false);
    }
  };

  const updateManagedBusinessField = (businessId, field, value) => {
    setManagedBusinesses((current) =>
      current.map((item) => (
        item.business_id === businessId
          ? { ...item, [field]: value }
          : item
      ))
    );
  };

  const saveHiringProfile = async (business) => {
    setSavingBusinessId(business.business_id);
    setError(null);
    try {
      await api.put(`/support/${business.business_id}/settings/hiring`, {
        is_accepting_applications: Boolean(business.is_accepting_applications),
        hiring_title: business.hiring_title,
        hiring_description: business.hiring_description,
        desired_languages: String(business.desired_languages || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        desired_shift_coverage: business.desired_shift_coverage,
        remote_allowed: Boolean(business.remote_allowed),
        compensation_summary: business.compensation_summary,
        response_time_expectation: business.response_time_expectation,
      });
      toast.success(`${business.business_name} hiring profile updated.`);
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error');
    } finally {
      setSavingBusinessId(null);
    }
  };

  const openApply = (business) => {
    setApplyTarget(business);
    setForm({
      ...defaultFormState(),
      coverLetter: `I’d like to support ${business.business_name} on OxSteed. I can help with customer communication, triage, follow-up, and keeping the support queue moving.`,
    });
  };

  const closeApply = () => {
    if (submittingApplication) return;
    setApplyTarget(null);
    setForm(defaultFormState());
  };

  const submitApplication = async (event) => {
    event.preventDefault();
    if (!applyTarget) return;

    setSubmittingApplication(true);
    setError(null);
    try {
      await api.post('/support/apply', {
        businessId: applyTarget.business_id,
        jobTitle: form.jobTitle.trim(),
        experienceLevel: form.experienceLevel,
        availability: form.availability.trim(),
        languages: form.languages
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        resumeUrl: form.resumeUrl.trim() || null,
        coverLetter: form.coverLetter.trim() || null,
      });
      toast.success(`Application sent to ${applyTarget.business_name}.`);
      setApplyTarget(null);
      setForm(defaultFormState());
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error');
    } finally {
      setSubmittingApplication(false);
    }
  };

  const anyOnline = employments.some((row) => row.is_available);
  const activeRolesCount = employments.length;
  const pendingApplicationsCount = applications.filter((item) => item.status === 'pending').length;
  const openOpportunitiesCount = opportunities.filter((item) => !item.existing_agent_id && item.my_application_status !== 'pending').length;

  const visibleOpportunities = opportunities.filter((item) => {
    const haystack = [
      item.business_name,
      item.business_type,
      item.description,
      item.address_city,
      item.address_state,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const searchMatch = !search.trim() || haystack.includes(search.trim().toLowerCase());
    if (!searchMatch) return false;

    if (filter === 'remote') return Boolean(item.remote_allowed);
    if (filter === 'applied') return Boolean(item.my_application_status);
    if (filter === 'verified') return Boolean(item.is_business_verified);
    return true;
  });

  return (
    <PageShell>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(180deg,_#08111f_0%,_#050b14_52%,_#03070d_100%)]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur xl:p-8">
            <div className="grid gap-8 xl:grid-cols-[1.3fr_0.7fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-100">
                  <Headphones size={14} />
                  Support Agent Network
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  {t('supportAgentPortal.title')}
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
                  Find OxSteed businesses already running support, apply directly from one workspace, and keep your active support roles and availability in sync.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={savingAvailability || anyOnline}
                    onClick={() => setGlobalAvailability(true)}
                    className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {savingAvailability ? t('supportAgentPortal.saving') : t('supportAgentPortal.goOnline')}
                  </button>
                  <button
                    type="button"
                    disabled={savingAvailability || !anyOnline}
                    onClick={() => setGlobalAvailability(false)}
                    className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-orange-400/40 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    {savingAvailability ? t('supportAgentPortal.saving') : t('supportAgentPortal.goOffline')}
                  </button>
                  <Link
                    to={isHelper ? '/helper/messages' : '/messages'}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-orange-400/40"
                  >
                    <MessageSquare size={16} />
                    {t('supportAgentPortal.openMessages')}
                  </Link>
                  <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-orange-400/40 disabled:opacity-50"
                  >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Active roles</p>
                  <p className="mt-3 text-4xl font-semibold text-white">{activeRolesCount}</p>
                  <p className="mt-2 text-sm text-slate-400">Businesses or organizations you currently support.</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Pending applications</p>
                  <p className="mt-3 text-4xl font-semibold text-white">{pendingApplicationsCount}</p>
                  <p className="mt-2 text-sm text-slate-400">Applications waiting for a business review.</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Open opportunities</p>
                  <p className="mt-3 text-4xl font-semibold text-white">{openOpportunitiesCount}</p>
                  <p className="mt-2 text-sm text-slate-400">Businesses already showing support signals on OxSteed.</p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-100">
              {error}
            </div>
          )}

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {[
              {
                title: '1. Get discovered',
                body: 'Keep your availability live, maintain a strong support profile, and show the languages and shift windows you can cover.',
              },
              {
                title: '2. Apply to live businesses',
                body: 'Target businesses already showing support demand on OxSteed instead of sending cold applications into the void.',
              },
              {
                title: '3. Move into active support',
                body: 'Once a business hires you, the role appears here and your support workspace becomes your day-to-day operating surface.',
              },
            ].map((step) => (
              <div key={step.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-sm font-semibold text-white">{step.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-8 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="space-y-8">
              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Active support roles</p>
                    <p className="mt-1 text-sm text-slate-400">
                      The businesses and organizations where you already operate as a support agent.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                    <Users size={14} />
                    {activeRolesCount} roles
                  </span>
                </div>

                {loading ? (
                  <p className="mt-6 text-sm text-slate-400">{t('supportAgentPortal.loading')}</p>
                ) : employments.length === 0 ? (
                  <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6">
                    <p className="text-base font-medium text-white">{t('supportAgentPortal.emptyTitle')}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {t('supportAgentPortal.emptyBody')} This page now also lets you browse businesses that are already showing support demand and submit applications directly.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {employments.map((row) => (
                      <div
                        key={row.agent_id}
                        className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                              {t('supportAgentPortal.employer')} · {kindLabel(row.employer_kind, t)}
                            </p>
                            <p className="mt-2 text-lg font-semibold text-white">{row.employer_label}</p>
                            {row.service_business_name && (
                              <p className="mt-2 text-sm text-slate-400">
                                {t('supportAgentPortal.serviceContext')}: {row.service_business_name}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>
                              {titleCase(row.status)}
                            </span>
                            <p className={`mt-3 text-sm font-medium ${row.is_available ? 'text-emerald-300' : 'text-slate-400'}`}>
                              {row.is_available ? t('common.available') : t('common.unavailable')}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-400">
                          <span>Role: {titleCase(row.role)}</span>
                          <span>Hired: {formatDate(row.hire_date) || '-'}</span>
                          <span>Max chats: {row.max_concurrent_chats ?? '-'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">My applications</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Track which businesses are reviewing your support profile and where follow-up may be needed.
                    </p>
                  </div>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                    <Briefcase size={14} />
                    {applications.length} total
                  </span>
                </div>

                {loading ? (
                  <p className="mt-6 text-sm text-slate-400">Loading applications…</p>
                ) : applications.length === 0 ? (
                  <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6">
                    <p className="text-base font-medium text-white">No applications yet</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Once you apply to a business, the status will show up here so you can see who is pending, hired, or asking for a stronger fit.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {applications.map((item) => (
                      <div key={item.id} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-lg font-semibold text-white">{item.business_name}</p>
                            <p className="mt-1 text-sm text-slate-400">
                              {item.job_title} · {titleCase(item.experience_level)}
                            </p>
                          </div>
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge(item.status)}`}>
                            {titleCase(item.status)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
                          {item.business_type && <span>{item.business_type}</span>}
                          {formatLocation(item.address_city, item.address_state) && (
                            <span>{formatLocation(item.address_city, item.address_state)}</span>
                          )}
                          <span>Applied {formatDate(item.created_at) || '-'}</span>
                        </div>
                        {item.availability && (
                          <p className="mt-4 text-sm leading-6 text-slate-300">
                            Availability: {item.availability}
                          </p>
                        )}
                        {item.review_notes && (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
                            <p className="font-medium text-white">Review note</p>
                            <p className="mt-2 leading-6">{item.review_notes}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Businesses hiring through support signals</p>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                    This board now shows only businesses that explicitly published a support-agent hiring profile. It is no longer inference-based, which means every card here represents a real employer-controlled opening.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ['all', 'All'],
                    ['remote', 'Remote-friendly'],
                    ['verified', 'Verified'],
                    ['applied', 'My applications'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        filter === value
                          ? 'bg-orange-500 text-slate-950'
                          : 'border border-white/10 text-slate-300 hover:border-orange-400/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <Search size={18} className="text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by business name, type, city, or state"
                  className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                />
              </label>

              {loading ? (
                <p className="mt-6 text-sm text-slate-400">Loading businesses…</p>
              ) : visibleOpportunities.length === 0 ? (
                <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6">
                  <p className="text-base font-medium text-white">No businesses match this view</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Try a broader search or switch filters. This board only shows businesses that explicitly turned on support-agent hiring, so it stays focused on real openings rather than a generic directory.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {visibleOpportunities.map((item) => (
                    <OpportunityCard key={item.business_id} item={item} onApply={openApply} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {managedBusinesses.length > 0 && (
            <section className="mt-10 rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Publish business hiring profiles</p>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                    If you manage a business on OxSteed, this is where you explicitly opt in to support-agent applications. When you turn hiring on here, your business can appear in the public agent board above.
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                  <Building2 size={14} />
                  {managedBusinesses.length} manageable businesses
                </span>
              </div>

              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                {managedBusinesses.map((business) => (
                  <article key={business.business_id} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-white">{business.business_name}</h3>
                        <p className="mt-1 text-sm text-slate-400">
                          {[business.business_type, formatLocation(business.address_city, business.address_state)].filter(Boolean).join(' · ') || 'Business workspace'}
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-3 rounded-full border border-white/10 px-3 py-2 text-sm text-white">
                        <input
                          type="checkbox"
                          checked={business.is_accepting_applications}
                          onChange={(event) => updateManagedBusinessField(business.business_id, 'is_accepting_applications', event.target.checked)}
                        />
                        Accepting applications
                      </label>
                    </div>

                    <div className="mt-5 space-y-4">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-white">Hiring title</span>
                        <input
                          value={business.hiring_title}
                          onChange={(event) => updateManagedBusinessField(business.business_id, 'hiring_title', event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                          placeholder="Support Agent"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-white">Hiring description</span>
                        <textarea
                          rows={4}
                          value={business.hiring_description}
                          onChange={(event) => updateManagedBusinessField(business.business_id, 'hiring_description', event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                          placeholder="Describe the support workload, customer tone, and what success looks like."
                        />
                      </label>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-white">Desired languages</span>
                          <input
                            value={business.desired_languages}
                            onChange={(event) => updateManagedBusinessField(business.business_id, 'desired_languages', event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                            placeholder="English, Spanish"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-white">Shift coverage</span>
                          <input
                            value={business.desired_shift_coverage}
                            onChange={(event) => updateManagedBusinessField(business.business_id, 'desired_shift_coverage', event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                            placeholder="Weekdays 8am-6pm EST"
                          />
                        </label>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-white">Compensation summary</span>
                          <input
                            value={business.compensation_summary}
                            onChange={(event) => updateManagedBusinessField(business.business_id, 'compensation_summary', event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                            placeholder="$20/hr + bonus, contract, per shift"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-white">Response expectation</span>
                          <input
                            value={business.response_time_expectation}
                            onChange={(event) => updateManagedBusinessField(business.business_id, 'response_time_expectation', event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                            placeholder="Reply to customers within 5 minutes"
                          />
                        </label>
                      </div>

                      <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white">
                        <input
                          type="checkbox"
                          checked={business.remote_allowed}
                          onChange={(event) => updateManagedBusinessField(business.business_id, 'remote_allowed', event.target.checked)}
                        />
                        Remote-friendly role
                      </label>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                      <p className="text-xs text-slate-400">
                        {business.updated_at ? `Last updated ${formatDate(business.updated_at)}` : 'No hiring profile saved yet.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => saveHiringProfile(business)}
                        disabled={savingBusinessId === business.business_id}
                        className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      >
                        <SendHorizonal size={15} />
                        {savingBusinessId === business.business_id ? 'Saving…' : 'Save hiring profile'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {applyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/10 bg-[#07111e] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">Apply to business</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{applyTarget.business_name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Submit a focused support-agent application. This should explain what kinds of queues, customers, and communication workflows you can confidently handle.
                </p>
              </div>
              <button
                type="button"
                onClick={closeApply}
                className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:border-orange-400/40 hover:text-white"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={submitApplication}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Job title</span>
                  <input
                    required
                    value={form.jobTitle}
                    onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Experience level</span>
                  <select
                    value={form.experienceLevel}
                    onChange={(event) => setForm((current) => ({ ...current, experienceLevel: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white focus:border-orange-400/50 focus:outline-none"
                  >
                    <option value="entry">Entry</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="expert">Expert</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-white">Languages</span>
                <input
                  value={form.languages}
                  onChange={(event) => setForm((current) => ({ ...current, languages: event.target.value }))}
                  placeholder="English, Spanish, Haitian Creole"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-white">Availability</span>
                <input
                  value={form.availability}
                  onChange={(event) => setForm((current) => ({ ...current, availability: event.target.value }))}
                  placeholder="Weekdays 8am-6pm EST, part-time evenings, weekends"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-white">Resume URL</span>
                <input
                  type="url"
                  value={form.resumeUrl}
                  onChange={(event) => setForm((current) => ({ ...current, resumeUrl: event.target.value }))}
                  placeholder="https://..."
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-white">Cover letter</span>
                <textarea
                  rows={7}
                  value={form.coverLetter}
                  onChange={(event) => setForm((current) => ({ ...current, coverLetter: event.target.value }))}
                  placeholder="Describe your support experience, how you handle customer tone, triage, follow-up, and what kinds of businesses you work best with."
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                />
              </label>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                <p className="font-medium text-white">Recommended process</p>
                <p className="mt-2 leading-6">
                  Businesses should review for queue-handling fit, communication quality, language coverage, and schedule overlap. Once approved, the agent should move straight into the active support roster and see the role in this portal.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeApply}
                  className="rounded-full border border-white/10 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:border-orange-400/40 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingApplication || !form.jobTitle.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  <SendHorizonal size={15} />
                  {submittingApplication ? 'Sending…' : 'Submit application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
}
