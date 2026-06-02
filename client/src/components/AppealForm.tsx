/**
 * AppealForm.tsx
 * Form for users to submit appeals against enforcement restrictions
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileText, AlertTriangle } from 'lucide-react';
import api from '../api/axios';

interface AppealFormProps {
  restrictionId: string | number;
  onClose: () => void;
  onSuccess?: () => void;
}

const AppealForm: React.FC<AppealFormProps> = ({
  restrictionId,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [appealText, setAppealText] = useState('');
  const [evidence, setEvidence] = useState<Array<{ type: string; content: string }>>([]);
  const [newEvidenceContent, setNewEvidenceContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddEvidence = () => {
    if (newEvidenceContent.trim().length > 0) {
      setEvidence([
        ...evidence,
        {
          type: 'text',
          content: newEvidenceContent.trim(),
        },
      ]);
      setNewEvidenceContent('');
    }
  };

  const handleRemoveEvidence = (index: number) => {
    setEvidence(evidence.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (appealText.trim().length < 50) {
      setError(t('appeal.validationError'));
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/enforcement-policy/appeals', {
        enforcementId: restrictionId,
        appealText: appealText.trim(),
        evidence,
      });

      setAppealText('');
      setEvidence([]);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/95">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-brand-500" />
            {t('appeal.title')}
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
          {/* Info box */}
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4">
            <p className="text-sm text-blue-200">
              {t('appeal.info')}
            </p>
          </div>

          {/* Appeal text */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              {t('appeal.textLabel')}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <textarea
              value={appealText}
              onChange={(e) => setAppealText(e.target.value)}
              placeholder={t('appeal.textPlaceholder')}
              rows={8}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none transition-colors resize-none"
              minLength={50}
            />
            <p className="text-xs text-gray-500 mt-1">
              {appealText.length} / 50 {t('appeal.characterMinimum')}
            </p>
          </div>

          {/* Evidence */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              {t('appeal.evidenceLabel')}
            </label>
            <div className="space-y-3">
              {evidence.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-start justify-between"
                >
                  <p className="text-sm text-gray-300 flex-1 break-words">{item.content}</p>
                  <button
                    type="button"
                    onClick={() => handleRemoveEvidence(idx)}
                    className="ml-2 p-1 hover:bg-gray-700 rounded transition-colors text-gray-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <div className="flex gap-2">
                <textarea
                  value={newEvidenceContent}
                  onChange={(e) => setNewEvidenceContent(e.target.value)}
                  placeholder={t('appeal.evidencePlaceholder')}
                  rows={3}
                  className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none transition-colors resize-none"
                />
                <button
                  type="button"
                  onClick={handleAddEvidence}
                  disabled={newEvidenceContent.trim().length === 0}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 font-semibold"
                >
                  {t('appeal.addEvidence')}
                </button>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

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
              disabled={isSubmitting || appealText.trim().length < 50}
              className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('appeal.submitting')}
                </>
              ) : (
                t('appeal.submit')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AppealForm;
