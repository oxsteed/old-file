import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { translateTexts } from '../api/translate';
import { primaryLanguageTag } from '../utils/messageTranslate';

interface AutoTranslatedMessageProps {
  /** Raw message body */
  text: string;
  /** When false, skip translation (e.g. empty or disabled globally). */
  enabled?: boolean;
  /** If true, only translate when the message is from the other party (saves API calls on own bubbles). */
  incomingOnly?: boolean;
  isOwnMessage?: boolean;
  className?: string;
  /** Bubble text color inherits from parent; this is for the translation bar only */
  compact?: boolean;
}

/**
 * Auto-translates message text to the viewer's UI language via POST /api/translate (source: auto).
 * Shows translated text by default when different from original; toggle to see original.
 */
export default function AutoTranslatedMessage({
  text,
  enabled = true,
  incomingOnly = false,
  isOwnMessage = false,
  className = '',
  compact = false,
}: AutoTranslatedMessageProps) {
  const { t, i18n } = useTranslation();
  const target = primaryLanguageTag(i18n.language);

  const shouldFetch = Boolean(
    enabled &&
      text?.trim() &&
      (!incomingOnly || !isOwnMessage)
  );

  const [translated, setTranslated] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTranslated, setShowTranslated] = useState(true);

  useEffect(() => {
    if (!shouldFetch) {
      setTranslated(null);
      setSourceLang(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setTranslated(null);
    setSourceLang(null);

    (async () => {
      try {
        const { translations, source } = await translateTexts([text], target, 'auto');
        if (cancelled) return;
        const tr = translations[0];
        const src = primaryLanguageTag(source);
        const same =
          !tr ||
          src === target ||
          tr.trim() === text.trim();
        if (same) {
          setTranslated(null);
          setSourceLang(src);
          setShowTranslated(true);
        } else {
          setTranslated(tr);
          setSourceLang(src);
          setShowTranslated(true);
        }
      } catch {
        if (!cancelled) {
          setTranslated(null);
          setSourceLang(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, target, shouldFetch]);

  const hasTranslation = translated != null && sourceLang != null && sourceLang !== target;

  const displayText = useMemo(() => {
    if (!hasTranslation) return text;
    return showTranslated ? translated! : text;
  }, [text, translated, hasTranslation, showTranslated]);

  const toggle = useCallback(() => {
    if (hasTranslation) setShowTranslated((v) => !v);
  }, [hasTranslation]);

  if (!shouldFetch || (!hasTranslation && !loading)) {
    return (
      <span className={className}>
        {text}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-col gap-1 min-w-0 ${className}`}>
      <span className="whitespace-pre-wrap break-words">{displayText}</span>
      {loading && (
        <span className={`text-xs opacity-80 ${compact ? 'text-inherit' : 'text-gray-500 dark:text-gray-400'}`}>
          {t('messages.translating')}
        </span>
      )}
      {hasTranslation && !loading && (
        <span
          className={`inline-flex flex-wrap items-center gap-1.5 mt-0.5 ${
            compact ? 'text-[11px] opacity-90' : 'text-xs text-gray-500 dark:text-gray-400'
          }`}
        >
          <Globe className="w-3 h-3 flex-shrink-0 opacity-80" aria-hidden />
          <button
            type="button"
            onClick={toggle}
            className="underline hover:opacity-100 text-left font-medium"
          >
            {showTranslated
              ? t('messages.showOriginalMessage')
              : t('messages.showTranslationMessage')}
          </button>
        </span>
      )}
    </span>
  );
}
