import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const locales = ['en', 'es', 'fr', 'ht', 'ar'];
const required = {
  adminSupportMetrics: [
    'title', 'subtitle', 'refresh', 'conversations', 'total', 'resolved',
    'resolutionRate', 'avgResponseTime', 'seconds', 'teamAverage',
    'activeAgents', 'onlineNow', 'trendTitle', 'issuesByCategory',
    'departmentBreakdown', 'topAgents', 'noTrendData', 'noCategoryData',
    'noDepartmentData', 'noAgentData', 'resolvedCount', 'noRating', 'rating',
    'noResponseData', 'avgSeconds', 'failedTitle', 'failedMessage',
  ],
  adminSupportSla: [
    'title', 'subtitle', 'refresh', 'overallCompliance', 'targetPercent',
    'avgFirstResponse', 'minutes', 'targetHour', 'avgResolutionTime', 'hours',
    'targetHours', 'violations', 'thisWeek', 'complianceTrend',
    'departmentComparison', 'department', 'compliance', 'avgResponse',
    'avgResolution', 'recentViolations', 'noTrendData', 'noDepartmentData',
    'notAvailable', 'firstResponseMissed', 'resolutionMissed', 'violationTypes',
    'failedTitle', 'failedMessage',
  ],
};

for (const locale of locales) {
  const translations = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${locale}.json`), 'utf8'));
  for (const [namespace, keys] of Object.entries(required)) {
    assert.ok(translations[namespace], `${locale} is missing ${namespace}`);
    for (const key of keys) {
      assert.ok(Object.prototype.hasOwnProperty.call(translations[namespace], key), `${locale} is missing ${namespace}.${key}`);
    }
  }
  assert.equal(typeof translations.adminSupportSla.violationTypes.first_response, 'string');
  assert.equal(typeof translations.adminSupportSla.violationTypes.resolution, 'string');
}

for (const file of ['SupportMetricsDashboard.jsx', 'SupportSLADashboard.jsx']) {
  const source = fs.readFileSync(path.join(root, 'admin', 'pages', file), 'utf8');
  assert.match(source, /useTranslation/);
  assert.match(source, /aria-label=\{t\(/);
}

console.log('Admin support analytics localization checks passed');
