// Admin legal dashboard — layout aligned with oxsteed_admin_legal_documents_dashboard.html
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import './AdminLegalDocumentsDashboard.css';

const STATUS_LABEL = {
  draft: 'Draft',
  pending_review: 'Pending review',
  scheduled: 'Scheduled',
  live: 'Live',
  archived: 'Archived',
};

export default function AdminLegalDocumentsPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const { data } = await api.get('/legal/admin/documents');
        const list = data.documents || [];
        setDocuments(list);
        if (list.length && !selectedId) setSelectedId(list[0].id);
      } catch (err) {
        setError('Failed to load documents');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const selected = documents.find((d) => d.id === selectedId);

  const statusClass = (status) => {
    if (status === 'live') return 'status-live';
    if (status === 'draft') return 'status-draft';
    return 'status-muted';
  };

  if (loading) {
    return <div className="ald-loading">Loading documents…</div>;
  }

  return (
    <div className="ald-dashboard">
      <header className="ald-header">
        <h1>Legal Documents</h1>
        <div className="ald-header-actions">
          <button
            type="button"
            className="ald-btn"
            disabled={!selected}
            onClick={() => selected && window.open('/terms', '_blank')}
          >
            <Eye size={16} aria-hidden />
            Preview
          </button>
          <button type="button" className="ald-btn ald-btn-primary" onClick={() => navigate('/admin/legal/documents/new')}>
            <Plus size={16} aria-hidden />
            New Document
          </button>
        </div>
      </header>

      {error && (
        <div className="ald-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <aside className="ald-sidebar">
        <span className="ald-sidebar-label">Documents</span>
        <ul className="ald-doc-list">
          {documents.length === 0 ? (
            <li className="ald-empty-hint">No documents yet</li>
          ) : (
            documents.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  className={`ald-doc-item ${doc.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(doc.id)}
                >
                  <span className="ald-doc-title">{doc.title}</span>
                  <span className={`ald-doc-status ${statusClass(doc.status)}`}>
                    {STATUS_LABEL[doc.status] || doc.status}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="ald-main">
        {!selected ? (
          <div className="ald-empty-state">
            <p>Select a document or create one</p>
            <button type="button" className="ald-btn ald-btn-primary" onClick={() => navigate('/admin/legal/documents/new')}>
              <Plus size={16} />
              New Document
            </button>
          </div>
        ) : (
          <>
            <div className="ald-doc-header">
              <div>
                <h2>{selected.title}</h2>
                <div className="ald-doc-meta">
                  <div>
                    Version {selected.version} · Updated {new Date(selected.updatedAt).toLocaleDateString()}
                  </div>
                  <div className="ald-meta-row">
                    <span className="ald-category">{selected.category}</span>
                    <span className={`ald-status-pill ${statusClass(selected.status)}`}>
                      {STATUS_LABEL[selected.status] || selected.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="ald-actions-row">
              <button type="button" className="ald-btn" onClick={() => window.open('/terms', '_blank')}>
                <Eye size={16} />
                Preview public terms
              </button>
              <button type="button" className="ald-btn ald-btn-primary" onClick={() => navigate(`/admin/legal/documents/${selected.id}/edit`)}>
                Open editor
              </button>
              {(selected.status === 'draft' || selected.status === 'pending_review') && (
                <button type="button" className="ald-btn" onClick={() => navigate(`/admin/legal/documents/${selected.id}/approve`)}>
                  Approval workflow
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
