'use strict';

const fs = require('fs');
const path = require('path');

const learnRoutes = fs.readFileSync(path.join(__dirname, '../routes/learn.js'), 'utf8');
const learnController = fs.readFileSync(path.join(__dirname, '../controllers/learnController.js'), 'utf8');
const mediaRoutes = fs.readFileSync(path.join(__dirname, '../routes/media.js'), 'utf8');
const mediaController = fs.readFileSync(path.join(__dirname, '../controllers/mediaController.js'), 'utf8');
const accessMiddleware = fs.readFileSync(path.join(__dirname, '../middleware/requireAccess.js'), 'utf8');
const learnPage = fs.readFileSync(path.join(__dirname, '../../client/src/pages/LearnModePage.jsx'), 'utf8');

describe('progressive access Learn and personal-resource contracts', () => {
  test('Learn authoring is capability-aware while reading and completion remain customer-first', () => {
    expect(learnRoutes).toContain("requireAnyCapability");
    expect(learnRoutes).toContain("helper.offer_services");
    expect(learnRoutes).toContain("consultant.accept_paying_clients");
    expect(learnRoutes).toContain("router.post('/guides/submit',        authenticate, requireLearnAuthorAccess, submitGuide)");
    expect(learnRoutes).toContain("router.post('/submissions',          authenticate, requireLearnAuthorAccess, submitGuide)");
    expect(learnRoutes).toContain("router.get('/guides',                optionalAuth, getGuides)");
    expect(learnRoutes).toContain("router.post('/views',                recordView)");
    expect(learnRoutes).toContain("router.post('/completions',          authenticate, recordCompletion)");
    expect(accessMiddleware).toContain('function requireAnyCapability(entries = [])');
    expect(accessMiddleware).toContain("code: 'access_required'");
  });

  test('personal Learn state is owner-scoped and product links are publish-only', () => {
    expect(learnController).toMatch(/FROM user_guide_completions\s+WHERE user_id = \$1/);
    expect(learnController).toMatch(/FROM guide_submissions\s+WHERE user_id = \$1/);
    expect(learnController).toMatch(/WHERE is_active = TRUE/);
    expect(learnController).toContain('learn_marketplace_clicks');
  });

  test('bookmarks and post deletion bind to the requesting account and revoke delivery', () => {
    expect(mediaRoutes).toContain("router.get('/posts/bookmarks', requireAuth, ctrl.getBookmarks)");
    expect(mediaRoutes).toContain("router.post('/posts/:id/bookmark', requireAuth, ctrl.toggleBookmark)");
    expect(mediaRoutes).toContain("router.delete('/posts/:id', requireAuth, ctrl.deletePost)");
    expect(mediaController).toMatch(/AND b\.user_id = \$1/);
    expect(mediaController).toMatch(/a\.owner_user_id = \$2/);
    expect(mediaController).toContain("delivery_revoke_reason = COALESCE(delivery_revoke_reason, 'author_deleted')");
    expect(mediaController).toContain("visibility = 'removed'");
  });

  test('Learn UI derives authoring access from the projection as well as legacy compatibility fields', () => {
    expect(learnPage).toContain("useAccessProjection(user)");
    expect(learnPage).toContain("helper.offer_services");
    expect(learnPage).toContain("consultant.accept_paying_clients");
    expect(learnPage).toContain('const canSubmitGuide = Boolean(');
    expect(learnPage).toContain('{canSubmitGuide && (');
  });
});

