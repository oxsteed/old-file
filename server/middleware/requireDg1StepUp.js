'use strict';

// DG1 step-up: staff (admin) sessions performing customer-facing Direct
// mutations must have TOTP enabled. This mirrors the DG1 read gate in
// directController.staffCanAccessDirectRequest. Customers acting on their
// own requests are unaffected.

const { adminTotpEnabled } = require('./adminAuth');

function isStaff(user) {
  return user && (user.role === 'admin' || user.role === 'super_admin');
}

async function requireDg1StepUp(req, res, next) {
  try {
    // Non-staff (customers) pass through; owner checks happen in controllers.
    if (!isStaff(req.user)) return next();
    const totpOn = await adminTotpEnabled(req.user.id);
    if (!totpOn) {
      return res.status(403).json({
        error: 'Step-up authentication required. Enable TOTP to perform this action.',
        code: 'dg1_stepup_required',
      });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Step-up check failed' });
  }
}

module.exports = { requireDg1StepUp };
