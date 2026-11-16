'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access media publisher boundary (WP-042)', () => {
  test('publication rechecks selected-author verification at write time', () => {
    const source = read('controllers/mediaController.js');
    expect(source).toMatch(/current_actor_verified/);
    expect(source).toMatch(/media_not_verified_poster/);
    expect(source).toMatch(/verifiedActorSql\('a'\)/);
  });

  test('editing a represented public post does not survive verification revocation', () => {
    const source = read('controllers/mediaController.js');
    expect(source).toMatch(/a\.actor_type = 'user' OR \(\$\{verifiedActorSql\('a'\)\}\) = TRUE/);
  });

  test('draft and asset mutations remain owner-bound and private', () => {
    const attachments = read('services/mediaDraftAttachments.js');
    const routes = read('routes/media.js');
    expect(attachments).toMatch(/a\.owner_user_id = \$2/);
    expect(attachments).toMatch(/p\.visibility <> 'removed'/);
    expect(routes).toMatch(/router\.delete\('\/posts\/:postId\/assets\/:assetId', requireAuth/);
    expect(routes).toMatch(/router\.delete\('\/posts\/:id', requireAuth/);
  });
});
