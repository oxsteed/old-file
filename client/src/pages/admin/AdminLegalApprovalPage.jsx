// Admin: Legal Document Approval Workflow
// Legal counsel review, approval, and scheduling interface

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, Calendar, AlertCircle, User, MessageSquare } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';
import './AdminLegalApprovalPage.css';

export default function AdminLegalApprovalPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const copy = (key, options) => t(`adminLegal.approval.${key}`, options);
  const [approvals, setApprovals] = useState([]);
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [reviewComments, setReviewComments] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');

  useEffect(() => {
    fetchApprovals();
  }, []);

  const fetchApprovals = async () => {
    try {
      setLoading(true);
      // Mock data - in production, would fetch from /api/admin/legal/approvals
      const mockApprovals = [
        {
          id: '1',
          documentId: 'doc1',
          documentTitle: 'Terms of Service',
          status: 'pending',
          requestedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          requestedBy: 'John Legal',
          changeSummary: 'Updated payment terms and added GDPR section',
          changedSections: ['payment_terms', 'data_retention']
        },
        {
          id: '2',
          documentId: 'doc2',
          documentTitle: 'Privacy Policy',
          status: 'pending',
          requestedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          requestedBy: 'Jane Legal',
          changeSummary: 'Added new data processing categories',
          changedSections: ['data_processing']
        }
      ];
      setApprovals(mockApprovals);
      if (mockApprovals.length > 0) {
        setSelectedApproval(mockApprovals[0]);
      }
    } catch (err) {
      logger.error('Failed to fetch approvals', { err });
      setError(copy('loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedApproval) return;

    try {
      setProcessing(true);
      await api.post(`/admin/legal/documents/${selectedApproval.documentId}/approve`, {
        scheduledPublishDate: scheduledDate ? new Date(scheduledDate) : null,
        reviewComments
      });

      logger.info('Document approved');
      setApprovals(approvals.filter(a => a.id !== selectedApproval.id));
      setSelectedApproval(null);
      setReviewComments('');
      setScheduledDate('');
    } catch (err) {
      logger.error('Failed to approve document', { err });
      setError(err.response?.data?.message || copy('approveFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedApproval) return;

    try {
      setProcessing(true);
      // Mock rejection - would call actual endpoint
      logger.info('Document rejected');
      setApprovals(approvals.filter(a => a.id !== selectedApproval.id));
      setSelectedApproval(null);
      setReviewComments('');
      setScheduledDate('');
    } catch (err) {
      logger.error('Failed to reject document', { err });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="approval-page-loading">{copy('loading')}</div>;
  }

  if (approvals.length === 0) {
    return (
      <div className="approval-page">
        <div className="approval-header">
          <h1>{copy('queueTitle')}</h1>
          <p>{copy('queueSubtitle')}</p>
        </div>
        <div className="approval-empty">
          <CheckCircle size={48} />
          <h2>{copy('emptyTitle')}</h2>
          <p>{copy('emptyBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="approval-page">
      {/* Header */}
      <div className="approval-header">
        <h1>{copy('queueTitleWithCount', { count: approvals.length })}</h1>
        <p>{copy('queueSubtitle')}</p>
      </div>

      {error && (
        <div className="approval-error">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <div className="approval-container">
        {/* Approval List */}
        <div className="approval-list">
          <div className="approval-list-header">
            <h3>{copy('pendingApprovals')}</h3>
            <span className="approval-count">{approvals.length}</span>
          </div>
          <div className="approval-items">
            {approvals.map(approval => (
              <div
                key={approval.id}
                className={`approval-item ${selectedApproval?.id === approval.id ? 'active' : ''}`}
                onClick={() => setSelectedApproval(approval)}
              >
                <div className="approval-item-title">
                  <h4>{approval.documentTitle}</h4>
                  <span className="approval-item-age">
                    {copy('hoursAgo', { count: Math.floor((Date.now() - new Date(approval.requestedAt)) / (1000 * 60 * 60)) })}
                  </span>
                </div>
                <p className="approval-item-summary">{approval.changeSummary}</p>
                <div className="approval-item-meta">
                  <User size={14} />
                  <span>{approval.requestedBy}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Approval Detail */}
        {selectedApproval && (
          <div className="approval-detail">
            <div className="approval-detail-header">
              <h2>{selectedApproval.documentTitle}</h2>
              <span className="approval-status pending">{copy('pendingReview')}</span>
            </div>

            {/* Request Info */}
            <div className="approval-info-box">
              <div className="approval-info-row">
                <span className="approval-info-label">{copy('requestedBy')}</span>
                <span>{selectedApproval.requestedBy}</span>
              </div>
              <div className="approval-info-row">
                <span className="approval-info-label">{copy('requestedAt')}</span>
                <span>{new Date(selectedApproval.requestedAt).toLocaleDateString()} at {new Date(selectedApproval.requestedAt).toLocaleTimeString()}</span>
              </div>
              <div className="approval-info-row">
                <span className="approval-info-label">{copy('changeSummary')}</span>
                <span>{selectedApproval.changeSummary}</span>
              </div>
              <div className="approval-info-row">
                <span className="approval-info-label">{copy('changedSections')}</span>
                <div className="approval-sections-tags">
                  {selectedApproval.changedSections.map(section => (
                    <span key={section} className="approval-tag">
                      {section.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Review Form */}
            <div className="approval-form">
              <div className="approval-form-group">
                <label>{copy('reviewComments')}</label>
                <textarea
                  value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)}
                  placeholder={copy('reviewCommentsPlaceholder')}
                  className="approval-textarea"
                  rows={6}
                />
                <span className="approval-form-hint">{copy('reviewCommentsHint')}</span>
              </div>

              <div className="approval-form-group">
                <label>{copy('schedulePublishDate')}</label>
                <input
                  type="datetime-local"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="approval-input"
                />
                <span className="approval-form-hint">{copy('schedulePublishHint')}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="approval-actions">
              <button
                className="approval-btn approval-btn-approve"
                onClick={handleApprove}
                disabled={processing}
              >
                <CheckCircle size={18} />
                {processing ? copy('approving') : copy('approveDocument')}
              </button>
              <button
                className="approval-btn approval-btn-reject"
                onClick={handleReject}
                disabled={processing}
              >
                <XCircle size={18} />
                {copy('rejectChanges')}
              </button>
            </div>

            {/* Preview Link */}
            <div className="approval-preview-link">
              <Clock size={16} />
              <a href={`/terms?preview=${selectedApproval.documentId}`} target="_blank" rel="noopener noreferrer">
                {copy('previewTerms')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
