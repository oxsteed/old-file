/**
 * TranscriptConfidenceIndicator.tsx
 * Shows confidence % of Web Speech API transcription
 * Offers "Improve with AI" button for low-confidence transcripts
 */

import React from 'react';
import { AlertCircle, Sparkles, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TranscriptConfidenceIndicatorProps {
  confidence: number; // 0-1
  transcript: string;
  isImproving?: boolean;
  onRequestImprovement?: () => void;
  className?: string;
}

export default function TranscriptConfidenceIndicator({
  confidence,
  transcript,
  isImproving = false,
  onRequestImprovement,
  className = '',
}: TranscriptConfidenceIndicatorProps) {
  const confidence_percent = Math.round(confidence * 100);
  const isLowConfidence = confidence < 0.85;
  const isHighConfidence = confidence >= 0.95;
  const { t } = useTranslation();

  if (!transcript || confidence_percent < 0 || confidence_percent > 100) {
    return null;
  }

  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg bg-slate-100 dark:bg-slate-800 ${className}`}>
      {/* Confidence indicator icon */}
      {isHighConfidence && (
        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
      )}
      {isLowConfidence && !isHighConfidence && (
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      )}
      {!isLowConfidence && !isHighConfidence && (
        <div className="w-4 h-4 rounded-full bg-slate-400 dark:bg-slate-500 flex-shrink-0" />
      )}

      {/* Confidence percentage */}
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {t('transcriptConfidence.label', { percent: confidence_percent })}
      </span>

      {/* "Improve with AI" button for low confidence */}
      {isLowConfidence && onRequestImprovement && (
        <button
          type="button"
          onClick={onRequestImprovement}
          disabled={isImproving}
          className="ms-auto flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Sparkles className="w-3 h-3" />
          {isImproving ? t('transcriptConfidence.improving') : t('transcriptConfidence.improve')}
        </button>
      )}

      {isHighConfidence && (
        <span className="ms-auto text-xs text-green-600 dark:text-green-400 font-medium">
          {t('transcriptConfidence.highAccuracy')}
        </span>
      )}
    </div>
  );
}
