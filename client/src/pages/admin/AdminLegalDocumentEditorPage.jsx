// Legal document editor — layout aligned with oxsteed_admin_legal_documents_dashboard.html
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, X, Plus, Trash2, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import { legalAdminPreviewUrl } from '../../utils/legalAdminPreviewUrl';
import './AdminLegalDocumentEditorPage.css';

export default function AdminLegalDocumentEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;

  const [document, setDocument] = useState({
    title: '',
    category: 'terms_of_service',
    description: '',
    changeSummary: '',
    status: 'draft',
    version: 1,
    lastEditedBy: null,
    updatedAt: null,
  });

  const [sections, setSections] = useState([{ key: 'introduction', title: 'Introduction', content: '', isCritical: false }]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sectionChangeSummary, setSectionChangeSummary] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const categories = [
    { value: 'terms_of_service', label: 'Terms of Service' },
    { value: 'privacy_policy', label: 'Privacy Policy' },
    { value: 'helper_agreement', label: 'Helper Agreement' },
    { value: 'seller_agreement', label: 'Seller Agreement' },
    { value: 'payment_terms', label: 'Payment Terms' },
    { value: 'dispute_resolution', label: 'Dispute Resolution' },
  ];

  useEffect(() => {
    if (!isNew) fetchDocument();
  }, [id]);

  useEffect(() => {
    setSectionChangeSummary('');
  }, [selectedIndex]);

  const fetchDocument = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/legal/admin/documents/${id}`);
      const d = data.document;
      setDocument({
        title: d.title || '',
        category: d.category || 'terms_of_service',
        description: d.description || '',
        changeSummary: '',
        status: d.status,
        version: d.version,
        lastEditedBy: d.lastEditedBy,
        updatedAt: d.updatedAt,
      });
      const secs = (data.sections || []).map((s) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        content: s.content || '',
        isCritical: !!s.isCritical,
        history: s.history || [],
        updatedAt: s.updatedAt,
      }));
      setSections(secs.length ? secs : [{ key: 'introduction', title: 'Introduction', content: '', isCritical: false }]);
      setSelectedIndex(0);
    } catch (err) {
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const buildPayload = () => ({
    title: document.title,
    description: document.description,
    changeSummary: document.changeSummary || null,
    sections: sections.map((s, i) => ({
      id: s.id,
      key: s.key,
      title: s.title,
      content: s.content,
      isCritical: !!s.isCritical,
      sectionChangeSummary: i === selectedIndex ? sectionChangeSummary || undefined : undefined,
    })),
  });

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const payload = buildPayload();

      if (isNew) {
        const joined = sections.map((s) => s.content).join('\n\n');
        await api.post('/legal/admin/documents', {
          category: document.category,
          title: document.title,
          description: document.description,
          content: joined,
          sections: payload.sections.map(({ id: sid, ...rest }) => rest),
        });
      } else {
        await api.put(`/legal/admin/documents/${id}`, payload);
      }

      navigate('/admin/legal/documents');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestApproval = async () => {
    if (isNew) return;
    try {
      setSaving(true);
      await api.post(`/legal/admin/documents/${id}/request-approval`, {
        changeSummary: document.changeSummary || sectionChangeSummary,
        changedSections: sections.map((s) => s.key),
      });
      navigate('/admin/legal/approvals');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to request approval');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSection = () => {
    const newKey = `section_${Date.now()}`;
    setSections([...sections, { key: newKey, title: 'New Section', content: '', isCritical: false }]);
    setSelectedIndex(sections.length);
  };

  const handleDeleteSection = (index) => {
    if (sections.length <= 1) return;
    const next = sections.filter((_, i) => i !== index);
    setSections(next);
    setSelectedIndex((prev) => {
      if (index < prev) return prev - 1;
      if (index === prev) return Math.min(prev, next.length - 1);
      return prev;
    });
  };

  const updateSection = (index, field, value) => {
    const next = [...sections];
    next[index] = { ...next[index], [field]: value };
    setSections(next);
  };

  const textareaRef = useRef(null);

  const wrapSelection = (before, after = before) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = sections[selectedIndex]?.content || '';
    const sel = text.slice(start, end);
    const nextContent = text.slice(0, start) + before + sel + after + text.slice(end);
    updateSection(selectedIndex, 'content', nextContent);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    });
  };

  const insertHeading = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const text = sections[selectedIndex]?.content || '';
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nextContent = `${text.slice(0, lineStart)}## ${text.slice(lineStart)}`;
    updateSection(selectedIndex, 'content', nextContent);
  };

  const selected = sections[selectedIndex];

  const handleRestoreSectionVersion = async (versionNum) => {
    if (isNew || !id || !selected?.id) return;
    if (
      !window.confirm(
        `Restore this section to version ${versionNum}? The editor will reload and unsaved changes are lost.`
      )
    ) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await api.post(`/legal/admin/documents/${id}/sections/${selected.id}/restore-version/${versionNum}`);
      await fetchDocument();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to restore section version');
    } finally {
      setSaving(false);
    }
  };

  const formatShortDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  };

  if (loading) {
    return <div className="alde-loading">Loading document…</div>;
  }

  return (
    <div className="alde-dashboard">
      <header className="alde-header">
        <div>
          <h1>{isNew ? 'New legal document' : document.title || 'Edit document'}</h1>
          {!isNew && (
            <p className="alde-sub">
              Version {document.version} · {STATUS_LABEL[document.status] || document.status}
              {document.lastEditedBy && ` · Last edited by ${document.lastEditedBy}`}
            </p>
          )}
        </div>
        <div className="alde-header-actions">
          <button
            type="button"
            className="alde-btn"
            disabled={isNew}
            title={isNew ? 'Save the document first to open a preview' : 'Open public preview (draft)'}
            onClick={() => {
              if (!isNew) window.open(legalAdminPreviewUrl(document.category, id), '_blank');
            }}
          >
            Preview as user
          </button>
          {!isNew && (
            <button type="button" className="alde-btn alde-btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
          {isNew && (
            <button type="button" className="alde-btn alde-btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={16} />
              {saving ? 'Creating…' : 'Create document'}
            </button>
          )}
          {!isNew && (
            <button type="button" className="alde-btn" onClick={handleRequestApproval} disabled={saving}>
              Request approval
            </button>
          )}
          <button type="button" className="alde-btn alde-icon" onClick={() => navigate('/admin/legal/documents')} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className="alde-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="alde-grid">
        <aside className="alde-sidebar">
          {isNew && (
            <div className="alde-field">
              <label className="alde-label">Category</label>
              <select
                className="alde-input"
                value={document.category}
                onChange={(e) => setDocument({ ...document, category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="alde-field">
            <label className="alde-label">Document title</label>
            <input
              className="alde-input"
              value={document.title}
              onChange={(e) => setDocument({ ...document, title: e.target.value })}
              placeholder="e.g. Terms of Service"
            />
          </div>
          <div className="alde-field">
            <label className="alde-label">Description</label>
            <textarea
              className="alde-textarea alde-textarea-sm"
              value={document.description}
              onChange={(e) => setDocument({ ...document, description: e.target.value })}
              rows={2}
            />
          </div>
          <div className="alde-field">
            <label className="alde-label">Overall change summary (optional)</label>
            <input
              className="alde-input"
              value={document.changeSummary}
              onChange={(e) => setDocument({ ...document, changeSummary: e.target.value })}
              placeholder="e.g. Q2 2026 legal refresh"
            />
          </div>

          <span className="alde-sidebar-section-label">Sections</span>
          <button type="button" className="alde-btn alde-btn-block alde-btn-muted" onClick={handleAddSection}>
            <Plus size={16} />
            Add section
          </button>
          <div className="alde-section-list">
            {sections.map((sec, index) => (
              <button
                key={`${sec.key}-${index}`}
                type="button"
                className={`alde-section-row ${index === selectedIndex ? 'active' : ''}`}
                onClick={() => setSelectedIndex(index)}
              >
                <span className="alde-section-row-title">{sec.title || 'Untitled'}</span>
                <span className="alde-section-row-meta">
                  v{document.version} · {formatShortDate(sec.updatedAt || document.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="alde-main">
          {selected ? (
            <>
              <div className="alde-toolbar">
                <span className="alde-toolbar-label">Format</span>
                <button type="button" className="alde-tool" title="Bold" onClick={() => wrapSelection('**')}>
                  <strong>B</strong>
                </button>
                <button type="button" className="alde-tool" title="Italic" onClick={() => wrapSelection('*')}>
                  <em>I</em>
                </button>
                <button type="button" className="alde-tool" title="Underline (HTML)" onClick={() => wrapSelection('<u>', '</u>')}>
                  <u>U</u>
                </button>
                <span className="alde-toolbar-divider" />
                <button type="button" className="alde-tool" title="Heading line" onClick={insertHeading}>
                  H2
                </button>
              </div>

              <div className="alde-field">
                <label className="alde-label">Section title</label>
                <input
                  className="alde-input"
                  value={selected.title}
                  onChange={(e) => updateSection(selectedIndex, 'title', e.target.value)}
                />
              </div>

              <div className="alde-field">
                <label className="alde-label">Critical section</label>
                <label className="alde-check">
                  <input
                    type="checkbox"
                    checked={!!selected.isCritical}
                    onChange={(e) => updateSection(selectedIndex, 'isCritical', e.target.checked)}
                  />
                  <span>Mark as critical (highlighted on public terms page)</span>
                </label>
              </div>

              <div className="alde-field">
                <label className="alde-label">Content</label>
                <textarea
                  ref={textareaRef}
                  className="alde-textarea"
                  value={selected.content}
                  onChange={(e) => updateSection(selectedIndex, 'content', e.target.value)}
                  placeholder="Section body (HTML or plain text)"
                  rows={14}
                />
              </div>

              <div className="alde-field">
                <label className="alde-label">What changed in this update?</label>
                <input
                  className="alde-input"
                  value={sectionChangeSummary}
                  onChange={(e) => setSectionChangeSummary(e.target.value)}
                  placeholder="e.g. Clarified payment dispute timeline"
                />
              </div>

              {selected.history?.length > 0 && (
                <div className="alde-version-history">
                  <h4>Version history (this section)</h4>
                  {selected.history.map((h) => (
                    <div key={`${h.version}-${h.createdAt}`} className="alde-version-item">
                      <div className="alde-version-item-head">
                        <strong>v{h.version}</strong>
                        <span>
                          {formatShortDate(h.createdAt)} · {h.editorName}
                        </span>
                      </div>
                      {h.changeSummary && <div className="alde-version-sum">{h.changeSummary}</div>}
                      <button
                        type="button"
                        className="alde-btn alde-btn-inline alde-restore-btn"
                        disabled={saving || h.version === undefined}
                        onClick={() => handleRestoreSectionVersion(h.version)}
                      >
                        Restore this version
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="alde-footer-actions">
                <button type="button" className="alde-btn" onClick={() => navigate('/admin/legal/documents')}>
                  Discard
                </button>
                <div className="alde-footer-right">
                  {sections.length > 1 && (
                    <button type="button" className="alde-btn alde-btn-danger" onClick={() => handleDeleteSection(selectedIndex)}>
                      <Trash2 size={16} />
                      Remove section
                    </button>
                  )}
                  <button type="button" className="alde-btn alde-btn-primary" onClick={handleSave} disabled={saving}>
                    <Save size={16} />
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="alde-empty">Select a section</div>
          )}
        </main>
      </div>
    </div>
  );
}

const STATUS_LABEL = {
  draft: 'Draft',
  pending_review: 'Pending review',
  scheduled: 'Scheduled',
  live: 'Live',
  archived: 'Archived',
};
