import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { translateTexts as apiTranslate, getSupportedLanguages } from '../api/translate';

const LS_KEY = 'oxs:language';
const FLUSH_DELAY_MS = 50; // batch window

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem(LS_KEY) || 'en');
  const [availableLanguages, setAvailableLanguages] = useState([
    { code: 'en', name: 'English' },
  ]);

  // Translation cache: Map<`${lang}:${sourceText}`, translatedText>
  // Stored in sessionStorage so it survives within a session across navigations.
  const cacheRef = useRef((() => {
    try {
      const raw = sessionStorage.getItem('oxs:tlcache');
      return raw ? new Map(JSON.parse(raw)) : new Map();
    } catch {
      return new Map();
    }
  })());

  // Pending queue for batched translation
  const pendingQueue = useRef([]);                       // { text, lang }[]
  const pendingResolvers = useRef(new Map());            // key → resolve[]
  const flushTimer = useRef(null);

  // Persist cache to sessionStorage (debounced to avoid excessive writes)
  const persistCacheTimer = useRef(null);
  const persistCache = useCallback(() => {
    clearTimeout(persistCacheTimer.current);
    persistCacheTimer.current = setTimeout(() => {
      try {
        sessionStorage.setItem('oxs:tlcache', JSON.stringify([...cacheRef.current]));
      } catch {
        // sessionStorage quota exceeded — not critical
      }
    }, 500);
  }, []);

  // Fetch supported languages on mount
  useEffect(() => {
    getSupportedLanguages()
      .then(langs => {
        if (Array.isArray(langs) && langs.length > 0) {
          setAvailableLanguages(langs);
        }
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((code) => {
    setLanguageState(code);
    localStorage.setItem(LS_KEY, code);
  }, []);

  /**
   * Request translation of a single string.
   * Returns a Promise that resolves with the translated string.
   * Multiple calls within FLUSH_DELAY_MS are batched into one API request.
   */
  const requestTranslation = useCallback((text, targetLang) => {
    if (!text || targetLang === 'en') return Promise.resolve(text);

    const cacheKey = `${targetLang}:${text}`;
    if (cacheRef.current.has(cacheKey)) {
      return Promise.resolve(cacheRef.current.get(cacheKey));
    }

    return new Promise((resolve) => {
      // Deduplicate: same text+lang already queued
      if (!pendingResolvers.current.has(cacheKey)) {
        pendingResolvers.current.set(cacheKey, []);
        pendingQueue.current.push({ text, lang: targetLang });
      }
      pendingResolvers.current.get(cacheKey).push(resolve);

      // Schedule flush
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, FLUSH_DELAY_MS);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    const batch = pendingQueue.current.splice(0);
    if (batch.length === 0) return;

    // Group by target language (usually just one)
    const byLang = {};
    batch.forEach(({ text, lang }) => {
      (byLang[lang] = byLang[lang] || []).push(text);
    });

    await Promise.allSettled(
      Object.entries(byLang).map(async ([lang, texts]) => {
        const cacheKeys = texts.map(t => `${lang}:${t}`);

        try {
          const { translations } = await apiTranslate(texts, lang);
          texts.forEach((text, i) => {
            const key = cacheKeys[i];
            const result = translations[i] ?? text;
            cacheRef.current.set(key, result);
            pendingResolvers.current.get(key)?.forEach(r => r(result));
            pendingResolvers.current.delete(key);
          });
          persistCache();
        } catch {
          // On failure, resolve with the original text
          texts.forEach((text, i) => {
            const key = cacheKeys[i];
            pendingResolvers.current.get(key)?.forEach(r => r(text));
            pendingResolvers.current.delete(key);
          });
        }
      })
    );
  }

  /**
   * Look up a translation from cache synchronously.
   * Returns null if not yet translated.
   */
  const getCached = useCallback((text, targetLang) => {
    if (!text || targetLang === 'en') return text;
    return cacheRef.current.get(`${targetLang}:${text}`) ?? null;
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, availableLanguages, requestTranslation, getCached }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
