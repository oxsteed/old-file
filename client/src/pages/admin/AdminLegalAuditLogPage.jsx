// Admin: Legal Document Audit Log
// Complete compliance audit trail with filtering and export

import { useState, useEffect } from 'react';
import { Search, Download, Filter, X } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import './AdminLegalAuditLogPage.css';

export default function AdminLegalAuditLogPage() {
  const [auditLogs, setAuditLogs] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [filterUser, setFilterUser] = useState('');
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });

  const actionTypes = [
    { value: 'all', label: 'All Actions' },
    { value: 'document_created', label: 'Document Created' },
    { value: 'document_updated', label: 'Document Updated' },
    { value: 'document_viewed', label: 'Document Viewed' },
    { value: 'document_published', label: 'Document Published' },
    { value: 'approval_requested', label: 'Approval Requested' },
    { value: 'approval_approved', label: 'Approval Approved' },
    { value: 'approval_rejected', label: 'Approval Rejected' },
    { value: 'user_accepted', label: 'User Accepted' },
    { value: 'translation_completed', label: 'Translation Completed' }
  ];

  useEffect(() => {
    fetchAuditLogs();
  }, []);

  useEffect(() => {
    filterLogs();
  }, [auditLogs, searchQuery, filterAction, filterUser, dateRange]);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      // Mock data - in production, would fetch from /api/admin/legal/audit-log
      const mockLogs = [
        {
          id: '1',
          actionType: 'document_published',
          resourceType: 'document',
          resourceId: 'doc1',
          documentId: 'doc1',
          userId: 'user1',
          userName: 'John Legal',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
          createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
          metadata: { version: 1, status: 'live' }
        },
        {
          id: '2',
          actionType: 'approval_approved',
          resourceType: 'approval',
          resourceId: 'app1',
          documentId: 'doc1',
          userId: 'user2',
          userName: 'Jane Counsel',
          ipAddress: '192.168.1.101',
          userAgent: 'Mozilla/5.0...',
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          metadata: { reviewComments: 'Looks good', scheduledDate: null }
        },
        {
          id: '3',
          actionType: 'approval_requested',
          resourceType: 'approval',
          resourceId: 'app1',
          documentId: 'doc1',
          userId: 'user1',
          userName: 'John Legal',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
          createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
          metadata: { changeSummary: 'Updated payment terms' }
        },
        {
          id: '4',
          actionType: 'document_updated',
          resourceType: 'document',
          resourceId: 'doc1',
          documentId: 'doc1',
          userId: 'user1',
          userName: 'John Legal',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
          createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
          metadata: { version: 1, sections: 8 }
        },
        {
          id: '5',
          actionType: 'user_accepted',
          resourceType: 'acceptance',
          resourceId: 'acc1',
          documentId: 'doc1',
          userId: 'user3',
          userName: 'Customer User',
          ipAddress: '203.0.113.45',
          userAgent: 'Mozilla/5.0...',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          metadata: { version: 1, timestamp: new Date() }
        }
      ];
      setAuditLogs(mockLogs);
    } catch (err) {
      logger.error('Failed to fetch audit logs', { err });
    } finally {
      setLoading(false);
    }
  };

  const filterLogs = () => {
    let result = auditLogs;

    // Filter by action type
    if (filterAction !== 'all') {
      result = result.filter(log => log.actionType === filterAction);
    }

    // Filter by user
    if (filterUser) {
      result = result.filter(log =>
        log.userName.toLowerCase().includes(filterUser.toLowerCase())
      );
    }

    // Filter by search query
    if (searchQuery) {
      result = result.filter(log =>
        log.resourceId.includes(searchQuery) ||
        log.documentId?.includes(searchQuery) ||
        log.userName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by date range
    if (dateRange.startDate) {
      const start = new Date(dateRange.startDate);
      result = result.filter(log => new Date(log.createdAt) >= start);
    }
    if (dateRange.endDate) {
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);
      result = result.filter(log => new Date(log.createdAt) <= end);
    }

    setFilteredLogs(result);
  };

  const handleExportCSV = () => {
    const headers = ['Timestamp', 'Action', 'User', 'Resource ID', 'IP Address', 'Status'];
    const rows = filteredLogs.map(log => [
      new Date(log.createdAt).toISOString(),
      log.actionType,
      log.userName,
      log.resourceId,
      log.ipAddress,
      'completed'
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterAction('all');
    setFilterUser('');
    setDateRange({ startDate: '', endDate: '' });
  };

  const getActionLabel = (actionType) => {
    return actionTypes.find(a => a.value === actionType)?.label || actionType;
  };

  const getActionColor = (actionType) => {
    const colorMap = {
      document_created: '#10b981',
      document_updated: '#3b82f6',
      document_published: '#f97316',
      approval_requested: '#8b5cf6',
      approval_approved: '#10b981',
      approval_rejected: '#ef4444',
      user_accepted: '#10b981',
      document_viewed: '#6b7280'
    };
    return colorMap[actionType] || '#6b7280';
  };

  if (loading) {
    return <div className="audit-log-loading">Loading audit logs...</div>;
  }

  return (
    <div className="audit-log-page">
      {/* Header */}
      <div className="audit-log-header">
        <h1>Audit Log</h1>
        <p>Complete compliance audit trail for legal documents</p>
      </div>

      {/* Filters */}
      <div className="audit-log-filters">
        <div className="audit-filter-group">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search by resource ID, document ID, or user..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="audit-filter-input"
          />
        </div>

        <div className="audit-filter-group">
          <Filter size={18} />
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="audit-filter-select"
          >
            {actionTypes.map(action => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </div>

        <div className="audit-filter-group">
          <input
            type="text"
            placeholder="Filter by user..."
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="audit-filter-input"
          />
        </div>

        <div className="audit-filter-group">
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
            className="audit-filter-input"
            title="Start date"
          />
          <span className="audit-date-separator">to</span>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
            className="audit-filter-input"
            title="End date"
          />
        </div>

        <button className="audit-filter-clear" onClick={clearFilters} title="Clear filters">
          <X size={18} />
        </button>

        <button className="audit-filter-export" onClick={handleExportCSV}>
          <Download size={18} />
          Export CSV
        </button>
      </div>

      {/* Results */}
      <div className="audit-log-results">
        <div className="audit-log-count">
          Showing {filteredLogs.length} of {auditLogs.length} events
        </div>

        {filteredLogs.length === 0 ? (
          <div className="audit-log-empty">
            <p>No events match your filters</p>
          </div>
        ) : (
          <div className="audit-log-table">
            <div className="audit-log-table-header">
              <div className="audit-col-timestamp">Timestamp</div>
              <div className="audit-col-action">Action</div>
              <div className="audit-col-user">User</div>
              <div className="audit-col-resource">Resource</div>
              <div className="audit-col-ip">IP Address</div>
              <div className="audit-col-details">Details</div>
            </div>

            <div className="audit-log-table-body">
              {filteredLogs.map(log => (
                <div key={log.id} className="audit-log-row">
                  <div className="audit-col-timestamp">
                    {new Date(log.createdAt).toLocaleString()}
                  </div>
                  <div className="audit-col-action">
                    <span
                      className="audit-action-badge"
                      style={{ backgroundColor: getActionColor(log.actionType) }}
                    >
                      {getActionLabel(log.actionType)}
                    </span>
                  </div>
                  <div className="audit-col-user">{log.userName}</div>
                  <div className="audit-col-resource">
                    <span className="audit-resource-id">{log.resourceId}</span>
                  </div>
                  <div className="audit-col-ip">
                    <span className="audit-ip-address">{log.ipAddress}</span>
                  </div>
                  <div className="audit-col-details">
                    <details className="audit-metadata">
                      <summary>View</summary>
                      <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
