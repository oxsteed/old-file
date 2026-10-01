/**
 * DisputeSubmissionModal.tsx
 * Modal for customers/helpers to submit disputes against jobs
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import { createMessageRequestId } from '../lib/messageRequestId';

interface DisputeSubmissionModalProps {
  jobId: string | number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const DISPUTE_REASONS = [
  'work_not_completed',
  'poor_quality',
  'no_show',
  'overcharged',
  'property_damage',
  'safety_concern',
  'fraud',
  'other',
];

const DisputeSubmissionModal: React.FC<DisputeSubmissionModalProps> = ({
  jobId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRequestRef = useRef<{ clientRequestId: string; fingerprint: string } | null>(null);

  const { data: jobData } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const res = await api.get(`/jobs/${jobId}`);
      return res.data;
    },
    enabled: isOpen,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedReason || description.trim().length < 20) {
      setError(t('dispute.validationError'));
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        reason: selectedReason,
        description: description.trim(),
      };
      const fingerprint = JSON.stringify(payload);
      const pending = pendingRequestRef.current;
      const clientRequestId = pending?.fingerprint === fingerprint
        ? pending.clientRequestId
        : createMessageRequestId();
      pendingRequestRef.current = { clientRequestId, fingerprint };
      await api.post(`/disputes/jobs/${jobId}`, {
        ...payload,
        clientRequestId,
      }, {
        headers: { 'Idempotency-Key': clientRequestId },
      });

      setSelectedReason('');
      setDescription('');
      pendingRequestRef.current = null;
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/95">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            {t('dispute.submitTitle')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Job info */}
          {jobData?.data && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-1">{t('dispute.jobInfo')}</p>
              <p className="text-white font-semibold">{jobData.data.title}</p>
            </div>
          )}

          {/* Reason selector */}
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              {t('dispute.reasonLabel')}
              <span className="text-red-500 ms-1">*</span>
            </label>
            <div className="space-y-2">
              {DISPUTE_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={reason}
                    checked={selectedReason === reason}
                    onChange={(e) => setSelectedReason(e.target.value)}
                    className="w-4 h-4 text-brand-500"
                  />
                  <span className="text-sm text-gray-300">
                    {t(`dispute.reason.${reason}`)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              {t('dispute.descriptionLabel')}
              <span className="text-red-500 ms-1">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('dispute.descriptionPlaceholder')}
              rows={6}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none transition-colors resize-none"
              minLength={20}
            />
            <p className="text-xs text-gray-500 mt-1">
              {description.length} / 20 {t('dispute.characterMinimum')}
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4 flex items-start gap-3">
            <FileText className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-200 space-y-1">
              <p className="font-semibold">{t('dispute.info.title')}</p>
              <p>{t('dispute.info.body')}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedReason || description.trim().length < 20}
              className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('dispute.submitting')}
                </>
              ) : (
                t('dispute.submit')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DisputeSubmissionModal;
