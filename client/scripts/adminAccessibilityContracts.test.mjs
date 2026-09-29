import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('high-risk admin and support controls keep accessible labels after refactors', () => {
  const users = read('src/admin/pages/UsersList.jsx');
  const templates = read('src/admin/pages/TemplateManagement.jsx');
  const supportAgents = read('src/admin/pages/SupportAgentManagement.jsx');
  const supportPerformance = read('src/admin/pages/SupportPerformanceAnalytics.jsx');
  const support = read('src/pages/SupportEscalationPage.jsx');

  assert.match(users, /function CreateUserModal[\s\S]*?const \{ t \} = useTranslation\(\);/);
  assert.match(users, /function ResetPasswordModal[\s\S]*?const \{ t \} = useTranslation\(\);/);
  assert.match(users, /common\.moreActions/);
  assert.match(users, /common\.firstPage/);
  assert.match(users, /common\.lastPage/);
  assert.match(users, /aria-current=\{p === filters\.page \? 'page' : undefined\}/);
  assert.match(users, /adminUsers\.list\.createTitle/);
  assert.match(users, /adminUsers\.list\.messagePlaceholder/);
  assert.doesNotMatch(users, />Create User Account</);
  assert.doesNotMatch(users, />Export CSV</);

  assert.match(supportAgents, /adminSupportAgents\.searchPlaceholder/);
  assert.match(supportAgents, /adminSupportAgents\.viewAgent/);
  assert.match(supportAgents, /adminSupportAgents\.toggleStatus/);
  assert.match(supportAgents, /adminSupportAgents\.deleteAgent/);
  assert.match(supportAgents, /adminSupportAgents\.close/);
  assert.doesNotMatch(supportAgents, />Support agents</);
  assert.match(supportPerformance, /adminSupportPerformance\.title/);
  assert.match(supportPerformance, /adminSupportPerformance\.searchPlaceholder/);
  assert.match(supportPerformance, /adminSupportPerformance\.refresh/);
  assert.match(supportPerformance, /adminSupportPerformance\.close/);
  assert.doesNotMatch(supportPerformance, />Performance Analytics</);

  assert.match(templates, /common\.refresh/);
  assert.match(templates, /adminTemplates\.closePreview/);
  assert.match(support, /support\.escalation\.attachImage[\s\S]*?aria-label/);
  assert.match(support, /common\.send[\s\S]*?type="submit"/);
});
