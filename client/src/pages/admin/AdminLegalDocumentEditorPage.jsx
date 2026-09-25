// Admin: Legal Document Editor
// Rich text editing with section-by-section support and approval workflow

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Save, X, Plus, Edit, Trash2, ChevronDown, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import './AdminLegalDocumentEditorPage.css';

export default function AdminLegalDocumentEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { t } = useTranslation();
  const copy = (key, options) => t(`adminLegal.documents.editor.${key}`, options);
  const isNew = !id;

  const [document, setDocument] = useState({
    title: '',
    category: 'terms_of_service',
    description: '',
    changeSummary: ''
  });

  const [sections, setSections] = useState([
    { key: 'introduction', title: copy('introduction'), content: '' }
  ]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedSection, setExpandedSection] = useState(0);

  const categories = [
    { value: 'terms_of_service', label: copy('categories.termsOfService') },
    { value: 'privacy_policy', label: copy('categories.privacyPolicy') },
    { value: 'helper_agreement', label: copy('categories.helperAgreement') },
    { value: 'seller_agreement', label: copy('categories.sellerAgreement') },
    { value: 'payment_terms', label: copy('categories.paymentTerms') },
    { value: 'dispute_resolution', label: copy('categories.disputeResolution') },
    { value: 'data_retention', label: copy('categories.dataRetention') },
    { value: 'background_check_policy', label: copy('categories.backgroundCheckPolicy') },
    { value: 'fcra_compliance', label: copy('categories.fcraCompliance') },
    { value: 'incident_response', label: copy('categories.incidentResponse') },
    { value: 'accessibility_policy', label: copy('categories.accessibilityPolicy') }
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
      const { data } = await api.get(`/admin/legal/documents/${id}`);
      setDocument(data.document);
      setSections(data.sections || []);
    } catch (err) {
      logger.error('Failed to load document', { err });
      setError(copy('loadFailed'));
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
        await api.post('/admin/legal/documents', {
          category: document.category,
          ...payload
        });
        logger.info('Document created');
      } else {
        await api.put(`/admin/legal/documents/${id}`, payload);
        logger.info('Document updated');
      }

      navigate('/admin/legal/documents');
    } catch (err) {
      logger.error('Failed to save document', { err });
      setError(err.response?.data?.message || copy('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSection = () => {
    const newKey = `section_${Date.now()}`;
    setSections([
      ...sections,
      { key: newKey, title: copy('newSection'), content: '' }
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
      await api.post(`/admin/legal/documents/${id}/request-approval`, {
        changeSummary: document.changeSummary,
        changedSections: sections.map(s => s.key)
      });
      logger.info('Approval requested');
      navigate('/admin/legal/approvals');
    } catch (err) {
      logger.error('Failed to request approval', { err });
      setError(err.response?.data?.message || copy('approvalFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-editor-loading">{copy('loading')}</div>;
  }

  return (
    <div className="admin-editor-page">
      {/* Header */}
      <div className="admin-editor-header">
        <div>
          <h1>{isNew ? copy('createTitle') : copy('editTitle', { title: document.title })}</h1>
          <p>{copy('subtitle')}</p>
        </div>
        <div className="admin-editor-actions">
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={18} />
            {saving ? copy('saving') : copy('saveDraft')}
          </button>
          {!isNew && (
            <button
              className="admin-btn admin-btn-secondary"
              onClick={handleRequestApproval}
              disabled={saving}
            >
              {copy('requestApproval')}
            </button>
          )}
          <button className="admin-btn admin-btn-ghost" onClick={() => navigate('/admin/legal/documents')}>
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
          <label>{copy('titleLabel')}</label>
          <input
            type="text"
            value={document.title}
            onChange={(e) => setDocument({ ...document, title: e.target.value })}
            placeholder={copy('titlePlaceholder')}
            className="admin-input"
          />
        </div>

        {isNew && (
          <div className="admin-editor-field">
            <label>{copy('categoryLabel')}</label>
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
          <label>{copy('descriptionLabel')}</label>
          <textarea
            value={document.description}
            onChange={(e) => setDocument({ ...document, description: e.target.value })}
            placeholder={copy('descriptionPlaceholder')}
            className="admin-textarea"
            rows={2}
          />
        </div>

        <div className="admin-editor-field">
          <label>{copy('changeSummaryLabel')}</label>
          <textarea
            value={document.changeSummary}
            onChange={(e) => setDocument({ ...document, changeSummary: e.target.value })}
            placeholder={copy('changeSummaryPlaceholder')}
            className="admin-textarea"
            rows={2}
          />
        </div>
      </div>

      {/* Sections Editor */}
      <div className="admin-editor-sections">
        <div className="admin-sections-header">
          <h2>{copy('sections')}</h2>
          <button className="admin-btn admin-btn-sm" onClick={handleAddSection}>
            <Plus size={16} />
            {copy('addSection')}
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
                  placeholder={copy('sectionTitlePlaceholder')}
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
                    placeholder={copy('sectionContentPlaceholder')}
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
          {saving ? copy('saving') : copy('saveDraft')}
        </button>
        <button className="admin-btn admin-btn-ghost" onClick={() => navigate('/admin/legal/documents')}>
          {copy('cancel')}
        </button>
      </div>
    </div>
  );
}
