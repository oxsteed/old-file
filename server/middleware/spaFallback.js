'use strict';

const path = require('path');
const { isAdminSpaPath } = require('../utils/adminSpaRoutes');

// These namespaces belong to APIs/transports/files, including extensionless
// uploads. A failed lookup must never become a successful document response.
const NON_DOCUMENT_PATH = /^\/(?:api|assets|icons|uploads|qr-codes|socket\.io|\.well-known|direct\/service-area-assets)(?:\/|$)/i;

function createSpaFallback(clientDist) {
  return function spaFallback(req, res, next) {
    const pathname = req.path;
    const notFound = () => res.status(404).set('Cache-Control', 'no-store')
      .type('text/plain').send('Not found');

    if (NON_DOCUMENT_PATH.test(pathname)) {
      if (/^\/api(?:\/|$)/i.test(pathname)) {
        return res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found' });
      }
      return notFound();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
    if (pathname.startsWith('//')) return notFound();
    // Do not decode separators or accept a file-looking segment as a SPA URL.
    if (pathname.split('/').some((segment) => /[.%\\]/.test(segment))) return notFound();
    if (!req.accepts('html')) return notFound();

    const canonicalPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const isAdmin = /^\/admin(?:\/|$)/i.test(pathname);
    if (isAdmin) {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      if (!isAdminSpaPath(canonicalPath)) return notFound();
      if (pathname !== canonicalPath) {
        // Relative, manifest-validated destination: never trust Host or a query
        // parameter as the redirect origin. Preserve the original query bytes.
        const queryStart = req.originalUrl.indexOf('?');
        const query = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);
        return res.set('Cache-Control', 'no-store').redirect(308, canonicalPath + query);
      }
    }

    res.set('Cache-Control', isAdmin ? 'no-store' : 'no-cache');
    return res.sendFile(path.join(clientDist, isAdmin ? 'admin.html' : 'index.html'), (err) => {
      if (err) next(err);
    });
  };
}

module.exports = { createSpaFallback };
