// Guards the Learn deep-review fix 4: no em dashes (U+2014) in user-visible
// Learn guide copy, and a forward data migration that scrubs the rows
// migration 627 seeded into learn_guides.
const fs = require('fs');
const path = require('path');
const { listMigrationFiles } = require('../migrate');

const GUIDES_JSON = path.join(__dirname, '..', 'data', 'learnGuides.json');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const CLEANUP_FILE = '629_learn_guides_em_dash_cleanup.sql';

function* walkStrings(value) {
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* walkStrings(item);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) yield* walkStrings(item);
  }
}

describe('learn guide copy has no em dashes', () => {
  test('learnGuides.json fallback catalog contains no U+2014 in any string', () => {
    const raw = fs.readFileSync(GUIDES_JSON, 'utf8');
    const data = JSON.parse(raw);
    const guides = Array.isArray(data) ? data : data.guides;
    expect(Array.isArray(guides)).toBe(true);
    expect(guides.length).toBeGreaterThan(0);
    const offenders = [];
    for (const guide of guides) {
      for (const str of walkStrings(guide)) {
        if (str.includes('—')) offenders.push(guide.id);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('migration 629 exists, sorts after 628, and scrubs every user-visible column', () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const idx629 = files.indexOf(CLEANUP_FILE);
    const idx628 = files.indexOf('628_learn_ai_tagging.sql');
    expect(idx629).toBeGreaterThan(-1);
    expect(idx628).toBeGreaterThan(-1);
    expect(idx629).toBeGreaterThan(idx628);

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, CLEANUP_FILE), 'utf8');
    expect(sql).toMatch(/UPDATE\s+learn_guides/i);
    // Every user-visible text column from migration 627's seed must be scrubbed.
    for (const column of ['title', 'intro', 'steps', 'skills', 'tools']) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, 'i'));
    }
    expect(sql).toContain('—');
    // Guards against wiping NOT NULL columns when only one column carries a dash.
    expect(sql).toMatch(/jsonb_array_length/i);
    expect(sql).toMatch(/cardinality\(skills\)/i);
  });
});
