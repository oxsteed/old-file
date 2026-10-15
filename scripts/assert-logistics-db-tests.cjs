'use strict';
const fs=require('node:fs');const assert=require('node:assert/strict');
const results=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const suites=results.testResults.filter(s=>/logisticsCredit(Pay|CheckoutFixes)\.db\.test\.js$/.test(s.name));
assert.equal(suites.length,2,'Both real PostgreSQL Logistics suites must run');
assert.ok(suites.reduce((n,s)=>n+s.assertionResults.length,0)>=20,'Integration cases were not collected');
for(const suite of suites){assert.equal(suite.status,'passed',suite.name);for(const c of suite.assertionResults)assert.equal(c.status,'passed',c.fullName);}
console.log('Logistics database integration executed without skipped cases');
