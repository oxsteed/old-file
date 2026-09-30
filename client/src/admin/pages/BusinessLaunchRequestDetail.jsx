import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import ConfirmDialog from '../lib/ConfirmDialog';

const STATUS_COLORS = {
  pending: '#FFA500',
  contacted: '#4F46E5',
  kickoff_scheduled: '#8B5CF6',
  in_progress: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
};

export default function BusinessLaunchRequestDetail({ request, onClose, onStatusUpdate }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [consultants, setConsultants] = useState([]);
  const [consultantsLoading, setConsultantsLoading] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [assignmentForm, setAssignmentForm] = useState({
    consultant_user_id: request.consultant_assigned_id || '',
    assigned_oxsteed_cut_bps: request.assigned_oxsteed_cut_bps || 2000,
    note_text: '',
  });
  const [customMessage, setCustomMessage] = useState({
    subject: '',
    message_html: '',
  });

  // Abortable, sequence-guarded per-resource loader. A newer load of the same
  // resource cancels the in-flight one, and a slower earlier response can
  // never clobber newer data. Individual loading flags keep empty states
  // from flashing while their own resource is still fetching.
  const loadersRef = useRef({});

  useEffect(() => () => {
    Object.values(loadersRef.current).forEach(({ controller }) => controller?.abort());
  }, []);

  async function loadResource(key, fetcher, { setData, setLoading, onError } = {}) {
    const prev = loadersRef.current[key];
    prev?.controller?.abort();
    const controller = new AbortController();
    const seq = (prev?.seq || 0) + 1;
    loadersRef.current[key] = { controller, seq };
    const isCurrent = () => loadersRef.current[key]?.seq === seq;
    setLoading?.(true);
    try {
      const value = await fetcher(controller.signal);
      if (!isCurrent()) return;
      setData?.(value);
    } catch (err) {
      if (controller.signal.aborted || !isCurrent()) return;
      onError?.(err);
    } finally {
      if (isCurrent()) setLoading?.(false);
    }
  }

  useEffect(() => {
    loadNotes();
    loadMessages();
    loadTemplates();
    loadConsultants();
    setAssignmentForm({
      consultant_user_id: request.consultant_assigned_id || '',
      assigned_oxsteed_cut_bps: request.assigned_oxsteed_cut_bps || 2000,
      note_text: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  async function loadNotes() {
    await loadResource(
      'notes',
      (signal) => axios.get(`/consulting/business-launch/requests/${request.id}/notes`, { signal }).then(r => r.data || []),
      { setData: setNotes, setLoading: setNotesLoading, onError: () => toast.error(t('common.errorLoading')) }
    );
  }

  async function loadMessages() {
    await loadResource(
      'messages',
      (signal) => axios.get(`/consulting/business-launch/requests/${request.id}/messages`, { signal }).then(r => r.data || []),
      { setData: setMessages, setLoading: setMessagesLoading, onError: () => toast.error(t('common.errorLoading')) }
    );
  }

  async function loadTemplates() {
    await loadResource(
      'templates',
      (signal) => axios.get('/consulting/business-launch/message-templates', { signal }).then(r => r.data || []),
      { setData: setTemplates, setLoading: setTemplatesLoading, onError: () => toast.error(t('common.errorLoading')) }
    );
  }

  async function loadConsultants() {
    await loadResource(
      'consultants',
      (signal) => {
        const params = new URLSearchParams();
        if (request.operating_country) params.set('country', request.operating_country);
        if (request.operating_state) params.set('region', request.operating_state);
        if (request.package_price) params.set('package_price', request.package_price);
        return axios.get(`/consulting/business-launch/consultants?${params}`, { signal }).then(r => r.data.consultants || []);
      },
      { setData: setConsultants, setLoading: setConsultantsLoading, onError: () => toast.error(t('adminBusinessLaunchDetail.loadConsultantsFailed')) }
    );
  }

  async function addNote() {
    if (!newNote.trim()) {
      toast.error(t('businessLaunchAdmin.enterNote'));
      return;
    }

    try {
      setNoteLoading(true);
      await axios.post(`/consulting/business-launch/requests/${request.id}/notes`, {
        note_text: newNote,
        is_internal: true,
      });
      setNewNote('');
      loadNotes();
      toast.success(t('businessLaunchAdmin.noteAdded'));
    } catch (err) {
      toast.error(t('common.errorUpdating'));
    } finally {
      setNoteLoading(false);
    }
  }

  // Note deletion is destructive: it goes through a confirmation dialog.
  // ConfirmDialog stays open and shows the error if the DELETE fails.
  async function confirmDeleteNote() {
    const noteId = deleteTarget;
    await axios.delete(`/consulting/business-launch/notes/${noteId}`);
    setDeleteTarget(null);
    loadNotes();
    toast.success(t('businessLaunchAdmin.noteDeleted'));
  }

  async function sendMessage() {
    const message = selectedTemplate
      ? templates.find(t => t.id === selectedTemplate)
      : customMessage;

    if (!message.subject || !message.message_html) {
      toast.error(t('businessLaunchAdmin.fillMessage'));
      return;
    }

    try {
      setMessageLoading(true);
      await axios.post(`/consulting/business-launch/requests/${request.id}/send-message`, {
        subject: message.subject,
        message_html: message.message_html,
        message_plain: message.body || '',
      });

      setSelectedTemplate('');
      setCustomMessage({ subject: '', message_html: '' });
      loadMessages();
      toast.success(t('businessLaunchAdmin.messageSent'));
    } catch (err) {
      toast.error(t('common.errorUpdating'));
    } finally {
      setMessageLoading(false);
    }
  }

  async function assignConsultant() {
    if (!assignmentForm.consultant_user_id) {
      toast.error(t('adminBusinessLaunchDetail.selectConsultantFirst'));
      return;
    }

    // Referral cut is basis points: a finite integer from 0 through 10000.
    const bps = Number(assignmentForm.assigned_oxsteed_cut_bps);
    if (!Number.isFinite(bps) || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
      toast.error(t('businessLaunchAdmin.invalidBps'));
      return;
    }

    try {
      setAssignmentLoading(true);
      await axios.post(`/consulting/business-launch/requests/${request.id}/assign-consultant`, {
        ...assignmentForm,
        assigned_oxsteed_cut_bps: bps,
      });
      toast.success(t('adminBusinessLaunchDetail.consultantAssigned'));
      onStatusUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('adminBusinessLaunchDetail.assignConsultantFailed'));
    } finally {
      setAssignmentLoading(false);
    }
  }

  const containerStyle = {
    background: 'var(--color-surface)',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '900px',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  const tabStyle = {
    display: 'flex',
    gap: '1rem',
    borderBottom: '2px solid var(--color-border)',
    marginBottom: '1.5rem',
  };

  const tabButtonStyle = (isActive) => ({
    padding: '0.75rem 1.5rem',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontWeight: 600,
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: isActive ? '3px solid var(--color-primary)' : 'none',
    marginBottom: '-2px',
  });

  const sectionStyle = {
    marginBottom: '2rem',
  };

  const sectionTitleStyle = {
    fontSize: '1.1rem',
    fontWeight: 600,
    marginBottom: '1rem',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.95rem',
    marginBottom: '0.5rem',
  };

  const buttonStyle = {
    padding: '0.75rem 1.5rem',
    borderRadius: '6px',
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
  };

  const noteCardStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    borderRadius: '6px',
    marginBottom: '1rem',
    borderLeft: '4px solid var(--color-primary)',
  };

  const messageCardStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    borderRadius: '6px',
    marginBottom: '1rem',
    borderLeft: '4px solid #10B981',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
          {request.business_name || `${request.first_name} ${request.last_name}`}
        </h2>
        <div style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <span style={{
            background: STATUS_COLORS[request.status],
            color: 'white',
            padding: '0.4rem 0.8rem',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}>
            {request.status.replace('_', ' ')}
          </span>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {request.package_selected} • ${request.package_price}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={tabStyle}>
        <button
          style={tabButtonStyle(activeTab === 'overview')}
          onClick={() => setActiveTab('overview')}
        >
          {t('adminBusinessLaunchDetail.tabOverview')}
        </button>
        <button
          style={tabButtonStyle(activeTab === 'notes')}
          onClick={() => setActiveTab('notes')}
        >
          {t('adminBusinessLaunchDetail.tabNotes', { count: notes.length })}
        </button>
        <button
          style={tabButtonStyle(activeTab === 'messages')}
          onClick={() => setActiveTab('messages')}
        >
          {t('adminBusinessLaunchDetail.tabMessages', { count: messages.length })}
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionContactInfo')}</div>
            <p><strong>{t('adminBusinessLaunchDetail.labelEmail')}</strong> {request.email}</p>
            <p><strong>{t('adminBusinessLaunchDetail.labelPhone')}</strong> {request.phone || '-'}</p>
            <p><strong>{t('adminBusinessLaunchDetail.labelReferralSource')}</strong> {request.referral_source || '-'}</p>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionBusinessDetails')}</div>
            <p><strong>{t('adminBusinessLaunchDetail.labelSkill')}</strong> {request.skill_description}</p>
            <p><strong>{t('adminBusinessLaunchDetail.labelTargetMarket')}</strong> {request.target_market}</p>
            <p><strong>{t('adminBusinessLaunchDetail.labelCountry')}</strong> {request.operating_country || '-'}</p>
            <p><strong>{t('adminBusinessLaunchDetail.labelState')}</strong> {request.operating_state || '-'}</p>
            <p><strong>{t('adminBusinessLaunchDetail.labelCurrentPhase')}</strong> {request.current_phase || t('adminBusinessLaunchDetail.notSpecified')} / 25</p>
            {request.business_name && <p><strong>{t('adminBusinessLaunchDetail.labelBusinessName')}</strong> {request.business_name}</p>}
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionConsultantMatch')}</div>
            {request.consultant_first_name ? (
              <div style={{ ...noteCardStyle, borderLeft: '4px solid #10B981', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 0.35rem' }}>
                  <strong>{request.consultant_first_name} {request.consultant_last_name}</strong>
                  {request.consultant_headline ? `: ${request.consultant_headline}` : ''}
                </p>
                <p style={{ margin: '0.2rem 0', color: 'var(--color-text-muted)' }}>
                  {t('adminBusinessLaunchDetail.assignmentStatusLine', {
                    status: request.consultant_assignment_status || t('adminBusinessLaunchDetail.defaultAssignmentStatus'),
                  })}
                </p>
                <p style={{ margin: '0.2rem 0', color: 'var(--color-text-muted)' }}>
                  {t('adminBusinessLaunchDetail.consultantShareLine', {
                    cut: ((request.assigned_oxsteed_cut_bps || 0) / 100).toFixed(2),
                    share: ((request.estimated_consultant_share_cents || 0) / 100).toFixed(2),
                  })}
                </p>
              </div>
            ) : (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('adminBusinessLaunchDetail.noConsultantText')}</p>
            )}

            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>{t('adminBusinessLaunchDetail.fieldConsultant')}</label>
                <select
                  value={assignmentForm.consultant_user_id}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, consultant_user_id: e.target.value }))}
                  style={inputStyle}
                  disabled={consultantsLoading}
                >
                  <option value="">{t('adminBusinessLaunchDetail.selectConsultantOption')}</option>
                  {consultants.map((consultant) => (
                    <option key={consultant.user_id} value={consultant.user_id}>
                      {consultant.first_name} {consultant.last_name} • {consultant.home_country || t('adminBusinessLaunchDetail.globalScope')} • {t('adminBusinessLaunchDetail.activeReferralsCount', { count: consultant.active_referrals })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>{t('adminBusinessLaunchDetail.fieldReferralCut')}</label>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={assignmentForm.assigned_oxsteed_cut_bps}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, assigned_oxsteed_cut_bps: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>{t('adminBusinessLaunchDetail.fieldAssignmentNote')}</label>
                <textarea
                  value={assignmentForm.note_text}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, note_text: e.target.value }))}
                  placeholder={t('adminBusinessLaunchDetail.placeholderAssignmentNote')}
                  style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button style={buttonStyle} onClick={assignConsultant} disabled={assignmentLoading || consultantsLoading}>
                {assignmentLoading ? t('adminBusinessLaunchDetail.assigningButton') : t('adminBusinessLaunchDetail.assignConsultantButton')}
              </button>
              <button
                type="button"
                onClick={loadConsultants}
                style={{ ...buttonStyle, background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                {t('adminBusinessLaunchDetail.refreshMatchesButton')}
              </button>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionSetupItems', { count: request.setup_items_selected?.length || 0 })}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {request.setup_items_selected?.map((item, idx) => (
                <span
                  key={idx}
                  style={{
                    background: 'var(--color-primary)',
                    color: 'white',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Notes Tab */}
      {activeTab === 'notes' && (
        <div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionAddNote')}</div>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder={t('adminBusinessLaunchDetail.placeholderNewNote')}
              style={{
                ...inputStyle,
                minHeight: '100px',
                resize: 'vertical',
                fontFamily: 'system-ui, sans-serif',
              }}
            />
            <button
              style={buttonStyle}
              onClick={addNote}
              disabled={noteLoading}
            >
              {noteLoading ? t('adminBusinessLaunchDetail.addingButton') : t('adminBusinessLaunchDetail.addNoteButton')}
            </button>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionNotes')}</div>
            {notesLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
            ) : notes.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('adminBusinessLaunchDetail.emptyNotes')}</p>
            ) : (
              notes.map(note => (
                <div key={note.id} style={noteCardStyle}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'start',
                    marginBottom: '0.5rem',
                  }}>
                    <div>
                      <strong>{note.first_name} {note.last_name}</strong>
                      <p style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.85rem',
                        color: 'var(--color-text-muted)',
                      }}>
                        {new Date(note.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => setDeleteTarget(note.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-error)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      {t('adminBusinessLaunchDetail.deleteButton')}
                    </button>
                  </div>
                  <p style={{ margin: '0.75rem 0 0', whiteSpace: 'pre-wrap' }}>
                    {note.note_text}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionSendMessage')}</div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                {t('adminBusinessLaunchDetail.fieldUseTemplate')}
              </label>
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                style={inputStyle}
                disabled={templatesLoading}
              >
                <option value="">{templatesLoading ? t('common.loading') : t('adminBusinessLaunchDetail.customMessageOption')}</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            {!selectedTemplate && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  {t('adminBusinessLaunchDetail.fieldSubject')}
                </label>
                <input
                  type="text"
                  value={customMessage.subject}
                  onChange={e => setCustomMessage({ ...customMessage, subject: e.target.value })}
                  placeholder={t('adminBusinessLaunchDetail.placeholderSubject')}
                  style={inputStyle}
                />

                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  {t('adminBusinessLaunchDetail.fieldMessageHtml')}
                </label>
                <textarea
                  value={customMessage.message_html}
                  onChange={e => setCustomMessage({ ...customMessage, message_html: e.target.value })}
                  placeholder={t('adminBusinessLaunchDetail.placeholderMessageHtml')}
                  style={{
                    ...inputStyle,
                    minHeight: '150px',
                    resize: 'vertical',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            )}

            <button
              style={buttonStyle}
              onClick={sendMessage}
              disabled={messageLoading}
            >
              {messageLoading ? t('adminBusinessLaunchDetail.sendingButton') : t('adminBusinessLaunchDetail.sendMessageButton')}
            </button>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('adminBusinessLaunchDetail.sectionMessageHistory')}</div>
            {messagesLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
            ) : messages.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('adminBusinessLaunchDetail.emptyMessages')}</p>
            ) : (
              messages.map(msg => (
                <div key={msg.id} style={messageCardStyle}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'start',
                    marginBottom: '0.5rem',
                  }}>
                    <div>
                      <strong>{msg.subject}</strong>
                      <p style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.85rem',
                        color: 'var(--color-text-muted)',
                      }}>
                        {msg.first_name} {msg.last_name} • {new Date(msg.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: msg.status === 'sent' ? '#D1FAE5' : msg.status === 'failed' ? '#FEE2E2' : '#FEF3C7',
                      color: msg.status === 'sent' ? '#065F46' : msg.status === 'failed' ? '#7F1D1D' : '#92400E',
                    }}>
                      {msg.status}
                    </span>
                  </div>
                  {msg.error_message && (
                    <p style={{
                      margin: '0.5rem 0 0',
                      color: 'var(--color-error)',
                      fontSize: '0.85rem',
                    }}>
                      {t('adminBusinessLaunchDetail.messageErrorLine', { error: msg.error_message })}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Close Button */}
      <button
        style={{
          ...buttonStyle,
          width: '100%',
          marginTop: '1rem',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
        onClick={onClose}
      >
        {t('adminBusinessLaunchDetail.closeButton')}
      </button>

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={t('businessLaunchAdmin.deleteNoteTitle')}
        message={t('businessLaunchAdmin.deleteNoteConfirm')}
        onConfirm={confirmDeleteNote}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
