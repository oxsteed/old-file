import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import axios from '../../api/axios';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  pending: '#FFA500',
  contacted: '#4F46E5',
  scheduled: '#0EA5E9',
  in_progress: '#10B981',
  completed: '#6B7280',
  cancelled: '#EF4444',
  archived: '#9CA3AF',
};

const STATUS_LABELS = {
  pending: 'Pending',
  contacted: 'Contacted',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
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
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function CreateRequestModal({ consultants, onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    business_name: '', service_tier: 'initial', description: '', consultant_id: '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.email) {
      toast.error('First name, last name and email are required');
      return;
    }
    try {
      setSaving(true);
      await axios.post('/consulting/admin/requests/create', form);
      toast.success('Request created successfully');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create request');
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
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>Create Consulting Request</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>First Name *</label>
              <input style={inputStyle} value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} required />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Last Name *</label>
              <input style={inputStyle} value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} required />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email *</label>
            <input type="email" style={inputStyle} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Phone</label>
            <input type="tel" style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Business Name</label>
            <input style={inputStyle} value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Service Tier</label>
            <select style={inputStyle} value={form.service_tier} onChange={e => setForm({ ...form, service_tier: e.target.value })}>
              <option value="initial">Initial ($100)</option>
              <option value="foundation">Foundation</option>
              <option value="implementation">Implementation</option>
              <option value="transformation">Transformation</option>
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Assign Consultant (optional)</label>
            <select style={inputStyle} value={form.consultant_id} onChange={e => setForm({ ...form, consultant_id: e.target.value })}>
              <option value="">-- Unassigned --</option>
              {consultants.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role})</option>
              ))}
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Description / Notes</label>
            <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Creating...' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequestDetailModal({ request, consultants, onClose, onRefresh }) {
  const [status, setStatus] = useState(request.status);
  const [updating, setUpdating] = useState(false);
  const [assigningTo, setAssigningTo] = useState(request.consultant_id || '');
  const [assigning, setAssigning] = useState(false);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  async function updateStatus(newStatus) {
    try {
      setUpdating(true);
      await axios.patch(`/consulting/admin/requests/${request.id}/status`, { status: newStatus });
      setStatus(newStatus);
      toast.success('Status updated');
      onRefresh();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdating(false);
    }
  }

  async function doAssign() {
    try {
      setAssigning(true);
      await axios.post('/consulting/admin/assign', { session_id: request.id, consultant_id: assigningTo });
      toast.success('Consultant assigned');
      onRefresh();
    } catch {
      toast.error('Failed to assign consultant');
    } finally {
      setAssigning(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    try {
      setAddingNote(true);
      await axios.patch(`/consulting/admin/sessions/${request.id}`, { notes: note });
      toast.success('Note saved');
      setNote('');
    } catch {
      toast.error('Failed to save note');
    } finally {
      setAddingNote(false);
    }
  }

  const p = (label, val) => val ? (
    <p style={{ margin: '0.35rem 0' }}><strong>{label}:</strong> {val}</p>
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
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{request.service_tier}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Submitted: {new Date(request.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Contact</h4>
            {p('Email', request.email)}
            {p('Phone', request.phone)}
          </div>
          <div>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Business</h4>
            {p('Business Name', request.business_name)}
            {p('Current Phase', request.current_phase ? `${request.current_phase}/30` : null)}
          </div>
        </div>

        {request.description && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Description</h4>
            <p style={{ margin: 0, background: 'var(--color-bg)', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.9rem', lineHeight: 1.6 }}>{request.description}</p>
          </div>
        )}

        {request.areas_of_help && request.areas_of_help.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Areas of Help</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {request.areas_of_help.map((a, i) => (
                <span key={i} style={{ background: 'var(--color-primary)', color: 'white', padding: '0.2rem 0.65rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                  {a.split('_').join(' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem', marginBottom: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Update Status</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {Object.entries(STATUS_LABELS).map(([s, label]) => (
              <button key={s} disabled={updating || s === status} onClick={() => updateStatus(s)} style={{
                padding: '0.4rem 0.9rem', borderRadius: '8px', border: `2px solid ${STATUS_COLORS[s] || '#6B7280'}`,
                background: s === status ? STATUS_COLORS[s] : 'transparent',
                color: s === status ? 'white' : STATUS_COLORS[s],
                fontWeight: 600, fontSize: '0.8rem', cursor: s === status ? 'default' : 'pointer',
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem', marginBottom: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Assign Consultant</h4>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select style={{ ...inputStyle, flex: 1 }} value={assigningTo} onChange={e => setAssigningTo(e.target.value)}>
              <option value="">-- Unassigned --</option>
              {consultants.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role})</option>
              ))}
            </select>
            <button onClick={doAssign} disabled={assigning || !assigningTo} style={{ padding: '0.6rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {assigning ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Add Internal Note</h4>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder="Private note visible only to admins..."
            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', display: 'block', marginBottom: '0.5rem' }}
          />
          <button onClick={addNote} disabled={addingNote || !note.trim()} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
            {addingNote ? 'Saving...' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConsultingDashboard() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTier, setFilterTier] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [reqRes, consRes, statsRes] = await Promise.all([
        axios.get('/consulting/admin/requests?limit=200'),
        axios.get('/consulting/admin/consultants'),
        axios.get('/consulting/admin/dashboard-stats'),
      ]);
      setRequests(reqRes.data.requests || []);
      setConsultants(consRes.data || []);
      setStats(statsRes.data);
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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

  async function markContacted(req) {
    try {
      await axios.patch(`/consulting/admin/requests/${req.id}/status`, { status: 'contacted' });
      toast.success('Marked as contacted');
      loadData();
    } catch {
      toast.error('Failed to update');
    }
  }

  async function archiveRequest(req) {
    if (!window.confirm(`Archive this request from ${req.first_name} ${req.last_name}?`)) return;
    try {
      await axios.patch(`/consulting/admin/requests/${req.id}/status`, { status: 'archived' });
      toast.success('Request archived');
      loadData();
    } catch {
      toast.error('Failed to archive');
    }
  }

  const inputStyle = { padding: '0.55rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem' };

  if (loading) {
    return (
      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading dashboard...</div>
      </div>
    );
  }

  const totalRevenue = stats?.total_revenue_cents ? `$${(stats.total_revenue_cents / 100).toLocaleString()}` : '$0';
  const conversionRate = stats?.pending_requests && stats?.active_packages
    ? `${Math.round((stats.active_packages / (stats.active_packages + stats.pending_requests)) * 100)}%`
    : 'N/A';

  return (
    <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
      {/* Breadcrumb */}
      <nav style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Admin</Link>
        {' / '}
        <span>Consulting</span>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Consulting Dashboard</h1>
        <button onClick={() => setShowCreate(true)} style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>
          + Create Request
        </button>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        <StatCard label="Pending Requests" value={stats?.pending_requests || 0} color="#FFA500" />
        <StatCard label="Scheduled Sessions" value={stats?.scheduled_sessions || 0} color="#0EA5E9" />
        <StatCard label="Sessions Completed" value={stats?.completed_sessions || 0} color="#10B981" />
        <StatCard label="Active Clients" value={stats?.total_clients || 0} />
        <StatCard label="Total Revenue" value={totalRevenue} color="#10B981" />
        <StatCard label="Avg NPS" value={stats?.avg_nps ? stats.avg_nps.toFixed(1) : 'N/A'} />
        <StatCard label="Cancellation Rate" value={stats?.cancellation_rate ? `${stats.cancellation_rate}%` : 'N/A'} color="#EF4444" />
        <StatCard label="Conversion Rate" value={conversionRate} color="#8B5CF6" sub="Requests to sessions" />
      </div>

      {/* Requests Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Consulting Requests ({filteredRequests.length})</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text" placeholder="Search name or email..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, minWidth: '200px' }}
          />
          <select style={inputStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            {Object.entries(STATUS_LABELS).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
          </select>
          <select style={inputStyle} value={filterTier} onChange={e => setFilterTier(e.target.value)}>
            <option value="">All Tiers</option>
            <option value="initial">Initial ($100)</option>
            <option value="foundation">Foundation</option>
            <option value="implementation">Implementation</option>
            <option value="transformation">Transformation</option>
          </select>
          {(search || filterStatus || filterTier) && (
            <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterTier(''); }} style={{ ...inputStyle, cursor: 'pointer', background: 'none', color: 'var(--color-text-muted)' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
          {requests.length === 0 ? (
            <>
              <p style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No consulting requests yet</p>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>Share your intake form link to start receiving requests, or create one manually above.</p>
              <button onClick={() => setShowCreate(true)} style={{ padding: '0.65rem 1.5rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
                Create First Request
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>No requests match your filters.</p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Service Tier', 'Status', 'Submitted', 'Consultant', 'Actions'].map(h => (
                  <th key={h} style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    {h}
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
                    <span style={{ background: 'var(--color-bg)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>{req.service_tier}</span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}><Badge status={req.status} /></td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>
                    {req.consultant_id ? (
                      <span style={{ color: '#10B981', fontWeight: 600 }}>Assigned</span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button onClick={() => setSelectedRequest(req)} style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                        View
                      </button>
                      {req.status === 'pending' && (
                        <button onClick={() => markContacted(req)} style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid #4F46E5', background: 'none', color: '#4F46E5', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                          Mark Contacted
                        </button>
                      )}
                      <button onClick={() => archiveRequest(req)} style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}>
                        Archive
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
          onRefresh={loadData}
        />
      )}

      {showCreate && (
        <CreateRequestModal
          consultants={consultants}
          onClose={() => setShowCreate(false)}
          onCreated={loadData}
        />
      )}
    </div>
  );
}
