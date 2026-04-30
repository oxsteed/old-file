// Admin: Legal Document Editor
// Rich text editing with section-by-section support and approval workflow

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, X, Plus, Edit, Trash2, ChevronDown, AlertCircle } from 'lucide-react';
import api from '../../api/axios';

export default function AdminLegalDocumentEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;

  const [document, setDocument] = useState({
    title: '',
    category: 'terms_of_service',
    description: '',
    changeSummary: ''
  });

  const [sections, setSections] = useState([
    { key: 'introduction', title: 'Introduction', content: '' }
  ]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedSection, setExpandedSection] = useState(0);

  const categories = [
    { value: 'terms_of_service', label: 'Terms of Service' },
    { value: 'privacy_policy', label: 'Privacy Policy' },
    { value: 'helper_agreement', label: 'Helper Agreement' },
    { value: 'seller_agreement', label: 'Seller Agreement' },
    { value: 'payment_terms', label: 'Payment Terms' },
    { value: 'dispute_resolution', label: 'Dispute Resolution' },
    { value: 'data_retention', label: 'Data Retention' },
    { value: 'background_check_policy', label: 'Background Check Policy' },
    { value: 'fcra_compliance', label: 'FCRA Compliance' },
    { value: 'incident_response', label: 'Incident Response' },
    { value: 'accessibility_policy', label: 'Accessibility Policy' }
  ];

  // Load document if editing
  useEffect(() => {
    if (!isNew) {
      fetchDocument();
    }
  }, [id]);

  const fetchDocument = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/legal/admin/documents/${id}`);
      setDocument(data.document);
      setSections(data.sections || []);
    } catch (err) {
      console.error('Failed to load document', err);
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const payload = {
        title: document.title,
        description: document.description,
        content: sections.map(s => s.content).join('\n\n'),
        changeSummary: document.changeSummary
      };

      if (isNew) {
        await api.post('/legal/admin/documents', {
          category: document.category,
          ...payload
        });
        console.log('Document created');
      } else {
        await api.put(`/legal/admin/documents/${id}`, payload);
        console.log('Document updated');
      }

      navigate('/legal/admin/documents');
    } catch (err) {
      console.error('Failed to save document', err);
      setError(err.response?.data?.message || 'Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSection = () => {
    const newKey = `section_${Date.now()}`;
    setSections([
      ...sections,
      { key: newKey, title: 'New Section', content: '' }
    ]);
    setExpandedSection(sections.length);
  };

  const handleDeleteSection = (index) => {
    if (sections.length > 1) {
      setSections(sections.filter((_, i) => i !== index));
    }
  };

  const updateSection = (index, field, value) => {
    const updated = [...sections];
    updated[index][field] = value;
    setSections(updated);
  };

  const handleRequestApproval = async () => {
    try {
      setSaving(true);
      await api.post(`/legal/admin/documents/${id}/request-approval`, {
        changeSummary: document.changeSummary,
        changedSections: sections.map(s => s.key)
      });
      console.log('Approval requested');
      navigate('/admin/legal/approvals');
    } catch (err) {
      console.error('Failed to request approval', err);
      setError(err.response?.data?.message || 'Failed to request approval');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-editor-loading">Loading document...</div>;
  }

  return (
    <div className="admin-editor-page">
      {/* Header */}
      <div className="admin-editor-header">
        <div>
          <h1>{isNew ? 'Create Document' : `Edit: ${document.title}`}</h1>
          <p>Create and edit legal documents with section management</p>
        </div>
        <div className="admin-editor-actions">
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          {!isNew && (
            <button
              className="admin-btn admin-btn-secondary"
              onClick={handleRequestApproval}
              disabled={saving}
            >
              Request Approval
            </button>
          )}
          <button className="admin-btn admin-btn-ghost" onClick={() => navigate('/legal/admin/documents')}>
            <X size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="admin-error-box">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Document Settings */}
      <div className="admin-editor-settings">
        <div className="admin-editor-field">
          <label>Title</label>
          <input
            type="text"
            value={document.title}
            onChange={(e) => setDocument({ ...document, title: e.target.value })}
            placeholder="e.g., Terms of Service"
            className="admin-input"
          />
        </div>

        {isNew && (
          <div className="admin-editor-field">
            <label>Category</label>
            <select
              value={document.category}
              onChange={(e) => setDocument({ ...document, category: e.target.value })}
              className="admin-select"
            >
              {categories.map(cat => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="admin-editor-field">
          <label>Description</label>
          <textarea
            value={document.description}
            onChange={(e) => setDocument({ ...document, description: e.target.value })}
            placeholder="Brief description of this document"
            className="admin-textarea"
            rows={2}
          />
        </div>

        <div className="admin-editor-field">
          <label>Change Summary</label>
          <textarea
            value={document.changeSummary}
            onChange={(e) => setDocument({ ...document, changeSummary: e.target.value })}
            placeholder="What changed in this version? (e.g., 'Updated payment terms', 'Added GDPR section')"
            className="admin-textarea"
            rows={2}
          />
        </div>
      </div>

      {/* Sections Editor */}
      <div className="admin-editor-sections">
        <div className="admin-sections-header">
          <h2>Sections</h2>
          <button className="admin-btn admin-btn-sm" onClick={handleAddSection}>
            <Plus size={16} />
            Add Section
          </button>
        </div>

        <div className="admin-sections-list">
          {sections.map((section, index) => (
            <div key={section.key} className="admin-section-item">
              <div
                className="admin-section-header"
                onClick={() => setExpandedSection(expandedSection === index ? -1 : index)}
              >
                <ChevronDown
                  size={20}
                  style={{ transform: expandedSection === index ? 'rotate(0)' : 'rotate(-90deg)' }}
                  className="admin-section-toggle"
                />
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) => updateSection(index, 'title', e.target.value)}
                  className="admin-section-title-input"
                  placeholder="Section title"
                  onClick={(e) => e.stopPropagation()}
                />
                {sections.length > 1 && (
                  <button
                    className="admin-section-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSection(index);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {expandedSection === index && (
                <div className="admin-section-content">
                  <textarea
                    value={section.content}
                    onChange={(e) => updateSection(index, 'content', e.target.value)}
                    placeholder="Section content (supports markdown)"
                    className="admin-section-textarea"
                    rows={10}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="admin-editor-footer">
        <button
          className="admin-btn admin-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button className="admin-btn admin-btn-ghost" onClick={() => navigate('/legal/admin/documents')}>
          Cancel
        </button>
      </div>
    </div>
  );
}
