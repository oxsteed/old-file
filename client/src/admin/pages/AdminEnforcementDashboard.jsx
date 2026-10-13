import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Shield, Clock, Loader, X } from 'lucide-react';
import api from '../../api/axios';
import '../styles/AdminEnforcementDashboard.css';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';

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

// P3-2-F13: enforcement appeals review UI. Backs the ?tab=appeals deep link
// used by the admin notification; previously that link 404ed because no
// client route or page existed for appeals.
const EnforcementAppealsTab = ({ highlightAppealId }) => {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  const { data, error: fetchError, loading, reload } = useAbortableFetch(async (signal) => {
    const response = await api.get('/enforcement-policy/admin/appeals', {
      params: { status: statusFilter, limit: 50 },
      signal,
    });
    return response.data;
  }, [statusFilter]);

  const appeals = data?.data ?? [];

  const submitReview = async (decision) => {
    setReviewError(null);
    setReviewing(true);
    try {
      await api.put(`/enforcement-policy/admin/appeals/${reviewTarget.id}/review`, {
        decision,
        adminNotes: adminNotes.trim() || null,
      });
      setReviewTarget(null);
      setAdminNotes('');
      reload();
    } catch (err) {
      setReviewError(err.response?.data?.error || err.message);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="admin-enforcement-appeals">
      <div className="admin-enforcement-filters">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="admin-enforcement-select"
          aria-label={t('adminEnforcement.appealStatus')}
        >
          <option value="pending">{t('adminEnforcement.appealPending')}</option>
          <option value="under_review">{t('adminEnforcement.appealUnderReview')}</option>
          <option value="approved">{t('adminEnforcement.appealApproved')}</option>
          <option value="denied">{t('adminEnforcement.appealDenied')}</option>
          <option value="all">{t('adminEnforcement.allStatus')}</option>
        </select>
      </div>

      {loading && appeals.length === 0 ? (
        <div className="admin-enforcement-loading">
          <Loader className="spinner" size={32} />
          <p>{t('adminEnforcement.loading')}</p>
        </div>
      ) : fetchError ? (
        <AdminErrorState onRetry={reload} />
      ) : appeals.length === 0 ? (
        <div className="admin-enforcement-empty">
          <Shield size={32} opacity={0.5} />
          <p>{t('adminEnforcement.noAppeals')}</p>
        </div>
      ) : (
        <div className="admin-enforcement-list">
          {appeals.map((appeal) => (
            <div
              key={appeal.id}
              className={`admin-enforcement-item${String(highlightAppealId) === String(appeal.id) ? ' highlighted' : ''}`}
            >
              <div className="admin-enforcement-item-header">
                <div className="admin-enforcement-item-title">
                  <span>{appeal.user_name || appeal.user_email || appeal.user_id}</span>
                </div>
                <div className="admin-enforcement-item-status">
                  <span className="admin-enforcement-action-badge" style={{ backgroundColor: '#6b7280' }}>
                    {appeal.status}
                  </span>
                  <span className="admin-enforcement-action-badge" style={{ backgroundColor: getActionColor(appeal.action_type) }}>
                    {appeal.action_type}
                  </span>
                </div>
              </div>
              <div className="admin-enforcement-item-details">
                <p className="admin-enforcement-reason">
                  <strong>{t('adminEnforcement.appealFor')}:</strong> {appeal.enforcement_reason}
                </p>
                <p className="admin-enforcement-description">
                  <strong>{t('adminEnforcement.appealText')}:</strong> {appeal.appeal_text}
                </p>
                <div className="admin-enforcement-timestamps">
                  <span>
                    <Clock size={14} />
                    {new Date(appeal.submitted_at).toLocaleString()}
                  </span>
                </div>
                {appeal.admin_notes && (
                  <p className="admin-enforcement-description">
                    <strong>{t('adminEnforcement.appealAdminNotes')}:</strong> {appeal.admin_notes}
                  </p>
                )}
                {['pending', 'under_review'].includes(appeal.status) && (
                  <div className="admin-enforcement-appeal-actions">
                    <button
                      type="button"
                      className="admin-enforcement-btn-approve"
                      onClick={() => { setReviewTarget({ ...appeal, decision: 'approved' }); setAdminNotes(''); setReviewError(null); }}
                    >
                      {t('adminEnforcement.appealApprove')}
                    </button>
                    <button
                      type="button"
                      className="admin-enforcement-btn-deactivate"
                      onClick={() => { setReviewTarget({ ...appeal, decision: 'denied' }); setAdminNotes(''); setReviewError(null); }}
                    >
                      {t('adminEnforcement.appealDeny')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewTarget && (
        <div className="admin-enforcement-modal-overlay" onClick={() => setReviewTarget(null)}>
          <div className="admin-enforcement-modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {reviewTarget.decision === 'approved'
                ? t('adminEnforcement.appealApproveTitle')
                : t('adminEnforcement.appealDenyTitle')}
            </h2>
            <p className="admin-enforcement-help-text">
              {t('adminEnforcement.appealReviewHint', { name: reviewTarget.user_name || reviewTarget.user_email })}
            </p>
            <div className="admin-enforcement-form-group">
              <label htmlFor="appealNotes" className="admin-enforcement-label">
                {t('adminEnforcement.appealNotes')}
              </label>
              <textarea
                id="appealNotes"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder={t('adminEnforcement.appealNotesPlaceholder')}
                className="admin-enforcement-textarea"
                rows="4"
                maxLength="2000"
                disabled={reviewing}
              />
            </div>
            {reviewError && <div className="admin-enforcement-error">{reviewError}</div>}
            <div className="admin-enforcement-form-actions">
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                className="admin-enforcement-btn-cancel"
                disabled={reviewing}
              >
                {t('adminEnforcement.cancel')}
              </button>
              <button
                type="button"
                onClick={() => submitReview(reviewTarget.decision)}
                className={reviewTarget.decision === 'approved' ? 'admin-enforcement-btn-submit' : 'admin-enforcement-btn-deactivate'}
                disabled={reviewing}
              >
                {reviewing
                  ? t('adminEnforcement.creating')
                  : reviewTarget.decision === 'approved'
                    ? t('adminEnforcement.appealApprove')
                    : t('adminEnforcement.appealDeny')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AdminEnforcementDashboard = () => {
  const { t } = useTranslation();
  const [actionError, setActionError] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  // P3-2-F13: appeals review UI. Deep-linkable via ?tab=appeals&appealId=.
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('tab') === 'appeals' ? 'appeals' : 'actions';
    } catch {
      return 'actions';
    }
  });
  const [highlightAppealId] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('appealId') || null;
    } catch {
      return null;
    }
  });
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

  const { data, error: fetchError, loading, reload } = useAbortableFetch(async (signal) => {
    const params = new URLSearchParams({
      limit: pagination.limit,
      offset: pagination.offset
    });

    if (filters.actionType) params.append('actionType', filters.actionType);
    if (filters.isActive !== '') params.append('isActive', filters.isActive);

    const response = await api.get('/enforcement/all', { params, signal });
    return response.data;
  }, [filters, pagination.offset, pagination.limit]);

  const actions = data?.data ?? [];
  const hasMore = data?.pagination?.hasMore ?? false;

  const handleCreateAction = async (e) => {
    e.preventDefault();
    setActionError(null);

    if (!newAction.userId.trim()) {
      setActionError(t('adminEnforcement.userIdRequired'));
      return;
    }

    if (!newAction.reason.trim()) {
      setActionError(t('adminEnforcement.reasonRequired'));
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
      reload();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message);
    } finally {
      setCreatingAction(false);
    }
  };

  // Deactivation is destructive: it lifts restrictions immediately, so it
  // goes through a confirmation dialog. ConfirmDialog stays open and shows
  // the error if the POST fails.
  const confirmDeactivate = async () => {
    await api.post(`/enforcement/${deactivateTarget}/deactivate`);
    reload();
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

      <div className="admin-enforcement-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'actions'}
          className={`admin-enforcement-tab${activeTab === 'actions' ? ' active' : ''}`}
          onClick={() => setActiveTab('actions')}
        >
          {t('adminEnforcement.actionsTab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'appeals'}
          className={`admin-enforcement-tab${activeTab === 'appeals' ? ' active' : ''}`}
          onClick={() => setActiveTab('appeals')}
        >
          {t('adminEnforcement.appealsTab')}
        </button>
      </div>

      {activeTab === 'appeals' ? (
        <EnforcementAppealsTab highlightAppealId={highlightAppealId} />
      ) : (
        <>
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
        {fetchError ? (
          <AdminErrorState onRetry={reload} />
        ) : actions.length === 0 && !loading ? (
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
                    onClick={() => setDeactivateTarget(action.id)}
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

      {hasMore && (
        <div className="admin-enforcement-pagination">
          <button
            onClick={() => setPagination({ ...pagination, offset: pagination.offset + pagination.limit })}
            className="admin-enforcement-load-more"
          >
            {t('adminEnforcement.loadMore')}
          </button>
        </div>
      )}
        </>
      )}

      {showNewActionModal && (
        <div className="admin-enforcement-modal-overlay" onClick={() => setShowNewActionModal(false)}>
          <div className="admin-enforcement-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-enforcement-modal-header">
              <h2>{t('adminEnforcement.newAction')}</h2>
              <button
                onClick={() => setShowNewActionModal(false)}
                className="admin-enforcement-modal-close"
                aria-label={t('common.aria.closeButton')}
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

              {actionError && <div className="admin-enforcement-error">{actionError}</div>}

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
      <ConfirmDialog
        open={!!deactivateTarget}
        danger
        title={t('adminEnforcement.confirmDeactivateTitle')}
        message={t('adminEnforcement.confirmDeactivateMessage')}
        onConfirm={confirmDeactivate}
        onClose={() => setDeactivateTarget(null)}
      />
    </div>
  );
};

export default AdminEnforcementDashboard;
