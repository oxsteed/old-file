'use strict';

// Unified statement search, period trends, and saved statement views
// (statements capabilities, Group B).
//
// Self-contained Express router. NOT mounted here: the application wires it
// with a mount line such as
//   app.use('/api/statements', statementSearchRoutes);
// placed BEFORE the statementRenditions mount at the same prefix (none of
// this router's paths collide with the rendition or archive routes).
// Every route requires authentication via ../middleware/auth.
//
// Routes:
//   GET    /search?q=...&product=...&limit=...&offset=...
//          Search amount, description, transaction ID, order, invoice, or
//          reference across every statement the caller is authorized to see
//          (all five products). Results are grouped by product; each entry
//          carries a link target (product, documentId, entryId, url).
//   GET    /saved-views?product=...
//   POST   /saved-views            { name, product, filters, sort }
//   DELETE /saved-views/:id        (owner-only; foreign ids answer 404)
//   GET    /:product/:accountId/trends?period=YYYY-MM
//          Current vs previous period comparison for an OxSteed Credit or
//          Restaurant Credit account the caller owns. :accountId accepts the
//          numeric account id, the OxSteed currency code ("USD"), or the
//          restaurant wallet key ("<restaurantId>:USD") used by the statement
//          page. period defaults to the current UTC month.
//
// Invariants honored:
// - Record-level authorization per product, mirroring the existing checks:
//   credit products join the caller's own accounts; helper_earnings matches
//   scope_helper_user_id; restaurant_settlement/business resolve scopes where
//   the caller is the owner (or the restaurant's recorded owner) or an
//   ACTIVE manager. Search never leaks across users.
// - Amounts stay integer minor units; currencies are never combined.
// - Saved views are owner-scoped; list/create/delete all bind user_id to the
//   authenticated caller, and unknown/foreign ids are indistinguishable 404s.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  searchStatements,
  getStatementTrends,
  listSavedViews,
  createSavedView,
  deleteSavedView,
} = require('../services/statementSearchService');

const router = express.Router();
router.use(authenticate);

router.get('/search', async (req, res, next) => {
  try {
    const result = await searchStatements(req.user.id, {
      q: req.query.q,
      product: req.query.product,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.set('Cache-Control', 'private, no-store');
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/saved-views', async (req, res, next) => {
  try {
    const views = await listSavedViews(req.user.id, req.query.product);
    res.set('Cache-Control', 'private, no-store');
    res.json({ views });
  } catch (err) { next(err); }
});

router.post('/saved-views', async (req, res, next) => {
  try {
    const view = await createSavedView(req.user.id, {
      name: req.body?.name,
      product: req.body?.product,
      filters: req.body?.filters,
      sort: req.body?.sort,
    });
    res.status(201).json({ view });
  } catch (err) { next(err); }
});

router.delete('/saved-views/:id', async (req, res, next) => {
  try {
    const result = await deleteSavedView(req.user.id, req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:product/:accountId/trends', async (req, res, next) => {
  try {
    const trends = await getStatementTrends(req.user.id, {
      product: req.params.product,
      accountId: req.params.accountId,
      period: req.query.period,
    });
    res.set('Cache-Control', 'private, no-store');
    res.json(trends);
  } catch (err) { next(err); }
});

module.exports = router;
