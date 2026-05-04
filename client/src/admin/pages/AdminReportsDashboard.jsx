import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, Loader } from 'lucide-react';
import '../styles/AdminReportsDashboard.css';

const AdminReportsDashboard = () => {
  const { t } = useTranslation();
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: '', reason: '' });
  const [pagination, setPagination] = useState({ offset: 0, limit: 20 });
  const [adminNotes, setAdminNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset
      });

      if (filters.status) params.append('status', filters.status);
      if (filters.reason) params.append('reason', filters.reason);

      const response = await fetch(`/api/reports/admin/all?${params}`);
      if (!response.ok) throw new Error('Failed to fetch reports');

      const { data, pagination: paginationData } = await response.json();
      setReports(data);
      setPagination(paginationData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.offset, pagination.limit]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleUpdateStatus = async (reportId, newStatus) => {
    try {
      setUpdatingStatus(true);

      const response = await fetch(`/api/reports/admin/${reportId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          adminNotes
        })
      });

      if (!response.ok) throw new Error('Failed to update report status');

      setAdminNotes('');
      fetchReports();
      setSelectedReport(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const getReasonLabel = (reason) => {
    const key = `reportModal.reason${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/_/g, '')}`;
    return t(key);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'submitted':
        return '#3b82f6';
      case 'reviewing':
        return '#f59e0b';
      case 'resolved':
        return '#10b981';
      case 'dismissed':
        return '#6b7280';
      case 'escalated':
        return '#dc2626';
      default:
        return '#6b7280';
    }
  };

  if (loading && reports.length === 0) {
    return (
      <div className="admin-reports-loading">
        <Loader className="spinner" size={32} />
        <p>{t('adminReports.loading')}</p>
      </div>
    );
  }

  return (
    <div className="admin-reports-dashboard">
      <div className="admin-reports-header">
        <h1>{t('adminReports.title')}</h1>
        <p className="admin-reports-subtitle">
          {t('adminReports.totalReports', { count: pagination.total })}
        </p>
      </div>

      <div className="admin-reports-filters">
        <select
          value={filters.status}
          onChange={(e) => {
            setFilters({ ...filters, status: e.target.value });
            setPagination({ ...pagination, offset: 0 });
          }}
          className="admin-reports-select"
        >
          <option value="">{t('adminReports.allStatus')}</option>
          <option value="submitted">{t('adminReports.statusSubmitted')}</option>
          <option value="reviewing">{t('adminReports.statusReviewing')}</option>
          <option value="resolved">{t('adminReports.statusResolved')}</option>
          <option value="dismissed">{t('adminReports.statusDismissed')}</option>
          <option value="escalated">{t('adminReports.statusEscalated')}</option>
        </select>

        <select
          value={filters.reason}
          onChange={(e) => {
            setFilters({ ...filters, reason: e.target.value });
            setPagination({ ...pagination, offset: 0 });
          }}
          className="admin-reports-select"
        >
          <option value="">{t('adminReports.allReasons')}</option>
          <option value="harassment">{t('reportModal.reasonHarassment')}</option>
          <option value="no_show">{t('reportModal.reasonNoShow')}</option>
          <option value="damaged_property">{t('reportModal.reasonDamagedProperty')}</option>
          <option value="abusive_language">{t('reportModal.reasonAbusiveLanguage')}</option>
          <option value="safety_violation">{t('reportModal.reasonSafetyViolation')}</option>
          <option value="scam">{t('reportModal.reasonScam')}</option>
          <option value="other">{t('reportModal.reasonOther')}</option>
        </select>
      </div>

      <div className="admin-reports-container">
        <div className="admin-reports-list">
          {reports.length === 0 ? (
            <div className="admin-reports-empty">
              <AlertTriangle size={32} opacity={0.5} />
              <p>{t('adminReports.noReports')}</p>
            </div>
          ) : (
            reports.map((report) => (
              <div
                key={report.id}
                className={`admin-report-item ${selectedReport?.id === report.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedReport(report);
                  setAdminNotes(report.adminNotes || '');
                }}
              >
                <div className="admin-report-item-header">
                  <h3 className="admin-report-item-title">
                    Report #{report.id}
                  </h3>
                  <div
                    className="admin-report-status-badge"
                    style={{ backgroundColor: getStatusColor(report.status) }}
                  >
                    {t(`adminReports.status${report.status.charAt(0).toUpperCase()}${report.status.slice(1)}`)}
                  </div>
                </div>
                <p className="admin-report-item-reason">
                  {getReasonLabel(report.reason)}
                </p>
                <p className="admin-report-item-user">
                  User: {report.reportedUserId.substring(0, 8)}...
                </p>
                <p className="admin-report-item-date">
                  {new Date(report.createdAt).toLocaleDateString()}
                </p>
                <ChevronRight size={16} className="admin-report-item-arrow" />
              </div>
            ))
          )}
        </div>

        {selectedReport && (
          <div className="admin-report-detail">
            <div className="admin-report-detail-header">
              <h2>Report #{selectedReport.id}</h2>
              <div
                className="admin-report-detail-status"
                style={{ backgroundColor: getStatusColor(selectedReport.status) }}
              >
                {t(`adminReports.status${selectedReport.status.charAt(0).toUpperCase()}${selectedReport.status.slice(1)}`)}
              </div>
            </div>

            <div className="admin-report-detail-content">
              <div className="admin-report-detail-section">
                <h3>{t('adminReports.details')}</h3>
                <dl className="admin-report-detail-list">
                  <dt>{t('adminReports.reportedUser')}</dt>
                  <dd>{selectedReport.reportedUserId}</dd>

                  <dt>{t('adminReports.reason')}</dt>
                  <dd>{getReasonLabel(selectedReport.reason)}</dd>

                  <dt>{t('adminReports.submittedAt')}</dt>
                  <dd>{new Date(selectedReport.createdAt).toLocaleString()}</dd>

                  {selectedReport.jobId && (
                    <>
                      <dt>{t('adminReports.job')}</dt>
                      <dd>{selectedReport.jobId}</dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="admin-report-detail-section">
                <h3>{t('adminReports.description')}</h3>
                <p className="admin-report-detail-description">
                  {selectedReport.description}
                </p>
              </div>

              {selectedReport.evidenceUrls && selectedReport.evidenceUrls.length > 0 && (
                <div className="admin-report-detail-section">
                  <h3>{t('adminReports.evidence')}</h3>
                  <ul className="admin-report-evidence-list">
                    {selectedReport.evidenceUrls.map((url, idx) => (
                      <li key={idx}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="admin-report-detail-section">
                <h3>{t('adminReports.adminNotes')}</h3>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder={t('adminReports.adminNotesPlaceholder')}
                  className="admin-report-notes"
                  disabled={updatingStatus}
                  maxLength="1000"
                />
                <p className="admin-report-char-count">
                  {adminNotes.length} / 1000
                </p>
              </div>

              <div className="admin-report-detail-actions">
                <button
                  onClick={() => handleUpdateStatus(selectedReport.id, 'reviewing')}
                  disabled={updatingStatus || selectedReport.status === 'reviewing'}
                  className="admin-report-btn"
                >
                  {t('adminReports.markReviewing')}
                </button>
                <button
                  onClick={() => handleUpdateStatus(selectedReport.id, 'dismissed')}
                  disabled={updatingStatus || ['dismissed', 'resolved'].includes(selectedReport.status)}
                  className="admin-report-btn admin-report-btn-secondary"
                >
                  {t('adminReports.dismiss')}
                </button>
                <button
                  onClick={() => handleUpdateStatus(selectedReport.id, 'escalated')}
                  disabled={updatingStatus}
                  className="admin-report-btn admin-report-btn-danger"
                >
                  {t('adminReports.escalate')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="admin-reports-error">
          {error}
        </div>
      )}

      {pagination.hasMore && (
        <div className="admin-reports-pagination">
          <button
            onClick={() => setPagination({ ...pagination, offset: pagination.offset + pagination.limit })}
            className="admin-reports-load-more"
          >
            {t('adminReports.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminReportsDashboard;
