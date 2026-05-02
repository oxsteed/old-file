import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import ConsultingSessionDetail from './ConsultingSessionDetail';

const STATUS_COLORS = {
  pending: '#FFA500',
  scheduled: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
  no_show: '#DC2626',
};

const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00',
];

function StatusBadge({ status }) {
  const labels = { pending: 'Pending', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No Show' };
  return (
    <span style={{ display: 'inline-block', background: STATUS_COLORS[status] || '#6B7280', color: 'white', padding: '0.2rem 0.65rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>
      {labels[status] || status}
    </span>
  );
}

function AreasOfHelpCell({ areas }) {
  const [showAll, setShowAll] = useState(false);
  if (!areas || areas.length === 0) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>None</span>;

  const visible = showAll ? areas : areas.slice(0, 2);
  const hidden = areas.length - 2;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', maxWidth: '200px' }}>
      {visible.map((area, idx) => (
        <span key={idx} title={area} style={{ fontSize: '0.72rem', background: 'var(--color-primary)', color: 'white', padding: '0.15rem 0.45rem', borderRadius: '4px', whiteSpace: 'nowrap', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {area.split('_').join(' ')}
        </span>
      ))}
      {!showAll && hidden > 0 && (
        <button onClick={() => setShowAll(true)} style={{ fontSize: '0.72rem', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.15rem 0.3rem', fontWeight: 600 }}>
          +{hidden} more
        </button>
      )}
    </div>
  );
}

function NewSessionModal({ consultants, onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    business_name: '', service_tier: 'initial', description: '',
    areas_of_help: [], consultant_id: '',
    scheduled_date: '', scheduled_time: '', meeting_url: '',
  });
  const [saving, setSaving] = useState(false);

  const AREAS = ['legal_setup', 'pricing_strategy', 'branding', 'financial_systems', 'marketing', 'team_building', 'operational_systems', 'scaling', 'acquisition_preparation', 'exit_strategy'];

  function toggleArea(area) {
    setForm(f => ({
      ...f,
      areas_of_help: f.areas_of_help.includes(area)
        ? f.areas_of_help.filter(a => a !== area)
        : [...f.areas_of_help, area],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.email || !form.service_tier) {
      toast.error('Email and service tier are required');
      return;
    }
    try {
      setSaving(true);
      const payload = { ...form };
      if (form.scheduled_date && form.scheduled_time) {
        payload.scheduled_at = new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString();
        payload.status = 'scheduled';
      }
      await axios.post('/consulting/admin/sessions/create', payload);
      toast.success('Session created');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create session');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.85rem' };
  const fieldStyle = { marginBottom: '1rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '10px', padding: '2rem', maxWidth: '600px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>New Consulting Session</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>First Name</label>
              <input style={inputStyle} value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Last Name</label>
              <input style={inputStyle} value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email *</label>
            <input type="email" style={inputStyle} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Phone</label>
              <input type="tel" style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Business Name</label>
              <input style={inputStyle} value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Service Tier *</label>
            <select style={inputStyle} value={form.service_tier} onChange={e => setForm({ ...form, service_tier: e.target.value })} required>
              <option value="initial">Initial ($100)</option>
              <option value="foundation">Foundation</option>
              <option value="implementation">Implementation</option>
              <option value="transformation">Transformation</option>
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Assign Consultant</label>
            <select style={inputStyle} value={form.consultant_id} onChange={e => setForm({ ...form, consultant_id: e.target.value })}>
              <option value="">-- Unassigned --</option>
              {consultants.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role})</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Session Date</label>
              <input type="date" style={inputStyle} value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Session Time</label>
              <select style={inputStyle} value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })}>
                <option value="">-- Not set --</option>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Meeting URL</label>
            <input type="url" placeholder="https://zoom.us/j/..." style={inputStyle} value={form.meeting_url} onChange={e => setForm({ ...form, meeting_url: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Areas of Focus</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {AREAS.map(a => (
                <button key={a} type="button" onClick={() => toggleArea(a)} style={{
                  padding: '0.3rem 0.7rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  border: `2px solid ${form.areas_of_help.includes(a) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: form.areas_of_help.includes(a) ? 'var(--color-primary)' : 'transparent',
                  color: form.areas_of_help.includes(a) ? 'white' : 'var(--color-text)',
                }}>
                  {a.split('_').join(' ')}
                </button>
              ))}
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Description / Notes</label>
            <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ConsultingSessionsAdmin() {
  const [sessions, setSessions] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', service_tier: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page, limit: 20 });
      if (filters.status) params.set('status', filters.status);
      if (filters.service_tier) params.set('service_tier', filters.service_tier);
      if (search) params.set('search', search);

      const [sesRes, consRes] = await Promise.all([
        axios.get(`/consulting/admin/sessions?${params}`),
        axios.get('/consulting/admin/consultants'),
      ]);
      setSessions(sesRes.data.data || []);
      setPagination(sesRes.data.pagination || {});
      setConsultants(consRes.data || []);
    } catch {
      toast.error('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [filters, page, search]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function markComplete(session) {
    if (!window.confirm(`Mark session with ${session.first_name} ${session.last_name} as completed?`)) return;
    try {
      await axios.patch(`/consulting/admin/sessions/${session.id}/complete`);
      toast.success('Session marked as completed');
      loadSessions();
    } catch {
      toast.error('Failed to mark complete');
    }
  }

  async function cancelSession(session) {
    if (!window.confirm(`Cancel session with ${session.first_name} ${session.last_name}?`)) return;
    try {
      await axios.patch(`/consulting/admin/sessions/${session.id}`, { status: 'cancelled' });
      toast.success('Session cancelled');
      loadSessions();
    } catch {
      toast.error('Failed to cancel session');
    }
  }

  async function sendFollowUp(session) {
    try {
      await axios.post(`/consulting/admin/sessions/${session.id}/send-followup`);
      toast.success('Follow-up email sent');
    } catch {
      toast.error('Failed to send follow-up');
    }
  }

  function exportCSV() {
    const headers = ['Name', 'Email', 'Service Tier', 'Status', 'Areas of Help', 'Submitted', 'Scheduled'];
    const rows = sessions.map(s => [
      `${s.first_name} ${s.last_name}`,
      s.email,
      s.service_tier,
      s.status,
      (s.areas_of_help || []).join('; '),
      s.created_at ? new Date(s.created_at).toLocaleDateString() : '',
      s.scheduled_at ? new Date(s.scheduled_at).toLocaleString() : '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consulting-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const inputStyle = { padding: '0.55rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem' };
  const btnStyle = { padding: '0.55rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2rem' }}>
      {/* Breadcrumb */}
      <nav style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Admin</Link>
        {' / '}
        <Link to="/admin/consulting" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Consulting</Link>
        {' / '}
        <span>Sessions</span>
      </nav>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700 }}>Consulting Sessions</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {pagination.total || 0} total sessions
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={exportCSV} style={{ ...btnStyle, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            Export CSV
          </button>
          <button onClick={() => setShowNewSession(true)} style={btnStyle}>
            + New Session
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search by name or email..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ ...inputStyle, minWidth: '220px' }}
        />
        <select style={inputStyle} value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No Show</option>
        </select>
        <select style={inputStyle} value={filters.service_tier} onChange={e => { setFilters(f => ({ ...f, service_tier: e.target.value })); setPage(1); }}>
          <option value="">All Tiers</option>
          <option value="initial">Initial ($100)</option>
          <option value="foundation">Foundation</option>
          <option value="implementation">Implementation</option>
          <option value="transformation">Transformation</option>
        </select>
        {(search || filters.status || filters.service_tier) && (
          <button onClick={() => { setSearch(''); setFilters({ status: '', service_tier: '' }); setPage(1); }} style={{ ...inputStyle, background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {loading && page === 1 ? (
        <div style={{ color: 'var(--color-text-muted)' }}>Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
          {pagination.total === 0 || (!filters.status && !filters.service_tier && !search) ? (
            <>
              <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No consulting sessions yet</p>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>Create a new session or clients can submit consulting requests from the intake form.</p>
              <button onClick={() => setShowNewSession(true)} style={btnStyle}>+ New Session</button>
            </>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>No sessions match your filters.</p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <thead>
              <tr>
                {['Client', 'Email', 'Service Tier', 'Status', 'Consultant', 'Scheduled', 'Areas of Help', 'Submitted', 'Actions'].map(h => (
                  <th key={h} style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => (
                <tr key={session.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <button onClick={() => setSelectedSession(session)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.9rem', textAlign: 'left' }}>
                      {session.first_name} {session.last_name}
                    </button>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{session.email}</td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span style={{ background: '#8B5CF6', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>{session.service_tier}</span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}><StatusBadge status={session.status} /></td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem', color: session.consultant_assigned_id ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {session.consultant_name || (session.consultant_assigned_id ? 'Assigned' : 'Unassigned')}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                    {session.scheduled_at ? new Date(session.scheduled_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <AreasOfHelpCell areas={session.areas_of_help} />
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                    {session.created_at ? new Date(session.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <button onClick={() => setSelectedSession(session)} style={{ padding: '0.3rem 0.55rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        View
                      </button>
                      {session.status === 'scheduled' && (
                        <button onClick={() => markComplete(session)} style={{ padding: '0.3rem 0.55rem', borderRadius: '5px', border: '1px solid #10B981', background: 'none', color: '#10B981', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          Complete
                        </button>
                      )}
                      {session.status === 'completed' && (
                        <button onClick={() => sendFollowUp(session)} style={{ padding: '0.3rem 0.55rem', borderRadius: '5px', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Follow-up
                        </button>
                      )}
                      {(session.status === 'pending' || session.status === 'scheduled') && (
                        <button onClick={() => cancelSession(session)} style={{ padding: '0.3rem 0.55rem', borderRadius: '5px', border: '1px solid #EF4444', background: 'none', color: '#EF4444', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem', alignItems: 'center' }}>
          <button style={btnStyle} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
          <span style={{ padding: '0.5rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Page {page} of {pagination.pages}
          </span>
          <button style={btnStyle} disabled={page === pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {selectedSession && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <ConsultingSessionDetail
            session={selectedSession}
            onClose={() => setSelectedSession(null)}
            onStatusUpdate={() => { loadSessions(); setSelectedSession(null); }}
          />
        </div>
      )}

      {showNewSession && (
        <NewSessionModal
          consultants={consultants}
          onClose={() => setShowNewSession(false)}
          onCreated={loadSessions}
        />
      )}
    </div>
  );
}
