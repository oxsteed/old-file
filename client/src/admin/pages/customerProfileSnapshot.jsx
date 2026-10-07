import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { AuthContext } from '../../context/AuthContext';
import { ThemeContext } from '../../context/ThemeContext';
import { LanguageContext } from '../../context/LanguageContext';
import { CookieConsentContext } from '../../context/CookieConsentContext';
import HelperBusinessProfilePage from '../../pages/HelperBusinessProfilePage';
import BusinessPublicProfilePage from '../../pages/BusinessPublicProfilePage';
import FoodRestaurantPage from '../../pages/food/FoodRestaurantPage';
import { businessProfilePath } from '../../utils/profileUrls';
import { NAVBAR_STYLES } from '../../components/Navbar';

const noop = () => {};
const pages = {
  helper: { path: '/helpers/:id', url: id => `/helpers/${id}`, Component: HelperBusinessProfilePage },
  business: { path: '/businesses/public/:businessId', url: id => businessProfilePath({ businessId: id }), Component: BusinessPublicProfilePage },
  restaurant: { path: '/restaurants/r/:restaurantId', url: id => `/restaurants/r/${id}`, Component: FoodRestaurantPage },
};

// Rendering, not mounting, is essential: public-page effects (tracking, sockets,
// cart recovery, requests) and event handlers must never run in an admin preview.
export function renderCustomerProfileMarkup({ type, id, content, i18n, language, availableLanguages, theme, tab, category }) {
  const page = pages[type];
  const validId = type === 'helper' ? /^[a-z0-9-]{1,80}$/i.test(String(id)) : /^[1-9]\d*$/.test(String(id));
  if (!page || !content?.[type] || !validId) throw new Error('Invalid snapshot profile');
  const Component = page.Component;
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <LanguageContext.Provider value={{ language, availableLanguages, setLanguage: noop, syncLanguageFromServer: noop }}>
        <AuthContext.Provider value={{ user: null, loading: false, initialized: true, isHelper: false, logout: noop }}>
          <ThemeContext.Provider value={{ isDark: theme === 'dark', toggleTheme: noop }}>
            <CookieConsentContext.Provider value={{ preferences: null, showBanner: false, showSettings: false,
              acceptAll: noop, rejectAll: noop, savePreferences: noop, openSettings: noop, closeSettings: noop, hasConsent: () => false }}>
              <MemoryRouter initialEntries={[page.url(id)]}>
                <Routes><Route path={page.path} element={<Component customerSnapshot={content} snapshotTab={tab} snapshotCategory={category} />} /></Routes>
              </MemoryRouter>
            </CookieConsentContext.Provider>
          </ThemeContext.Provider>
        </AuthContext.Provider>
      </LanguageContext.Provider>
    </I18nextProvider>
  );
}

function passiveImage(value, origin) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, origin);
    // No API requests, credentials in URLs, active schemes, or arbitrary data SVG.
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !/^\/api(?:\/|$)/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export function sanitizeCustomerProfileMarkup(markup, origin = window.location.origin) {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  doc.querySelectorAll('script,style,link,meta,base,iframe,object,embed,template,audio,video,source,track').forEach(node => node.remove());
  doc.querySelectorAll('form').forEach(form => {
    const replacement = doc.createElement('div');
    replacement.className = form.className;
    replacement.append(...form.childNodes);
    form.replaceWith(replacement);
  });
  for (const node of doc.body.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || ['href', 'xlink:href', 'target', 'action', 'formaction', 'srcdoc', 'srcset', 'autofocus', 'contenteditable', 'ping'].includes(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }
    if (node.hasAttribute('src')) {
      const src = node.tagName === 'IMG' ? passiveImage(node.getAttribute('src'), origin) : null;
      if (src) { node.setAttribute('src', src); node.setAttribute('referrerpolicy', 'no-referrer'); }
      else node.removeAttribute('src');
    }
    // User-supplied image URLs may also appear in React-generated cover styles.
    if (node.hasAttribute('style')) {
      const style = node.getAttribute('style');
      node.removeAttribute('style');
      node.style.cssText = style;
      node.setAttribute('style', node.style.cssText);
      if (/@import|expression\s*\(|[<>]/i.test(style)) node.removeAttribute('style');
      else if (/url\s*\(/i.test(style)) {
        for (const property of [...node.style]) {
          const value = node.style.getPropertyValue(property);
          if (/url\s*\(/i.test(value)) {
            let safe = ['background', 'background-image'].includes(property);
            let matched = 0;
            const normalized = value.replace(/url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^()]*))\s*\)/gi, (_, quoted, single, plain) => {
              matched += 1;
              const url = passiveImage(quoted || single || plain?.trim(), origin);
              if (!url) safe = false;
              return url ? `url(${JSON.stringify(url)})` : '';
            });
            if (safe && matched === (value.match(/url\s*\(/gi) || []).length) node.style.setProperty(property, normalized);
            else node.style.removeProperty(property);
          }
        }
        node.setAttribute('style', node.style.cssText);
      }
    }
    if (node.matches('button,input,select,textarea,fieldset')) node.setAttribute('disabled', '');
    if (node.matches('a,button,input,select,textarea,summary,[tabindex],[role="button"]')) {
      node.setAttribute('tabindex', '-1'); node.setAttribute('aria-disabled', 'true');
    }
  }
  return doc.body.innerHTML;
}

export function buildCustomerProfileDocument(options) {
  const origin = window.location.origin;
  const html = sanitizeCustomerProfileMarkup(renderCustomerProfileMarkup(options), origin);
  const doc = document.implementation.createHTMLDocument('OxSteed customer preview');
  doc.documentElement.lang = options.language;
  doc.documentElement.dir = options.language === 'ar' ? 'rtl' : 'ltr';
  doc.documentElement.className = options.theme === 'dark' ? 'dark' : '';
  doc.documentElement.dataset.theme = options.theme;
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; style-src ${origin} https://fonts.googleapis.com 'unsafe-inline'; font-src ${origin} https://fonts.gstatic.com data:; img-src https: http: data:;`;
  doc.head.append(policy);
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'; doc.head.append(viewport);
  // Only the application's same-origin stylesheets and bundler-created styles,
  // never profile HTML. Lazy imports finish loading their CSS before this runs.
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
    if (node.tagName === 'LINK') {
      const url = new URL(node.href, origin);
      if (url.origin !== origin) return;
      const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = url.href; doc.head.append(link);
    } else {
      const style = doc.createElement('style'); style.textContent = node.textContent; doc.head.append(style);
    }
  });
  const safety = doc.createElement('style');
  const navbarStyle = doc.createElement('style'); navbarStyle.textContent = NAVBAR_STYLES; doc.head.append(navbarStyle);
  safety.textContent = 'html{color-scheme:' + options.theme + '}body{margin:0}a,button,input,select,textarea,summary,[role="button"]{pointer-events:none!important}button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:1}';
  doc.head.append(safety);
  doc.body.className = `${options.language === 'ar' ? 'rtl is-rtl ' : ''}lang-${options.language}`;
  doc.body.innerHTML = html;
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
