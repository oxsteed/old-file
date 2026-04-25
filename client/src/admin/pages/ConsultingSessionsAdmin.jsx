import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import ConsultingSessionDetail from './ConsultingSessionDetail';

const STATUS_COLORS = {
  pending: '#FFA500',      // Orange
  scheduled: '#0EA5E9',    // Cyan
  completed: '#10B981',    // Green
  cancelled: '#EF4444',    // Red
};

const AREAS_OF_HELP = [
  'legal_setup',
  'pricing_strategy',
  'branding',
  'financial_systems',
  'marketing',
  'team_building',
  'operational_systems',
  'scaling',
  'acquisition_preparation',
  'exit_strategy',
];

export default function ConsultingSessionsAdmin() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    service_tier: '',
  });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  useEffect(() => {
    loadSessions();
  }, [filters, page]);

  async function loadSessions() {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page,
        limit: 20,
        ...(filters.status && { status: filters.status }),
        ...(filters.service_tier && { service_tier: filters.service_tier }),
      });

      const res = await axios.get(`/api/consulting/admin/sessions?${params}`);
      setSessions(res.data.data || []);
      setPagination(res.data.pagination || {});
    } catch (err) {
      toast.error(t('common.errorLoading'));
    } finally {
      setLoading(false);
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
        <h1 style={titleStyle}>Business Consulting Sessions</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Total: {pagination.total || 0} sessions
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
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          style={inputStyle}
          value={filters.service_tier}
          onChange={e => {
            setFilters({ ...filters, service_tier: e.target.value });
            setPage(1);
          }}
        >
          <option value="">All Service Tiers</option>
          <option value="initial">Initial ($100)</option>
          <option value="foundation">Foundation</option>
          <option value="implementation">Implementation</option>
          <option value="transformation">Transformation</option>
        </select>

        <button
          style={{
            ...buttonStyle,
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
          onClick={() => {
            setFilters({ status: '', service_tier: '' });
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
              <th style={thStyle}>Service Tier</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Areas of Help</th>
              <th style={thStyle}>Submitted</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No sessions found
                </td>
              </tr>
            ) : (
              sessions.map(session => (
                <tr key={session.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={tdStyle}>
                    <strong>{session.first_name} {session.last_name}</strong>
                  </td>
                  <td style={tdStyle}>{session.email}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle('#8B5CF6')}>
                      {session.service_tier}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(STATUS_COLORS[session.status] || '#6B7280')}>
                      {session.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {session.areas_of_help && session.areas_of_help.slice(0, 3).map((area, idx) => (
                        <span key={idx} style={{ fontSize: '0.75rem', background: 'var(--color-primary)', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                          {area.split('_').join(' ')}
                        </span>
                      ))}
                      {session.areas_of_help && session.areas_of_help.length > 3 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          +{session.areas_of_help.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {new Date(session.created_at).toLocaleDateString()}
                  </td>
                  <td style={tdStyle}>
                    <button
                      style={buttonStyle}
                      onClick={() => setSelectedSession(session)}
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
      {selectedSession && (
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
          <ConsultingSessionDetail
            session={selectedSession}
            onClose={() => setSelectedSession(null)}
            onStatusUpdate={() => loadSessions()}
          />
        </div>
      )}
    </div>
  );
}
