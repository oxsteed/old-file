// Admin: Legal Documents Management
// Create, edit, approve, and publish legal documents

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, CheckCircle, Clock, AlertCircle, Trash2, Eye } from 'lucide-react';
import api from '../../api/axios';

export default function AdminLegalDocumentsPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState('all');

  useEffect(() => {
    fetchDocuments();
  }, [selectedStatus]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/legal/admin/documents', {
        params: { status: selectedStatus !== 'all' ? selectedStatus : undefined }
      });
      setDocuments(data.documents || []);
    } catch (err) {
      console.error('Failed to fetch documents', err);
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    navigate('/admin/legal/documents/new');
  };

  const handleEdit = (id) => {
    navigate(`/admin/legal/documents/${id}/edit`);
  };

  const handleApprove = (id) => {
    navigate(`/admin/legal/documents/${id}/approve`);
  };

  const handlePreview = (id) => {
    window.open(`/terms?preview=${id}`, '_blank');
  };

  const getStatusBadge = (status) => {
    const styles = {
      draft: { bg: '#6b7280', text: '#f3f4f6' },
      pending_review: { bg: '#f59e0b', text: '#1f2937' },
      scheduled: { bg: '#3b82f6', text: '#f3f4f6' },
      live: { bg: '#10b981', text: '#f3f4f6' },
      archived: { bg: '#9ca3af', text: '#f3f4f6' }
    };
    const style = styles[status] || styles.draft;
    return (
      <span className="admin-status-badge" style={{ backgroundColor: style.bg, color: style.text }}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const statusOptions = [
    { value: 'all', label: 'All Documents' },
    { value: 'draft', label: 'Drafts' },
    { value: 'pending_review', label: 'Pending Review' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'live', label: 'Published' },
    { value: 'archived', label: 'Archived' }
  ];

  if (loading) {
    return <div className="admin-page-loading">Loading documents...</div>;
  }

  return (
    <div className="admin-legal-page">
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1>Legal Documents</h1>
          <p>Manage Terms of Service, Privacy Policy, and other legal documents</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={handleCreateNew}>
          <Plus size={18} />
          New Document
        </button>
      </div>

      {error && (
        <div className="admin-error-box">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Filters */}
      <div className="admin-filters">
        <div className="admin-filter-group">
          <label>Status</label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="admin-select"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Documents Table */}
      {documents.length === 0 ? (
        <div className="admin-empty-state">
          <p>No documents yet. Create your first legal document.</p>
          <button className="admin-btn admin-btn-primary" onClick={handleCreateNew}>
            <Plus size={18} />
            Create Document
          </button>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Version</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="admin-doc-title">{doc.title}</td>
                  <td>
                    <span className="admin-category-badge">{doc.category.replace('_', ' ')}</span>
                  </td>
                  <td className="admin-version">v{doc.version}</td>
                  <td>{getStatusBadge(doc.status)}</td>
                  <td className="admin-date">{new Date(doc.updatedAt).toLocaleDateString()}</td>
                  <td className="admin-actions">
                    <button
                      className="admin-action-btn admin-action-preview"
                      onClick={() => handlePreview(doc.id)}
                      title="Preview"
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      className="admin-action-btn admin-action-edit"
                      onClick={() => handleEdit(doc.id)}
                      title="Edit"
                    >
                      <Edit size={16} />
                    </button>
                    {doc.status === 'draft' && (
                      <button
                        className="admin-action-btn admin-action-approve"
                        onClick={() => handleApprove(doc.id)}
                        title="Request Approval"
                      >
                        <CheckCircle size={16} />
                      </button>
                    )}
                    {doc.status === 'scheduled' && (
                      <button
                        className="admin-action-btn admin-action-publish"
                        onClick={() => handleApprove(doc.id)}
                        title="Publish Now"
                      >
                        <Clock size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
