'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const seed = readFileSync(join(__dirname, 'credit-isolated-seed.sql'), 'utf8');

function valuesBlock(table) {
  const match = seed.match(new RegExp(
    `INSERT INTO ${table} [\\s\\S]*?VALUES\\s*([\\s\\S]*?)\\nON CONFLICT`,
  ));
  assert.ok(match, `missing ${table} fixture block`);
  return match[1];
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

test('isolated Credit seed preserves restaurant ownership invariants', () => {
  const businessIds = [...valuesBlock('businesses').matchAll(/\((\d+),\s*'[^']+',\s*'[^']+'/g)]
    .map((match) => Number(match[1]));
  const restaurants = [...valuesBlock('food_restaurants').matchAll(/\((\d+),\s*(\d+),\s*'[^']+'/g)]
    .map((match) => ({ id: Number(match[1]), businessId: Number(match[2]) }));
  const partners = [...valuesBlock('oxsteed_credit_partners').matchAll(/\((\d+),\s*(\d+),\s*(\d+),\s*'/g)]
    .map((match) => ({ id: Number(match[1]), restaurantId: Number(match[2]), businessId: Number(match[3]) }));

  unique(businessIds, 'business IDs');
  unique(restaurants.map((restaurant) => restaurant.id), 'restaurant IDs');
  unique(restaurants.map((restaurant) => restaurant.businessId), 'restaurant business IDs');
  unique(partners.map((partner) => partner.id), 'partner IDs');

  const businessSet = new Set(businessIds);
  const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  for (const restaurant of restaurants) {
    assert.ok(businessSet.has(restaurant.businessId), `restaurant ${restaurant.id} references an unknown business`);
  }
  for (const partner of partners) {
    const restaurant = restaurantsById.get(partner.restaurantId);
    assert.ok(restaurant, `partner ${partner.id} references an unknown restaurant`);
    assert.equal(partner.businessId, restaurant.businessId, `partner ${partner.id} business ownership drifted`);
  }
});
