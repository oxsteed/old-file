/**
 * MessageWithTranslation.tsx
 * Displays a message with optional translation and toggle button
 * Shows original or translated version based on viewer's language preference
 */

import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MessageWithTranslationProps {
  original: string;
  translatedText?: string;
  originalLanguage: string;
  translatedLanguage: string;
  isLoading?: boolean;
  className?: string;
}

// Language code → display name
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  ht: 'Haitian Creole',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ja: 'Japanese',
  zh: 'Chinese',
};

export default function MessageWithTranslation({
  original,
  translatedText,
  originalLanguage,
  translatedLanguage,
  isLoading = false,
  className = '',
}: MessageWithTranslationProps) {
  const [showTranslated, setShowTranslated] = useState(false);
  const { t } = useTranslation('common');

  // If no translation available or same language, just show original
  const hasTranslation = translatedText && originalLanguage !== translatedLanguage;
  const displayText = showTranslated && hasTranslation ? translatedText : original;
  const displayLanguage = showTranslated && hasTranslation ? translatedLanguage : originalLanguage;
  const languageName = (code) => t(`messageWithTranslation.languageNames.${code}`, {
    defaultValue: (LANGUAGE_NAMES[code] || code.toUpperCase()),
  });

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Main message text */}
      <div className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
        {displayText}
      </div>

      {/* Translation toggle and language indicator */}
      {hasTranslation && (
        <div className="flex items-center gap-2 text-xs">
          <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span className="text-slate-600 dark:text-slate-400">
            {languageName(displayLanguage)}
          </span>

          <button
            type="button"
            onClick={() => setShowTranslated(!showTranslated)}
            disabled={isLoading}
            className="ms-auto px-2 py-0.5 text-xs font-medium rounded text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {showTranslated
              ? t('messageWithTranslation.showOriginal', {
                  language: languageName(originalLanguage),
                })
              : t('messageWithTranslation.showTranslation', {
                  language: languageName(translatedLanguage),
                })}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-xs text-slate-500 dark:text-slate-400 animate-pulse">
          {t('actions.translating')}
        </div>
      )}
    </div>
  );
}
