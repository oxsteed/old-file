import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

/**
 * Translate a single string to the currently selected language.
 *
 * Returns [translatedText, isLoading].
 *
 * - While the language is English, returns the original text immediately.
 * - If a cached translation exists, returns it synchronously (no loading flash).
 * - Otherwise returns the original text while the API call is in-flight,
 *   then swaps to the translation when it arrives.
 *
 * @param {string} text - The source string to translate (should be in English).
 * @returns {[string, boolean]}
 */
export function useTranslate(text) {
  const { language, requestTranslation, getCached } = useLanguage();

  const getInitial = () => {
    if (!text || language === 'en') return text;
    return getCached(text, language) ?? text;
  };

  const [translated, setTranslated] = useState(getInitial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!text || language === 'en') {
      setTranslated(text);
      setLoading(false);
      return;
    }

    const cached = getCached(text, language);
    if (cached !== null) {
      setTranslated(cached);
      setLoading(false);
      return;
    }

    // Show original while waiting; mark loading
    setTranslated(text);
    setLoading(true);

    let cancelled = false;
    requestTranslation(text, language).then((result) => {
      if (!cancelled) {
        setTranslated(result);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [text, language]); // eslint-disable-line react-hooks/exhaustive-deps

  return [translated, loading];
}

/**
 * Convenience: just returns the translated string (no loading flag).
 */
export default function useT(text) {
  const [translated] = useTranslate(text);
  return translated;
}
