import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';

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
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [customMessage, setCustomMessage] = useState({
    subject: '',
    message_html: '',
  });

  useEffect(() => {
    loadNotes();
    loadMessages();
    loadTemplates();
  }, [request.id]);

  async function loadNotes() {
    try {
      const res = await axios.get(`/consulting/business-launch/requests/${request.id}/notes`);
      setNotes(res.data || []);
    } catch (err) {
      toast.error(t('common.errorLoading'));
    }
  }

  async function loadMessages() {
    try {
      const res = await axios.get(`/consulting/business-launch/requests/${request.id}/messages`);
      setMessages(res.data || []);
    } catch (err) {
      toast.error(t('common.errorLoading'));
    }
  }

  async function loadTemplates() {
    try {
      const res = await axios.get(`/consulting/business-launch/message-templates`);
      setTemplates(res.data || []);
    } catch (err) {
      toast.error(t('common.errorLoading'));
    }
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

  async function deleteNote(noteId) {
    if (!window.confirm(t('businessLaunchAdmin.deleteNoteConfirm'))) return;

    try {
      await axios.delete(`/consulting/business-launch/notes/${noteId}`);
      loadNotes();
      toast.success(t('businessLaunchAdmin.noteDeleted'));
    } catch (err) {
      toast.error(t('common.errorUpdating'));
    }
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
          Overview
        </button>
        <button
          style={tabButtonStyle(activeTab === 'notes')}
          onClick={() => setActiveTab('notes')}
        >
          Internal Notes ({notes.length})
        </button>
        <button
          style={tabButtonStyle(activeTab === 'messages')}
          onClick={() => setActiveTab('messages')}
        >
          Messages ({messages.length})
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Contact Information</div>
            <p><strong>Email:</strong> {request.email}</p>
            <p><strong>Phone:</strong> {request.phone || '—'}</p>
            <p><strong>Referral Source:</strong> {request.referral_source || '—'}</p>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Business Details</div>
            <p><strong>Skill:</strong> {request.skill_description}</p>
            <p><strong>Target Market:</strong> {request.target_market}</p>
            <p><strong>State:</strong> {request.operating_state || '—'}</p>
            <p><strong>Current Phase:</strong> {request.current_phase || 'Not specified'} / 25</p>
            {request.business_name && <p><strong>Business Name:</strong> {request.business_name}</p>}
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Setup Items ({request.setup_items_selected?.length || 0})</div>
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
            <div style={sectionTitleStyle}>Add Internal Note</div>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Add a private note (only visible to admins)..."
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
              {noteLoading ? 'Adding...' : 'Add Note'}
            </button>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Notes</div>
            {notes.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No notes yet</p>
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
                      onClick={() => deleteNote(note.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-error)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      Delete
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
            <div style={sectionTitleStyle}>Send Message to Client</div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                Use Template (Optional)
              </label>
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Create Custom Message —</option>
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
                  Subject
                </label>
                <input
                  type="text"
                  value={customMessage.subject}
                  onChange={e => setCustomMessage({ ...customMessage, subject: e.target.value })}
                  placeholder="Email subject"
                  style={inputStyle}
                />

                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Message (HTML)
                </label>
                <textarea
                  value={customMessage.message_html}
                  onChange={e => setCustomMessage({ ...customMessage, message_html: e.target.value })}
                  placeholder="Email message (supports HTML)"
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
              {messageLoading ? 'Sending...' : 'Send Message'}
            </button>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Message History</div>
            {messages.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No messages sent yet</p>
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
                      Error: {msg.error_message}
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
        Close
      </button>
    </div>
  );
}
