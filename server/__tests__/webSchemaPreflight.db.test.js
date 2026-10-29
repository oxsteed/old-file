'use strict';

const rawUrl = process.env.BUSINESS_OPERATIONS_TEST_DATABASE_URL || process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = value => { try { const u = new URL(value); return ['postgres:','postgresql:'].includes(u.protocol)
  && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)
  && ['/oxsteed_operations_test','/credit_statement_test'].includes(u.pathname)
  && [...u.searchParams.keys()].every(key => key === 'sslmode'); } catch { return false; } };
if (rawUrl && !permitted(rawUrl)) throw Error('Schema preflight tests require an explicit disposable localhost database');
const run = rawUrl ? describe : describe.skip;
const { Pool } = jest.requireActual('pg');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { verifyWebSchema } = require('../services/webSchemaPreflight');

test('schema preflight DB checks reject production targets and connection overrides', () => {
  expect(permitted('postgresql://127.0.0.1/credit_statement_test?sslmode=disable')).toBe(true);
  expect(permitted('postgresql://prod.example/credit_statement_test')).toBe(false);
  expect(permitted('postgresql://127.0.0.1/production')).toBe(false);
  expect(permitted('postgresql://127.0.0.1/credit_statement_test?host=prod.example')).toBe(false);
});

run('read-only web startup on PostgreSQL', () => {
  const schema = `web_schema_${crypto.randomUUID().replaceAll('-','')}`;
  const missingSchema = `${schema}_missing`;
  let pool, migrationsDir;
  const files = ['20261029000000_first.sql','20261029000001_second.sql'];
  const source = file => `CREATE TABLE "${schema}".must_never_execute_${files.indexOf(file)}(id int);`;
  const hash = file => crypto.createHash('sha256').update(source(file)).digest('hex');
  beforeAll(async () => {
    pool = new Pool({ connectionString: rawUrl, max: 2 });
    migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(),'oxsteed-web-schema-db-'));
    await pool.query(`CREATE SCHEMA "${schema}"; CREATE SCHEMA "${missingSchema}";
      CREATE TABLE "${schema}"._migrations(filename text PRIMARY KEY,status text,checksum text);
      CREATE TABLE "${schema}".sentinel(id int PRIMARY KEY); INSERT INTO "${schema}".sentinel VALUES(1);`);
  });
  beforeEach(async () => {
    for (const existing of fs.readdirSync(migrationsDir)) fs.unlinkSync(path.join(migrationsDir,existing));
    await pool.query(`TRUNCATE "${schema}"._migrations`);
    for (const file of files) {
      fs.writeFileSync(path.join(migrationsDir,file),source(file));
      await pool.query(`INSERT INTO "${schema}"._migrations VALUES($1,'applied',$2)`,[file,hash(file)]);
    }
  });
  afterAll(async () => {
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${missingSchema}" CASCADE; DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
    if (migrationsDir) fs.rmSync(migrationsDir,{recursive:true,force:true});
  });
  async function check(targetSchema = schema) {
    const statements = [];
    const monitored = { connect: async () => {
      const client = await pool.connect();
      return { query: (...args) => { statements.push(args[0]); return client.query(...args); }, release: () => client.release() };
    } };
    try { return await verifyWebSchema({ pool: monitored, migrationsDir, schema: targetSchema }); }
    finally {
      expect(statements.every(statement => /^(BEGIN READ ONLY|SET LOCAL|SELECT|COMMIT|ROLLBACK)/.test(statement))).toBe(true);
      expect((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".sentinel`)).rows[0].n).toBe(1);
      for (const index of [0,1]) expect((await pool.query('SELECT to_regclass($1) AS relation',[`${schema}.must_never_execute_${index}`])).rows[0].relation).toBeNull();
    }
  }
  test('matching applied metadata starts without executing migration files', async () => {
    await expect(check()).resolves.toEqual({ok:true,appliedMigrations:2,checksumVerified:2,legacyUnverified:0});
  });
  test('a pending migration refuses the new web release and leaves the database unchanged', async () => {
    await pool.query(`DELETE FROM "${schema}"._migrations WHERE filename=$1`,[files[1]]);
    await expect(check()).rejects.toMatchObject({code:'WEB_SCHEMA_NOT_READY',counts:{pending:1}});
    expect((await pool.query(`SELECT count(*)::int AS n FROM "${schema}"._migrations`)).rows[0].n).toBe(1);
  });
  test('legacy applied rows are reported without writing a forward checksum baseline', async () => {
    await pool.query(`UPDATE "${schema}"._migrations SET checksum=NULL WHERE filename=$1`,[files[0]]);
    await expect(check()).resolves.toMatchObject({ok:true,checksumVerified:1,legacyUnverified:1});
    expect((await pool.query(`SELECT checksum FROM "${schema}"._migrations WHERE filename=$1`,[files[0]])).rows[0].checksum).toBeNull();
  });
  test('a changed immutable source file refuses startup without applying its new SQL', async () => {
    fs.appendFileSync(path.join(migrationsDir,files[0]),'\n-- Synthetic changed source');
    await expect(check()).rejects.toMatchObject({code:'WEB_SCHEMA_NOT_READY',counts:{changed:1}});
  });
  test('failed migration markers are never retried or repaired by a web process', async () => {
    await pool.query(`UPDATE "${schema}"._migrations SET status='failed' WHERE filename=$1`,[files[0]]);
    await expect(check()).rejects.toMatchObject({code:'WEB_SCHEMA_NOT_READY',counts:{incomplete:1}});
    expect((await pool.query(`SELECT status FROM "${schema}"._migrations WHERE filename=$1`,[files[0]])).rows[0].status).toBe('failed');
  });
  test('a database from a newer catalog refuses this replacement', async () => {
    await pool.query(`INSERT INTO "${schema}"._migrations VALUES('future.sql','applied',$1)`,['0'.repeat(64)]);
    await expect(check()).rejects.toMatchObject({code:'WEB_SCHEMA_NOT_READY',counts:{unexpected:1}});
  });
  test('missing metadata is not bootstrapped by web startup', async () => {
    await expect(check(missingSchema)).rejects.toMatchObject({code:'42P01'});
    expect((await pool.query('SELECT to_regclass($1) AS relation',[`${missingSchema}._migrations`])).rows[0].relation).toBeNull();
  });
  test('the real web startup CLI never imports the writer or applies pending SQL', async () => {
    const { spawnSync } = require('child_process');
    const database = `web_schema_cli_${crypto.randomUUID().replaceAll('-','')}`;
    const directory = path.join(__dirname,'../migrations');
    const catalog = fs.readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
    const checksums = catalog.map(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,file),'utf8')).digest('hex'));
    const url = new URL(rawUrl); url.pathname = `/${database}`;
    let isolated;
    await pool.query(`CREATE DATABASE "${database}"`);
    try {
      isolated = new Pool({connectionString:url.href,max:1});
      await isolated.query('CREATE TABLE public._migrations(filename text PRIMARY KEY,status text,checksum text)');
      await isolated.query("INSERT INTO public._migrations SELECT file,'applied',checksum FROM unnest($1::text[],$2::text[]) AS markers(file,checksum)",[catalog,checksums]);
      const writer = path.resolve(__dirname,'../migrate.js');
      const instrumentation = path.join(migrationsDir,'reject-writer.cjs');
      fs.writeFileSync(instrumentation,`const Module=require('module');const load=Module._load;Module._load=function(request,parent,...args){if(Module._resolveFilename(request,parent)===${JSON.stringify(writer)})throw Error('Writer imported by web CLI');return load.call(this,request,parent,...args);};`);
      const execute = () => spawnSync(process.execPath,['--require',instrumentation,path.resolve(__dirname,'../scripts/prepare-runtime-schema.cjs')],{
        cwd:migrationsDir,env:{PATH:process.env.PATH,NODE_ENV:'test',OXSTEED_RUNTIME_ROLE:'web',DATABASE_URL:url.href},encoding:'utf8',timeout:15000,
      });
      const compatible = execute();
      expect(compatible.error).toBeUndefined();
      expect(compatible.status).toBe(0);
      expect(compatible.stdout).toContain(`"appliedMigrations":${catalog.length}`);
      await isolated.query('DELETE FROM public._migrations WHERE filename=$1',[catalog[0]]);
      const pending = execute();
      expect(pending.error).toBeUndefined();
      expect(pending.status).toBe(1);
      expect(pending.stderr).toContain('WEB_SCHEMA_NOT_READY');
      expect((await isolated.query('SELECT count(*)::int AS n FROM public._migrations')).rows[0].n).toBe(catalog.length-1);
      expect((await isolated.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name<>'_migrations'")).rows[0].n).toBe(0);
    } finally {
      await isolated?.end();
      await pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    }
  },60000);
});
