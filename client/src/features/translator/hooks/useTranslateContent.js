import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translateText } from '../api/translationPlatform';

/**
 * useTranslateContent — small hook for translating user-generated content
 * (job descriptions, message bodies, product names, etc.) on demand.
 *
 * Drop-in usage:
 *
 *   const { translated, status, error, retranslate } = useTranslateContent({
 *     text: job.description,
 *     targetLanguage: i18n.language,
 *     sourceLanguage: job.detected_language || 'en',
 *     enabled: i18n.language !== 'en',
 *     glossaryId: null,
 *   });
 *
 * Why a hook (and not a direct api call inside the component):
 * - It debounces per-text identity, so a re-render with the same input doesn't
 *   fire a second translation request.
 * - It surfaces a single canonical `status` (idle / loading / ready / error) so
 *   UI code doesn't have to track booleans.
 * - It abandons in-flight responses when the input changes, so stale results
 *   never overwrite fresh ones.
 *
 * The backend already de-duplicates by cache key, so calling this from many
 * components on the same page is safe — Redis returns the same translation
 * for repeated inputs.
 */
export function useTranslateContent({
  text,
  targetLanguage,
  sourceLanguage = 'auto',
  tone = 'default',
  glossaryId = null,
  enabled = true,
} = {}) {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [translated, setTranslated] = useState(null);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);

  // Track the latest request so stale responses can't overwrite fresh ones.
  const reqIdRef = useRef(0);

  // Cache key the *frontend* uses to skip refetches when inputs are identical.
  const requestKey = useMemo(
    () =>
      [text || '', sourceLanguage || '', targetLanguage || '', tone || 'default', glossaryId || ''].join('|'),
    [text, sourceLanguage, targetLanguage, tone, glossaryId]
  );

  const run = useCallback(async () => {
    if (!enabled || !text || !targetLanguage) {
      setStatus('idle');
      setTranslated(null);
      setError(null);
      setMeta(null);
      return;
    }
    const myId = reqIdRef.current + 1;
    reqIdRef.current = myId;
    setStatus('loading');
    setError(null);

    try {
      const result = await translateText({
        text,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
        tone,
        glossaryId,
      });
      if (myId !== reqIdRef.current) return; // stale — drop result
      setTranslated(result?.translatedText ?? null);
      setMeta({
        provider: result?.provider,
        model: result?.model,
        cached: !!result?.cached,
        confidence: result?.confidence ?? null,
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        translationId: result?.translationId || null,
        providerAttempts: Array.isArray(result?.providerAttempts) ? result.providerAttempts : [],
      });
      setStatus('ready');
    } catch (err) {
      if (myId !== reqIdRef.current) return;
      setError(err?.response?.data?.message || err?.message || 'Translation failed');
      setStatus('error');
    }
  }, [enabled, text, sourceLanguage, targetLanguage, tone, glossaryId]);

  useEffect(() => {
    run();
    // requestKey is the stable identity — when it changes, kick a new run.
    // We intentionally depend on requestKey (not on each input separately)
    // so identical re-renders don't refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled]);

  return {
    status,
    translated,
    error,
    meta,
    retranslate: run,
    isLoading: status === 'loading',
    isReady: status === 'ready',
    isError: status === 'error',
  };
}

export default useTranslateContent;
