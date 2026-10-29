'use strict';

const rawUrl=process.env.BUSINESS_OPERATIONS_TEST_DATABASE_URL || process.env.STATEMENT_TEST_DATABASE_URL;
function permitted(value){try{const u=new URL(value);return ['postgres:','postgresql:'].includes(u.protocol)
  && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)
  && ['/oxsteed_operations_test','/credit_statement_test'].includes(u.pathname)
  && [...u.searchParams.keys()].every(key=>key==='sslmode');}catch{return false;}}
if(rawUrl&&!permitted(rawUrl))throw Error('Readiness DB tests require an explicit disposable localhost database');
const run=rawUrl?describe:describe.skip;
const {Pool}=jest.requireActual('pg');
const {randomUUID}=require('crypto');
const {adminControlPlaneSchemaStatus}=require('../services/readinessService');
test('readiness DB checks reject production targets and connection overrides',()=>{
  expect(permitted('postgresql://localhost/credit_statement_test?sslmode=disable')).toBe(true);
  expect(permitted('postgresql://prod.example/credit_statement_test')).toBe(false);
  expect(permitted('postgresql://localhost/production')).toBe(false);
  expect(permitted('postgresql://localhost/credit_statement_test?host=prod.example')).toBe(false);
});
run('targeted readiness schema checks on PostgreSQL',()=>{
  const schema=`ready_${randomUUID().replaceAll('-','')}`;
  let pool,previous;
  // Redirect only the fixed public qualifier into this test's own schema.
  // The production function has no schema override or connection fallback.
  const db={query:(sql,params)=>pool.query(sql.replace("'public.'",`'${schema}.'`),params)};
  beforeAll(async()=>{
    pool=new Pool({connectionString:rawUrl,max:1});previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
    await pool.query(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.admin_audit_log(target_key text);
      CREATE TABLE ${schema}.platform_settings(min_numeric_value numeric,max_numeric_value numeric,validation_pattern text,version int)`);
  });
  afterAll(async()=>{process.env.NODE_ENV=previous;if(pool){await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}});
  test('complete schema passes, dropped columns and missing relations fail closed',async()=>{
    await expect(adminControlPlaneSchemaStatus(db)).resolves.toEqual({ok:true});
    await pool.query(`ALTER TABLE ${schema}.platform_settings DROP COLUMN version`);
    await expect(adminControlPlaneSchemaStatus(db)).resolves.toMatchObject({ok:false,missing:['platform_settings.version']});
    await pool.query(`DROP TABLE ${schema}.admin_audit_log`);
    const missing=await adminControlPlaneSchemaStatus(db);
    expect(missing.ok).toBe(false);expect(missing.missing).toEqual(['admin_audit_log.target_key','platform_settings.version']);
  });
});
