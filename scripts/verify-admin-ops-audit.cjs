'use strict';
// Run only against the disposable migration-rehearsal database. Every fixture rolls back.
const assert = require('node:assert/strict');
const { Pool } = require('../server/node_modules/pg');
const connectionString = process.env.ADMIN_OPS_TEST_DATABASE_URL;
if (!connectionString) throw new Error('ADMIN_OPS_TEST_DATABASE_URL is required');
const target = new URL(connectionString);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/oxsteed_rehearsal') throw new Error('Only the loopback rehearsal database is accepted');
const pool = new Pool({ connectionString });
const admin = '00000000-0000-4000-8000-000000000181';
const grantee = '00000000-0000-4000-8000-000000000182';
async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active)
      VALUES($1,'audit-admin@example.invalid','SYNTHETIC','Audit','Admin','super_admin',true),
            ($2,'audit-grantee@example.invalid','SYNTHETIC','Audit','Grantee','admin',true)`, [admin,grantee]);
    const { rows: [book] } = await c.query(`INSERT INTO ops_runbooks(code,title,category,body,updated_by)
      VALUES('audit-fixture','Fixture','incident','Original',$1) RETURNING id`, [admin]);
    await c.query(`UPDATE ops_runbooks SET body='Revised',version=version+1,updated_by=$2 WHERE id=$1`, [book.id,admin]);
    let versions = await c.query('SELECT snapshot FROM ops_runbook_versions WHERE runbook_id=$1 ORDER BY version', [book.id]);
    assert.deepEqual(versions.rows.map(r=>r.snapshot.body), ['Original','Revised']);
    const audit = await c.query("SELECT count(*)::int AS n FROM admin_audit_log WHERE target_type='ops_runbook' AND target_key=$1", [String(book.id)]);
    assert.equal(audit.rows[0].n,2);
    await c.query('SAVEPOINT history_mutation');
    await assert.rejects(c.query('DELETE FROM ops_runbook_versions WHERE runbook_id=$1',[book.id]), /append-only/);
    await c.query('ROLLBACK TO SAVEPOINT history_mutation');
    // If an audit insertion fails, the runbook mutation must fail with it.
    await c.query(`CREATE FUNCTION pg_temp.reject_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.target_type='ops_runbook' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$`);
    await c.query('CREATE TRIGGER synthetic_audit_outage BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_fixture_audit()');
    await c.query('SAVEPOINT audit_failure');
    await assert.rejects(c.query(`UPDATE ops_runbooks SET body='Unaudited',version=version+1 WHERE id=$1`,[book.id]), /synthetic audit outage/);
    await c.query('ROLLBACK TO SAVEPOINT audit_failure');
    assert.equal((await c.query('SELECT body FROM ops_runbooks WHERE id=$1',[book.id])).rows[0].body,'Revised');
    await c.query(`INSERT INTO delegation_grants(grantor_admin_id,grantee_admin_id,scopes,expires_at)
      VALUES($1,$2,ARRAY['manage_operations'],NOW()+INTERVAL '1 day')`,[admin,grantee]);
    await c.query('UPDATE users SET is_active=false WHERE id=$1',[admin]);
    await c.query('UPDATE users SET is_active=true WHERE id=$1',[admin]);
    assert.equal((await c.query('SELECT status FROM delegation_grants WHERE grantor_admin_id=$1',[admin])).rows[0].status,'revoked');
    const { rows: [incident] } = await c.query(`INSERT INTO incident_log(type,severity,message,notification_claimed_at)
      VALUES('fixture','critical','Synthetic',NOW()) RETURNING notification_count,last_notified_at`);
    assert.equal(Number(incident.notification_count),0); assert.equal(incident.last_notified_at,null);
    for (const action of ['food_refund','restaurant_topup_approve','fee_config_update']) await c.query(`INSERT INTO oxsteed_credit_stepup_challenges
      (actor_user_id,action_type,amount_cents,currency_code,method,code_hash,expires_at)
      VALUES($1,$2,1,'USD','totp',NULL,NOW()+INTERVAL '1 minute')`,[admin,action]);
    const { rows: [sos] } = await c.query('INSERT INTO safety_sos_events(user_id) VALUES($1) RETURNING id',[grantee]);
    await c.query('UPDATE safety_sos_events SET acknowledged_at=NOW(),acknowledged_by=$2 WHERE id=$1',[sos.id,admin]);
    assert.ok((await c.query('SELECT acknowledged_at FROM safety_sos_events WHERE id=$1',[sos.id])).rows[0].acknowledged_at);
    console.log('PASS: runbook snapshots, append-only history, audit rollback, delegation revocation, truthful incident counters, TOTP purposes, SOS acknowledgment');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
}
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
