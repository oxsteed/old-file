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
import PlatformApprovalBanner from '../components/PlatformApprovalBanner';
import { useTranslation } from 'react-i18next';
import { formatCents, formatNumber } from '../lib/format';

const STATUS_OPTIONS = [
  ['assigned', 'consultantContractorDashboard.referralStatus.assigned', 'Assigned'],
  ['intro_pending', 'consultantContractorDashboard.referralStatus.introPending', 'Intro pending'],
  ['intro_sent', 'consultantContractorDashboard.referralStatus.introSent', 'Intro sent'],
  ['discovery_scheduled', 'consultantContractorDashboard.referralStatus.discoveryScheduled', 'Discovery scheduled'],
  ['proposal_sent', 'consultantContractorDashboard.referralStatus.proposalSent', 'Proposal sent'],
  ['engaged', 'consultantContractorDashboard.referralStatus.engaged', 'Engaged'],
  ['won', 'consultantContractorDashboard.referralStatus.won', 'Won'],
  ['lost', 'consultantContractorDashboard.referralStatus.lost', 'Lost'],
  ['completed', 'consultantContractorDashboard.referralStatus.completed', 'Completed'],
  ['paused', 'consultantContractorDashboard.referralStatus.paused', 'Paused'],
];

function centsToCurrency(cents) {
  return formatCents(cents || 0, { maximumFractionDigits: 0 });
}

function compactNumber(value) {
  return formatNumber(Number(value) || 0, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
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

const PROFILE_FIELDS = [
  ['Headline', 'headline', 'consultantContractorDashboard.profile.fields.headline', 'consultantContractorDashboard.profile.fields.headlinePlaceholder'],
  ['Bio', 'bio', 'consultantContractorDashboard.profile.fields.bio', 'consultantContractorDashboard.profile.fields.bioPlaceholder'],
  ['Home country', 'home_country', 'consultantContractorDashboard.profile.fields.homeCountry', 'consultantContractorDashboard.profile.fields.homeCountryPlaceholder'],
  ['Home region / state', 'home_region', 'consultantContractorDashboard.profile.fields.homeRegion', 'consultantContractorDashboard.profile.fields.homeRegionPlaceholder'],
  ['Home city', 'home_city', 'consultantContractorDashboard.profile.fields.homeCity', 'consultantContractorDashboard.profile.fields.homeCityPlaceholder'],
  ['Coverage countries', 'coverage_countries', 'consultantContractorDashboard.profile.fields.coverageCountries', 'consultantContractorDashboard.profile.fields.coverageCountriesPlaceholder'],
  ['Coverage regions', 'coverage_regions', 'consultantContractorDashboard.profile.fields.coverageRegions', 'consultantContractorDashboard.profile.fields.coverageRegionsPlaceholder'],
  ['Languages', 'languages', 'consultantContractorDashboard.profile.fields.languages', 'consultantContractorDashboard.profile.fields.languagesPlaceholder'],
  ['Specialties', 'specialties', 'consultantContractorDashboard.profile.fields.specialties', 'consultantContractorDashboard.profile.fields.specialtiesPlaceholder'],
  ['Timezone', 'timezone', 'consultantContractorDashboard.profile.fields.timezone', 'consultantContractorDashboard.profile.fields.timezonePlaceholder'],
];

const PROFILE_NUMERIC_FIELDS = [
  ['Years experience', 'years_experience', 'consultantContractorDashboard.profile.fields.yearsExperience'],
  ['Default OxSteed cut (bps)', 'default_oxsteed_cut_bps', 'consultantContractorDashboard.profile.fields.defaultCut'],
  ['Referral limit', 'active_referral_limit', 'consultantContractorDashboard.profile.fields.referralLimit'],
  ['Minimum package cents', 'minimum_package_price_cents', 'consultantContractorDashboard.profile.fields.minimumPackageCents'],
];

const PROFILE_TOGGLES = [
  ['Accepting referrals', 'accepts_new_referrals', 'consultantContractorDashboard.profile.toggles.acceptingReferrals'],
  ['Virtual consulting', 'accepts_virtual_consulting', 'consultantContractorDashboard.profile.toggles.virtualConsulting'],
  ['Profile active', 'is_active', 'consultantContractorDashboard.profile.toggles.profileActive'],
];

function centsToFriendly(cents) {
  const n = Number(cents || 0) / 100;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function ReferralCard({ referral, onSave, savingId, tx }) {
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
              {tx('consultantContractorDashboard.referral.yourShare', 'Your share')} {centsToCurrency(referral.estimated_consultant_share_cents)}
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
            <p className="mt-1 text-xs text-gray-500">
              {tx('consultantContractorDashboard.referral.retainedByPlatform', {
                defaultValue: '{{amount}} retained by platform',
                amount: centsToCurrency(referral.estimated_oxsteed_share_cents),
              })}
            </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {tx('consultantContractorDashboard.referral.statusLabel', 'Referral status')}
          </label>
          <select
            value={draft.consultant_assignment_status}
            onChange={(event) => setDraft((prev) => ({ ...prev, consultant_assignment_status: event.target.value }))}
            className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
          >
            {STATUS_OPTIONS.map(([optionValue, optionLabelKey, optionLabelFallback]) => (
            <option key={optionValue} value={optionValue}>{tx(optionLabelKey, optionLabelFallback)}</option>
          ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {tx('consultantContractorDashboard.referral.followUpLabel', 'Follow-up')}
          </label>
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
            {savingId === referral.id ? tx('consultantContractorDashboard.actions.saving', 'Saving') : tx('consultantContractorDashboard.referral.saveUpdate', 'Save update')}
          </button>
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
          {tx('consultantContractorDashboard.referral.notesLabel', 'Notes for this referral')}
        </label>
        <textarea
          value={draft.consultant_status_notes}
          onChange={(event) => setDraft((prev) => ({ ...prev, consultant_status_notes: event.target.value }))}
          className="min-h-[110px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
          placeholder={tx('consultantContractorDashboard.referral.notesPlaceholder', 'Capture discovery notes, local market context, next steps, and anything OxSteed should know.')}
        />
      </div>

      <div className="mt-3 text-xs text-gray-500">
        {tx('consultantContractorDashboard.referral.targetMarketLabel', 'Target market')}: {referral.target_market || tx('consultantContractorDashboard.referral.targetMarketMissing', 'Not provided')}<br />
      </div>
    </article>
  );
}

export default function ConsultantContractorDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const tx = (key, fallback, options) => t(key, { defaultValue: fallback, ...options });
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
      setError(err.response?.data?.error || tx('consultantContractorDashboard.errors.load', 'Failed to load consultant dashboard.'));
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
      setError(err.response?.data?.error || tx('consultantContractorDashboard.errors.saveProfile', 'Failed to save profile.'));
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
      setError(err.response?.data?.error || tx('consultantContractorDashboard.errors.saveReferral', 'Failed to update referral.'));
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
        title={tx('consultantContractorDashboard.page.title', 'Consultant Contractor Dashboard')}
        description={tx(
          'consultantContractorDashboard.page.description',
          'Manage local OxSteed business-launch referrals, coverage markets, and negotiated referral economics.'
        )}
        url={`${window.location.origin}/consulting/contractor-dashboard`}
      />

      <div className="min-h-screen bg-[#06080d] text-gray-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {/* Renders only when consultant mode is gated and the user is
              not yet approved. Self-hides on approval. */}
          <div className="mb-4">
            <PlatformApprovalBanner mode="consultant" />
          </div>
          <section className="overflow-hidden rounded-[34px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.22),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.14),_transparent_24%),#0d1016] p-6 lg:p-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">
                  <Sparkles className="h-3.5 w-3.5" />
                  {tx('consultantContractorDashboard.page.workspaceBadge', 'Consultant contractor workspace')}
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">
                  {tx('consultantContractorDashboard.page.heading', 'Local referrals, payout split, and market coverage in one place.')}
                </h1>
                <p className="mt-4 text-sm leading-7 text-gray-300 lg:text-base">
                  {tx('consultantContractorDashboard.page.subheading', 'Use this dashboard to operate as an independent OxSteed consultant. You can define your market coverage, manage Dominican Republic or other country referrals, track the negotiated OxSteed cut, and move each lead from introduction to engagement.')}
                </p>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{tx('consultantContractorDashboard.page.signedInAs', 'Signed in as')}</p>
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
              label={tx('consultantContractorDashboard.summary.activeReferrals', 'Active referrals')}
              value={loading ? '...' : compactNumber(summary.active_referrals)}
              hint={tx('consultantContractorDashboard.summary.activeReferralsHint', 'Leads still moving through your local consulting pipeline.')}
            />
            <DashboardCard
              icon={Wallet}
              label={tx('consultantContractorDashboard.summary.pipelineValue', 'Your pipeline value')}
              value={loading ? '...' : centsToCurrency(summary.consultant_pipeline_cents)}
              hint={tx('consultantContractorDashboard.summary.pipelineValueHint', 'Estimated contractor-side value from assigned and open referrals.')}
              tone="text-emerald-300"
            />
            <DashboardCard
              icon={ArrowUpRight}
              label={tx('consultantContractorDashboard.summary.generated', 'OxSteed generated')}
              value={loading ? '...' : centsToCurrency(summary.oxsteed_generated_cents)}
              hint={tx('consultantContractorDashboard.summary.generatedHint', 'Estimated platform-side share being created from your referral activity.')}
              tone="text-orange-300"
            />
            <DashboardCard
              icon={Globe2}
              label={tx('consultantContractorDashboard.summary.coveredCountries', 'Covered countries')}
              value={loading ? '...' : compactNumber((profile.coverage_countries || []).length)}
              hint={tx('consultantContractorDashboard.summary.coveredCountriesHint', 'Markets where you are currently available for local or virtual referrals.')}
            />
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_1.35fr]">
            <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
                  <MapPinned className="h-5 w-5 text-gray-300" />
                </div>
                <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{tx('consultantContractorDashboard.coverageProfile.label', 'Coverage Profile')}</p>
                <h2 className="text-2xl font-semibold text-white">{tx('consultantContractorDashboard.coverageProfile.title', 'Where you can serve')}</h2>
              </div>
              </div>

              {!hasCoverage ? (
                <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  {tx('consultantContractorDashboard.coverageProfile.noCoverage', 'Add your country and region coverage so OxSteed can route local business-launch referrals to you.')}
                </div>
              ) : null}

              <div className="grid gap-3">
                {PROFILE_FIELDS.map(([labelFallback, key, labelKey, placeholderKey]) => (
                  <div key={key}>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{tx(labelKey, labelFallback)}</label>
                    {key === 'bio' ? (
                      <textarea
                        value={profileForm[key]}
                        onChange={(event) => setProfileForm((prev) => ({ ...prev, [key]: event.target.value }))}
                        placeholder={tx(placeholderKey, '')}
                        className="min-h-[120px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                      />
                    ) : (
                      <input
                        value={profileForm[key]}
                        onChange={(event) => setProfileForm((prev) => ({ ...prev, [key]: event.target.value }))}
                        placeholder={tx(placeholderKey, '')}
                        className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {PROFILE_NUMERIC_FIELDS.map(([labelFallback, key, labelKey]) => (
                  <div key={key}>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{tx(labelKey, labelFallback)}</label>
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
                {PROFILE_TOGGLES.map(([labelFallback, key, labelKey]) => (
                  <label key={key} className="flex items-center justify-between rounded-2xl border border-gray-800 bg-[#111318] px-4 py-3 text-sm text-white">
                    <span>{tx(labelKey, labelFallback)}</span>
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
                  {savingProfile ? tx('consultantContractorDashboard.actions.savingProfile', 'Saving profile') : tx('consultantContractorDashboard.actions.saveProfile', 'Save profile')}
                </button>
                <a
                  href="/consultant-availability"
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white"
                >
                  <CalendarClock className="h-4 w-4" />
                  {tx('consultantContractorDashboard.actions.manageAvailability', 'Manage availability')}
                </a>
              </div>
            </section>

            <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{tx('consultantContractorDashboard.pipeline.label', 'Referral Pipeline')}</p>
                  <h2 className="text-2xl font-semibold text-white">{tx('consultantContractorDashboard.pipeline.title', 'Assigned local consulting leads')}</h2>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{tx('consultantContractorDashboard.pipeline.openNow', 'Open now')}</p>
                  <p className="mt-1 text-xl font-semibold text-white">{loading ? '...' : compactNumber(referralPipelineCount)}</p>
                </div>
              </div>

              {loading ? (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-[#111318] px-4 py-10 text-center text-sm text-gray-400">
                  {tx('consultantContractorDashboard.pipeline.loading', 'Loading referrals…')}
                </div>
              ) : referrals.length ? (
                <div className="space-y-4">
                  {referrals.map((referral) => (
                    <ReferralCard
                      key={referral.id}
                      referral={referral}
                      onSave={saveReferral}
                      savingId={savingReferralId}
                      tx={tx}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-gray-700 bg-[#111318] px-5 py-10 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/80">
                    <CheckCircle2 className="h-6 w-6 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{tx('consultantContractorDashboard.pipeline.emptyTitle', 'No assigned referrals yet')}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    {tx('consultantContractorDashboard.pipeline.emptyDescription', 'Once OxSteed routes a business-launch lead to you, it will appear here with payout split, market context, and next-step tracking.')}
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{tx('consultantContractorDashboard.howItWorks.label', 'How this program works')}</p>
                <h2 className="text-2xl font-semibold text-white">{tx('consultantContractorDashboard.howItWorks.title', 'OxSteed referral model')}</h2>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <h3 className="text-sm font-semibold text-white">{tx('consultantContractorDashboard.howItWorks.step1Title', '1. Local match')}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {tx('consultantContractorDashboard.howItWorks.step1Body', 'Admins can match a helper or business-launch intake to consultants who cover that country, region, and language.')}
                </p>
              </div>
              <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <h3 className="text-sm font-semibold text-white">{tx('consultantContractorDashboard.howItWorks.step2Title', '2. Negotiated cut')}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {tx('consultantContractorDashboard.howItWorks.step2Body', 'The agreed OxSteed referral cut is copied onto the lead at assignment time, so your share and the platform share stay locked for that referral.')}
                </p>
              </div>
              <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                <h3 className="text-sm font-semibold text-white">{tx('consultantContractorDashboard.howItWorks.step3Title', '3. Pipeline execution')}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {tx('consultantContractorDashboard.howItWorks.step3Body', 'Use your dashboard to move leads from intro to discovery, proposal, engagement, and completion while keeping OxSteed in the loop.')}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
