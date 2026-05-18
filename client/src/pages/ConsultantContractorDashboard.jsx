import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  Globe2,
  Loader2,
  MapPinned,
  Save,
  Sparkles,
  Wallet,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';

const STATUS_OPTIONS = [
  'assigned',
  'intro_pending',
  'intro_sent',
  'discovery_scheduled',
  'proposal_sent',
  'engaged',
  'won',
  'lost',
  'completed',
  'paused',
];

function centsToCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

function arrayToText(list) {
  return Array.isArray(list) ? list.join(', ') : '';
}

function DashboardCard({ icon: Icon, label, value, hint, tone = 'text-white' }) {
  return (
    <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</span>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
          <Icon className="h-4.5 w-4.5 text-gray-300" />
        </div>
      </div>
      <div className={`text-3xl font-semibold ${tone}`}>{value}</div>
      <p className="mt-2 text-sm leading-6 text-gray-500">{hint}</p>
    </div>
  );
}

function ReferralCard({ referral, onSave, savingId }) {
  const [draft, setDraft] = useState({
    consultant_assignment_status: referral.consultant_assignment_status || 'assigned',
    consultant_status_notes: referral.consultant_status_notes || '',
    consultant_follow_up_at: referral.consultant_follow_up_at ? referral.consultant_follow_up_at.slice(0, 16) : '',
  });

  useEffect(() => {
    setDraft({
      consultant_assignment_status: referral.consultant_assignment_status || 'assigned',
      consultant_status_notes: referral.consultant_status_notes || '',
      consultant_follow_up_at: referral.consultant_follow_up_at ? referral.consultant_follow_up_at.slice(0, 16) : '',
    });
  }, [referral]);

  return (
    <article className="rounded-[28px] border border-gray-800 bg-[#111318] p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-200">
              {referral.package_selected || 'launch'}
            </span>
            <span className="rounded-full border border-gray-700 bg-gray-900/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              {referral.operating_country || '-'} / {referral.operating_state || '-'}
            </span>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Your share {centsToCurrency(referral.estimated_consultant_share_cents)}
            </span>
          </div>
          <h3 className="text-xl font-semibold text-white">
            {referral.business_name || `${referral.first_name} ${referral.last_name}`}
          </h3>
          <p className="mt-2 text-sm leading-6 text-gray-400">{referral.skill_description}</p>
          <p className="mt-2 text-sm text-gray-500">
            {referral.email} {referral.phone ? `• ${referral.phone}` : ''}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Target market: {referral.target_market || 'Not provided'}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">OxSteed cut</p>
          <p className="mt-1 text-lg font-semibold text-white">
            {((Number(referral.assigned_oxsteed_cut_bps) || 0) / 100).toFixed(2)}%
          </p>
          <p className="mt-1 text-xs text-gray-500">{centsToCurrency(referral.estimated_oxsteed_share_cents)} retained by platform</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Referral status</label>
          <select
            value={draft.consultant_assignment_status}
            onChange={(event) => setDraft((prev) => ({ ...prev, consultant_assignment_status: event.target.value }))}
            className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Follow-up</label>
          <input
            type="datetime-local"
            value={draft.consultant_follow_up_at}
            onChange={(event) => setDraft((prev) => ({ ...prev, consultant_follow_up_at: event.target.value }))}
            className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => onSave(referral.id, draft)}
            disabled={savingId === referral.id}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
          >
            {savingId === referral.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {savingId === referral.id ? 'Saving' : 'Save update'}
          </button>
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Notes for this referral</label>
        <textarea
          value={draft.consultant_status_notes}
          onChange={(event) => setDraft((prev) => ({ ...prev, consultant_status_notes: event.target.value }))}
          className="min-h-[110px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
          placeholder="Capture discovery notes, local market context, next steps, and anything OxSteed should know."
        />
      </div>
    </article>
  );
}

export default function ConsultantContractorDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingReferralId, setSavingReferralId] = useState(null);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [profileForm, setProfileForm] = useState({
    headline: '',
    bio: '',
    home_country: '',
    home_region: '',
    home_city: '',
    coverage_countries: '',
    coverage_regions: '',
    languages: '',
    specialties: '',
    years_experience: '',
    default_oxsteed_cut_bps: '2000',
    minimum_package_price_cents: '0',
    active_referral_limit: '12',
    accepts_new_referrals: true,
    accepts_virtual_consulting: true,
    is_active: true,
    timezone: '',
  });

  async function loadDashboard() {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/consulting/contractor/dashboard');
      setDashboard(data);
      const profile = data.profile || {};
      setProfileForm({
        headline: profile.headline || '',
        bio: profile.bio || '',
        home_country: profile.home_country || '',
        home_region: profile.home_region || '',
        home_city: profile.home_city || '',
        coverage_countries: arrayToText(profile.coverage_countries),
        coverage_regions: arrayToText(profile.coverage_regions),
        languages: arrayToText(profile.languages),
        specialties: arrayToText(profile.specialties),
        years_experience: profile.years_experience ?? '',
        default_oxsteed_cut_bps: String(profile.default_oxsteed_cut_bps ?? 2000),
        minimum_package_price_cents: String(profile.minimum_package_price_cents ?? 0),
        active_referral_limit: String(profile.active_referral_limit ?? 12),
        accepts_new_referrals: profile.accepts_new_referrals !== false,
        accepts_virtual_consulting: profile.accepts_virtual_consulting !== false,
        is_active: profile.is_active !== false,
        timezone: profile.timezone || '',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load consultant dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function saveProfile() {
    try {
      setSavingProfile(true);
      setError('');
      await api.put('/consulting/contractor/profile', profileForm);
      await loadDashboard();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveReferral(referralId, draft) {
    try {
      setSavingReferralId(referralId);
      setError('');
      await api.patch(`/consulting/contractor/referrals/${referralId}`, {
        ...draft,
        mark_contacted: ['intro_sent', 'discovery_scheduled', 'proposal_sent', 'engaged', 'won', 'completed'].includes(draft.consultant_assignment_status),
      });
      await loadDashboard();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update referral.');
    } finally {
      setSavingReferralId(null);
    }
  }

  const summary = dashboard?.summary || {};
  const referrals = dashboard?.referrals || [];
  const profile = dashboard?.profile || {};
  const hasCoverage = (profile.coverage_countries || []).length > 0;

  const referralPipelineCount = useMemo(
    () => referrals.filter((referral) => !['lost', 'completed'].includes(referral.consultant_assignment_status)).length,
    [referrals]
  );

  return (
    <PageShell>
      <PageMeta
        title="Consultant Contractor Dashboard"
        description="Manage local OxSteed business-launch referrals, coverage markets, and negotiated referral economics."
        url={`${window.location.origin}/consulting/contractor-dashboard`}
      />

      <div className="min-h-screen bg-[#06080d] text-gray-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[34px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.22),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.14),_transparent_24%),#0d1016] p-6 lg:p-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">
                  <Sparkles className="h-3.5 w-3.5" />
                  Consultant contractor workspace
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">
                  Local referrals, payout split, and market coverage in one place.
                </h1>
                <p className="mt-4 text-sm leading-7 text-gray-300 lg:text-base">
                  Use this dashboard to operate as an independent OxSteed consultant. You can define your market coverage,
                  manage Dominican Republic or other country referrals, track the negotiated OxSteed cut, and move each lead
                  from introduction to engagement.
                </p>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Signed in as</p>
                <p className="mt-2 text-lg font-semibold text-white">{user?.first_name} {user?.last_name}</p>
                <p className="mt-1 text-sm text-gray-400">{user?.email}</p>
              </div>
            </div>
          </section>

          {error ? (
            <div className="mt-5 rounded-[24px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DashboardCard
              icon={Briefcase}
              label="Active referrals"
              value={loading ? '...' : compactNumber(summary.active_referrals)}
              hint="Leads still moving through your local consulting pipeline."
            />
            <DashboardCard
              icon={Wallet}
              label="Your pipeline value"
              value={loading ? '...' : centsToCurrency(summary.consultant_pipeline_cents)}
              hint="Estimated contractor-side value from assigned and open referrals."
              tone="text-emerald-300"
            />
            <DashboardCard
              icon={ArrowUpRight}
              label="OxSteed generated"
              value={loading ? '...' : centsToCurrency(summary.oxsteed_generated_cents)}
              hint="Estimated platform-side share being created from your referral activity."
              tone="text-orange-300"
            />
            <DashboardCard
              icon={Globe2}
              label="Covered countries"
              value={loading ? '...' : compactNumber((profile.coverage_countries || []).length)}
              hint="Markets where you are currently available for local or virtual referrals."
            />
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_1.35fr]">
            <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
                  <MapPinned className="h-5 w-5 text-gray-300" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">Coverage Profile</p>
                  <h2 className="text-2xl font-semibold text-white">Where you can serve</h2>
                </div>
              </div>

              {!hasCoverage ? (
                <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  Add your country and region coverage so OxSteed can route local business-launch referrals to you.
                </div>
              ) : null}

              <div className="grid gap-3">
                {[
                  ['Headline', 'headline', 'Local launch consultant for trades, service businesses, and operators'],
                  ['Bio', 'bio', 'Explain your local expertise, business-launch experience, and operator strengths.'],
                  ['Home country', 'home_country', 'DO'],
                  ['Home region / state', 'home_region', 'Santo Domingo'],
                  ['Home city', 'home_city', 'Santo Domingo'],
                  ['Coverage countries', 'coverage_countries', 'DO, HT, US'],
                  ['Coverage regions', 'coverage_regions', 'Distrito Nacional, Santiago, Cap-Haïtien'],
                  ['Languages', 'languages', 'English, Spanish, Haitian Creole'],
                  ['Specialties', 'specialties', 'Business formation, local permits, operations setup, hiring'],
                  ['Timezone', 'timezone', 'America/Santo_Domingo'],
                ].map(([label, key, placeholder]) => (
                  <div key={key}>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</label>
                    {key === 'bio' ? (
                      <textarea
                        value={profileForm[key]}
                        onChange={(event) => setProfileForm((prev) => ({ ...prev, [key]: event.target.value }))}
                        placeholder={placeholder}
                        className="min-h-[120px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                      />
                    ) : (
                      <input
                        value={profileForm[key]}
                        onChange={(event) => setProfileForm((prev) => ({ ...prev, [key]: event.target.value }))}
                        placeholder={placeholder}
                        className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ['Years experience', 'years_experience'],
                  ['Default OxSteed cut (bps)', 'default_oxsteed_cut_bps'],
                  ['Referral limit', 'active_referral_limit'],
                  ['Minimum package cents', 'minimum_package_price_cents'],
                ].map(([label, key]) => (
                  <div key={key}>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</label>
                    <input
                      type="number"
                      min="0"
                      value={profileForm[key]}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, [key]: event.target.value }))}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ['Accepting referrals', 'accepts_new_referrals'],
                  ['Virtual consulting', 'accepts_virtual_consulting'],
                  ['Profile active', 'is_active'],
                ].map(([label, key]) => (
                  <label key={key} className="flex items-center justify-between rounded-2xl border border-gray-800 bg-[#111318] px-4 py-3 text-sm text-white">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={profileForm[key]}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, [key]: event.target.checked }))}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={saveProfile}
                  disabled={savingProfile}
                  className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingProfile ? 'Saving profile' : 'Save profile'}
                </button>
                <a
                  href="/consultant-availability"
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white"
                >
                  <CalendarClock className="h-4 w-4" />
                  Manage availability
                </a>
              </div>
            </section>

            <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">Referral Pipeline</p>
                  <h2 className="text-2xl font-semibold text-white">Assigned local consulting leads</h2>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Open now</p>
                  <p className="mt-1 text-xl font-semibold text-white">{loading ? '...' : compactNumber(referralPipelineCount)}</p>
                </div>
              </div>

              {loading ? (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-[#111318] px-4 py-10 text-center text-sm text-gray-400">
                  Loading referrals…
                </div>
              ) : referrals.length ? (
                <div className="space-y-4">
                  {referrals.map((referral) => (
                    <ReferralCard
                      key={referral.id}
                      referral={referral}
                      onSave={saveReferral}
                      savingId={savingReferralId}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-gray-700 bg-[#111318] px-5 py-10 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/80">
                    <CheckCircle2 className="h-6 w-6 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">No assigned referrals yet</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    Once OxSteed routes a business-launch lead to you, it will appear here with payout split, market context, and next-step tracking.
                  </p>
                </div>
              )}
            </section>
          </div>

          <section className="mt-5 rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
                <Building2 className="h-5 w-5 text-gray-300" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">How this program works</p>
                <h2 className="text-2xl font-semibold text-white">OxSteed referral model</h2>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <h3 className="text-sm font-semibold text-white">1. Local match</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  Admins can match a helper or business-launch intake to consultants who cover that country, region, and language.
                </p>
              </div>
              <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <h3 className="text-sm font-semibold text-white">2. Negotiated cut</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  The agreed OxSteed referral cut is copied onto the lead at assignment time, so your share and the platform share stay locked for that referral.
                </p>
              </div>
              <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <h3 className="text-sm font-semibold text-white">3. Pipeline execution</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  Use your dashboard to move leads from intro to discovery, proposal, engagement, and completion while keeping OxSteed in the loop.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
