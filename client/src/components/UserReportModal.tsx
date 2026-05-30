import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import './UserReportModal.css';

interface UserReportModalProps {
  // Canonical prop
  reportedUserId?: number | string;
  // Back-compat aliases used across the codebase
  userId?: number | string;
  reportedName?: string;
  bookingId?: number;
  isOpen: boolean;
  onClose: () => void;
  onReportSubmitted?: () => void;
  onSuccess?: () => void;
}

const UserReportModal: React.FC<UserReportModalProps> = ({
  reportedUserId,
  userId,
  bookingId,
  isOpen,
  onClose,
  onReportSubmitted,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [reportType, setReportType] = useState('non_payment');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const reportTypes = [
    { value: 'non_payment', label: t('toolRentals.nonPayment') || 'Non-Payment' },
    { value: 'tool_damage', label: t('toolRentals.toolDamage') || 'Tool Damage' },
    { value: 'non_return', label: t('toolRentals.nonReturn') || 'Did Not Return Tool' },
    { value: 'fraud', label: t('toolRentals.fraud') || 'Fraud' },
    { value: 'other', label: t('common.other') || 'Other' }
  ];

  const handleSubmit = async () => {
    if (description.trim().length < 10) {
      toast.error(t('toolRentals.descriptionMinLength') || 'Description must be at least 10 characters');
      return;
    }

    setLoading(true);
    try {
      const resolvedUserId = reportedUserId ?? userId;
      if (resolvedUserId === undefined || resolvedUserId === null) {
        toast.error(t('common.error') || 'Missing user id');
        return;
      }
      await api.post('/tool-rentals/reports', {
        reportedUserId: resolvedUserId,
        bookingId,
        reportType,
        description: description.trim()
      });

      toast.success(t('toolRentals.reportSubmitted') || 'Report submitted. Our team will review it within 48 hours.');
      onReportSubmitted?.();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(t('toolRentals.reportFailed') || 'Failed to submit report');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal-content" onClick={e => e.stopPropagation()}>
        <div className="report-modal-header">
          <h2>{t('toolRentals.reportUser') || 'Report User'}</h2>
          <button onClick={onClose} className="report-modal-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="report-modal-body">
          <div className="report-warning">
            <AlertTriangle className="w-5 h-5" />
            <p>
              {t('toolRentals.reportWarning') ||
                'Reports are reviewed by our team. False reports may result in action against your account.'}
            </p>
          </div>

          <div className="report-field">
            <label htmlFor="report-type">{t('toolRentals.issueType') || 'Issue Type'}</label>
            <select
              id="report-type"
              value={reportType}
              onChange={e => setReportType(e.target.value)}
              disabled={loading}
            >
              {reportTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div className="report-field">
            <label htmlFor="description">
              {t('toolRentals.description') || 'Description'} ({description.length}/500)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 500))}
              placeholder={t('toolRentals.describeProblem') || 'Describe what happened in detail...'}
              disabled={loading}
              rows={5}
            />
            <p className="report-hint">
              {t('toolRentals.descriptionHint') || 'Be specific about what occurred and when.'}
            </p>
          </div>

          <div className="report-info">
            <p>
              {t('toolRentals.reportInfo') ||
                'Our team will review your report within 48 hours. Confirmed violations may result in account warnings, suspensions, or bans.'}
            </p>
          </div>
        </div>

        <div className="report-modal-footer">
          <button onClick={onClose} disabled={loading} className="report-btn-cancel">
            {t('common.cancel') || 'Cancel'}
          </button>
          <button onClick={handleSubmit} disabled={loading} className="report-btn-submit">
            {loading ? t('common.submitting') : t('toolRentals.submitReport')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserReportModal;
