import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Globe,
  MapPin,
  Plus,
  RefreshCcw,
  Search,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import axios from '../../../api/axios';

const STATUS_OPTIONS = ['inquiry', 'screening', 'application_review', 'diligence', 'agreement_pending', 'approved', 'rejected', 'archived', 'launched'];
const AGREEMENT_OPTIONS = ['draft', 'sent', 'signed', 'waived'];
const TRAINING_OPTIONS = ['not_started', 'scheduled', 'in_progress', 'completed'];
const READINESS_OPTIONS = ['not_ready', 'planning', 'ready', 'launched'];
const CHECKLIST_OPTIONS = ['pending', 'in_progress', 'completed', 'blocked', 'waived'];

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const pageShell = {
  minHeight: '100%',
  background: 'linear-gradient(180deg, #030712 0%, #0f172a 42%, #111827 100%)',
  color: '#e5e7eb',
  padding: '24px',
};

const panel = {
  background: 'rgba(15, 23, 42, 0.88)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '24px',
  boxShadow: '0 24px 70px rgba(2, 6, 23, 0.42)',
  backdropFilter: 'blur(16px)',
};

const fieldStyle = {
  width: '100%',
  padding: '11px 13px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#f8fafc',
  fontSize: '0.92rem',
};

const OPTION_LABEL_KEYS = {
  inquiry: 'adminFranchiseStatusInquiry',
  screening: 'adminFranchiseStatusScreening',
  application_review: 'adminFranchiseStatusApplicationReview',
  diligence: 'adminFranchiseStatusDiligence',
  agreement_pending: 'adminFranchiseStatusAgreementPending',
  approved: 'adminFranchiseStatusApproved',
  rejected: 'adminFranchiseStatusRejected',
  archived: 'adminFranchiseStatusArchived',
  launched: 'adminFranchiseStatusLaunched',
  draft: 'adminFranchiseOptionDraft',
  sent: 'adminFranchiseOptionSent',
  signed: 'adminFranchiseOptionSigned',
  waived: 'adminFranchiseOptionWaived',
  not_started: 'adminFranchiseOptionNotStarted',
  scheduled: 'adminFranchiseOptionScheduled',
  in_progress: 'adminFranchiseOptionInProgress',
  completed: 'adminFranchiseOptionCompleted',
  not_ready: 'adminFranchiseOptionNotReady',
  planning: 'adminFranchiseOptionPlanning',
  ready: 'adminFranchiseOptionReady',
  pending: 'adminFranchiseOptionPending',
  blocked: 'adminFranchiseOptionBlocked',
};

function formatLabel(value, t) {
  const raw = String(value || '');
  if (!raw) return '';
  const key = OPTION_LABEL_KEYS[raw.toLowerCase()];
  if (key && t) return t(key);
  return raw
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function MetricCard({ icon: Icon, label, value, sublabel, accent }) {
  return (
    <div style={{ ...panel, padding: '18px 18px 16px', display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: accent }}>
          <Icon size={18} />
        </span>
        <span style={{ color: '#94a3b8', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f8fafc' }}>{value}</div>
      <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{sublabel}</div>
    </div>
  );
}

function FranchiseRow({ item, isActive, onClick }) {
  const { t } = useTranslation();
  const readinessPct = item.checklist_total ? Math.round((item.checklist_completed / item.checklist_total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: '20px',
        padding: '16px',
        border: isActive ? '1px solid rgba(249, 115, 22, 0.7)' : '1px solid rgba(148, 163, 184, 0.12)',
        background: isActive ? 'linear-gradient(135deg, rgba(249, 115, 22, 0.18), rgba(15, 23, 42, 0.96))' : 'rgba(2, 6, 23, 0.62)',
        color: '#e5e7eb',
        display: 'grid',
        gap: '10px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
            {item.desired_brand_name || item.current_company_name || `${item.first_name} ${item.last_name}`}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.86rem' }}>{item.first_name} {item.last_name} · {item.email}</div>
        </div>
        <div style={{ color: '#fb923c', fontSize: '0.8rem', fontWeight: 700 }}>{formatLabel(item.status, t)}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', fontSize: '0.78rem' }}>
          {item.desired_country}{item.desired_region ? ` · ${item.desired_region}` : ''}
        </span>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(16, 185, 129, 0.15)', color: '#86efac', fontSize: '0.78rem' }}>
          {t('adminFranchiseAgreementLabel', { status: formatLabel(item.agreement_status, t) })}
        </span>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(250, 204, 21, 0.12)', color: '#fde68a', fontSize: '0.78rem' }}>
          {t('adminFranchiseStores', { count: item.preferred_store_count })}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.78rem' }}>
          <span>{t('adminFranchiseLaunchReadiness')}</span>
          <span>{readinessPct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: 'rgba(148, 163, 184, 0.14)', overflow: 'hidden' }}>
          <div style={{ width: `${readinessPct}%`, height: '100%', background: 'linear-gradient(90deg, #f97316, #22c55e)' }} />
        </div>
      </div>
    </button>
  );
}

export default function FranchiseHQPage() {
  const { t } = useTranslation();
  const [applications, setApplications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedBundle, setSelectedBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ status: '', country: '', agreement_status: '' });
  const [search, setSearch] = useState('');
  const [noteText, setNoteText] = useState('');
  const [createForm, setCreateForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    lead_source: 'admin_referral',
    current_company_name: '',
    desired_brand_name: '',
    desired_country: '',
    desired_region: '',
    desired_city: '',
    territory_summary: '',
    business_background: '',
    available_capital: '',
    liquid_capital: '',
    preferred_store_count: 1,
    timeline_window: '',
  });
  const [editForm, setEditForm] = useState(null);
  const [agreementForm, setAgreementForm] = useState(null);
  const [activationForm, setActivationForm] = useState({ business_name: '', business_type: 'corp', website: '', description: '' });

  const selectedApplication = selectedBundle?.application || null;

  const metrics = useMemo(() => {
    const total = applications.length;
    const active = applications.filter((item) => !['rejected', 'archived'].includes(item.status)).length;
    const approved = applications.filter((item) => ['approved', 'launched'].includes(item.status)).length;
    const launched = applications.filter((item) => item.status === 'launched' || item.linked_business_id).length;
    return { total, active, approved, launched };
  }, [applications]);

  async function loadApplications(preferredId) {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.country) params.set('country', filters.country.trim().toUpperCase());
      if (filters.agreement_status) params.set('agreement_status', filters.agreement_status);
      if (search.trim()) params.set('search', search.trim());
      const res = await axios.get(`/franchise/applications?${params.toString()}`);
      const list = res.data?.data || [];
      setApplications(list);
      const nextId = preferredId || selectedId || list[0]?.id || null;
      setSelectedId(nextId);
      if (nextId) {
        await loadDetail(nextId);
      } else {
        setSelectedBundle(null);
      }
    } catch (err) {
      toast.error(t('adminFranchiseLoadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) return;
    try {
      setDetailLoading(true);
      const res = await axios.get(`/franchise/applications/${id}`);
      const bundle = res.data;
      setSelectedBundle(bundle);
      setEditForm({
        status: bundle.application.status || 'inquiry',
        agreement_status: bundle.application.agreement_status || 'draft',
        training_status: bundle.application.training_status || 'not_started',
        launch_readiness_status: bundle.application.launch_readiness_status || 'not_ready',
        owner_user_id: bundle.application.owner_user_id || '',
        desired_country: bundle.application.desired_country || '',
        desired_region: bundle.application.desired_region || '',
        desired_city: bundle.application.desired_city || '',
        desired_brand_name: bundle.application.desired_brand_name || '',
        current_company_name: bundle.application.current_company_name || '',
        territory_summary: bundle.application.territory_summary || '',
        timeline_window: bundle.application.timeline_window || '',
        preferred_store_count: bundle.application.preferred_store_count || 1,
        hq_recommendation: bundle.application.hq_recommendation || '',
        risk_notes: bundle.application.risk_notes || '',
        market_assessment: bundle.application.market_assessment || '',
      });
      setAgreementForm({
        agreement_version: bundle.agreement?.agreement_version || 'v1',
        document_url: bundle.agreement?.document_url || '',
        initial_fee: bundle.agreement?.initial_fee_cents ? (bundle.agreement.initial_fee_cents / 100).toFixed(0) : '',
        royalty_bps: bundle.agreement?.royalty_bps ?? '',
        marketing_fee_bps: bundle.agreement?.marketing_fee_bps ?? '',
        term_years: bundle.agreement?.term_years ?? '',
        territory_exclusive: bundle.agreement?.territory_exclusive || false,
        signed_by_name: bundle.agreement?.signed_by_name || '',
        signed_by_email: bundle.agreement?.signed_by_email || '',
        notes: bundle.agreement?.notes || '',
        application_agreement_status: bundle.application.agreement_status || 'draft',
      });
      setActivationForm({
        business_name: bundle.application.desired_brand_name || bundle.application.current_company_name || '',
        business_type: 'corp',
        website: '',
        description: bundle.application.local_market_overview || '',
      });
    } catch (err) {
      toast.error(t('adminFranchiseDetailFailed'));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveApplication() {
    if (!selectedApplication || !editForm) return;
    try {
      setSaving(true);
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}`, editForm);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseUpdated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseUpdateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function saveAgreement() {
    if (!selectedApplication || !agreementForm) return;
    try {
      setSaving(true);
      const res = await axios.put(`/franchise/applications/${selectedApplication.id}/agreement`, agreementForm);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseAgreementUpdated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseAgreementFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function createApplication(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await axios.post('/franchise/applications', createForm);
      toast.success(t('adminFranchiseLeadCreated'));
      setShowCreate(false);
      setCreateForm({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        lead_source: 'admin_referral',
        current_company_name: '',
        desired_brand_name: '',
        desired_country: '',
        desired_region: '',
        desired_city: '',
        territory_summary: '',
        business_background: '',
        available_capital: '',
        liquid_capital: '',
        preferred_store_count: 1,
        timeline_window: '',
      });
      await loadApplications(res.data?.application?.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLeadFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!selectedApplication || !noteText.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/notes`, { note_text: noteText });
      setSelectedBundle(res.data);
      setNoteText('');
      toast.success(t('adminFranchiseNoteAdded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseNoteFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateChecklist(itemId, payload) {
    if (!selectedApplication) return;
    try {
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}/checklist/${itemId}`, payload);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseChecklistUpdated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseChecklistFailed'));
    }
  }

  async function activateStore() {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/activate-store`, activationForm);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseStoreActivated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseActivateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={pageShell}>
      <div style={{ maxWidth: 1500, margin: '0 auto', display: 'grid', gap: 22 }}>
        <section style={{ ...panel, padding: '28px 28px 24px', display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 760 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, background: 'rgba(249, 115, 22, 0.13)', color: '#fdba74', fontSize: '0.82rem', fontWeight: 700 }}>
                <Globe size={14} />
                {t('adminFranchiseEyebrow')}
              </div>
              <h1 style={{ margin: '14px 0 10px', fontSize: '2.6rem', lineHeight: 1.05, color: '#f8fafc' }}>
                {t('adminFranchiseTitle')}
              </h1>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '1rem', lineHeight: 1.6 }}>
                {t('adminFranchiseSubtitle')}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowCreate((value) => !value)}
                style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #f97316, #fb7185)', color: 'white', padding: '12px 18px', fontWeight: 700, display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
              >
                <Plus size={16} />
                {t('adminFranchiseNewLead')}
              </button>
              <button
                type="button"
                onClick={() => loadApplications(selectedId)}
                style={{ border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 14, background: 'rgba(15, 23, 42, 0.72)', color: '#e5e7eb', padding: '12px 16px', fontWeight: 700, display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
              >
                <RefreshCcw size={16} />
                {t('common.refresh')}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <MetricCard icon={Users} label={t('adminFranchiseLivePipeline')} value={metrics.active} sublabel={t('adminFranchiseLivePipelineHint')} accent="rgba(59, 130, 246, 0.22)" />
            <MetricCard icon={Briefcase} label={t('adminFranchiseApproved')} value={metrics.approved} sublabel={t('adminFranchiseApprovedHint')} accent="rgba(34, 197, 94, 0.2)" />
            <MetricCard icon={Building2} label={t('adminFranchiseLaunchedStores')} value={metrics.launched} sublabel={t('adminFranchiseLaunchedStoresHint')} accent="rgba(16, 185, 129, 0.22)" />
            <MetricCard icon={ClipboardList} label={t('adminFranchiseTotalLeads')} value={metrics.total} sublabel={t('adminFranchiseTotalLeadsHint')} accent="rgba(249, 115, 22, 0.2)" />
          </div>

          {showCreate && (
            <form onSubmit={createApplication} style={{ ...panel, padding: 20, display: 'grid', gap: 14, borderRadius: 20 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseCreateLead')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <input style={fieldStyle} placeholder={t('adminFranchiseFirstName')} value={createForm.first_name} onChange={(e) => setCreateForm((v) => ({ ...v, first_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseLastName')} value={createForm.last_name} onChange={(e) => setCreateForm((v) => ({ ...v, last_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseEmail')} value={createForm.email} onChange={(e) => setCreateForm((v) => ({ ...v, email: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchisePhone')} value={createForm.phone} onChange={(e) => setCreateForm((v) => ({ ...v, phone: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseCountryCode')} value={createForm.desired_country} onChange={(e) => setCreateForm((v) => ({ ...v, desired_country: e.target.value.toUpperCase() }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseRegion')} value={createForm.desired_region} onChange={(e) => setCreateForm((v) => ({ ...v, desired_region: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseCity')} value={createForm.desired_city} onChange={(e) => setCreateForm((v) => ({ ...v, desired_city: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseLeadSource')} value={createForm.lead_source} onChange={(e) => setCreateForm((v) => ({ ...v, lead_source: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseCurrentCompany')} value={createForm.current_company_name} onChange={(e) => setCreateForm((v) => ({ ...v, current_company_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseDesiredBrand')} value={createForm.desired_brand_name} onChange={(e) => setCreateForm((v) => ({ ...v, desired_brand_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseAvailableCapital')} value={createForm.available_capital} onChange={(e) => setCreateForm((v) => ({ ...v, available_capital: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseLiquidCapital')} value={createForm.liquid_capital} onChange={(e) => setCreateForm((v) => ({ ...v, liquid_capital: e.target.value }))} />
              </div>
              <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseTerritorySummary')} value={createForm.territory_summary} onChange={(e) => setCreateForm((v) => ({ ...v, territory_summary: e.target.value }))} />
              <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseBusinessBackground')} value={createForm.business_background} onChange={(e) => setCreateForm((v) => ({ ...v, business_background: e.target.value }))} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setShowCreate(false)} style={{ border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 14, background: 'transparent', color: '#cbd5e1', padding: '11px 16px', cursor: 'pointer' }}>{t('common.close')}</button>
                <button type="submit" style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #f97316, #fb7185)', color: 'white', padding: '11px 18px', fontWeight: 700, cursor: 'pointer' }}>{t('adminFranchiseCreateLeadButton')}</button>
              </div>
            </form>
          )}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
          <div style={{ ...panel, padding: 18, display: 'grid', gap: 14, position: 'sticky', top: 24 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#64748b' }} />
                <input style={{ ...fieldStyle, paddingLeft: 38 }} placeholder={t('adminFranchiseSearchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <select style={fieldStyle} value={filters.status} onChange={(e) => setFilters((v) => ({ ...v, status: e.target.value }))}>
                  <option value="">{t('adminFranchiseAllStatuses')}</option>
                  {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                </select>
                <input style={fieldStyle} placeholder={t('adminFranchiseCountry')} value={filters.country} onChange={(e) => setFilters((v) => ({ ...v, country: e.target.value.toUpperCase() }))} />
                <select style={fieldStyle} value={filters.agreement_status} onChange={(e) => setFilters((v) => ({ ...v, agreement_status: e.target.value }))}>
                  <option value="">{t('adminFranchiseAllAgreements')}</option>
                  {AGREEMENT_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => loadApplications()} style={{ border: 'none', borderRadius: 14, background: 'rgba(59, 130, 246, 0.16)', color: '#bfdbfe', padding: '11px 14px', fontWeight: 700, cursor: 'pointer' }}>
                {t('adminFranchiseApplyFilters')}
              </button>
            </div>

            <div style={{ display: 'grid', gap: 12, maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
              {loading ? (
                <div style={{ color: '#94a3b8' }}>{t('adminFranchiseLoadingPipeline')}</div>
              ) : applications.length ? (
                applications.map((item) => (
                  <FranchiseRow key={item.id} item={item} isActive={item.id === selectedId} onClick={() => { setSelectedId(item.id); loadDetail(item.id); }} />
                ))
              ) : (
                <div style={{ ...panel, padding: 20, textAlign: 'center', color: '#94a3b8' }}>
                  {t('adminFranchiseNoMatches')}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 18 }}>
            {!selectedApplication ? (
              <div style={{ ...panel, padding: 36, textAlign: 'center', color: '#94a3b8' }}>
                {t('adminFranchiseSelectPrompt')}
              </div>
            ) : detailLoading || !editForm || !agreementForm ? (
              <div style={{ ...panel, padding: 36, color: '#94a3b8' }}>{t('adminFranchiseLoadingWorkspace')}</div>
            ) : (
              <>
                <section style={{ ...panel, padding: 24, display: 'grid', gap: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ padding: '6px 11px', borderRadius: 999, background: 'rgba(249, 115, 22, 0.14)', color: '#fdba74', fontSize: '0.78rem', fontWeight: 700 }}>{formatLabel(selectedApplication.status, t)}</span>
                        <span style={{ padding: '6px 11px', borderRadius: 999, background: 'rgba(16, 185, 129, 0.14)', color: '#86efac', fontSize: '0.78rem', fontWeight: 700 }}>{t('adminFranchiseAgreementBadge', { status: formatLabel(selectedApplication.agreement_status, t) })}</span>
                        <span style={{ padding: '6px 11px', borderRadius: 999, background: 'rgba(59, 130, 246, 0.16)', color: '#bfdbfe', fontSize: '0.78rem', fontWeight: 700 }}>{selectedApplication.desired_country}{selectedApplication.desired_region ? ` · ${selectedApplication.desired_region}` : ''}</span>
                      </div>
                      <h2 style={{ margin: 0, fontSize: '2rem', color: '#f8fafc' }}>
                        {selectedApplication.desired_brand_name || selectedApplication.current_company_name || `${selectedApplication.first_name} ${selectedApplication.last_name}`}
                      </h2>
                      <div style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
                        {selectedApplication.first_name} {selectedApplication.last_name} · {selectedApplication.email}{selectedApplication.phone ? ` · ${selectedApplication.phone}` : ''}
                      </div>
                    </div>

                    <div style={{ ...panel, padding: 16, borderRadius: 18, minWidth: 240 }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('adminFranchiseLaunchProgress')}</div>
                      <div style={{ marginTop: 6, fontSize: '1.9rem', fontWeight: 700 }}>{selectedApplication.checklist_total ? Math.round((selectedApplication.checklist_completed / selectedApplication.checklist_total) * 100) : 0}%</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.88rem', marginTop: 4 }}>
                        {t('adminFranchiseStepsComplete', { completed: selectedApplication.checklist_completed, total: selectedApplication.checklist_total })}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                    <MetricCard icon={MapPin} label={t('adminFranchiseTerritory')} value={selectedApplication.desired_city || selectedApplication.desired_region || selectedApplication.desired_country} sublabel={selectedApplication.territory_summary || t('adminFranchiseTerritoryFallback')} accent="rgba(59, 130, 246, 0.18)" />
                    <MetricCard icon={DollarSign} label={t('adminFranchiseCapital')} value={selectedApplication.available_capital_cents ? money.format(selectedApplication.available_capital_cents / 100) : t('adminFranchiseTbd')} sublabel={selectedApplication.liquid_capital_cents ? t('adminFranchiseLiquidAmount', { amount: money.format(selectedApplication.liquid_capital_cents / 100) }) : t('adminFranchiseLiquidityMissing')} accent="rgba(16, 185, 129, 0.18)" />
                    <MetricCard icon={Users} label={t('adminFranchiseOwner')} value={selectedApplication.owner_email || t('adminFranchiseUnassigned')} sublabel={selectedApplication.owner_user_id ? t('adminFranchiseOwnerLinked') : t('adminFranchiseAssignOwner')} accent="rgba(168, 85, 247, 0.18)" />
                    <MetricCard icon={Building2} label={t('adminFranchiseStoreLink')} value={selectedApplication.linked_business_name || t('adminFranchiseNotLaunched')} sublabel={selectedApplication.linked_business_id ? t('adminFranchiseBusinessRef', { id: selectedApplication.linked_business_id }) : t('adminFranchiseNoStore')} accent="rgba(249, 115, 22, 0.18)" />
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: 18 }}>
                  <div style={{ ...panel, padding: 22, display: 'grid', gap: 14 }}>
                    <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseHqReview')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                      <select style={fieldStyle} value={editForm.status} onChange={(e) => setEditForm((v) => ({ ...v, status: e.target.value }))}>
                        {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                      </select>
                      <input style={fieldStyle} placeholder={t('adminFranchiseOwnerUuid')} value={editForm.owner_user_id} onChange={(e) => setEditForm((v) => ({ ...v, owner_user_id: e.target.value }))} />
                      <select style={fieldStyle} value={editForm.training_status} onChange={(e) => setEditForm((v) => ({ ...v, training_status: e.target.value }))}>
                        {TRAINING_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                      </select>
                      <select style={fieldStyle} value={editForm.launch_readiness_status} onChange={(e) => setEditForm((v) => ({ ...v, launch_readiness_status: e.target.value }))}>
                        {READINESS_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                      </select>
                      <input style={fieldStyle} placeholder={t('adminFranchiseCountry')} value={editForm.desired_country} onChange={(e) => setEditForm((v) => ({ ...v, desired_country: e.target.value.toUpperCase() }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseRegion')} value={editForm.desired_region} onChange={(e) => setEditForm((v) => ({ ...v, desired_region: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseCity')} value={editForm.desired_city} onChange={(e) => setEditForm((v) => ({ ...v, desired_city: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchisePreferredStoreCount')} value={editForm.preferred_store_count} onChange={(e) => setEditForm((v) => ({ ...v, preferred_store_count: e.target.value }))} />
                      <input style={{ ...fieldStyle, gridColumn: '1 / -1' }} placeholder={t('adminFranchiseDesiredBrandName')} value={editForm.desired_brand_name} onChange={(e) => setEditForm((v) => ({ ...v, desired_brand_name: e.target.value }))} />
                      <input style={{ ...fieldStyle, gridColumn: '1 / -1' }} placeholder={t('adminFranchiseCurrentCompanyName')} value={editForm.current_company_name} onChange={(e) => setEditForm((v) => ({ ...v, current_company_name: e.target.value }))} />
                    </div>
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseTerritorySummary')} value={editForm.territory_summary} onChange={(e) => setEditForm((v) => ({ ...v, territory_summary: e.target.value }))} />
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseMarketAssessment')} value={editForm.market_assessment} onChange={(e) => setEditForm((v) => ({ ...v, market_assessment: e.target.value }))} />
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseHqRecommendation')} value={editForm.hq_recommendation} onChange={(e) => setEditForm((v) => ({ ...v, hq_recommendation: e.target.value }))} />
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseRiskNotes')} value={editForm.risk_notes} onChange={(e) => setEditForm((v) => ({ ...v, risk_notes: e.target.value }))} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.86rem' }}>
                        {t('adminFranchiseLastContact', { value: selectedApplication.last_contacted_at ? new Date(selectedApplication.last_contacted_at).toLocaleString() : t('adminFranchiseNotRecorded') })}
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" onClick={() => setEditForm((v) => ({ ...v, touch_contacted_at: true }))} style={{ border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 14, background: 'transparent', color: '#cbd5e1', padding: '10px 14px', cursor: 'pointer' }}>{t('adminFranchiseMarkContacted')}</button>
                        <button type="button" disabled={saving} onClick={saveApplication} style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #2563eb, #14b8a6)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>{t('adminFranchiseSaveReview')}</button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 18 }}>
                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseAgreementPackage')}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                        <select style={fieldStyle} value={agreementForm.application_agreement_status} onChange={(e) => setAgreementForm((v) => ({ ...v, application_agreement_status: e.target.value }))}>
                          {AGREEMENT_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                        </select>
                        <input style={fieldStyle} placeholder={t('adminFranchiseAgreementVersion')} value={agreementForm.agreement_version} onChange={(e) => setAgreementForm((v) => ({ ...v, agreement_version: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseInitialFee')} value={agreementForm.initial_fee} onChange={(e) => setAgreementForm((v) => ({ ...v, initial_fee: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseRoyalty')} value={agreementForm.royalty_bps} onChange={(e) => setAgreementForm((v) => ({ ...v, royalty_bps: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseMarketingFee')} value={agreementForm.marketing_fee_bps} onChange={(e) => setAgreementForm((v) => ({ ...v, marketing_fee_bps: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseTermYears')} value={agreementForm.term_years} onChange={(e) => setAgreementForm((v) => ({ ...v, term_years: e.target.value }))} />
                        <input style={{ ...fieldStyle, gridColumn: '1 / -1' }} placeholder={t('adminFranchiseAgreementUrl')} value={agreementForm.document_url} onChange={(e) => setAgreementForm((v) => ({ ...v, document_url: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseSignedByName')} value={agreementForm.signed_by_name} onChange={(e) => setAgreementForm((v) => ({ ...v, signed_by_name: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseSignedByEmail')} value={agreementForm.signed_by_email} onChange={(e) => setAgreementForm((v) => ({ ...v, signed_by_email: e.target.value }))} />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={agreementForm.territory_exclusive} onChange={(e) => setAgreementForm((v) => ({ ...v, territory_exclusive: e.target.checked }))} />
                        {t('adminFranchiseExclusiveTerritory')}
                      </label>
                      <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseAgreementNotes')} value={agreementForm.notes} onChange={(e) => setAgreementForm((v) => ({ ...v, notes: e.target.value }))} />
                      <button type="button" disabled={saving} onClick={saveAgreement} style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>
                        {t('adminFranchiseSaveAgreement')}
                      </button>
                    </div>

                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseActivateStore')}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6 }}>
                        {t('adminFranchiseActivateText')}
                      </div>
                      <input style={fieldStyle} placeholder={t('adminFranchiseBusinessName')} value={activationForm.business_name} onChange={(e) => setActivationForm((v) => ({ ...v, business_name: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseBusinessType')} value={activationForm.business_type} onChange={(e) => setActivationForm((v) => ({ ...v, business_type: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseWebsite')} value={activationForm.website} onChange={(e) => setActivationForm((v) => ({ ...v, website: e.target.value }))} />
                      <textarea style={{ ...fieldStyle, minHeight: 84 }} placeholder={t('adminFranchiseOpeningDescription')} value={activationForm.description} onChange={(e) => setActivationForm((v) => ({ ...v, description: e.target.value }))} />
                      <button
                        type="button"
                        disabled={saving || !selectedApplication.owner_user_id || !!selectedApplication.linked_business_id}
                        onClick={activateStore}
                        style={{ border: 'none', borderRadius: 14, background: selectedApplication.linked_business_id ? 'rgba(34, 197, 94, 0.25)' : 'linear-gradient(135deg, #10b981, #22c55e)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: selectedApplication.linked_business_id ? 'default' : 'pointer' }}
                      >
                        {selectedApplication.linked_business_id ? t('adminFranchiseAlreadyActivated') : t('adminFranchiseActivateButton')}
                      </button>
                      {!selectedApplication.owner_user_id && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#fca5a5', fontSize: '0.86rem' }}>
                          <AlertTriangle size={15} />
                          {t('adminFranchiseAssignOwnerNote')}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div style={{ ...panel, padding: 22, display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseLaunchChecklist')}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.84rem' }}>{t('adminFranchiseItems', { count: selectedBundle.checklist.length })}</div>
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {selectedBundle.checklist.map((item) => (
                        <div key={item.id} style={{ border: '1px solid rgba(148, 163, 184, 0.14)', borderRadius: 18, padding: 14, display: 'grid', gap: 10, background: 'rgba(2, 6, 23, 0.48)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <div>
                              <div style={{ fontWeight: 700, color: '#f8fafc' }}>{item.label}</div>
                              <div style={{ color: '#94a3b8', fontSize: '0.84rem' }}>{item.owner_role || t('adminFranchiseUnassignedOwner')}</div>
                            </div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: item.status === 'completed' ? '#86efac' : '#fcd34d', fontSize: '0.84rem', fontWeight: 700 }}>
                              {item.status === 'completed' ? <CheckCircle2 size={15} /> : <ClipboardList size={15} />}
                              {formatLabel(item.status, t)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {CHECKLIST_OPTIONS.map((status) => (
                              <button
                                key={status}
                                type="button"
                                onClick={() => updateChecklist(item.id, { status })}
                                style={{
                                  border: item.status === status ? '1px solid rgba(249, 115, 22, 0.65)' : '1px solid rgba(148, 163, 184, 0.12)',
                                  borderRadius: 999,
                                  padding: '6px 10px',
                                  background: item.status === status ? 'rgba(249, 115, 22, 0.16)' : 'transparent',
                                  color: '#e5e7eb',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                }}
                              >
                                {formatLabel(status, t)}
                              </button>
                            ))}
                          </div>
                          {item.notes ? <div style={{ color: '#cbd5e1', fontSize: '0.84rem' }}>{item.notes}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 18 }}>
                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseInternalNotes')}</div>
                      <textarea style={{ ...fieldStyle, minHeight: 92 }} placeholder={t('adminFranchiseNotesPlaceholder')} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                      <button type="button" disabled={saving || !noteText.trim()} onClick={addNote} style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>{t('adminFranchiseAddNote')}</button>
                      <div style={{ display: 'grid', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
                        {selectedBundle.notes.length ? selectedBundle.notes.map((note) => (
                          <div key={note.id} style={{ borderRadius: 16, padding: 14, background: 'rgba(2, 6, 23, 0.56)', border: '1px solid rgba(148, 163, 184, 0.12)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, color: '#94a3b8', fontSize: '0.78rem' }}>
                              <span>{note.admin_email || t('adminFranchiseSystem')}</span>
                              <span>{new Date(note.created_at).toLocaleString()}</span>
                            </div>
                            <div style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.55 }}>{note.note_text}</div>
                          </div>
                        )) : (
                          <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{t('adminFranchiseNoNotes')}</div>
                        )}
                      </div>
                    </div>

                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseRecentActivity')}</div>
                      <div style={{ display: 'grid', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
                        {selectedBundle.activity.length ? selectedBundle.activity.map((event) => (
                          <div key={event.id} style={{ borderRadius: 16, padding: 14, background: 'rgba(2, 6, 23, 0.56)', border: '1px solid rgba(148, 163, 184, 0.12)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, color: '#94a3b8', fontSize: '0.78rem' }}>
                              <span>{formatLabel(event.event_type, t)}</span>
                              <span>{new Date(event.created_at).toLocaleString()}</span>
                            </div>
                            <div style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.55 }}>{event.event_summary}</div>
                          </div>
                        )) : (
                          <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{t('adminFranchiseNoActivity')}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
