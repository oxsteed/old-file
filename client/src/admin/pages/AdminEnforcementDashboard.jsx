import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Shield, Clock, Loader, X } from 'lucide-react';
import api from '../../api/axios';
import '../styles/AdminEnforcementDashboard.css';

const AdminEnforcementDashboard = () => {
  const { t } = useTranslation();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ actionType: '', isActive: '' });
  const [pagination, setPagination] = useState({ offset: 0, limit: 20 });
  const [showNewActionModal, setShowNewActionModal] = useState(false);
  const [newAction, setNewAction] = useState({
    userId: '',
    actionType: 'warning',
    reason: '',
    description: '',
    restrictions: {},
    expiresAt: ''
  });
  const [creatingAction, setCreatingAction] = useState(false);

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset
      });

      if (filters.actionType) params.append('actionType', filters.actionType);
      if (filters.isActive !== '') params.append('isActive', filters.isActive);

      const response = await api.get('/enforcement/all', { params });
      const { data, pagination: paginationData } = response.data;
      setActions(data);
      setPagination(paginationData);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.offset, pagination.limit]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const handleCreateAction = async (e) => {
    e.preventDefault();
    setError(null);

    if (!newAction.userId.trim()) {
      setError(t('adminEnforcement.userIdRequired'));
      return;
    }

    if (!newAction.reason.trim()) {
      setError(t('adminEnforcement.reasonRequired'));
      return;
    }

    try {
      setCreatingAction(true);

      const payload = {
        userId: newAction.userId,
        actionType: newAction.actionType,
        reason: newAction.reason,
        description: newAction.description || null,
        restrictions: Object.keys(newAction.restrictions).length > 0 ? newAction.restrictions : null,
        expiresAt: newAction.expiresAt || null
      };

      await api.post('/enforcement/issue', payload);

      setNewAction({
        userId: '',
        actionType: 'warning',
        reason: '',
        description: '',
        restrictions: {},
        expiresAt: ''
      });
      setShowNewActionModal(false);
      fetchActions();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setCreatingAction(false);
    }
  };

  const handleDeactivateAction = async (actionId) => {
    try {
      await api.post(`/enforcement/${actionId}/deactivate`);
      fetchActions();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const getActionColor = (actionType) => {
    switch (actionType) {
      case 'warning':
        return '#f59e0b';
      case 'restriction':
        return '#f97316';
      case 'suspension':
        return '#dc2626';
      default:
        return '#6b7280';
    }
  };

  const getActionIcon = (actionType) => {
    switch (actionType) {
      case 'warning':
        return '⚠️';
      case 'restriction':
        return '🚫';
      case 'suspension':
        return '🔴';
      default:
        return '⚪';
    }
  };

  if (loading && actions.length === 0) {
    return (
      <div className="admin-enforcement-loading">
        <Loader className="spinner" size={32} />
        <p>{t('adminEnforcement.loading')}</p>
      </div>
    );
  }

  return (
    <div className="admin-enforcement-dashboard">
      <div className="admin-enforcement-header">
        <h1>{t('adminEnforcement.title')}</h1>
        <button
          onClick={() => setShowNewActionModal(true)}
          className="admin-enforcement-btn-new"
        >
          + {t('adminEnforcement.newAction')}
        </button>
      </div>

      <div className="admin-enforcement-filters">
        <select
          value={filters.actionType}
          onChange={(e) => {
            setFilters({ ...filters, actionType: e.target.value });
            setPagination({ ...pagination, offset: 0 });
          }}
          className="admin-enforcement-select"
        >
          <option value="">{t('adminEnforcement.allActions')}</option>
          <option value="warning">{t('adminEnforcement.actionWarning')}</option>
          <option value="restriction">{t('adminEnforcement.actionRestriction')}</option>
          <option value="suspension">{t('adminEnforcement.actionSuspension')}</option>
        </select>

        <select
          value={filters.isActive}
          onChange={(e) => {
            setFilters({ ...filters, isActive: e.target.value });
            setPagination({ ...pagination, offset: 0 });
          }}
          className="admin-enforcement-select"
        >
          <option value="">{t('adminEnforcement.allStatus')}</option>
          <option value="true">{t('adminEnforcement.active')}</option>
          <option value="false">{t('adminEnforcement.inactive')}</option>
        </select>
      </div>

      <div className="admin-enforcement-list">
        {actions.length === 0 ? (
          <div className="admin-enforcement-empty">
            <Shield size={32} opacity={0.5} />
            <p>{t('adminEnforcement.noActions')}</p>
          </div>
        ) : (
          actions.map((action) => (
            <div key={action.id} className="admin-enforcement-item">
              <div className="admin-enforcement-item-header">
                <div className="admin-enforcement-item-title">
                  <span className="admin-enforcement-icon">
                    {getActionIcon(action.actionType)}
                  </span>
                  <span>User: {action.userId.substring(0, 8)}...</span>
                </div>
                <div className="admin-enforcement-item-status">
                  <span
                    className="admin-enforcement-action-badge"
                    style={{ backgroundColor: getActionColor(action.actionType) }}
                  >
                    {t(`adminEnforcement.action${action.actionType.charAt(0).toUpperCase()}${action.actionType.slice(1)}`)}
                  </span>
                  {action.isActive ? (
                    <span className="admin-enforcement-status-active">
                      {t('adminEnforcement.active')}
                    </span>
                  ) : (
                    <span className="admin-enforcement-status-inactive">
                      {t('adminEnforcement.inactive')}
                    </span>
                  )}
                </div>
              </div>

              <div className="admin-enforcement-item-details">
                <p className="admin-enforcement-reason">
                  <strong>{t('adminEnforcement.reason')}:</strong> {action.reason}
                </p>
                {action.description && (
                  <p className="admin-enforcement-description">
                    <strong>{t('adminEnforcement.description')}:</strong> {action.description}
                  </p>
                )}

                <div className="admin-enforcement-timestamps">
                  <span>
                    <Clock size={14} />
                    {t('adminEnforcement.effective')}: {new Date(action.effectiveAt).toLocaleDateString()}
                  </span>
                  {action.expiresAt && (
                    <span>
                      <AlertTriangle size={14} />
                      {t('adminEnforcement.expires')}: {new Date(action.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {action.isActive && (
                  <button
                    onClick={() => handleDeactivateAction(action.id)}
                    className="admin-enforcement-btn-deactivate"
                  >
                    {t('adminEnforcement.deactivate')}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="admin-enforcement-error">
          {error}
        </div>
      )}

      {pagination.hasMore && (
        <div className="admin-enforcement-pagination">
          <button
            onClick={() => setPagination({ ...pagination, offset: pagination.offset + pagination.limit })}
            className="admin-enforcement-load-more"
          >
            {t('adminEnforcement.loadMore')}
          </button>
        </div>
      )}

      {showNewActionModal && (
        <div className="admin-enforcement-modal-overlay" onClick={() => setShowNewActionModal(false)}>
          <div className="admin-enforcement-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-enforcement-modal-header">
              <h2>{t('adminEnforcement.newAction')}</h2>
              <button
                onClick={() => setShowNewActionModal(false)}
                className="admin-enforcement-modal-close"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateAction} className="admin-enforcement-form">
              <div className="admin-enforcement-form-group">
                <label htmlFor="userId" className="admin-enforcement-label">
                  {t('adminEnforcement.userId')} <span className="required">*</span>
                </label>
                <input
                  id="userId"
                  type="text"
                  value={newAction.userId}
                  onChange={(e) => setNewAction({ ...newAction, userId: e.target.value })}
                  placeholder={t('adminEnforcement.userIdPlaceholder')}
                  className="admin-enforcement-input"
                  disabled={creatingAction}
                  required
                />
              </div>

              <div className="admin-enforcement-form-group">
                <label htmlFor="actionType" className="admin-enforcement-label">
                  {t('adminEnforcement.actionType')} <span className="required">*</span>
                </label>
                <select
                  id="actionType"
                  value={newAction.actionType}
                  onChange={(e) => setNewAction({ ...newAction, actionType: e.target.value })}
                  className="admin-enforcement-input"
                  disabled={creatingAction}
                >
                  <option value="warning">{t('adminEnforcement.actionWarning')}</option>
                  <option value="restriction">{t('adminEnforcement.actionRestriction')}</option>
                  <option value="suspension">{t('adminEnforcement.actionSuspension')}</option>
                </select>
              </div>

              <div className="admin-enforcement-form-group">
                <label htmlFor="reason" className="admin-enforcement-label">
                  {t('adminEnforcement.reason')} <span className="required">*</span>
                </label>
                <input
                  id="reason"
                  type="text"
                  value={newAction.reason}
                  onChange={(e) => setNewAction({ ...newAction, reason: e.target.value })}
                  placeholder={t('adminEnforcement.reasonPlaceholder')}
                  className="admin-enforcement-input"
                  disabled={creatingAction}
                  required
                />
              </div>

              <div className="admin-enforcement-form-group">
                <label htmlFor="description" className="admin-enforcement-label">
                  {t('adminEnforcement.description')}
                </label>
                <textarea
                  id="description"
                  value={newAction.description}
                  onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
                  placeholder={t('adminEnforcement.descriptionPlaceholder')}
                  className="admin-enforcement-textarea"
                  disabled={creatingAction}
                  maxLength="500"
                  rows="3"
                />
              </div>

              <div className="admin-enforcement-form-group">
                <label htmlFor="expiresAt" className="admin-enforcement-label">
                  {t('adminEnforcement.expiryDate')}
                </label>
                <input
                  id="expiresAt"
                  type="datetime-local"
                  value={newAction.expiresAt}
                  onChange={(e) => setNewAction({ ...newAction, expiresAt: e.target.value })}
                  className="admin-enforcement-input"
                  disabled={creatingAction}
                />
                <p className="admin-enforcement-help-text">
                  {t('adminEnforcement.permanentIfEmpty')}
                </p>
              </div>

              {error && <div className="admin-enforcement-error">{error}</div>}

              <div className="admin-enforcement-form-actions">
                <button
                  type="button"
                  onClick={() => setShowNewActionModal(false)}
                  className="admin-enforcement-btn-cancel"
                  disabled={creatingAction}
                >
                  {t('adminEnforcement.cancel')}
                </button>
                <button
                  type="submit"
                  className="admin-enforcement-btn-submit"
                  disabled={creatingAction}
                >
                  {creatingAction ? t('adminEnforcement.creating') : t('adminEnforcement.issueAction')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEnforcementDashboard;
