const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const adminPhoneVerificationService = require('../services/adminPhoneVerificationService');

async function sendCode(req, res) {
  const { userId } = req.params;
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return sendValidationError(res, { reason: 'A reason is required.' });

  try {
    const result = await adminPhoneVerificationService.issueChallenge({
      userId,
      adminId: req.user.id,
      reason,
      req,
    });
    return res.status(202).json({
      success: true,
      message: 'Verification code sent to the user phone.',
      data: result,
    });
  } catch (error) {
    logger.warn('Admin phone verification code request failed', {
      adminId: req.user?.id,
      userId,
      code: error.code || 'unknown',
      error: error.message,
    });
    return sendError(res, error.statusCode || 500, error.message || 'Failed to send verification code.');
  }
}

module.exports = { sendCode };
