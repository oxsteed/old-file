import api from './axios';

// Unified statement search, saved views, and period trends.
// Server routes live in server/routes/statementSearch.js; the router is
// mounted at /api/statements (see the integration notes in the group report).

export function searchStatements({ q, product, limit = 25, offset = 0, signal } = {}) {
  return api.get('/statements/search', { params: { q, product, limit, offset }, signal })
    .then((response) => response.data);
}

export function listSavedViews({ product, signal } = {}) {
  return api.get('/statements/saved-views', { params: product ? { product } : {}, signal })
    .then((response) => (Array.isArray(response.data?.views) ? response.data.views : []));
}

export function createSavedView({ name, product, filters = {}, sort = {} }) {
  return api.post('/statements/saved-views', { name, product, filters, sort })
    .then((response) => response.data?.view || null);
}

export function deleteSavedView(id) {
  if (!id) throw new Error('Invalid saved view');
  return api.delete(`/statements/saved-views/${encodeURIComponent(String(id))}`)
    .then((response) => response.data);
}

export function getStatementTrends(product, accountId, { period, signal } = {}) {
  if (!product || accountId === undefined || accountId === null || String(accountId) === '') {
    throw new Error('Invalid trend account');
  }
  const params = period ? { period } : {};
  return api.get(`/statements/${encodeURIComponent(product)}/${encodeURIComponent(String(accountId))}/trends`, { params, signal })
    .then((response) => response.data);
}
