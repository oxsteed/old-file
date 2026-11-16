'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access careers boundary (WP-031)', () => {
  test('applicant actions remain personal and do not depend on a legacy role', () => {
    const routes = read('routes/careers.js');
    const publicController = read('controllers/careers/publicController.js');
    const marketplace = read('controllers/careers/marketplaceController.js');

    expect(routes).toContain("router.post('/openings/:id(\\\\d+)/apply', authenticate, careersApplyLimiter, pub.apply);");
    expect(routes).toMatch(/me\.get\('\/applications', worker\.listApplications\)/);
    expect(routes).not.toMatch(/router\.post\('\/openings\/:id[^\n]+requireRole/);
    expect(publicController).toMatch(/exports\.apply = handle\(async \(req, res\) => \{\s*const user = requireUser\(req\);/);
    expect(publicController).not.toMatch(/exports\.apply[\s\S]{0,1200}user\.role/);
    expect(marketplace).toMatch(/async function ownApplication\(db, req, id/);
    expect(marketplace).toMatch(/if \(!app\.user_id \|\| app\.user_id !== user\.id\) throw new AppError\('Application not found'/);
  });

  test('employer operations use canonical business and record-level authorization', () => {
    const routes = read('routes/careers.js');
    const common = read('controllers/careers/common.js');
    const access = read('services/careers/access.js');

    expect(routes).toMatch(/emp\.use\(authenticate, requireAdminTotp, rejectImpersonated\)/);
    expect(common).toMatch(/const access = await requireHiringAccess\(user, businessId\)/);
    expect(common).toMatch(/const agency = await resolveAgencyAccess\(user, businessId, agencyPermission/);
    expect(common).toMatch(/const access = await assertCanManageOpening\(requireUser\(req\), opening/);
    expect(common).toMatch(/const access = await assertCanManageOpening\(requireUser\(req\), openingView\(app\)/);
    expect(access).toMatch(/resolveBusinessAccess\(user\.id, businessId\)/);
    expect(access).toMatch(/if \(!locationsInScope\(access, opening\.location_ids\)\) throw new AppError\('Opening not found'/);
  });
});
