import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';

export default function ConsultingDashboard() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [reqRes, consRes, statsRes] = await Promise.all([
        axios.get('/api/consulting/admin/requests'),
        axios.get('/api/consulting/admin/consultants'),
        axios.get('/api/consulting/admin/dashboard-stats'),
      ]);
      setRequests(reqRes.data.requests || []);
      setConsultants(consRes.data || []);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Error loading consulting dashboard', err);
    } finally {
      setLoading(false);
    }
  }

  async function assignConsultant(sessionId, consultantId) {
    try {
      await axios.post('/api/consulting/admin/assign', { session_id: sessionId, consultant_id: consultantId });
      loadData();
      toast.success(t('consulting.admin.messages.assignmentSuccess'));
    } catch (err) {
      toast.error(t('consulting.admin.messages.assignmentError'));
    }
  }

  const containerStyle = {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem',
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  };

  const cardStyle = {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '1.5rem',
    textAlign: 'center',
  };

  const statNumberStyle = {
    fontSize: '2.5rem',
    fontWeight: 700,
    color: 'var(--color-primary)',
    margin: '0.5rem 0',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '2rem',
  };

  const thStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    textAlign: 'left',
    borderBottom: '2px solid var(--color-border)',
    fontWeight: 600,
  };

  const tdStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
  };

  const buttonStyle = {
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
  };

  if (loading) return <div style={containerStyle}>{t('common.loading')}</div>;

  return (
    <div style={containerStyle}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 700 }}>
        {t('consulting.admin.title')}
      </h1>

      {/* Stats */}
      <div style={gridStyle}>
        <div style={cardStyle}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-text-muted)' }}>
            {t('consulting.admin.stats.pendingRequests')}
          </p>
          <div style={statNumberStyle}>{stats?.pending_requests || 0}</div>
        </div>
        <div style={cardStyle}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-text-muted)' }}>
            {t('consulting.admin.stats.scheduledSessions')}
          </p>
          <div style={statNumberStyle}>{stats?.scheduled_sessions || 0}</div>
        </div>
        <div style={cardStyle}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-text-muted)' }}>
            {t('consulting.admin.stats.activeClients')}
          </p>
          <div style={statNumberStyle}>{stats?.total_clients || 0}</div>
        </div>
        <div style={cardStyle}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-text-muted)' }}>
            {t('consulting.admin.stats.avgNps')}
          </p>
          <div style={statNumberStyle}>{stats?.avg_nps ? stats.avg_nps.toFixed(1) : 'N/A'}</div>
        </div>
      </div>

      {/* Requests Table */}
      <h2 style={{ fontSize: '1.5rem', margin: '2rem 0 1rem', fontWeight: 600 }}>
        {t('consulting.admin.requestsTable.title')}
      </h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>{t('consulting.admin.requestsTable.name')}</th>
            <th style={thStyle}>{t('consulting.admin.requestsTable.email')}</th>
            <th style={thStyle}>{t('consulting.admin.requestsTable.serviceTier')}</th>
            <th style={thStyle}>{t('consulting.admin.requestsTable.status')}</th>
            <th style={thStyle}>{t('consulting.admin.requestsTable.consultant')}</th>
            <th style={thStyle}>{t('consulting.admin.requestsTable.action')}</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(req => (
            <tr key={req.id}>
              <td style={tdStyle}>{req.first_name} {req.last_name}</td>
              <td style={tdStyle}>{req.email}</td>
              <td style={tdStyle}><strong>{req.service_tier}</strong></td>
              <td style={tdStyle}>
                <span style={{ background: 'var(--color-bg)', padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.85rem' }}>
                  {req.status}
                </span>
              </td>
              <td style={tdStyle}>
                {req.consultant_id ? (
                  <span>{t('consulting.admin.requestsTable.assigned')}</span>
                ) : (
                  <select
                    onChange={e => assignConsultant(req.id, e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                    defaultValue=""
                  >
                    <option value="">{t('consulting.admin.requestsTable.assign')}</option>
                    {consultants.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} ({c.role})
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td style={tdStyle}>
                <button
                  style={buttonStyle}
                  onClick={() => setSelectedRequest(req)}
                >
                  {t('consulting.admin.requestsTable.view')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Request Detail Modal */}
      {selectedRequest && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: '8px',
            padding: '2rem',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
          }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.5rem', fontWeight: 600 }}>
              {selectedRequest.first_name} {selectedRequest.last_name}
            </h2>
            <p><strong>{t('consulting.email')}:</strong> {selectedRequest.email}</p>
            <p><strong>{t('consulting.phone')}:</strong> {selectedRequest.phone || t('common.notProvided')}</p>
            <p><strong>{t('consulting.businessName')}:</strong> {selectedRequest.business_name || 'N/A'}</p>
            <p><strong>{t('consulting.admin.requestDetail.phase')}:</strong> {selectedRequest.current_phase || t('common.notSpecified')}/30</p>
            <p><strong>{t('consulting.serviceTier')}:</strong> {selectedRequest.service_tier}</p>
            <p><strong>{t('consulting.admin.requestDetail.areas')}:</strong> {selectedRequest.areas_of_help.join(', ')}</p>
            <p><strong>{t('consulting.admin.requestDetail.description')}:</strong> {selectedRequest.description}</p>
            <button
              style={{ ...buttonStyle, marginTop: '1rem' }}
              onClick={() => setSelectedRequest(null)}
            >
              {t('consulting.admin.requestDetail.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
