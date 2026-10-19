'use strict';
const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const url=disposableDatabaseOptIn('ANALYTICS_EVIDENCE_TEST_DATABASE_URL');
if(url) process.env.DATABASE_URL=url;
jest.unmock('pg');jest.unmock('../db');
const db=require('../db');
const { executeBuilderQuery,getBuilderMeta }=require('../analytics/queryBuilder');
const user={ id:'11111111-1111-4111-8111-111111111111',role:'super_admin' };

(isDisposableDatabase(url)?describe:describe.skip)('metric evidence against fully migrated schema',()=>{
  beforeAll(()=>assertMigratedSchema(db));
  afterAll(()=>db.end());
  test.each(getBuilderMeta().metrics.map(m=>m.name))('%s returns its canonical aggregate and paginated evidence',async metric=>{
    const result=await executeBuilderQuery(db,user,{metric,period:'30d'},{ evidence:true,eventType:'evidence' });
    expect(result.evidence).toBe(true);
    expect(result.rows.length).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.summary)).toBe(true);
    expect(result.summaryColumns.length).toBeGreaterThan(0);
    for(const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual([...result.columns].sort());
      expect(row).not.toHaveProperty('email');
      expect(row).not.toHaveProperty('phone');
    }
  });
});
