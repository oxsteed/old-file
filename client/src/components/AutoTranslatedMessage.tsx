import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { translateText } from '../api/translate';
import { primaryLanguageTag } from '../utils/messageTranslate';

interface AutoTranslatedMessageProps {
  /** Raw message body */
  text: string;
  /** Stable id used to cache the translation in memory across re-renders. */
  messageId?: string | number | null;
  /** When false, skip translation (e.g. empty or disabled globally). */
  enabled?: boolean;
  /** If true, only translate when the message is from the other party (saves API calls on own bubbles). */
  incomingOnly?: boolean;
  isOwnMessage?: boolean;
  className?: string;
  /** Bubble text color inherits from parent; this is for the translation bar only */
  compact?: boolean;
}

// In-memory cache of translation results, keyed by message id + target language.
// Bubbles re-render (and re-mount) when the user scrolls or new messages arrive;
// the cache keeps those from re-hitting the translation backend. Bounded so
// long-lived sessions cannot grow it without limit. The source text is stored
// alongside so an edited message re-translates instead of reusing stale output.
const MAX_CACHED_TRANSLATIONS = 500;
interface CachedTranslation {
  sourceText: string;
  translatedText: string | null;
  sourceLanguage: string | null;
}
const translationCache = new Map<string, CachedTranslation>();
const inFlightTranslations = new Map<
  string,
  Promise<{ translatedText: string; sourceLanguage: string }>
>();

function translationCacheKey(messageId: string | number, target: string): string {
  return `${messageId}::${target}`;
}

function readCachedTranslation(
  messageId: string | number | null | undefined,
  target: string,
  text: string,
): CachedTranslation | undefined {
  if (messageId == null) return undefined;
  const cached = translationCache.get(translationCacheKey(messageId, target));
  return cached && cached.sourceText === text ? cached : undefined;
}

function writeCachedTranslation(
  messageId: string | number | null | undefined,
  target: string,
  entry: CachedTranslation,
): void {
  if (messageId == null) return;
  const key = translationCacheKey(messageId, target);
  if (!translationCache.has(key) && translationCache.size >= MAX_CACHED_TRANSLATIONS) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(key, entry);
}

function decideDisplay(
  text: string,
  translatedText: string | null,
  source: string | undefined,
  target: string,
): { translated: string | null; sourceLang: string | null } {
  const src = primaryLanguageTag(source);
  const same = !translatedText || src === target || translatedText.trim() === text.trim();
  if (same) return { translated: null, sourceLang: src };
  return { translated: translatedText, sourceLang: src };
}

/**
 * Auto-translates message text to the viewer's UI language via POST /api/translate (source: auto).
 * Shows translated text by default when different from original; toggle to see original.
 */
export default function AutoTranslatedMessage({
  text,
  messageId = null,
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

    const cached = readCachedTranslation(messageId, target, text);
    if (cached) {
      const next = decideDisplay(text, cached.translatedText, cached.sourceLanguage ?? undefined, target);
      setTranslated(next.translated);
      setSourceLang(next.sourceLang);
      setShowTranslated(true);
      setLoading(false);
      return;
    }

    const key = messageId != null ? translationCacheKey(messageId, target) : null;
    let pending = key ? inFlightTranslations.get(key) : undefined;
    if (!pending) {
      pending = translateText({ text, sourceLang: 'auto', targetLang: target });
      if (key) inFlightTranslations.set(key, pending);
    }

    (async () => {
      try {
        const { translatedText, sourceLanguage: source } = await pending;
        if (cancelled) return;
        writeCachedTranslation(messageId, target, {
          sourceText: text,
          translatedText,
          sourceLanguage: source,
        });
        const next = decideDisplay(text, translatedText, source, target);
        setTranslated(next.translated);
        setSourceLang(next.sourceLang);
        setShowTranslated(true);
      } catch {
        if (!cancelled) {
          setTranslated(null);
          setSourceLang(null);
        }
      } finally {
        if (key) inFlightTranslations.delete(key);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, target, shouldFetch, messageId]);

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
            className="underline hover:opacity-100 text-start font-medium"
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
