'use strict';

/**
 * Media test schema drift guard.
 *
 * These tests hand-build TEMP tables with text IDs (production uses UUIDs),
 * so they can't copy the production schema directly. This helper closes the
 * drift gap: after the test creates its TEMP tables, call
 * `backfillMissingColumns(db, tableName)` to ADD any production columns the
 * TEMP table lacks. Existing columns are untouched.
 *
 * This runs against the already-migrated `public` schema (CI migrates before
 * tests), so it always reflects the current production shape. When a migration
 * adds a column, the test tables automatically gain it. No more whack-a-mole.
 */

async function getProductionColumns(db, tableName) {
  const { rows } = await db.query(
    `SELECT column_name, data_type, udt_name, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return rows;
}

async function getTempColumns(db, tableName, tableSchema = 'pg_temp') {
  const { rows } = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [tableSchema, tableName]
  );
  return new Set(rows.map(r => r.column_name));
}

function toAddColumnDef(col) {
  const name = col.column_name;
  let type;
  if (col.data_type === 'uuid' || col.udt_name === 'uuid') type = 'text';
  else if (['character varying', 'character', 'text', 'citext'].includes(col.data_type)) type = 'text';
  else type = col.data_type;
  // Skip defaults that reference sequences or UUID generators; keep it simple.
  // The test fixtures provide explicit values for columns they care about.
  return `ADD COLUMN IF NOT EXISTS ${name} ${type}`;
}

async function backfillMissingColumns(db, tableName, tableSchema = 'pg_temp') {
  const prodCols = await getProductionColumns(db, tableName);
  if (!prodCols.length) return; // table doesn't exist in production; nothing to mirror
  const tempCols = await getTempColumns(db, tableName, tableSchema);
  const missing = prodCols.filter(c => !tempCols.has(c.column_name));
  const qualified = tableSchema === 'pg_temp' ? tableName : `${tableSchema}.${tableName}`;
  for (const col of missing) {
    await db.query(`ALTER TABLE ${qualified} ${toAddColumnDef(col)}`);
  }
}

async function backfillAllTables(db, tableNames, tableSchema = 'pg_temp') {
  for (const name of tableNames) await backfillMissingColumns(db, name, tableSchema);
}

module.exports = { backfillMissingColumns, backfillAllTables, getProductionColumns };
