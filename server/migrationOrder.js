'use strict';

// Migration filename ordering (careers spec §6.14, decision Q11).
//
// Historically the runner sorted filenames as plain text. That breaks once a
// prefix grows a digit: `100000_x.sql` sorts between `099_` and `101_` and
// would run too early on a fresh database. The runner now sorts by the
// NUMERIC value of the leading digits, breaking ties by the full filename.
//
// For every file that existed before this change the numeric order is
// identical to the old text order (all prefixes were 3 or 5 digits and the
// 5-digit band starts at 99900), so already-applied names and checksums are
// untouched and a fresh database replays history in exactly the old order.
// New migrations use a 14-digit UTC timestamp prefix
// (YYYYMMDDHHMMSS_name.sql), which always sorts after 99994.
//
// A filename with no leading digits is refused rather than silently placed
// somewhere surprising.

const TIMESTAMP_PREFIX = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;

function migrationPrefix(filename) {
  const match = /^(\d+)/.exec(String(filename));
  if (!match) {
    throw new Error(`Migration filename needs a numeric prefix: ${filename}`);
  }
  return BigInt(match[1]);
}

function compareMigrationFiles(a, b) {
  const pa = migrationPrefix(a);
  const pb = migrationPrefix(b);
  if (pa < pb) return -1;
  if (pa > pb) return 1;
  // Same numeric prefix (historical duplicates such as 610_ and 610b_):
  // the full filename decides, exactly as the old text sort did.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortMigrationFiles(files) {
  return [...files].sort(compareMigrationFiles);
}

// Validates a timestamp prefix: 14 digits that form a real UTC date/time.
function isValidTimestampMigration(filename) {
  const match = TIMESTAMP_PREFIX.exec(String(filename));
  if (!match) return false;
  const s = match[1];
  const [y, mo, d, h, mi, se] = [
    s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14),
  ].map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === se
    && y >= 2026;
}

// Returns human-readable problems with a migration directory listing:
//   - files without a numeric prefix
//   - duplicate numeric prefixes, except those in `allowedDuplicatePrefixes`
//     (the frozen historical set; see migrationOrderLegacy.json)
function listOrderingProblems(files, { allowedDuplicatePrefixes = [] } = {}) {
  const problems = [];
  const allowed = new Set(allowedDuplicatePrefixes.map(String));
  const seen = new Map();
  for (const file of files) {
    let prefix;
    try {
      prefix = migrationPrefix(file).toString();
    } catch (err) {
      problems.push(err.message);
      continue;
    }
    if (!seen.has(prefix)) seen.set(prefix, []);
    seen.get(prefix).push(file);
  }
  for (const [prefix, names] of seen) {
    if (names.length > 1 && !allowed.has(prefix)) {
      problems.push(`Duplicate migration prefix ${prefix}: ${names.join(', ')}`);
    }
  }
  return problems;
}

module.exports = {
  TIMESTAMP_PREFIX,
  migrationPrefix,
  compareMigrationFiles,
  sortMigrationFiles,
  isValidTimestampMigration,
  listOrderingProblems,
};
