import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { translateTexts as apiTranslate, getSupportedLanguages } from '../api/translate';

const LS_KEY = 'oxs:language';

// ── DOM translation helpers ───────────────────────────────────────────────────

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE',
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'MATH',
]);

// Skip purely numeric / symbolic text — not worth translating
const SKIP_RE = /^[\d\s.,:%$€£¥₹+\-*/()[\]{}<>'"!?@#&^~`|\\]+$/;

// JS property (not HTML attribute) used to store original English text on elements.
// Survives React re-renders that keep the same DOM element but update its children.
const ORIG_PROP = '__oxsEn';

function collectTextNodes(root = document.body) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      // Skip anything inside editable, code, or pre ancestors
      if (p.closest('script,style,pre,code,[contenteditable="true"]'))
        return NodeFilter.FILTER_REJECT;
      const text = (node.nodeValue || '').trim();
      if (text.length < 2 || SKIP_RE.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

// Chunk an array into sub-arrays of at most `size`
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Context ───────────────────────────────────────────────────────────────────

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => localStorage.getItem(LS_KEY) || 'en'
  );
  const [availableLanguages, setAvailableLanguages] = useState([
    { code: 'en', name: 'English' },
  ]);

  // Translation cache: `${targetLang}:${origText}` → translatedText
  // Persisted in sessionStorage so hot re-applies don't need API calls.
  const cacheRef = useRef((() => {
    try {
      const raw = sessionStorage.getItem('oxs:tlcache');
      return raw ? new Map(JSON.parse(raw)) : new Map();
    } catch { return new Map(); }
  })());

  // Pending queue for the useTranslate hook (component-level API)
  const pendingQueue    = useRef([]);
  const pendingResolvers = useRef(new Map());
  const flushTimer      = useRef(null);

  // DOM engine refs
  const domBusy      = useRef(false);
  const observerRef  = useRef(null);
  const domDebounce  = useRef(null);

  // ── Cache persistence ─────────────────────────────────────────────────────

  const persistTimer = useRef(null);
  const persistCache = useCallback(() => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        sessionStorage.setItem('oxs:tlcache', JSON.stringify([...cacheRef.current]));
      } catch { /* quota full — not critical */ }
    }, 500);
  }, []);

  // ── Supported languages ───────────────────────────────────────────────────

  useEffect(() => {
    getSupportedLanguages()
      .then(langs => {
        if (Array.isArray(langs) && langs.length > 0) setAvailableLanguages(langs);
      })
      .catch(() => {});
  }, []);

  // ── setLanguage ───────────────────────────────────────────────────────────

  const setLanguage = useCallback((code) => {
    setLanguageState(code);
    localStorage.setItem(LS_KEY, code);
  }, []);

  // ── Component-level translation API (for useTranslate hook) ───────────────

  const requestTranslation = useCallback((text, targetLang) => {
    if (!text || targetLang === 'en') return Promise.resolve(text);
    const key = `${targetLang}:${text}`;
    if (cacheRef.current.has(key)) return Promise.resolve(cacheRef.current.get(key));

    return new Promise((resolve) => {
      if (!pendingResolvers.current.has(key)) {
        pendingResolvers.current.set(key, []);
        pendingQueue.current.push({ text, lang: targetLang });
      }
      pendingResolvers.current.get(key).push(resolve);
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flushHookQueue, 50);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function flushHookQueue() {
    const batch = pendingQueue.current.splice(0);
    if (!batch.length) return;
    const byLang = {};
    batch.forEach(({ text, lang }) => { (byLang[lang] = byLang[lang] || []).push(text); });

    await Promise.allSettled(Object.entries(byLang).map(async ([lang, texts]) => {
      try {
        const { translations } = await apiTranslate(texts, lang);
        texts.forEach((text, i) => {
          const key = `${lang}:${text}`;
          const result = translations[i] ?? text;
          cacheRef.current.set(key, result);
          pendingResolvers.current.get(key)?.forEach(r => r(result));
          pendingResolvers.current.delete(key);
        });
        persistCache();
      } catch {
        texts.forEach(text => {
          const key = `${lang}:${text}`;
          pendingResolvers.current.get(key)?.forEach(r => r(text));
          pendingResolvers.current.delete(key);
        });
      }
    }));
  }

  const getCached = useCallback((text, targetLang) => {
    if (!text || targetLang === 'en') return text;
    return cacheRef.current.get(`${targetLang}:${text}`) ?? null;
  }, []);

  // ── DOM translation engine ────────────────────────────────────────────────

  /**
   * Translate all visible text nodes in the document.
   * - Applies cached translations synchronously (no flicker for warm cache).
   * - Batches uncached strings, fetches from API, then applies.
   */
  async function translateDOM(targetLang) {
    if (domBusy.current) return;
    domBusy.current = true;
    try {
      const nodes = collectTextNodes();
      if (!nodes.length) return;

      // Save originals before first ever translation (so we can restore English)
      nodes.forEach(node => {
        const p = node.parentElement;
        if (p && p[ORIG_PROP] === undefined) {
          p[ORIG_PROP] = node.nodeValue;
        }
      });

      // Apply already-cached translations immediately (zero latency)
      const uncachedTexts = new Set();
      nodes.forEach(node => {
        const orig = (node.parentElement && node.parentElement[ORIG_PROP] !== undefined)
          ? node.parentElement[ORIG_PROP]
          : node.nodeValue;
        const text = (orig || '').trim();
        if (!text) return;
        const key = `${targetLang}:${text}`;
        if (cacheRef.current.has(key)) {
          node.nodeValue = cacheRef.current.get(key);
        } else {
          uncachedTexts.add(text);
        }
      });

      if (uncachedTexts.size === 0) return;

      // Batch-translate uncached strings (max 50 per request)
      const batches = chunk([...uncachedTexts], 50);
      for (const batch of batches) {
        try {
          const { translations } = await apiTranslate(batch, targetLang);
          batch.forEach((text, i) => {
            cacheRef.current.set(`${targetLang}:${text}`, translations[i] ?? text);
          });
          persistCache();
        } catch {
          // Leave these nodes in English — not critical
        }
      }

      // Apply the newly fetched translations
      collectTextNodes().forEach(node => {
        const p = node.parentElement;
        const orig = (p && p[ORIG_PROP] !== undefined) ? p[ORIG_PROP] : node.nodeValue;
        const text = (orig || '').trim();
        const key = `${targetLang}:${text}`;
        if (cacheRef.current.has(key)) {
          node.nodeValue = cacheRef.current.get(key);
        }
      });
    } finally {
      domBusy.current = false;
    }
  }

  /**
   * Restore all text nodes to their original English content.
   * Called when the user switches back to English.
   */
  function restoreEnglish() {
    collectTextNodes().forEach(node => {
      const p = node.parentElement;
      if (p && p[ORIG_PROP] !== undefined) {
        node.nodeValue = p[ORIG_PROP];
        delete p[ORIG_PROP];
      }
    });
  }

  // ── Language change effect — drives the DOM engine ────────────────────────

  useEffect(() => {
    // Tear down any previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    clearTimeout(domDebounce.current);

    if (language === 'en') {
      restoreEnglish();
      return;
    }

    // Translate the page immediately
    translateDOM(language);

    // Re-translate after React re-renders (debounced to avoid thrashing)
    const schedule = () => {
      clearTimeout(domDebounce.current);
      domDebounce.current = setTimeout(() => translateDOM(language), 150);
    };

    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some(m =>
        m.type === 'characterData' ||
        (m.type === 'childList' && m.addedNodes.length > 0)
      );
      if (relevant) schedule();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      clearTimeout(domDebounce.current);
    };
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, availableLanguages, requestTranslation, getCached }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
