require('dotenv').config();
const pool = require('./server/db');

async function check() {
  try {
    const { rows } = await pool.query(`
      SELECT table_name, column_name, column_default 
      FROM information_schema.columns 
      WHERE column_name = 'created_at' AND table_schema = 'public'
    `);
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
