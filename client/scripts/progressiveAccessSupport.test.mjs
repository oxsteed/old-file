import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

const applications = await read('src/pages/Settings/ApplicationsPage.jsx');
const handoff = await read('src/components/helperProfile/chat/supportEscalationHandoff.js');
const escalation = await read('src/pages/SupportEscalationPage.jsx');

assert.match(applications, /from=access-request&accessRequestId=/);
assert.match(applications, /OPEN\.includes\(r\.status\)/);
assert.match(handoff, /accessRequestId/);
assert.match(handoff, /\^\\d\{1,18\}\$/);
assert.match(escalation, /accessRequestId: handoff\?\.accessRequestId/);
assert.match(escalation, /support-routing\/connect/);
assert.match(escalation, /support-routing\/conversations/);

console.log('progressive access Support client contracts passed');
