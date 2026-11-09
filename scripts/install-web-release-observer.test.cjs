'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {plist}=require('./install-web-release-observer.cjs');
test('launch agent uses the automatic controller and fixed absolute paths',()=>{const text=plist('/Users/test/A&B','/opt/node','/opt/bin:/usr/bin');assert.match(text,/<integer>60<\/integer>/);assert.match(text,/<string>\/opt\/node<\/string>/);assert.match(text,/A&amp;B\/automatic-web-release.cjs/);assert.match(text,/--state-file/);assert.doesNotMatch(text,/\/bin\/sh|bash|GH_TOKEN|COOLIFY_TOKEN/);});
