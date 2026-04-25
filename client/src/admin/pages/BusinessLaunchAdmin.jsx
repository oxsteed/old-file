import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import BusinessLaunchRequestDetail from './BusinessLaunchRequestDetail';

const STATUS_COLORS = {
  pending: '#FFA500',      // Orange
  contacted: '#4F46E5',    // Indigo
  kickoff_scheduled: '#8B5CF6', // Purple
  in_progress: '#0EA5E9', // Cyan
  completed: '#10B981',    // Green
  cancelled: '#EF4444',    // Red
};

const URGENT_COLORS = {
  exploring: '#6B7280',    // Gray
  two_weeks: '#F59E0B',    // Amber
  asap: '#DC2626',         // Red
};

export default function BusinessLaunchAdmin() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    package: '',
    urgency: '',
    state: '',
  });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [updateLoading, setUpdateLoading] = useState(false);

  useEffect(() => {
    loadRequests();
  }, [filters, page]);

  async function loadRequests() {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page,
        limit: 20,
        ...(filters.status && { status: filters.status }),
        ...(filters.package && { package: filters.package }),
        ...(filters.urgency && { urgency: filters.urgency }),
        ...(filters.state && { state: filters.state }),
      });

      const res = await axios.get(`/api/consulting/business-launch/requests?${params}`);
      setRequests(res.data.data || []);
      setPagination(res.data.pagination || {});
    } catch (err) {
      console.error('Error loading business launch requests', err);
      toast.error(t('common.errorLoading'));
    } finally {
      setLoading(false);
    }
  }

  async function updateRequestStatus(requestId, newStatus) {
    try {
      setUpdateLoading(true);
      await axios.patch(`/api/consulting/business-launch/requests/${requestId}`, {
        status: newStatus,
      });
      toast.success(t('businessLaunchAdmin.statusUpdated'));
      loadRequests();
      setSelectedRequest(null);
    } catch (err) {
      console.error('Error updating status', err);
      toast.error(t('common.errorUpdating'));
    } finally {
      setUpdateLoading(false);
    }
  }

  const containerStyle = {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '2rem',
  };

  const headerStyle = {
    marginBottom: '2rem',
  };

  const titleStyle = {
    fontSize: '2rem',
    fontWeight: 700,
    marginBottom: '1rem',
  };

  const filtersStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  };

  const inputStyle = {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.9rem',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'var(--color-surface)',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  };

  const thStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    textAlign: 'left',
    borderBottom: '2px solid var(--color-border)',
    fontWeight: 600,
    fontSize: '0.9rem',
  };

  const tdStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
    fontSize: '0.9rem',
  };

  const buttonStyle = {
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
  };

  const badgeStyle = (color) => ({
    display: 'inline-block',
    background: color || 'var(--color-bg)',
    color: 'white',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.8rem',
    fontWeight: 500,
  });

  if (loading && page === 1) {
    return <div style={containerStyle}>{t('common.loading')}</div>;
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={titleStyle}>Business Launch Program - Intake Requests</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Total: {pagination.total || 0} requests
        </p>
      </div>

      {/* Filters */}
      <div style={filtersStyle}>
        <select
          style={inputStyle}
          value={filters.status}
          onChange={e => {
            setFilters({ ...filters, status: e.target.value });
            setPage(1);
          }}
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="contacted">Contacted</option>
          <option value="kickoff_scheduled">Kickoff Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          style={inputStyle}
          value={filters.package}
          onChange={e => {
            setFilters({ ...filters, package: e.target.value });
            setPage(1);
          }}
        >
          <option value="">All Packages</option>
          <option value="foundation">Foundation ($750)</option>
          <option value="launch">Launch ($1500)</option>
          <option value="accelerator">Accelerator ($3000)</option>
        </select>

        <select
          style={inputStyle}
          value={filters.urgency}
          onChange={e => {
            setFilters({ ...filters, urgency: e.target.value });
            setPage(1);
          }}
        >
          <option value="">All Urgency</option>
          <option value="exploring">Exploring</option>
          <option value="two_weeks">Two Weeks</option>
          <option value="asap">ASAP</option>
        </select>

        <select
          style={inputStyle}
          value={filters.state}
          onChange={e => {
            setFilters({ ...filters, state: e.target.value });
            setPage(1);
          }}
        >
          <option value="">All States</option>
          <option value="CA">CA</option>
          <option value="TX">TX</option>
          <option value="FL">FL</option>
          <option value="NY">NY</option>
          <option value="PA">PA</option>
          {/* Add more states as needed */}
        </select>

        <button
          style={{
            ...buttonStyle,
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
          onClick={() => {
            setFilters({ status: '', package: '', urgency: '', state: '' });
            setPage(1);
          }}
        >
          Clear Filters
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Package</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Urgency</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Submitted</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No requests found
                </td>
              </tr>
            ) : (
              requests.map(req => (
                <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={tdStyle}>
                    <strong>{req.first_name} {req.last_name}</strong>
                  </td>
                  <td style={tdStyle}>{req.email}</td>
                  <td style={tdStyle}>{req.phone || '—'}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle('#8B5CF6')}>
                      {req.package_selected}
                    </span>
                  </td>
                  <td style={tdStyle}>{req.operating_state || '—'}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(URGENT_COLORS[req.urgency] || '#6B7280')}>
                      {req.urgency}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(STATUS_COLORS[req.status] || '#6B7280')}>
                      {req.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {new Date(req.created_at).toLocaleDateString()}
                  </td>
                  <td style={tdStyle}>
                    <button
                      style={buttonStyle}
                      onClick={() => setSelectedRequest(req)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '1rem',
          marginBottom: '2rem',
        }}>
          <button
            style={buttonStyle}
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            ← Previous
          </button>
          <span style={{ padding: '0.5rem 1rem' }}>
            Page {page} of {pagination.pages}
          </span>
          <button
            style={buttonStyle}
            disabled={page === pagination.pages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {/* Detail Modal */}
      {selectedRequest && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <BusinessLaunchRequestDetail
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
            onStatusUpdate={() => loadRequests()}
          />
        </div>
      )}
    </div>
  );
}
