import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/hooks/useNotifications.js'), 'utf8');

test('Media notification hook reconciles the authenticated realtime stream', () => {
  assert.match(source, /import \{ useSocket \} from '\.\/useSocket';/);
  assert.match(source, /socket\.on\('notification:new', handleNewNotification\)/);
  assert.match(source, /socket\.off\('notification:new', handleNewNotification\)/);
  assert.match(source, /knownNotificationIds\.current\.has\(id\)/);
  assert.match(source, /setUnreadCount\(\(previous\) => previous \+ 1\)/);
  assert.match(source, /socket\.on\('connect', handleReconnect\)/);
  assert.match(source, /fetchNotifications\(\);/);
});
