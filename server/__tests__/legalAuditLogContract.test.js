/**
 * legalAuditLogContract.test.js
 *
 * Regression test for the silent legal_audit_log divergence (Sentry follow-up
 * to BACKEND-2P): migration 148 created the table with a document-centric
 * schema while migration 164 redefined it actor-centrically but no-ops when
 * 148 already ran. Both writers (ccpaController.logCCPAAction,
 * legalDocumentsController.logAuditAction) and both readers (getAuditLog,
 * the CSV export) use the 164-style columns, so on 148-schema databases
 * every INSERT failed inside a swallowed try/catch and audit rows were
 * dropped silently.
 *
 * Migration 588 reconciles the table. This test locks the contract:
 * every column the code references must exist in the union of columns
 * defined by migrations 148, 164, and 588.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const CONTROLLERS_DIR = path.join(__dirname, '../controllers');
const ROUTES_DIR = path.join(__dirname, '../routes');

function read(file) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

/** Extract column names from the first CREATE TABLE <table> (...) block. */
function createTableColumns(sql, table) {
  const m = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`)
  );
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line && !/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|LIKE)/i.test(line))
    .map((line) => {
      const col = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
      return col ? col[1].toLowerCase() : null;
    })
    .filter(Boolean);
}

/** Extract column names from ADD COLUMN IF NOT EXISTS lines. */
function addedColumns(sql) {
  const cols = [];
  const re = /ADD COLUMN IF NOT EXISTS\s+"?([a-z_][a-z0-9_]*)"?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) cols.push(m[1].toLowerCase());
  return cols;
}

/** Extract the column list of every INSERT INTO <table> (...) statement. */
function insertColumns(source, table) {
  const cols = [];
  const re = new RegExp(`INSERT INTO ${table}\\s*\\(([\\s\\S]*?)\\)`, 'gi');
  let m;
  while ((m = re.exec(source)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().toLowerCase();
      if (name) cols.push(name);
    }
  }
  return cols;
}

const sql148 = read('148_legal_audit_log.sql');
const sql164 = read('164_legal_audit_log_expand.sql');
const sql588 = read('588_legal_audit_log_reconcile.sql');

const available = new Set([
  ...createTableColumns(sql148, 'legal_audit_log'),
  ...createTableColumns(sql164, 'legal_audit_log'),
  ...createTableColumns(sql588, 'legal_audit_log'),
  ...addedColumns(sql148),
  ...addedColumns(sql164),
  ...addedColumns(sql588),
]);

const ccpaSource = fs.readFileSync(
  path.join(CONTROLLERS_DIR, 'ccpaController.js'),
  'utf8'
);
const legalSource = fs.readFileSync(
  path.join(CONTROLLERS_DIR, 'legalDocumentsController.js'),
  'utf8'
);
const legalRoutes = fs.readFileSync(
  path.join(ROUTES_DIR, 'legalDocuments.js'),
  'utf8'
);

describe('legal_audit_log writer/reader contract', () => {
  test('every column inserted by logCCPAAction exists after migrations 148+164+588', () => {
    const cols = insertColumns(ccpaSource, 'legal_audit_log');
    expect(cols.length).toBeGreaterThan(0);
    for (const col of cols) {
      expect([...available]).toContain(col);
    }
  });

  test('every column inserted by logAuditAction exists after migrations 148+164+588', () => {
    const cols = insertColumns(legalSource, 'legal_audit_log');
    expect(cols.length).toBeGreaterThan(0);
    for (const col of cols) {
      expect([...available]).toContain(col);
    }
  });

  test('every column selected by the CSV export exists after migrations 148+164+588', () => {
    // Tempered match: the SELECT list must not span another FROM/JOIN
    // (an earlier query joins user_legal_acceptances to legal_audit_log).
    const m = legalRoutes.match(
      /SELECT ((?:(?!\b(?:SELECT|FROM|JOIN)\b)[\s\S])*?) FROM legal_audit_log/
    );
    expect(m).not.toBeNull();
    const cols = m[1].split(',').map((c) => c.trim().toLowerCase());
    expect(cols.length).toBeGreaterThan(0);
    for (const col of cols) {
      expect([...available]).toContain(col);
    }
  });

  test('columns referenced by getAuditLog filters/joins exist', () => {
    for (const col of ['actor_id', 'document_type', 'action_type', 'created_at']) {
      expect([...available]).toContain(col);
    }
  });

  test('migration 588 drops the 148 CHECK constraints that rejected real taxonomies', () => {
    expect(sql588).toMatch(/DROP CONSTRAINT IF EXISTS valid_action_type/);
    expect(sql588).toMatch(/DROP CONSTRAINT IF EXISTS valid_resource_type/);
  });

  test('migration 588 widens resource_id off UUID so string resource ids fit', () => {
    expect(sql588).toMatch(/ALTER COLUMN resource_id TYPE VARCHAR\(255\)/);
  });
});
