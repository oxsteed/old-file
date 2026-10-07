/**
 * Schema-aware table/column probes for PostgreSQL.
 * Uses the active session search_path so checks match unqualified SQL
 * (e.g. DATABASE_URL with options=-csearch_path=app).
 */
const db = require('../db');

let cachedFirstSchema = null;

async function getFirstSearchPathSchema() {
  if (cachedFirstSchema !== null) return cachedFirstSchema;
  try {
    const { rows } = await db.query('SHOW search_path');
    const raw = rows[0]?.search_path || '';
    const parts = raw
      .split(',')
      .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
      .filter(Boolean);
    const first = parts.find((p) => p && p !== '$user' && p !== 'pg_catalog');
    cachedFirstSchema = first || 'public';
  } catch {
    cachedFirstSchema = 'public';
  }
  return cachedFirstSchema;
}

async function tableExists(name) {
  const schema = await getFirstSearchPathSchema();
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2`,
      [schema, name]
    );
    if (rows.length) return true;
    if (schema !== 'public') {
      const { rows: r2 } = await db.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1`,
        [name]
      );
      return r2.length > 0;
    }
    return false;
  } catch {
    return false;
  }
}

async function columnExists(table, column) {
  const schema = await getFirstSearchPathSchema();
  try {
    const probe = async (sch) => {
      const { rows } = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
        [sch, table, column]
      );
      return rows.length > 0;
    };
    if (await probe(schema)) return true;
    if (schema !== 'public' && (await probe('public'))) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Safe equality against user id columns that may be UUID on one DB and BIGINT on another.
 * Comparing a uuid param directly to bigint (or vice versa) raises 22P02.
 */
function userIdEq(column) {
  return `${column}::text = $1`;
}

/**
 * Batch probe: check multiple tables and columns in a single information_schema
 * query instead of N separate probes. Returns { tables: Set, columns: Set } of
 * existing "table" and "table.column" names.
 */
async function probeSchema(tables = [], columns = []) {
  const schema = await getFirstSearchPathSchema();
  const foundTables = new Set();
  const foundColumns = new Set();
  if (!tables.length && !columns.length) return { tables: foundTables, columns: foundColumns };
  try {
    const tableNames = [...new Set(tables)];
    const colPairs = [...new Set(columns.map(([t, c]) => `${t}.${c}`))];
    const { rows } = await db.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema IN ($1, 'public')
          AND (table_name = ANY($2) OR (table_name || '.' || column_name) = ANY($3))`,
      [schema, tableNames, colPairs]
    );
    for (const row of rows) {
      foundTables.add(row.table_name);
      foundColumns.add(`${row.table_name}.${row.column_name}`);
    }
  } catch {
    // Return empty sets on failure; callers treat missing as unavailable.
  }
  return { tables: foundTables, columns: foundColumns };
}

const { activeJobStatusSqlIn } = require('../constants/activeJobStatuses');

/** SQL `IN (...)` fragment for account-deletion job guards; labels must exist on enum `job_status`. */
const ACTIVE_JOB_STATUS_SQL_IN = activeJobStatusSqlIn();

module.exports = {
  getFirstSearchPathSchema,
  tableExists,
  columnExists,
  probeSchema,
  userIdEq,
  ACTIVE_JOB_STATUS_SQL_IN,
};
