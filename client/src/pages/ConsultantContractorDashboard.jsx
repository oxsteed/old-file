import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import DashboardQuickLinks, { DASHBOARD_QUICK_LINKS } from '../components/DashboardQuickLinks';

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
  ['declined', 'consultantContractorDashboard.referralStatus.declined', 'Declined'],
];
const PAYING_STATUSES = new Set(['engaged', 'won']);

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

// Group 10 item 509: portfolio manager on the contractor dashboard. The
// consultant adds, edits, hides, and removes portfolio items; public items
// appear on the public specialty profile (506), hidden ones never leave
// this workspace.
function PortfolioManager() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', description: '', link_url: '', image_url: '', visibility: 'public', sort_order: '0' });
  const [editingId, setEditingId] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const { data } = await api.get('/consulting/contractor/portfolio');
      setItems(data?.portfolio || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || t('consultantContractorDashboard.portfolio.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || '',
      description: item.description || '',
      link_url: item.link_url || '',
      image_url: item.image_url || '',
      visibility: item.visibility || 'public',
      sort_order: String(item.sort_order ?? 0),
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm({ title: '', description: '', link_url: '', image_url: '', visibility: 'public', sort_order: '0' });
  }

  async function save(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (editingId) await api.put(`/consulting/contractor/portfolio/${editingId}`, form);
      else await api.post('/consulting/contractor/portfolio', form);
      resetForm();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consultantContractorDashboard.portfolio.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/consulting/contractor/portfolio/${item.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consultantContractorDashboard.portfolio.removeError'));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500';

  return (
    <div>
      {error ? <p role="alert" className="mb-3 text-sm text-red-200">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-gray-400">{t('consultantContractorDashboard.portfolio.loading')}</p>
      ) : items.length ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-gray-800 bg-[#111318] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${item.visibility === 'public' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-gray-700 bg-gray-900/70 text-gray-400'}`}>
                  {item.visibility === 'public' ? t('consultantContractorDashboard.portfolio.visiblePublic') : t('consultantContractorDashboard.portfolio.hidden')}
                </span>
              </div>
              {item.description ? <p className="mt-1 text-sm text-gray-400">{item.description}</p> : null}
              {item.link_url ? (
                <a href={item.link_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-indigo-300 hover:text-indigo-200" data-track="ui.c62ffb2364.12">{item.link_url}</a>
              ) : null}
              <div className="mt-2 flex gap-3">
                <button type="button" onClick={() => startEdit(item)} className="text-xs font-semibold text-orange-300 hover:text-orange-200" data-track="ui.c62ffb2364.7">
                  {t('consultantContractorDashboard.portfolio.edit')}
                </button>
                <button type="button" disabled={busy} onClick={() => remove(item)} className="text-xs font-semibold text-red-300 hover:text-red-200 disabled:opacity-50" data-track="ui.c62ffb2364.8">
                  {t('consultantContractorDashboard.portfolio.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">{t('consultantContractorDashboard.portfolio.empty')}</p>
      )}

      <form onSubmit={save} className="mt-4 grid gap-3 rounded-2xl border border-gray-800 bg-[#111318] p-4" data-track="ui.c62ffb2364.13">
        <p className="text-sm font-semibold text-white">{editingId ? t('consultantContractorDashboard.portfolio.editTitle') : t('consultantContractorDashboard.portfolio.addTitle')}</p>
        <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder={t('consultantContractorDashboard.portfolio.fields.title')} className={inputClass} required maxLength={180} />
        <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder={t('consultantContractorDashboard.portfolio.fields.description')} className={`${inputClass} min-h-[80px]`} maxLength={2000} />
        <input value={form.link_url} onChange={(e) => setForm((prev) => ({ ...prev, link_url: e.target.value }))} placeholder={t('consultantContractorDashboard.portfolio.fields.link')} className={inputClass} inputMode="url" maxLength={500} />
        <input value={form.image_url} onChange={(e) => setForm((prev) => ({ ...prev, image_url: e.target.value }))} placeholder={t('consultantContractorDashboard.portfolio.fields.image')} className={inputClass} inputMode="url" maxLength={500} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {t('consultantContractorDashboard.portfolio.fields.visibility')}
            <select value={form.visibility} onChange={(e) => setForm((prev) => ({ ...prev, visibility: e.target.value }))} className={`${inputClass} mt-2 normal-case tracking-normal`}>
              <option value="public">{t('consultantContractorDashboard.portfolio.visiblePublic')}</option>
              <option value="hidden">{t('consultantContractorDashboard.portfolio.hidden')}</option>
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {t('consultantContractorDashboard.portfolio.fields.order')}
            <input type="number" min="0" max="1000" value={form.sort_order} onChange={(e) => setForm((prev) => ({ ...prev, sort_order: e.target.value }))} className={`${inputClass} mt-2`} />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || !form.title.trim()} className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.c62ffb2364.9">
            {busy ? t('consultantContractorDashboard.actions.saving') : editingId ? t('consultantContractorDashboard.portfolio.saveChanges') : t('consultantContractorDashboard.portfolio.add')}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200" data-track="ui.c62ffb2364.10">
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ReferralAttachments({ referral, userId, tx }) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState([]);
  const [visibility, setVisibility] = useState('consultant_only');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadAttachments() {
    try {
      const { data } = await api.get(`/consulting/business-launch/requests/${encodeURIComponent(referral.id)}/attachments`);
      setAttachments(data?.attachments || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.attachments.loadError', 'Attachments could not be loaded.'));
    }
  }

  useEffect(() => {
    loadAttachments();
  }, [referral.id]);

  async function uploadAttachment(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('visibility', visibility);
      await api.post(`/consulting/business-launch/requests/${encodeURIComponent(referral.id)}/attachments`, form);
      await loadAttachments();
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.attachments.uploadError', 'Attachment upload failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttachment(attachment) {
    try {
      const { data } = await api.get(`/consulting/business-launch/attachments/${encodeURIComponent(attachment.id)}/download`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.attachments.downloadError', 'Attachment download failed.'));
    }
  }

  async function removeAttachment(attachment) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/consulting/business-launch/attachments/${encodeURIComponent(attachment.id)}`);
      await loadAttachments();
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.attachments.removeError', 'Attachment removal failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/45 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            {tx('consultantContractorDashboard.attachments.label', 'Case attachments')}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {tx('consultantContractorDashboard.attachments.visibilityHint', 'Shared files are visible to the applicant; adviser-only files stay in this consultant workspace.')}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-gray-400">
          <span>{tx('consultantContractorDashboard.attachments.shareAs', 'Share as')}</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)} disabled={busy} className="rounded-xl border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-white">
            <option value="consultant_only">{tx('consultantContractorDashboard.attachments.consultantOnly', 'Consultant only')}</option>
            <option value="shared">{tx('consultantContractorDashboard.attachments.shared', 'Shared')}</option>
          </select>
        </label>
      </div>

      <div className="space-y-2">
        {attachments.map((attachment) => (
          <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-800 bg-[#111318] px-3 py-2 text-xs">
            <span className="min-w-0 truncate text-gray-200">{attachment.originalName}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-gray-500">{attachment.visibility === 'shared' ? tx('consultantContractorDashboard.attachments.shared', 'Shared') : tx('consultantContractorDashboard.attachments.consultantOnly', 'Consultant only')}</span>
              <button type="button" onClick={() => downloadAttachment(attachment)} className="font-semibold text-indigo-300 hover:text-indigo-200" data-track="ui.c62ffb2364.5">
                {t('businessLaunchAttachments.download')}
              </button>
              {String(attachment.uploadedBy) === String(userId) && (
                <button type="button" disabled={busy} onClick={() => removeAttachment(attachment)} className="font-semibold text-orange-300 hover:text-orange-200 disabled:opacity-50" data-track="ui.c62ffb2364.6">
                  {t('businessLaunchAttachments.remove')}
                </button>
              )}
            </span>
          </div>
        ))}
        {!attachments.length && !error ? <p className="text-xs text-gray-500">{tx('consultantContractorDashboard.attachments.empty', 'No case attachments yet.')}</p> : null}
        {error ? <p role="alert" className="text-xs text-orange-200">{error}</p> : null}
      </div>

      <label className="mt-3 inline-flex cursor-pointer items-center rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-200 transition hover:border-gray-500">
        {busy ? tx('consultantContractorDashboard.attachments.uploading', 'Uploading…') : tx('consultantContractorDashboard.attachments.add', 'Add attachment')}
        <input type="file" className="sr-only" onChange={uploadAttachment} disabled={busy} accept="image/*,application/pdf,.doc,.docx" />
      </label>
    </div>
  );
}

// Group 10 Slice B (512/513/515): screen one assigned inquiry.
// Fit assessment is advisory; a conflict declaration blocks forward
// moves on the referral until cleared or the referral is declined (D-105).
function ReferralScreening({ referralId, tx }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState([]);
  const [fit, setFit] = useState({ budget_fit: '', scope_fit: '', timing_fit: '', overall_fit: '', decision: 'fit', notes: '' });
  const [conflict, setConflict] = useState({ has_conflict: false, description: '' });
  const [messages, setMessages] = useState([]);
  const [replyTemplateId, setReplyTemplateId] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [savingFit, setSavingFit] = useState(false);
  const [savingConflict, setSavingConflict] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [savedNote, setSavedNote] = useState('');

  async function loadScreen() {
    try {
      setLoading(true);
      setError('');
      const [{ data: screen }, { data: templateList }] = await Promise.all([
        api.get(`/consulting/contractor/referrals/${referralId}/screen`),
        api.get('/consulting/contractor/inquiry-templates'),
      ]);
      if (screen.fit) {
        setFit({
          budget_fit: screen.fit.budget_fit ?? '',
          scope_fit: screen.fit.scope_fit ?? '',
          timing_fit: screen.fit.timing_fit ?? '',
          overall_fit: screen.fit.overall_fit ?? '',
          decision: screen.fit.decision || 'fit',
          notes: screen.fit.notes || '',
        });
      }
      if (screen.conflict) {
        setConflict({
          has_conflict: Boolean(screen.conflict.has_conflict),
          description: screen.conflict.description || '',
        });
      }
      setMessages(screen.messages || []);
      setTemplates(templateList.templates || []);
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.screening.loadError', 'Failed to load screening.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) loadScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, referralId]);

  const scoreValue = (value) => (value === '' ? null : Number(value));

  async function saveFit() {
    try {
      setSavingFit(true);
      setSavedNote('');
      const { data } = await api.post(`/consulting/contractor/referrals/${referralId}/fit`, {
        budget_fit: scoreValue(fit.budget_fit),
        scope_fit: scoreValue(fit.scope_fit),
        timing_fit: scoreValue(fit.timing_fit),
        overall_fit: scoreValue(fit.overall_fit),
        decision: fit.decision,
        notes: fit.notes,
      });
      setFit((prev) => ({ ...prev, ...data.fit, budget_fit: data.fit.budget_fit ?? '', scope_fit: data.fit.scope_fit ?? '', timing_fit: data.fit.timing_fit ?? '', overall_fit: data.fit.overall_fit ?? '' }));
      setSavedNote(tx('consultantContractorDashboard.screening.fitSaved', 'Fit assessment saved.'));
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.screening.saveError', 'Failed to save.'));
    } finally {
      setSavingFit(false);
    }
  }

  async function saveConflict() {
    try {
      setSavingConflict(true);
      setSavedNote('');
      const { data } = await api.post(`/consulting/contractor/referrals/${referralId}/conflict`, {
        has_conflict: conflict.has_conflict,
        description: conflict.description,
      });
      setConflict({ has_conflict: Boolean(data.conflict.has_conflict), description: data.conflict.description || '' });
      setSavedNote(tx('consultantContractorDashboard.screening.conflictSaved', 'Conflict declaration saved.'));
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.screening.saveError', 'Failed to save.'));
    } finally {
      setSavingConflict(false);
    }
  }

  function applyTemplate(templateId) {
    setReplyTemplateId(templateId);
    const template = templates.find((entry) => entry.id === templateId);
    if (template) {
      setReplySubject(template.subject || '');
      setReplyBody(template.body_plain || '');
    }
  }

  async function sendReply() {
    try {
      setSendingReply(true);
      setSavedNote('');
      const { data } = await api.post(`/consulting/contractor/referrals/${referralId}/reply`, {
        template_id: replyTemplateId || undefined,
        subject: replySubject,
        body_plain: replyBody,
      });
      setMessages((prev) => [...prev, data.message]);
      setReplyTemplateId('');
      setReplySubject('');
      setReplyBody('');
      setSavedNote(tx('consultantContractorDashboard.screening.replySent', 'Reply sent.'));
    } catch (err) {
      setError(err.response?.data?.error || tx('consultantContractorDashboard.screening.saveError', 'Failed to save.'));
    } finally {
      setSendingReply(false);
    }
  }

  const scoreOptions = ['', 1, 2, 3, 4, 5];
  const inputClass = 'w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500';
  const labelClass = 'mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500';

  return (
    <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/50 p-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        aria-expanded={open} data-track="ui.c62ffb2364.14"
      >
        <span>{tx('consultantContractorDashboard.screening.title', 'Screen this inquiry')}</span>
        <span className="text-xs font-normal text-gray-400">{open ? tx('consultantContractorDashboard.screening.hide', 'Hide') : tx('consultantContractorDashboard.screening.show', 'Show')}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-5">
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          {savedNote && <p role="status" className="text-sm text-emerald-300">{savedNote}</p>}
          {loading ? (
            <p className="text-sm text-gray-400">{tx('consultantContractorDashboard.screening.loading', 'Loading…')}</p>
          ) : (
            <>
              <section>
                <h4 className="mb-3 text-sm font-semibold text-white">{tx('consultantContractorDashboard.screening.fitTitle', 'Fit assessment')}</h4>
                <p className="mb-3 text-xs leading-5 text-gray-400">{tx('consultantContractorDashboard.screening.fitHint', 'Advisory only. A fit assessment never blocks scheduling or accepting the referral.')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[['budget_fit', 'consultantContractorDashboard.screening.fitBudget', 'Budget fit'], ['scope_fit', 'consultantContractorDashboard.screening.fitScope', 'Scope fit'], ['timing_fit', 'consultantContractorDashboard.screening.fitTiming', 'Timing fit'], ['overall_fit', 'consultantContractorDashboard.screening.fitOverall', 'Overall fit']].map(([field, key, fallback]) => (
                    <div key={field}>
                      <label className={labelClass} htmlFor={`${referralId}-${field}`}>{tx(key, fallback)}</label>
                      <select id={`${referralId}-${field}`} value={fit[field]} onChange={(event) => setFit((prev) => ({ ...prev, [field]: event.target.value }))} className={inputClass}>
                        {scoreOptions.map((option) => (
                          <option key={String(option)} value={option}>{option === '' ? '—' : option}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <label className={labelClass} htmlFor={`${referralId}-decision`}>{tx('consultantContractorDashboard.screening.fitDecision', 'Decision')}</label>
                  <select id={`${referralId}-decision`} value={fit.decision} onChange={(event) => setFit((prev) => ({ ...prev, decision: event.target.value }))} className={inputClass}>
                    <option value="fit">{tx('consultantContractorDashboard.screening.fitDecisionFit', 'Good fit')}</option>
                    <option value="no_fit">{tx('consultantContractorDashboard.screening.fitDecisionNoFit', 'Not a fit')}</option>
                    <option value="needs_info">{tx('consultantContractorDashboard.screening.fitDecisionNeedsInfo', 'Needs more info')}</option>
                  </select>
                </div>
                <div className="mt-3">
                  <label className={labelClass} htmlFor={`${referralId}-fit-notes`}>{tx('consultantContractorDashboard.screening.fitNotes', 'Notes')}</label>
                  <textarea id={`${referralId}-fit-notes`} value={fit.notes} onChange={(event) => setFit((prev) => ({ ...prev, notes: event.target.value }))} className="min-h-[80px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500" placeholder={tx('consultantContractorDashboard.screening.fitNotesPlaceholder', 'Why this is or is not a fit.')} />
                </div>
                <button type="button" onClick={saveFit} disabled={savingFit} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.c62ffb2364.15">
                  {savingFit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {tx('consultantContractorDashboard.screening.fitSave', 'Save fit assessment')}
                </button>
              </section>

              <section>
                <h4 className="mb-3 text-sm font-semibold text-white">{tx('consultantContractorDashboard.screening.conflictTitle', 'Conflict of interest')}</h4>
                {conflict.has_conflict && (
                  <p role="alert" className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
                    {tx('consultantContractorDashboard.screening.conflictBlocks', 'An open conflict blocks moving this referral forward until you clear it or decline the referral.')}
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={conflict.has_conflict} onChange={(event) => setConflict((prev) => ({ ...prev, has_conflict: event.target.checked }))} className="mt-1 h-4 w-4 accent-orange-500" data-track="ui.c62ffb2364.16" />
                  {tx('consultantContractorDashboard.screening.conflictHas', 'I have a conflict of interest with this inquiry')}
                </label>
                <div className="mt-3">
                  <label className={labelClass} htmlFor={`${referralId}-conflict-desc`}>{tx('consultantContractorDashboard.screening.conflictDescription', 'Description')}</label>
                  <textarea id={`${referralId}-conflict-desc`} value={conflict.description} onChange={(event) => setConflict((prev) => ({ ...prev, description: event.target.value }))} className="min-h-[80px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500" placeholder={tx('consultantContractorDashboard.screening.conflictDescriptionPlaceholder', 'Describe the conflict, for example a competing client or a personal relationship.')} />
                </div>
                <button type="button" onClick={saveConflict} disabled={savingConflict} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.c62ffb2364.17">
                  {savingConflict ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {tx('consultantContractorDashboard.screening.conflictSave', 'Save declaration')}
                </button>
              </section>

              <section>
                <h4 className="mb-3 text-sm font-semibold text-white">{tx('consultantContractorDashboard.screening.replyTitle', 'Reply to the inquiry')}</h4>
                <div>
                  <label className={labelClass} htmlFor={`${referralId}-template`}>{tx('consultantContractorDashboard.screening.replyTemplate', 'Template')}</label>
                  <select id={`${referralId}-template`} value={replyTemplateId} onChange={(event) => applyTemplate(event.target.value)} className={inputClass}>
                    <option value="">{tx('consultantContractorDashboard.screening.replyTemplateCustom', 'Custom message')}</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-3">
                  <label className={labelClass} htmlFor={`${referralId}-reply-subject`}>{tx('consultantContractorDashboard.screening.replySubject', 'Subject')}</label>
                  <input id={`${referralId}-reply-subject`} type="text" value={replySubject} onChange={(event) => setReplySubject(event.target.value)} className={inputClass} />
                </div>
                <div className="mt-3">
                  <label className={labelClass} htmlFor={`${referralId}-reply-body`}>{tx('consultantContractorDashboard.screening.replyBody', 'Message')}</label>
                  <textarea id={`${referralId}-reply-body`} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} className="min-h-[110px] w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500" />
                </div>
                <button type="button" onClick={sendReply} disabled={sendingReply || !replySubject.trim() || !replyBody.trim()} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.c62ffb2364.18">
                  {sendingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {tx('consultantContractorDashboard.screening.replySend', 'Send reply')}
                </button>
                <div className="mt-4">
                  <h5 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{tx('consultantContractorDashboard.screening.messagesTitle', 'Message history')}</h5>
                  {messages.length ? (
                    <ul className="space-y-2">
                      {messages.map((message) => (
                        <li key={message.id} className="rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                          <p className="text-sm font-semibold text-white">{message.subject}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-400">{message.message_plain}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {message.author_role === 'consultant'
                              ? tx('consultantContractorDashboard.screening.messageFromConsultant', 'From you')
                              : tx('consultantContractorDashboard.screening.messageFromTeam', 'From the OxSteed team')}
                            {' • '}{new Date(message.created_at).toLocaleString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">{tx('consultantContractorDashboard.screening.messagesEmpty', 'No messages yet.')}</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReferralCard({ referral, onSave, savingId, payingAllowed, tx, userId }) {
  const [draft, setDraft] = useState({
    consultant_assignment_status: referral.consultant_assignment_status || 'assigned',
    consultant_status_notes: referral.consultant_status_notes || '',
    consultant_follow_up_at: referral.consultant_follow_up_at ? referral.consultant_follow_up_at.slice(0, 16) : '',
  });
  // Group 10 Slice B (514, D-106): declining is a deliberate refusal, so
  // the button asks once more before it fires.
  const [confirmingDecline, setConfirmingDecline] = useState(false);

  useEffect(() => {
    setDraft({
      consultant_assignment_status: referral.consultant_assignment_status || 'assigned',
      consultant_status_notes: referral.consultant_status_notes || '',
      consultant_follow_up_at: referral.consultant_follow_up_at ? referral.consultant_follow_up_at.slice(0, 16) : '',
    });
  }, [referral]);

  const blockPayingStatus = (status) => !payingAllowed && PAYING_STATUSES.has(status);

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
              <option key={optionValue} value={optionValue} disabled={blockPayingStatus(optionValue)}>
                {tx(optionLabelKey, optionLabelFallback)}
              </option>
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
            disabled={savingId === referral.id || blockPayingStatus(draft.consultant_assignment_status)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.c62ffb2364.1"
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

      {/* Group 10 Slice B (514, D-106): accept moves the referral to
          intro_pending; decline is only offered while it is unaccepted. */}
      {referral.consultant_assignment_status === 'assigned' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSave(referral.id, { ...draft, consultant_assignment_status: 'intro_pending' })}
            disabled={savingId === referral.id}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50" data-track="ui.c62ffb2364.19"
          >
            <CheckCircle2 className="h-4 w-4" />
            {tx('consultantContractorDashboard.referral.acceptButton', 'Accept referral')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmingDecline) {
                setConfirmingDecline(false);
                onSave(referral.id, { ...draft, consultant_assignment_status: 'declined' });
              } else {
                setConfirmingDecline(true);
              }
            }}
            disabled={savingId === referral.id}
            className="inline-flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50" data-track="ui.c62ffb2364.20"
          >
            {confirmingDecline
              ? tx('consultantContractorDashboard.referral.confirmDeclineButton', 'Click again to decline')
              : tx('consultantContractorDashboard.referral.declineButton', 'Decline referral')}
          </button>
          {confirmingDecline && (
            <button
              type="button"
              onClick={() => setConfirmingDecline(false)}
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-300 transition hover:bg-gray-800" data-track="ui.c62ffb2364.21"
            >
              {tx('consultantContractorDashboard.referral.cancelDeclineButton', 'Keep referral')}
            </button>
          )}
        </div>
      )}

      <ReferralAttachments referral={referral} userId={userId} tx={tx} />
      <ReferralScreening referralId={referral.id} tx={tx} />
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
      if (err.response?.data?.code === 'access_required') {
        const canApply = err.response.data.canApply === true;
        setDashboard((current) => ({
          ...current,
          payingReferralAccess: { allowed: false, canApply },
        }));
      } else {
        setError(err.response?.data?.error || tx('consultantContractorDashboard.errors.saveReferral', 'Failed to update referral.'));
      }
    } finally {
      setSavingReferralId(null);
    }
  }

  const summary = dashboard?.summary || {};
  const referrals = dashboard?.referrals || [];
  const payingReferralAccess = dashboard?.payingReferralAccess;
  const profile = dashboard?.profile || {};
  const hasCoverage = (profile.coverage_countries || []).length > 0;
  const READINESS_LABELS = {
    profile_complete: 'consultantContractorDashboard.readiness.items.profileComplete',
    specialties_declared: 'consultantContractorDashboard.readiness.items.specialtiesDeclared',
    availability_set: 'consultantContractorDashboard.readiness.items.availabilitySet',
    pricing_set: 'consultantContractorDashboard.readiness.items.pricingSet',
    profile_approved: 'consultantContractorDashboard.readiness.items.profileApproved',
  };

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
          {dashboard && !payingReferralAccess && (
            <div className="mb-4">
              <PlatformApprovalBanner mode="consultant" />
            </div>
          )}
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

          {/* Group 10 item 505: engagement readiness checklist, computed
              server-side. Item 504: the approval state is shown here too. */}
          {dashboard?.readiness && (
            <section className="mt-6 rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{t('consultantContractorDashboard.readiness.label')}</p>
                  <h2 className="text-2xl font-semibold text-white">{t('consultantContractorDashboard.readiness.title')}</h2>
                </div>
                <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${dashboard.readiness.ready ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}>
                  {dashboard.readiness.ready ? t('consultantContractorDashboard.readiness.ready') : t('consultantContractorDashboard.readiness.notReady')}
                </span>
              </div>
              {profile.approval_status === 'pending' && (
                <p role="status" className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  {t('consultantContractorDashboard.readiness.pendingApproval')}
                </p>
              )}
              {profile.approval_status === 'declined' && (
                <p role="status" className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {t('consultantContractorDashboard.readiness.declined', { note: profile.approval_note || '' })}
                </p>
              )}
              <ul className="grid gap-2 md:grid-cols-2">
                {dashboard.readiness.items.map((item) => (
                  <li key={item.key} className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-[#111318] px-4 py-3 text-sm text-white">
                    {item.met
                      ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                      : <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-600 text-xs text-gray-400">•</span>}
                    <span>{t(READINESS_LABELS[item.key] || 'consultantContractorDashboard.readiness.items.profileComplete')}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-500">{t('consultantContractorDashboard.readiness.hint')}</p>
            </section>
          )}

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
                      className="h-4 w-4 accent-orange-500" data-track="ui.c62ffb2364.2"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={saveProfile}
                  disabled={savingProfile}
                  className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50" data-track="ui.c62ffb2364.3"
                >
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingProfile ? tx('consultantContractorDashboard.actions.savingProfile', 'Saving profile') : tx('consultantContractorDashboard.actions.saveProfile', 'Save profile')}
                </button>
                <a
                  href="/consultant-availability"
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white" data-track="ui.c62ffb2364.4"
                >
                  <CalendarClock className="h-4 w-4" />
                  {tx('consultantContractorDashboard.actions.manageAvailability', 'Manage availability')}
                </a>
              </div>

              {/* Group 10 item 510: the consultant's own pricing summary. */}
              {dashboard?.pricingSummary && (
                <div className="mt-5 rounded-2xl border border-gray-800 bg-[#111318] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('consultantContractorDashboard.pricing.label')}</p>
                  <p className="mt-2 text-sm text-gray-200">{t('consultantContractorDashboard.pricing.minimum', { amount: centsToFriendly(dashboard.pricingSummary.minimum_package_price_cents) })}</p>
                  <p className="mt-1 text-sm text-gray-400">{t('consultantContractorDashboard.pricing.cut', { percent: ((dashboard.pricingSummary.default_oxsteed_cut_bps || 0) / 100).toFixed(2) })}</p>
                  <p className="mt-1 text-sm text-gray-400">{t('consultantContractorDashboard.pricing.limit', { count: dashboard.pricingSummary.active_referral_limit })}</p>
                  {profile.approval_status === 'approved' && user?.id && (
                    <a href={`/consultants/${user.id}`} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-orange-300 hover:text-orange-200" data-track="ui.c62ffb2364.11">
                      {t('consultantContractorDashboard.pricing.viewPublic')}
                    </a>
                  )}
                </div>
              )}
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

              {payingReferralAccess?.allowed === false && (
                <p role="status" className="mb-4 text-sm text-orange-200">
                  {t(payingReferralAccess.unavailable ? 'progressiveAccess.unavailable' : 'progressiveAccess.accessRequired', { ns: 'common' })}
                  {payingReferralAccess.canApply && (
                    <> <Link to="/settings/applications" className="underline" data-track="ui.access.consultant.apply">
                      {t('progressiveAccess.openApplications', { ns: 'common' })}
                    </Link></>
                  )}
                </p>
              )}
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
                      payingAllowed={payingReferralAccess?.allowed !== false}
                      tx={tx}
                      userId={user?.id}
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

          {/* Group 10 item 509: portfolio manager. */}
          <section className="mt-5 rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
                <Briefcase className="h-5 w-5 text-gray-300" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{t('consultantContractorDashboard.portfolio.label')}</p>
                <h2 className="text-2xl font-semibold text-white">{t('consultantContractorDashboard.portfolio.title')}</h2>
              </div>
            </div>
            <p className="mb-4 text-sm leading-6 text-gray-400">{t('consultantContractorDashboard.portfolio.description')}</p>
            <PortfolioManager />
          </section>

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

          <DashboardQuickLinks items={DASHBOARD_QUICK_LINKS.consultant} className="mt-6" />
        </div>
      </div>
    </PageShell>
  );
}
