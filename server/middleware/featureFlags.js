const AppError = require('../utils/appError');

function envFlagEnabled(key, defaultEnabled = true) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return defaultEnabled;

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultEnabled;
}

function requireFeatureEnabled(feature, envKey) {
  return function featureFlagMiddleware(req, res, next) {
    const enabled = envFlagEnabled(envKey, true);
    if (enabled) return next();

    return next(
      new AppError(
        `${feature} is temporarily unavailable. Please try again later.`,
        503,
        'feature_disabled'
      )
    );
  };
}

module.exports = {
  envFlagEnabled,
  requireFeatureEnabled,
};

