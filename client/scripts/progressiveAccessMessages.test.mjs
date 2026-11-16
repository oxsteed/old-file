import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

const workspace = await read('src/components/messaging/MessagingWorkspace.jsx');
const hook = await read('src/hooks/useConversationChat.js');
const thread = await read('src/components/messaging/ConversationThread.jsx');

assert.match(workspace, /conversationSide\(userId, conv\)/);
assert.match(workspace, /conversationMatchesSide\(userId, conv, sideFilter\)/);
assert.match(workspace, /socket\.on\('message:new'/);
assert.match(workspace, /socket\.off\('message:new'/);
assert.match(workspace, /newInbound/);

assert.match(hook, /joinConversation\(conversationId\)/);
assert.match(hook, /leaveConversation\(conversationId\)/);
assert.match(hook, /api\.get\(`\/messages\/conversations\/\$\{conversationId\}`/);
assert.match(hook, /markRead: true/);
assert.match(hook, /markRead: false/);
assert.match(hook, /mapBusinessMessages/);

assert.match(thread, /att\.url/);
assert.match(thread, /target="_blank"/);

console.log('progressive access Messages client contracts passed');
