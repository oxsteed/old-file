import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import BusinessLaunchRequestDetail from './BusinessLaunchRequestDetail';

const STATUS_COLORS = {
  pending: '#FFA500',
  contacted: '#4F46E5',
  kickoff_scheduled: '#8B5CF6',
  in_progress: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
  archived: '#9CA3AF',
};

const STATUS_PIPELINE = [
  { key: 'pending', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'kickoff_scheduled', label: 'Session Scheduled' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const URGENCY_LABELS = {
  exploring: 'Just Exploring',
  two_weeks: '2 Weeks',
  one_month: '1 Month',
  asap: 'ASAP',
};

const URGENT_COLORS = {
  exploring: '#6B7280',
  two_weeks: '#F59E0B',
  one_month: '#F97316',
  asap: '#DC2626',
};

function Badge({ color, children }) {
  return (
    <span style={{ display: 'inline-block', background: color || '#6B7280', color: 'white', padding: '0.2rem 0.65rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  const label = status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return <Badge color={STATUS_COLORS[status]}>{label}</Badge>;
}

function UrgencyBadge({ urgency }) {
  return <Badge color={URGENT_COLORS[urgency] || '#6B7280'}>{URGENCY_LABELS[urgency] || urgency}</Badge>;
}

function QuickStatusMenu({ request, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function update(newStatus) {
    setOpen(false);
    try {
      setLoading(true);
      await axios.patch(`/consulting/business-launch/requests/${request.id}`, { status: newStatus });
      toast.success('Status updated');
      onUpdated();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--color-text)' }}
      >
        Status ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', minWidth: '160px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          {STATUS_PIPELINE.map(s => (
            <button key={s.key} onClick={() => update(s.key)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: STATUS_COLORS[s.key], fontWeight: request.status === s.key ? 700 : 400 }}>
              {request.status === s.key ? '✓ ' : ''}{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BusinessLaunchAdmin() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', package: '', urgency: '', state: '', country: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page, limit: 20 });
      if (filters.status) params.set('status', filters.status);
      if (filters.package) params.set('package', filters.package);
      if (filters.urgency) params.set('urgency', filters.urgency);
      if (filters.state) params.set('state', filters.state);
      if (filters.country) params.set('country', filters.country);
      if (search) params.set('search', search);

      const res = await axios.get(`/consulting/business-launch/requests?${params}`);
      setRequests(res.data.data || []);
      setPagination(res.data.pagination || {});
    } catch {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [filters, page, search]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  function exportCSV() {
    const headers = ['Name', 'Email', 'Phone', 'Package', 'Country', 'State', 'Urgency', 'Status', 'Submitted'];
    const rows = requests.map(r => [
      `${r.first_name} ${r.last_name}`,
      r.email,
      r.phone || '',
      r.package_selected || '',
      r.operating_country || '',
      r.operating_state || '',
      URGENCY_LABELS[r.urgency] || r.urgency || '',
      r.status,
      r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-launch-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function archiveRequest(req) {
    if (!window.confirm(`Archive request from ${req.first_name} ${req.last_name}? This will hide it from default views.`)) return;
    try {
      await axios.patch(`/consulting/business-launch/requests/${req.id}`, { status: 'archived' });
      toast.success('Request archived');
      loadRequests();
    } catch {
      toast.error('Failed to archive');
    }
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
        <span>Business Launch</span>
      </nav>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700 }}>Business Launch Program</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {pagination.total || 0} total requests
          </p>
        </div>
        <button onClick={exportCSV} style={{ ...btnStyle, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          Export CSV
        </button>
      </div>

      {/* Status Pipeline */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        {STATUS_PIPELINE.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={() => { setFilters(f => ({ ...f, status: f.status === s.key ? '' : s.key })); setPage(1); }}
              style={{ padding: '0.4rem 0.85rem', borderRadius: '20px', border: `2px solid ${STATUS_COLORS[s.key]}`, background: filters.status === s.key ? STATUS_COLORS[s.key] : 'transparent', color: filters.status === s.key ? 'white' : STATUS_COLORS[s.key], fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {s.label}
            </button>
            {i < STATUS_PIPELINE.length - 1 && <span style={{ color: 'var(--color-border)', fontWeight: 700 }}>→</span>}
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search name, email..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ ...inputStyle, minWidth: '200px' }}
        />
        <select style={inputStyle} value={filters.package} onChange={e => { setFilters(f => ({ ...f, package: e.target.value })); setPage(1); }}>
          <option value="">All Packages</option>
          <option value="foundation">Foundation ($750)</option>
          <option value="launch">Launch ($1,500)</option>
          <option value="accelerator">Accelerator ($3,000)</option>
        </select>
        <select style={inputStyle} value={filters.urgency} onChange={e => { setFilters(f => ({ ...f, urgency: e.target.value })); setPage(1); }}>
          <option value="">All Urgency</option>
          <option value="exploring">Just Exploring</option>
          <option value="two_weeks">2 Weeks</option>
          <option value="one_month">1 Month</option>
          <option value="asap">ASAP</option>
        </select>
        <select style={inputStyle} value={filters.state} onChange={e => { setFilters(f => ({ ...f, state: e.target.value })); setPage(1); }}>
          <option value="">All States</option>
          {['CA', 'TX', 'FL', 'NY', 'PA', 'IL', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA', 'TN', 'IN', 'MO', 'MD', 'WI', 'CO', 'MN', 'SC', 'AL', 'LA', 'KY', 'OR', 'OK', 'CT', 'UT', 'IA', 'NV', 'AR', 'MS', 'KS', 'NM', 'NE', 'WV', 'ID', 'HI', 'NH', 'ME', 'RI', 'MT', 'DE', 'SD', 'ND', 'AK', 'DC', 'VT', 'WY'].map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <input
          type="text"
          placeholder="Country code"
          value={filters.country}
          onChange={e => { setFilters(f => ({ ...f, country: e.target.value.toUpperCase() })); setPage(1); }}
          style={{ ...inputStyle, minWidth: '120px' }}
        />
        {(search || filters.status || filters.package || filters.urgency || filters.state || filters.country) && (
          <button onClick={() => { setSearch(''); setFilters({ status: '', package: '', urgency: '', state: '', country: '' }); setPage(1); }} style={{ ...inputStyle, background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            Clear All
          </button>
        )}
      </div>

      {/* Table */}
      {loading && page === 1 ? (
        <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
      ) : requests.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No requests found</p>
          <p style={{ color: 'var(--color-text-muted)' }}>Try adjusting your filters or search terms.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Phone', 'Package', 'Market', 'Consultant', 'Urgency', 'Status', 'Submitted', 'Actions'].map(h => (
                  <th key={h} style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <button onClick={() => setSelectedRequest(req)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.9rem', textAlign: 'left' }}>
                      {req.first_name} {req.last_name}
                    </button>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{req.email}</td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{req.phone || '-'}</td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <Badge color="#8B5CF6">{req.package_selected}</Badge>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>
                    {(req.operating_country || '-')} / {(req.operating_state || '-')}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem' }}>
                    {req.consultant_first_name ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>{req.consultant_first_name} {req.consultant_last_name}</div>
                        <div style={{ color: 'var(--color-text-muted)' }}>{req.consultant_assignment_status || 'assigned'}</div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <UrgencyBadge urgency={req.urgency} />
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <StatusBadge status={req.status} />
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setSelectedRequest(req)} style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600 }}>
                        View
                      </button>
                      <QuickStatusMenu request={req} onUpdated={loadRequests} />
                      <button onClick={() => archiveRequest(req)} style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid #EF4444', background: 'none', color: '#EF4444', fontSize: '0.78rem', cursor: 'pointer' }}>
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

      {selectedRequest && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <BusinessLaunchRequestDetail
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
            onStatusUpdate={() => { loadRequests(); setSelectedRequest(null); }}
          />
        </div>
      )}
    </div>
  );
}
