import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import consultingActionItemsApi from '../api/consultingActionItems';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const ASSIGNED_TO_TYPES = ['client', 'consultant'];

export default function ActionItemsPanel({ sessionId, isEditable = false }) {
  const { t } = useTranslation();
  const [actionItems, setActionItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dueDate: '',
    priority: 'medium',
    assignedToType: 'client',
    clientVisible: true,
  });

  // Load action items on mount
  useEffect(() => {
    loadActionItems();
  }, [sessionId]);

  const loadActionItems = async () => {
    try {
      setLoading(true);
      const response = await consultingActionItemsApi.getSessionActionItems(sessionId);
      setActionItems(response.data);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load action items');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async () => {
    try {
      if (!formData.title.trim()) {
        toast.error(t('actionItems.titleRequired') || 'Title is required');
        return;
      }

      setLoading(true);
      await consultingActionItemsApi.createActionItem(sessionId, formData);
      toast.success(t('actionItems.itemCreated') || 'Action item created');
      setFormData({
        title: '',
        description: '',
        dueDate: '',
        priority: 'medium',
        assignedToType: 'client',
        clientVisible: true,
      });
      setShowAddForm(false);
      loadActionItems();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to create action item');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateItem = async (itemId) => {
    try {
      setLoading(true);
      await consultingActionItemsApi.updateActionItem(sessionId, itemId, formData);
      toast.success(t('actionItems.itemUpdated') || 'Action item updated');
      setEditingId(null);
      setFormData({
        title: '',
        description: '',
        dueDate: '',
        priority: 'medium',
        assignedToType: 'client',
        clientVisible: true,
      });
      loadActionItems();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to update action item');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm(t('actionItems.confirmDelete') || 'Are you sure you want to delete this item?')) {
      return;
    }

    try {
      setLoading(true);
      await consultingActionItemsApi.deleteActionItem(sessionId, itemId);
      toast.success(t('actionItems.itemDeleted') || 'Action item deleted');
      loadActionItems();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to delete action item');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteItem = async (itemId) => {
    try {
      setLoading(true);
      await consultingActionItemsApi.completeActionItem(sessionId, itemId);
      toast.success(t('actionItems.itemMarkedComplete') || 'Action item marked complete');
      loadActionItems();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to complete action item');
    } finally {
      setLoading(false);
    }
  };

  const handleEditItem = (item) => {
    setEditingId(item.id);
    setFormData({
      title: item.title,
      description: item.description || '',
      dueDate: item.due_date ? item.due_date.split('T')[0] : '',
      priority: item.priority || 'medium',
      assignedToType: item.assigned_to_type || 'client',
      clientVisible: item.client_visible !== false,
    });
  };

  const panelStyle = {
    background: 'var(--color-surface)',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '2rem',
  };

  const titleStyle = {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    marginBottom: '1.5rem',
    color: 'var(--color-text)',
  };

  const formGroupStyle = {
    marginBottom: '1rem',
  };

  const labelStyle = {
    display: 'block',
    fontWeight: '500',
    marginBottom: '0.5rem',
    color: 'var(--color-text)',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
  };

  const textareaStyle = {
    ...inputStyle,
    minHeight: '100px',
    resize: 'vertical',
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem',
  };

  const buttonStyle = {
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '0.875rem',
    transition: 'all 0.2s',
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--color-primary)',
    color: 'white',
    opacity: loading ? 0.6 : 1,
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    background: 'transparent',
    color: 'var(--color-primary)',
    border: '1px solid var(--color-primary)',
  };

  const dangerButtonStyle = {
    ...buttonStyle,
    background: '#ef4444',
    color: 'white',
    opacity: loading ? 0.6 : 1,
  };

  const itemCardStyle = {
    background: 'var(--color-bg)',
    padding: '1.25rem',
    borderRadius: '8px',
    marginBottom: '1rem',
    borderLeft: '4px solid var(--color-primary)',
  };

  const itemTitleStyle = {
    fontSize: '1rem',
    fontWeight: '600',
    color: 'var(--color-text)',
    marginBottom: '0.5rem',
  };

  const itemMetaStyle = {
    fontSize: '0.85rem',
    color: 'var(--color-text-muted)',
    marginBottom: '0.75rem',
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  };

  const priorityBadgeStyle = (priority) => {
    const colors = {
      low: '#10b981',
      medium: '#f59e0b',
      high: '#f97316',
      critical: '#ef4444',
    };

    return {
      display: 'inline-block',
      padding: '0.25rem 0.75rem',
      borderRadius: '4px',
      background: colors[priority] || colors.medium,
      color: 'white',
      fontSize: '0.75rem',
      fontWeight: '600',
    };
  };

  const itemButtonsStyle = {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
  };

  const itemButtonStyle = {
    padding: '0.5rem 1rem',
    fontSize: '0.75rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'all 0.2s',
  };

  return (
    <div style={panelStyle}>
      <h3 style={titleStyle}>{t('actionItems.actionItems') || 'Action Items'}</h3>

      {isEditable && !showAddForm && !editingId && (
        <button
          style={primaryButtonStyle}
          onClick={() => setShowAddForm(true)}
          disabled={loading}
        >
          {t('actionItems.addItem') || '+ Add Action Item'}
        </button>
      )}

      {/* Add/Edit Form */}
      {(showAddForm || editingId) && isEditable && (
        <div style={{ background: 'var(--color-surface)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('actionItems.title') || 'Title *'}</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Update business website"
              style={inputStyle}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>{t('actionItems.description') || 'Description'}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Additional details..."
              style={textareaStyle}
            />
          </div>

          <div style={gridStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>{t('actionItems.dueDate') || 'Due Date'}</label>
              <input
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>{t('actionItems.priority') || 'Priority'}</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                style={inputStyle}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={gridStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>{t('actionItems.assignedTo') || 'Assigned To'}</label>
              <select
                value={formData.assignedToType}
                onChange={(e) => setFormData({ ...formData, assignedToType: e.target.value })}
                style={inputStyle}
              >
                {ASSIGNED_TO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>{t('actionItems.clientVisible') || 'Visible to Client'}</label>
              <input
                type="checkbox"
                checked={formData.clientVisible}
                onChange={(e) => setFormData({ ...formData, clientVisible: e.target.checked })}
                style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <button
              style={primaryButtonStyle}
              onClick={() => (editingId ? handleUpdateItem(editingId) : handleAddItem())}
              disabled={loading}
            >
              {editingId ? (t('common.update') || 'Update') : (t('common.create') || 'Create')}
            </button>
            <button
              style={secondaryButtonStyle}
              onClick={() => {
                setShowAddForm(false);
                setEditingId(null);
                setFormData({
                  title: '',
                  description: '',
                  dueDate: '',
                  priority: 'medium',
                  assignedToType: 'client',
                  clientVisible: true,
                });
              }}
              disabled={loading}
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Action Items List */}
      {actionItems.length > 0 ? (
        <div>
          {actionItems.map((item) => (
            <div
              key={item.id}
              style={{
                ...itemCardStyle,
                borderLeft: `4px solid ${item.completed ? '#10b981' : 'var(--color-primary)'}`,
                opacity: item.completed ? 0.7 : 1,
              }}
            >
              <div style={{ ...itemTitleStyle, textDecoration: item.completed ? 'line-through' : 'none' }}>
                {item.title}
              </div>
              {item.description && (
                <p style={{ color: 'var(--color-text-muted)', margin: '0.5rem 0', fontSize: '0.875rem' }}>
                  {item.description}
                </p>
              )}
              <div style={itemMetaStyle}>
                <span style={priorityBadgeStyle(item.priority)}>
                  {t(`actionItems.priority.${item.priority}`) || item.priority}
                </span>
                {item.due_date && (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    {t('actionItems.dueDate') || 'Due'}: {new Date(item.due_date).toLocaleDateString()}
                  </span>
                )}
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  {t('actionItems.assignedTo') || 'Assigned to'}: {item.assigned_to_type}
                </span>
                {item.client_visible && (
                  <span style={{ color: '#3b82f6', fontSize: '0.85rem' }}>
                    {t('actionItems.visibleToClient') || '👁 Visible'}
                  </span>
                )}
              </div>

              {isEditable && (
                <div style={itemButtonsStyle}>
                  {!item.completed && (
                    <button
                      style={{ ...itemButtonStyle, background: '#10b981', color: 'white' }}
                      onClick={() => handleCompleteItem(item.id)}
                      disabled={loading}
                    >
                      {t('actionItems.markComplete') || '✓ Done'}
                    </button>
                  )}
                  <button
                    style={{ ...itemButtonStyle, background: '#3b82f6', color: 'white' }}
                    onClick={() => handleEditItem(item)}
                    disabled={loading}
                  >
                    {t('common.edit') || 'Edit'}
                  </button>
                  <button
                    style={{ ...itemButtonStyle, background: '#ef4444', color: 'white' }}
                    onClick={() => handleDeleteItem(item.id)}
                    disabled={loading}
                  >
                    {t('common.delete') || 'Delete'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 0' }}>
          {t('actionItems.noItems') || 'No action items yet'}
        </p>
      )}
    </div>
  );
}
