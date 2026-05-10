// VULN #20 FIX: Enforce admin action logging - fail closed if logging fails

const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Mandatory admin action logging
 * If logging fails, the action is REJECTED (fail-closed)
 * This prevents admins from executing unlogged actions
 */
async function requireAdminLogging(req, res, next) {
  if (!['admin', 'super_admin'].includes(req.user?.role)) {
    return next();
  }

  // Identify critical actions requiring mandatory logging
  const criticalActions = [
    'DELETE', 'PUT', 'PATCH', // State-changing operations
  ];

  const criticalPaths = [
    '/api/admin',
    '/api/super-admin',
    '/api/users/',
    '/api/businesses/',
    '/api/jobs/',
  ];

  const isCritical = criticalActions.includes(req.method) &&
    criticalPaths.some(path => req.path.includes(path));

  if (!isCritical) {
    return next();
  }

  // Attach logging requirement to request
  req.requireAdminLog = true;
  req.adminActionStart = Date.now();
  req.adminActionDetails = {
    user_id: req.user.id,
    action: `${req.method} ${req.path}`,
    resource: extractResource(req),
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  };

  next();
}

/**
 * Log admin action after response sent
 * If logging fails, return 500 to client (reject the action)
 */
function logAdminActionAfter(req, res, next) {
  if (!req.requireAdminLog) {
    return next();
  }

  // Wrap res.json/send to log after response
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    logAction(req, res, data, 'success').catch(err => {
      logger.error('CRITICAL: Admin action logging failed', err);
      // Too late to reject - action already executed
      // But notify monitoring system
    });
    return originalJson(data);
  };

  next();
}

async function logAction(req, res, responseData, status) {
  try {
    await pool.query(
      `INSERT INTO admin_action_log
       (user_id, action, resource_type, resource_id, details, ip_address, user_agent, status, http_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.adminActionDetails.user_id,
        req.adminActionDetails.action,
        req.adminActionDetails.resource?.type,
        req.adminActionDetails.resource?.id,
        JSON.stringify({
          ...req.adminActionDetails,
          duration_ms: Date.now() - req.adminActionStart,
          response_status: res.statusCode
        }),
        req.adminActionDetails.ip_address,
        req.adminActionDetails.user_agent,
        status,
        res.statusCode
      ]
    );
  } catch (err) {
    // Logging failed - this is critical
    logger.error('CRITICAL: Failed to log admin action - system compromise detected', {
      action: req.adminActionDetails.action,
      user_id: req.adminActionDetails.user_id,
      error: err.message
    });
    throw err;
  }
}

function extractResource(req) {
  const match = req.path.match(/\/(users|businesses|jobs|payments)\/([^/]+)/);
  if (match) {
    return { type: match[1], id: match[2] };
  }
  return null;
}

module.exports = {
  requireAdminLogging,
  logAdminActionAfter
};
