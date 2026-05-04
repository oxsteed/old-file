import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle } from 'lucide-react';
import '../styles/ReportModal.css';

const REPORT_REASONS = [
  { value: 'harassment', label: 'reportModal.reasonHarassment' },
  { value: 'no_show', label: 'reportModal.reasonNoShow' },
  { value: 'damaged_property', label: 'reportModal.reasonDamagedProperty' },
  { value: 'abusive_language', label: 'reportModal.reasonAbusiveLanguage' },
  { value: 'safety_violation', label: 'reportModal.reasonSafetyViolation' },
  { value: 'scam', label: 'reportModal.reasonScam' },
  { value: 'other', label: 'reportModal.reasonOther' }
];

const ReportModal = ({ userId, userName, jobId = null, conversationId = null, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!reason) {
      setError(t('reportModal.selectReason'));
      return;
    }

    if (!description.trim()) {
      setError(t('reportModal.descriptionRequired'));
      return;
    }

    if (description.length > 2000) {
      setError(t('reportModal.descriptionTooLong'));
      return;
    }

    try {
      setLoading(true);

      const payload = {
        reportedUserId: userId,
        reason,
        description: description.trim(),
        evidenceUrls: evidenceUrls
          .split('\n')
          .map((url) => url.trim())
          .filter((url) => url.length > 0) || null,
        jobId: jobId || null,
        conversationId: conversationId || null
      };

      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const { error: errMsg } = await response.json();
        throw new Error(errMsg || 'Failed to submit report');
      }

      onSuccess && onSuccess();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-header">
          <div className="report-modal-title-section">
            <AlertTriangle size={20} />
            <h2 className="report-modal-title">{t('reportModal.reportUser')}</h2>
          </div>
          <button className="report-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="report-modal-content">
          <p className="report-modal-subtitle">
            {t('reportModal.reportingUser', { name: userName })}
          </p>

          <form onSubmit={handleSubmit} className="report-form">
            <div className="report-form-group">
              <label htmlFor="reason" className="report-label">
                {t('reportModal.reason')} <span className="required">*</span>
              </label>
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="report-select"
                disabled={loading}
                required
              >
                <option value="">{t('reportModal.selectReason')}</option>
                {REPORT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {t(r.label)}
                  </option>
                ))}
              </select>
            </div>

            <div className="report-form-group">
              <label htmlFor="description" className="report-label">
                {t('reportModal.description')} <span className="required">*</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('reportModal.descriptionPlaceholder')}
                className="report-textarea"
                disabled={loading}
                maxLength="2000"
                rows="5"
                required
              />
              <p className="report-char-count">
                {description.length} / 2000
              </p>
            </div>

            <div className="report-form-group">
              <label htmlFor="evidence" className="report-label">
                {t('reportModal.evidenceUrls')}
              </label>
              <textarea
                id="evidence"
                value={evidenceUrls}
                onChange={(e) => setEvidenceUrls(e.target.value)}
                placeholder={t('reportModal.evidenceUrlsPlaceholder')}
                className="report-textarea"
                disabled={loading}
                rows="3"
              />
              <p className="report-help-text">{t('reportModal.evidenceHelpText')}</p>
            </div>

            {error && <div className="report-error">{error}</div>}

            <div className="report-form-actions">
              <button
                type="button"
                onClick={onClose}
                className="report-btn-cancel"
                disabled={loading}
              >
                {t('reportModal.cancel')}
              </button>
              <button
                type="submit"
                className="report-btn-submit"
                disabled={loading}
              >
                {loading ? t('reportModal.submitting') : t('reportModal.submitReport')}
              </button>
            </div>
          </form>

          <div className="report-privacy-notice">
            <p>{t('reportModal.privacyNotice')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportModal;
