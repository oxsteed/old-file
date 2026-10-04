'use strict';

/**
 * Tests for the universal entity ID system (migration 670) and
 * server/lib/entityIds.js.
 *
 * Pure-algorithm checks (check digit, format, validation) run without any DB.
 * Lib behavior is tested against a tiny in-memory fake client that mimics the
 * entity_ids / entity_links tables, so grant/revoke/regrant history is
 * exercised behaviorally without a live Postgres.
 */

const {
  ALPHABET,
  computeCheckChar,
  isValidPublicId,
  parsePublicId,
  getOrMintEntityId,
  resolvePublicId,
  grantLink,
  revokeLink,
  getControlledEntities,
  getControllers,
} = require('../lib/entityIds');

function randomEight() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[Math.floor(Math.random() * 32)];
  }
  return s;
}

function makePublicId(typeCode, eight) {
  const e = eight || randomEight();
  return `OX-${typeCode}-${e.slice(0, 4)}-${e.slice(4)}-${computeCheckChar(e)}`;
}

// ── Minimal in-memory fake for entity_ids / entity_links ────────────────────
function fakeClient() {
  const ids = new Map(); // public_id -> row
  const byTypeKey = new Map(); // `${type}:${key}` -> public_id
  const links = []; // { id, subject_id, object_id, relation, share, granted_by, valid_from, valid_to }
  let seq = 1;
  let minted = 0;

  async function query(text, params = []) {
    const t = String(text);
    if (t.includes('FROM entity_ids WHERE entity_type = $1 AND entity_key = $2')) {
      const pid = byTypeKey.get(`${params[0]}:${params[1]}`);
      return { rows: pid ? [{ public_id: pid }] : [] };
    }
    if (t.includes('SELECT mint_entity_id($1)')) {
      minted += 1;
      const code = params[0]; // the lib passes the single-letter type code
      if (!['P', 'B', 'R', 'H'].includes(code)) throw new Error('fakeClient: bad type code ' + code);
      const eight = randomEight();
      return {
        rows: [{ public_id: `OX-${code}-${eight.slice(0, 4)}-${eight.slice(4)}-${computeCheckChar(eight)}` }],
      };
    }
    if (t.includes('INSERT INTO entity_ids')) {
      const [public_id, entity_type, entity_key] = params;
      const dup = [...byTypeKey.keys()].some(
        (k) => k === `${entity_type}:${entity_key}` || [...ids.keys()].includes(public_id)
      );
      if (dup) {
        const err = new Error('duplicate key');
        err.code = '23505';
        throw err;
      }
      const row = { public_id, entity_type, entity_key, created_at: new Date() };
      ids.set(public_id, row);
      byTypeKey.set(`${entity_type}:${entity_key}`, public_id);
      return { rows: [] };
    }
    if (t.includes('FROM entity_ids WHERE public_id = $1')) {
      const row = ids.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (t.startsWith('UPDATE entity_links SET valid_to = now()')) {
      const [subjectId, objectId, relation] = params;
      const now = new Date();
      const closed = [];
      for (const l of links) {
        if (l.subject_id === subjectId && l.object_id === objectId && l.relation === relation && !l.valid_to) {
          l.valid_to = now;
          closed.push({ ...l });
        }
      }
      return { rows: closed };
    }
    if (t.includes('INSERT INTO entity_links')) {
      const [subject_id, object_id, relation, share, granted_by] = params;
      const row = {
        id: seq++, subject_id, object_id, relation, share, granted_by,
        valid_from: new Date(), valid_to: null,
      };
      links.push(row);
      return { rows: [{ ...row }] };
    }
    if (t.includes('FROM entity_links l') && t.includes('l.subject_id = $1')) {
      return {
        rows: links
          .filter((l) => l.subject_id === params[0] && !l.valid_to)
          .map((l) => ({
            relation: l.relation, share: l.share, valid_from: l.valid_from,
            ...ids.get(l.object_id),
          })),
      };
    }
    if (t.includes('FROM entity_links l') && t.includes('l.object_id = $1')) {
      return {
        rows: links
          .filter((l) => l.object_id === params[0] && !l.valid_to)
          .map((l) => ({
            relation: l.relation, share: l.share, valid_from: l.valid_from,
            ...ids.get(l.subject_id),
          })),
      };
    }
    throw new Error(`fakeClient: unhandled query: ${t.slice(0, 80)}`);
  }

  return { query, _ids: ids, _links: links, _minted: () => minted };
}

describe('entity ID format and check digit', () => {
  test('hand-computed Luhn-mod-32 vectors', () => {
    expect(computeCheckChar('00000000')).toBe('0');
    expect(computeCheckChar('11111111')).toBe('M');
    expect(computeCheckChar('ZZZZZZZZ')).toBe('8');
  });

  test('200 generated IDs are well-formed, valid, and unique', () => {
    const seen = new Set();
    const re = /^OX-[PBRH]-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/;
    for (const code of ['P', 'B', 'R', 'H']) {
      for (let i = 0; i < 50; i++) {
        const id = makePublicId(code);
        expect(id).toMatch(re);
        expect(isValidPublicId(id)).toBe(true);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(parsePublicId(id).entity_type).toBe(
          { P: 'person', B: 'business', R: 'restaurant', H: 'helper_profile' }[code]
        );
      }
    }
    expect(seen.size).toBe(200);
  });

  test('tampered check digit fails validation', () => {
    const good = makePublicId('P');
    const bad = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    expect(isValidPublicId(good)).toBe(true);
    expect(isValidPublicId(bad)).toBe(false);
    expect(parsePublicId(bad)).toBeNull();
  });

  test('malformed IDs are rejected', () => {
    expect(isValidPublicId('OX-P-1234-5678')).toBe(false); // missing check char
    expect(isValidPublicId('OX-X-1234-5678-0')).toBe(false); // bad type code
    expect(isValidPublicId('OX-P-1234-567O-0')).toBe(false); // O not in alphabet
    const good = makePublicId('R');
    expect(isValidPublicId(good + ' ')).toBe(true); // surrounding whitespace tolerated
    expect(isValidPublicId(good.toLowerCase())).toBe(true); // case-insensitive
    expect(isValidPublicId('not-an-id')).toBe(false);
    expect(isValidPublicId(null)).toBe(false);
    expect(isValidPublicId(123)).toBe(false);
  });
});

describe('getOrMintEntityId', () => {
  test('returns the existing ID without minting', async () => {
    const client = fakeClient();
    const first = await getOrMintEntityId(client, 'person', 'user-1');
    const mintedBefore = client._minted();
    const second = await getOrMintEntityId(client, 'person', 'user-1');
    expect(second).toBe(first);
    expect(client._minted()).toBe(mintedBefore);
  });

  test('mints distinct IDs per entity type', async () => {
    const client = fakeClient();
    const p = await getOrMintEntityId(client, 'person', 'u1');
    const b = await getOrMintEntityId(client, 'business', '1');
    expect(p).not.toBe(b);
    expect(p).toMatch(/^OX-P-/);
    expect(b).toMatch(/^OX-B-/);
  });

  test('survives a 23505 mint race by returning the winner', async () => {
    const client = fakeClient();
    const realQuery = client.query.bind(client);
    let calls = 0;
    client.query = async (text, params) => {
      calls += 1;
      // Second caller: pretend someone else inserted between our SELECT and INSERT.
      if (calls === 3 && String(text).includes('INSERT INTO entity_ids')) {
        await realQuery('INSERT INTO entity_ids (public_id, entity_type, entity_key) VALUES ($1, $2, $3)',
          ['OX-P-AAAA-BBBB-' + computeCheckChar('AAAABBBB'), 'person', 'u-race']);
        const err = new Error('duplicate key');
        err.code = '23505';
        throw err;
      }
      return realQuery(text, params);
    };
    const id = await getOrMintEntityId(client, 'person', 'u-race');
    expect(id).toBe('OX-P-AAAA-BBBB-' + computeCheckChar('AAAABBBB'));
  });

  test('rejects unknown entity types', async () => {
    const client = fakeClient();
    await expect(getOrMintEntityId(client, 'spaceship', '1')).rejects.toThrow('unknown entity type');
  });
});

describe('resolvePublicId', () => {
  test('returns null for a tampered ID without touching the DB', async () => {
    const client = fakeClient();
    let queried = false;
    const counting = { query: async (t, p) => { queried = true; return client.query(t, p); } };
    const good = makePublicId('B');
    const bad = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    expect(await resolvePublicId(counting, bad)).toBeNull();
    expect(queried).toBe(false);
  });

  test('resolves a minted ID', async () => {
    const client = fakeClient();
    const pid = await getOrMintEntityId(client, 'restaurant', '42');
    const row = await resolvePublicId(client, pid);
    expect(row.public_id).toBe(pid);
    expect(row.entity_type).toBe('restaurant');
    expect(row.entity_key).toBe('42');
  });
});

describe('ownership graph', () => {
  test('grant -> revoke -> regrant keeps append-only history', async () => {
    const client = fakeClient();
    const person = await getOrMintEntityId(client, 'person', 'owner-1');
    const business = await getOrMintEntityId(client, 'business', '7');

    await grantLink(client, { subjectId: person, objectId: business, relation: 'owns' });
    expect(client._links).toHaveLength(1);
    expect(client._links[0].valid_to).toBeNull();

    const closed = await revokeLink(client, { subjectId: person, objectId: business, relation: 'owns' });
    expect(closed).not.toBeNull();
    expect(client._links).toHaveLength(1);
    expect(client._links[0].valid_to).not.toBeNull();

    await grantLink(client, { subjectId: person, objectId: business, relation: 'owns' });
    expect(client._links).toHaveLength(2);
    const [first, second] = client._links;
    expect(first.valid_to).not.toBeNull();
    expect(second.valid_to).toBeNull();
    expect(second.valid_from.getTime()).toBeGreaterThanOrEqual(first.valid_from.getTime());
  });

  test('grantLink closes a duplicate instead of stacking', async () => {
    const client = fakeClient();
    const person = await getOrMintEntityId(client, 'person', 'owner-1');
    const business = await getOrMintEntityId(client, 'business', '7');
    await grantLink(client, { subjectId: person, objectId: business, relation: 'owns' });
    await grantLink(client, { subjectId: person, objectId: business, relation: 'owns' });
    const current = client._links.filter((l) => !l.valid_to);
    expect(current).toHaveLength(1);
    expect(client._links).toHaveLength(2);
  });

  test('revokeLink returns null when nothing is current', async () => {
    const client = fakeClient();
    const person = await getOrMintEntityId(client, 'person', 'owner-1');
    const business = await getOrMintEntityId(client, 'business', '7');
    expect(await revokeLink(client, { subjectId: person, objectId: business, relation: 'owns' })).toBeNull();
  });

  test('rejects bad relations and self-links', async () => {
    const client = fakeClient();
    const person = await getOrMintEntityId(client, 'person', 'owner-1');
    await expect(grantLink(client, { subjectId: person, objectId: person, relation: 'owns' }))
      .rejects.toThrow('must differ');
    await expect(grantLink(client, { subjectId: person, objectId: 'OX-B-AAAA-BBBB-0', relation: 'steals' }))
      .rejects.toThrow('unknown relation');
    await expect(grantLink(client, { subjectId: person, objectId: 'OX-B-AAAA-BBBB-0', relation: 'owns', share: 150 }))
      .rejects.toThrow('share');
  });

  test('getControlledEntities returns the tree; getControllers the reverse', async () => {
    const client = fakeClient();
    const person = await getOrMintEntityId(client, 'person', 'owner-1');
    const business = await getOrMintEntityId(client, 'business', '7');
    const restaurant = await getOrMintEntityId(client, 'restaurant', '9');
    const helper = await getOrMintEntityId(client, 'helper_profile', '3');
    const manager = await getOrMintEntityId(client, 'person', 'mgr-2');

    await grantLink(client, { subjectId: person, objectId: business, relation: 'owns', share: 100 });
    await grantLink(client, { subjectId: person, objectId: restaurant, relation: 'owns' });
    await grantLink(client, { subjectId: restaurant, objectId: business, relation: 'belongs_to' });
    await grantLink(client, { subjectId: person, objectId: helper, relation: 'acts_as' });
    await grantLink(client, { subjectId: manager, objectId: business, relation: 'manages' });

    const tree = await getControlledEntities(client, person);
    expect(tree.map((r) => r.public_id).sort()).toEqual([business, helper, restaurant].sort());
    expect(tree.find((r) => r.public_id === business).relation).toBe('owns');

    const nested = await getControlledEntities(client, restaurant);
    expect(nested.map((r) => r.public_id)).toEqual([business]);

    const controllers = await getControllers(client, business);
    expect(controllers.map((r) => r.public_id).sort()).toEqual([person, restaurant, manager].sort());
    expect(controllers.find((r) => r.public_id === manager).relation).toBe('manages');

    // Revoked links disappear from the current tree.
    await revokeLink(client, { subjectId: person, objectId: helper, relation: 'acts_as' });
    const treeAfter = await getControlledEntities(client, person);
    expect(treeAfter.map((r) => r.public_id).sort()).toEqual([business, restaurant].sort());
  });
});
