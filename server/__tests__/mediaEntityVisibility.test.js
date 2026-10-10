'use strict';

const { publicBusinessSql, publicRestaurantSql, publicActorSql } = require('../services/mediaEntityVisibility');

test.each([publicBusinessSql, publicRestaurantSql])('owner predicates remain separate SQL tokens', predicate => {
  const sql = predicate('entity', 'owner');
  expect(sql).toMatch(/= TRUE\s+AND owner\.deleted_at IS NULL/);
  expect(sql).toContain('owner.is_active = TRUE');
  expect(sql).toContain('owner.is_banned = FALSE');
  expect(sql).not.toContain('TRUEAND');
});

test('public actors require verified visible entities with current owners', () => {
  const sql = publicActorSql('actor');
  for (const alias of ['media_public_hu', 'media_public_bu', 'media_public_ru']) {
    expect(sql).toContain(`${alias}.deleted_at IS NULL`);
    expect(sql).toContain(`${alias}.is_banned = FALSE`);
  }
  expect(sql).not.toContain('TRUEAND');
});
