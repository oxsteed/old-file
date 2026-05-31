import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Edit2, Copy, Check, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const CATEGORIES = ['general', 'appointment', 'follow_up', 'invoice', 'promotion', 'review_request', 'welcome', 'cancellation'];
const VARIABLES = ['{client_name}', '{business_name}', '{service_name}', '{appointment_date}', '{appointment_time}', '{amount}'];

export function MessageTemplatesManager({ businessId }) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'general', subject: '', body: '' });

  const categoryLabel = (cat) => t(`businessMessageTemplates.category.${cat}`);

  useEffect(() => { load(); }, [businessId, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/businesses/${businessId}/message-templates`, { params: filter ? { category: filter } : {} });
      setTemplates(res.data || []);
    } catch {
      toast.error(t('businessMessageTemplates.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!form.name || !form.body) return toast.error(t('businessMessageTemplates.toastNameAndBodyRequired'));
    try {
      if (editing) {
        await api.put(`/businesses/${businessId}/message-templates/${editing.id}`, form);
        toast.success(t('businessMessageTemplates.toastUpdated'));
      } else {
        await api.post(`/businesses/${businessId}/message-templates`, form);
        toast.success(t('businessMessageTemplates.toastCreated'));
      }
      setShowForm(false);
      setEditing(null);
      setForm({ name: '', category: 'general', subject: '', body: '' });
      load();
    } catch {
      toast.error(t('businessMessageTemplates.toastSaveFailed'));
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t('businessMessageTemplates.deleteConfirm'))) return;
    try {
      await api.delete(`/businesses/${businessId}/message-templates/${id}`);
      toast.success(t('businessMessageTemplates.deleteSuccess'));
      load();
    } catch {
      toast.error(t('businessMessageTemplates.deleteFailed'));
    }
  };

  const copyBody = async (template) => {
    navigator.clipboard.writeText(template.body);
    setCopied(template.id);
    setTimeout(() => setCopied(null), 2000);
    toast.success(t('businessMessageTemplates.toastCopied'));
    try {
      await api.post(`/businesses/${businessId}/message-templates/${template.id}/use`);
    } catch {}
  };

  const startEdit = (template) => {
    setEditing(template);
    setForm({
      name: template.name,
      category: template.category,
      subject: template.subject || '',
      body: template.body,
    });
    setShowForm(true);
  };

  const insertVar = (value) => {
    setForm((f) => ({ ...f, body: `${f.body}${value}` }));
  };

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = templates.filter((item) => item.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessMessageTemplates.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessMessageTemplates.subtitle')}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: '#f97316',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.6rem 1.2rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          <Plus size={16} /> {t('businessMessageTemplates.newTemplate')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setFilter('')}
          style={{
            padding: '0.3rem 0.75rem',
            borderRadius: '999px',
            border: '1px solid var(--border-color)',
            background: filter === '' ? '#f97316' : 'transparent',
            color: filter === '' ? '#fff' : 'var(--app-text)',
            cursor: 'pointer',
            fontSize: '0.8rem',
          }}
        >
          {t('businessMessageTemplates.all')}
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(filter === c ? '' : c)}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: '999px',
              border: '1px solid var(--border-color)',
              background: filter === c ? '#f97316' : 'transparent',
              color: filter === c ? '#fff' : 'var(--app-text)',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            {categoryLabel(c)}
          </button>
        ))}
      </div>

      {showForm && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem' }}>{editing ? t('businessMessageTemplates.editTemplate') : t('businessMessageTemplates.newTemplate')}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {[
              ['name', 'text', t('businessMessageTemplates.form.templateName'), 'Template Name'],
              ['subject', 'text', t('businessMessageTemplates.form.emailSubject'), 'Email Subject (optional)'],
            ].map(([k, type, label, fallback]) => (
              <div key={k}>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>
                  {label || fallback}
                </label>
                <input
                  type={type}
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessMessageTemplates.form.category')}</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '0.5rem',
                  background: 'var(--card-bg)',
                  color: 'var(--app-text)',
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{t('businessMessageTemplates.form.messageBody')}</label>
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted-text)' }}>{t('businessMessageTemplates.insertVariables')}</span>
                {VARIABLES.map((v) => (
                  <button
                    key={v}
                    onClick={() => insertVar(v)}
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.1rem 0.4rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '0.25rem',
                      background: 'var(--app-bg)',
                      color: 'var(--muted-text)',
                      cursor: 'pointer',
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={5}
              style={{
                width: '100%',
                padding: '0.6rem',
                border: '1px solid var(--border-color)',
                borderRadius: '0.5rem',
                background: 'var(--card-bg)',
                color: 'var(--app-text)',
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
              placeholder={t('businessMessageTemplates.form.bodyPlaceholder')}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid var(--border-color)',
                borderRadius: '0.5rem',
                background: 'transparent',
                color: 'var(--app-text)',
                cursor: 'pointer',
              }}
            >
              {t('businessMessageTemplates.cancel')}
            </button>
            <button
              onClick={save}
              style={{
                padding: '0.5rem 1rem',
                background: '#f97316',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {t('businessMessageTemplates.saveTemplate')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--muted-text)' }}>{t('businessMessageTemplates.loading')}</p>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <MessageSquare size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>{t('businessMessageTemplates.emptyTitle')}</p>
          <div style={{ fontSize: '0.875rem', marginTop: '0.5rem', color: 'var(--muted-text)' }}>{t('businessMessageTemplates.emptyBody')}</div>
        </div>
      ) : filter ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {templates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              copied={copied}
              onCopy={copyBody}
              onEdit={startEdit}
              onDelete={remove}
            />
          ))}
        </div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted-text)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              {categoryLabel(cat)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {items.map((template) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  copied={copied}
                  onCopy={copyBody}
                  onEdit={startEdit}
                  onDelete={remove}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TemplateRow({ template, copied, onCopy, onEdit, onDelete }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', cursor: 'pointer' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{template.name}</div>
          {!expanded && (
            <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>{template.body}</div>
          )}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--muted-text)' }}>
          {t('businessMessageTemplates.usesLabel', { count: template.use_count || 0 })}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(template);
          }}
          title={t('businessMessageTemplates.copy')}
          style={{ padding: '0.35rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}
        >
          {copied === template.id ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(template);
          }}
          title={t('businessMessageTemplates.edit')}
          style={{ padding: '0.35rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(template.id);
          }}
          title={t('businessMessageTemplates.delete')}
          style={{ padding: '0.35rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)', background: 'var(--app-bg)', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {template.subject && (
            <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--muted-text)', fontSize: '0.8rem' }}>
              {t('businessMessageTemplates.subjectPrefix')} {template.subject}
            </div>
          )}
          {template.body}
        </div>
      )}
    </div>
  );
}
