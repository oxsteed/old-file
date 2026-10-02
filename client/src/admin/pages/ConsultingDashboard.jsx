import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';

const STATUS_COLORS = {
  pending: '#FFA500',
  contacted: '#4F46E5',
  scheduled: '#0EA5E9',
  in_progress: '#10B981',
  completed: '#6B7280',
  cancelled: '#EF4444',
  archived: '#9CA3AF',
};

const STATUS_I18N_KEYS = {
  pending: 'status.pending',
  contacted: 'status.contacted',
  scheduled: 'status.scheduled',
  in_progress: 'status.inProgress',
  completed: 'status.completed',
  cancelled: 'status.cancelled',
  archived: 'status.archived',
};

const TIER_I18N_KEYS = {
  initial: 'create.tier.initial',
  foundation: 'create.tier.foundation',
  implementation: 'create.tier.implementation',
  transformation: 'create.tier.transformation',
};

const AREA_I18N_KEYS = {
  legal_setup: 'areas.legalSetup',
  pricing_strategy: 'areas.pricingStrategy',
  branding: 'areas.branding',
  financial_systems: 'areas.financialSystems',
  marketing: 'areas.marketing',
  team_building: 'areas.teamBuilding',
  operational_systems: 'areas.operationalSystems',
  scaling: 'areas.scaling',
  acquisition_preparation: 'areas.acquisitionPreparation',
  exit_strategy: 'areas.exitStrategy',
};

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '10px',
      padding: '1.25rem 1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    }}>
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: color || 'var(--color-primary)' }}>{value}</div>
      {sub && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{sub}</p>}
    </div>
  );
}

function Badge({ status }) {
  const { t } = useTranslation();
  const i18nKey = STATUS_I18N_KEYS[status];
  return (
    <span style={{
      display: 'inline-block',
      background: STATUS_COLORS[status] || '#6B7280',
      color: 'white',
      padding: '0.2rem 0.65rem',
      borderRadius: '12px',
      fontSize: '0.78rem',
      fontWeight: 600,
    }}>
      {i18nKey ? t(`adminConsultingDashboard.${i18nKey}`) : status}
    </span>
  );
}

function CreateRequestModal({ consultants, onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    business_name: '', service_tier: 'initial', description: '', consultant_id: '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.email) {
      toast.error(t('adminConsultingDashboard.create.validationRequired'));
      return;
    }
    try {
      setSaving(true);
      await axios.post('/consulting/admin/requests/create', form);
      toast.success(t('adminConsultingDashboard.create.createdSuccess'));
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminConsultingDashboard.create.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '0.6rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.9rem',
    boxSizing: 'border-box',
  };

  const labelStyle = { display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.85rem' };
  const fieldStyle = { marginBottom: '1rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '10px', padding: '2rem', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>{t('adminConsultingDashboard.create.title')}</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldFirstName')}</label>
              <input style={inputStyle} value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} required />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldLastName')}</label>
              <input style={inputStyle} value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} required />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldEmail')}</label>
            <input type="email" style={inputStyle} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldPhone')}</label>
            <input type="tel" style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldBusinessName')}</label>
            <input style={inputStyle} value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldServiceTier')}</label>
            <select style={inputStyle} value={form.service_tier} onChange={e => setForm({ ...form, service_tier: e.target.value })}>
              <option value="initial">{t('adminConsultingDashboard.create.tier.initial')}</option>
              <option value="foundation">{t('adminConsultingDashboard.create.tier.foundation')}</option>
              <option value="implementation">{t('adminConsultingDashboard.create.tier.implementation')}</option>
              <option value="transformation">{t('adminConsultingDashboard.create.tier.transformation')}</option>
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldAssignConsultant')}</label>
            <select style={inputStyle} value={form.consultant_id} onChange={e => setForm({ ...form, consultant_id: e.target.value })}>
              <option value="">{t('adminConsultingDashboard.create.unassigned')}</option>
              {consultants.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role})</option>
              ))}
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingDashboard.create.fieldDescription')}</label>
            <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>
              {t('adminConsultingDashboard.create.cancel')}
            </button>
            <button type="submit" disabled={saving} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? t('adminConsultingDashboard.create.creating') : t('adminConsultingDashboard.create.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequestDetailModal({ request, consultants, onClose, onRefresh }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(request.status);
  const [updating, setUpdating] = useState(false);
  const [assigningTo, setAssigningTo] = useState(request.consultant_id || '');
  const [assigning, setAssigning] = useState(false);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);

  const statusLabel = (s) => {
    const key = STATUS_I18N_KEYS[s];
    return key ? t(`adminConsultingDashboard.${key}`) : s;
  };
  const tierLabel = (v) => {
    const key = TIER_I18N_KEYS[v];
    return key ? t(`adminConsultingDashboard.${key}`) : v;
  };
  const areaLabel = (a) => {
    const key = AREA_I18N_KEYS[a];
    return key ? t(`adminConsultingDashboard.${key}`) : a.split('_').join(' ');
  };

  async function updateStatus(newStatus) {
    try {
      setUpdating(true);
      await axios.patch(`/consulting/admin/requests/${request.id}/status`, { status: newStatus });
      setStatus(newStatus);
      toast.success(t('adminConsultingDashboard.detail.statusUpdated'));
      onRefresh();
    } catch (err) {
      // Rethrow so the ConfirmDialog stays open and shows the failure instead
      // of closing as if the status change succeeded.
      toast.error(t('adminConsultingDashboard.detail.statusUpdateFailed'));
      throw err;
    } finally {
      setUpdating(false);
    }
  }

  async function doAssign() {
    try {
      setAssigning(true);
      await axios.post('/consulting/admin/assign', { session_id: request.id, consultant_id: assigningTo });
      toast.success(t('adminConsultingDashboard.detail.consultantAssigned'));
      onRefresh();
    } catch {
      toast.error(t('adminConsultingDashboard.detail.consultantAssignFailed'));
    } finally {
      setAssigning(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    try {
      setAddingNote(true);
      await axios.patch(`/consulting/admin/sessions/${request.id}`, { notes: note });
      toast.success(t('adminConsultingDashboard.detail.noteSaved'));
      setNote('');
    } catch {
      toast.error(t('adminConsultingDashboard.detail.noteSaveFailed'));
    } finally {
      setAddingNote(false);
    }
  }

  const p = (key, val) => val ? (
    <p style={{ margin: '0.35rem 0' }}><strong>{t(`adminConsultingDashboard.detail.${key}`)}:</strong> {val}</p>
  ) : null;

  const inputStyle = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '10px', padding: '2rem', maxWidth: '680px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.4rem', fontWeight: 700 }}>{request.first_name} {request.last_name}</h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge status={status} />
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{tierLabel(request.service_tier)}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{t('adminConsultingDashboard.detail.submitted', { date: new Date(request.created_at).toLocaleDateString() })}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.sectionContact')}</h4>
            {p('email', request.email)}
            {p('phone', request.phone)}
          </div>
          <div>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.sectionBusiness')}</h4>
            {p('businessName', request.business_name)}
            {p('currentPhase', request.current_phase ? `${request.current_phase}/30` : null)}
          </div>
        </div>

        {request.description && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.sectionDescription')}</h4>
            <p style={{ margin: 0, background: 'var(--color-bg)', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.9rem', lineHeight: 1.6 }}>{request.description}</p>
          </div>
        )}

        {request.areas_of_help && request.areas_of_help.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.sectionAreasOfHelp')}</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {request.areas_of_help.map((a, i) => (
                <span key={i} style={{ background: 'var(--color-primary)', color: 'white', padding: '0.2rem 0.65rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                  {areaLabel(a)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem', marginBottom: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.updateStatus')}</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {Object.entries(STATUS_I18N_KEYS).map(([s, key]) => (
              <button key={s} disabled={updating || s === status} onClick={() => setPendingStatus(s)} style={{
                padding: '0.4rem 0.9rem', borderRadius: '8px', border: `2px solid ${STATUS_COLORS[s] || '#6B7280'}`,
                background: s === status ? STATUS_COLORS[s] : 'transparent',
                color: s === status ? 'white' : STATUS_COLORS[s],
                fontWeight: 600, fontSize: '0.8rem', cursor: s === status ? 'default' : 'pointer',
              }}>{t(`adminConsultingDashboard.${key}`)}</button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem', marginBottom: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.assignConsultant')}</h4>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select style={{ ...inputStyle, flex: 1 }} value={assigningTo} onChange={e => setAssigningTo(e.target.value)}>
              <option value="">{t('adminConsultingDashboard.create.unassigned')}</option>
              {consultants.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role})</option>
              ))}
            </select>
            <button onClick={doAssign} disabled={assigning || !assigningTo} style={{ padding: '0.6rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {assigning ? t('adminConsultingDashboard.detail.assigning') : t('adminConsultingDashboard.detail.assign')}
            </button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.detail.addNote')}</h4>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder={t('adminConsultingDashboard.detail.notePlaceholder')}
            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', display: 'block', marginBottom: '0.5rem' }}
          />
          <button onClick={addNote} disabled={addingNote || !note.trim()} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
            {addingNote ? t('adminConsultingDashboard.detail.saving') : t('adminConsultingDashboard.detail.saveNote')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingStatus}
        title={t('adminConsultingDashboard.detail.updateStatus')}
        message={pendingStatus ? t('adminConsultingDashboard.detail.confirmStatusMessage', { status: statusLabel(pendingStatus) }) : ''}
        onConfirm={async () => { await updateStatus(pendingStatus); }}
        onClose={() => setPendingStatus(null)}
      />
    </div>
  );
}

export default function ConsultingDashboard() {
  const { t } = useTranslation();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTier, setFilterTier] = useState('');
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [contactTarget, setContactTarget] = useState(null);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const [reqRes, consRes, statsRes] = await Promise.all([
      axios.get('/consulting/admin/requests?limit=200', { signal }),
      axios.get('/consulting/admin/consultants', { signal }),
      axios.get('/consulting/admin/dashboard-stats', { signal }),
    ]);
    return {
      requests: reqRes.data.requests || [],
      consultants: consRes.data || [],
      stats: statsRes.data,
    };
  }, []);

  const requests = data?.requests ?? [];
  const consultants = data?.consultants ?? [];
  const stats = data?.stats ?? null;

  const filteredRequests = requests.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterTier && r.service_tier !== filterTier) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${r.first_name} ${r.last_name}`.toLowerCase();
      if (!name.includes(q) && !r.email?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Mark Contacted goes through a confirmation dialog; ConfirmDialog keeps
  // itself open and shows the error if the PATCH fails.
  async function confirmMarkContacted() {
    if (!contactTarget) return;
    await axios.patch(`/consulting/admin/requests/${contactTarget.id}/status`, { status: 'contacted' });
    toast.success(t('adminConsultingDashboard.toast.contacted'));
    reload();
  }

  // Archive goes through a confirmation dialog; ConfirmDialog keeps itself
  // open and shows the error if the PATCH fails.
  async function confirmArchive() {
    if (!archiveTarget) return;
    await axios.patch(`/consulting/admin/requests/${archiveTarget.id}/status`, { status: 'archived' });
    toast.success(t('adminConsultingDashboard.toast.archived'));
    reload();
  }

  const inputStyle = { padding: '0.55rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem' };

  const tierLabel = (v) => {
    const key = TIER_I18N_KEYS[v];
    return key ? t(`adminConsultingDashboard.${key}`) : v;
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
        <div style={{ color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
        <AdminErrorState onRetry={reload} />
      </div>
    );
  }

  const totalRevenue = stats?.total_revenue_cents ? `$${(stats.total_revenue_cents / 100).toLocaleString()}` : '$0';
  const conversionDenominator = (stats?.active_packages || 0) + (stats?.pending_requests || 0);
  const conversionRate = conversionDenominator > 0
    ? `${Math.round(((stats.active_packages || 0) / conversionDenominator) * 100)}%`
    : 'N/A';

  return (
    <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
      {/* Breadcrumb */}
      <nav style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{t('adminConsultingDashboard.breadcrumb.admin')}</Link>
        {' / '}
        <span>{t('adminConsultingDashboard.breadcrumb.here')}</span>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>{t('adminConsultingDashboard.title')}</h1>
        <button onClick={() => setShowCreate(true)} style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>
          + {t('adminConsultingDashboard.create.submit')}
        </button>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        <StatCard label={t('adminConsultingDashboard.stats.pendingRequests')} value={stats?.pending_requests || 0} color="#FFA500" />
        <StatCard label={t('adminConsultingDashboard.stats.scheduledSessions')} value={stats?.scheduled_sessions || 0} color="#0EA5E9" />
        <StatCard label={t('adminConsultingDashboard.stats.sessionsCompleted')} value={stats?.completed_sessions || 0} color="#10B981" />
        <StatCard label={t('adminConsultingDashboard.stats.activeClients')} value={stats?.total_clients || 0} />
        <StatCard label={t('adminConsultingDashboard.stats.totalRevenue')} value={totalRevenue} color="#10B981" />
        <StatCard label={t('adminConsultingDashboard.stats.avgNps')} value={stats?.avg_nps ? stats.avg_nps.toFixed(1) : 'N/A'} />
        <StatCard label={t('adminConsultingDashboard.stats.cancellationRate')} value={stats?.cancellation_rate ? `${stats.cancellation_rate}%` : 'N/A'} color="#EF4444" />
        <StatCard label={t('adminConsultingDashboard.stats.conversionRate')} value={conversionRate} color="#8B5CF6" sub={t('adminConsultingDashboard.stats.conversionSub')} />
      </div>

      {/* Requests Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>{t('adminConsultingDashboard.requestsTitle', { count: filteredRequests.length })}</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text" placeholder={t('adminConsultingDashboard.filters.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, minWidth: '200px' }}
          />
          <select style={inputStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{t('adminConsultingDashboard.filters.allStatus')}</option>
            {Object.entries(STATUS_I18N_KEYS).map(([s, key]) => <option key={s} value={s}>{t(`adminConsultingDashboard.${key}`)}</option>)}
          </select>
          <select style={inputStyle} value={filterTier} onChange={e => setFilterTier(e.target.value)}>
            <option value="">{t('adminConsultingDashboard.filters.allTiers')}</option>
            <option value="initial">{t('adminConsultingDashboard.create.tier.initial')}</option>
            <option value="foundation">{t('adminConsultingDashboard.create.tier.foundation')}</option>
            <option value="implementation">{t('adminConsultingDashboard.create.tier.implementation')}</option>
            <option value="transformation">{t('adminConsultingDashboard.create.tier.transformation')}</option>
          </select>
          {(search || filterStatus || filterTier) && (
            <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterTier(''); }} style={{ ...inputStyle, cursor: 'pointer', background: 'none', color: 'var(--color-text-muted)' }}>
              {t('adminConsultingDashboard.filters.clear')}
            </button>
          )}
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
          {requests.length === 0 ? (
            <>
              <p style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('adminConsultingDashboard.empty.title')}</p>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>{t('adminConsultingDashboard.empty.subtitle')}</p>
              <button onClick={() => setShowCreate(true)} style={{ padding: '0.65rem 1.5rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
                {t('adminConsultingDashboard.empty.createFirst')}
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.empty.noMatch')}</p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden' }}>
            <thead>
              <tr>
                {['table.name', 'table.email', 'table.serviceTier', 'table.status', 'table.submitted', 'table.consultant', 'table.actions'].map(key => (
                  <th key={key} style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    {t(`adminConsultingDashboard.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map(req => (
                <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.85rem 1rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{req.first_name} {req.last_name}</td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.9rem' }}>{req.email}</td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span style={{ background: 'var(--color-bg)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>{tierLabel(req.service_tier)}</span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}><Badge status={req.status} /></td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>
                    {req.consultant_id ? (
                      <span style={{ color: '#10B981', fontWeight: 600 }}>{t('adminConsultingDashboard.table.assigned')}</span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>{t('adminConsultingDashboard.table.unassigned')}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button onClick={() => setSelectedRequest(req)} style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                        {t('adminConsultingDashboard.row.view')}
                      </button>
                      {req.status === 'pending' && (
                        <button onClick={() => setContactTarget(req)} style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid #4F46E5', background: 'none', color: '#4F46E5', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                          {t('adminConsultingDashboard.row.markContacted')}
                        </button>
                      )}
                      <button onClick={() => setArchiveTarget(req)} style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}>
                        {t('adminConsultingDashboard.row.archive')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          consultants={consultants}
          onClose={() => setSelectedRequest(null)}
          onRefresh={reload}
        />
      )}

      {showCreate && (
        <CreateRequestModal
          consultants={consultants}
          onClose={() => setShowCreate(false)}
          onCreated={reload}
        />
      )}

      <ConfirmDialog
        open={!!contactTarget}
        title={t('adminConsultingDashboard.dialog.markContactedTitle')}
        message={contactTarget ? t('adminConsultingDashboard.dialog.markContactedMessage', { firstName: contactTarget.first_name, lastName: contactTarget.last_name }) : ''}
        onConfirm={confirmMarkContacted}
        onClose={() => setContactTarget(null)}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        danger
        title={t('adminConsultingDashboard.dialog.archiveTitle')}
        message={archiveTarget ? t('adminConsultingDashboard.dialog.archiveMessage', { firstName: archiveTarget.first_name, lastName: archiveTarget.last_name }) : ''}
        onConfirm={confirmArchive}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  );
}
