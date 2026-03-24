// Two-Factor Authentication API Client
// OxSteed v2
import api from './auth';

export const twoFactorAPI = {
  // Get current 2FA status
  getStatus: () => api.get('/2fa/status'),

  // Initiate TOTP setup - returns QR code and secret
  setup: () => api.post('/2fa/setup'),

  // Verify TOTP setup with code from authenticator app
  verifySetup: (token) => api.post('/2fa/verify-setup', { token }),

  // Validate a TOTP token (used during login)
  validate: (data) => api.post('/2fa/validate', data),

  // Disable 2FA
  disable: (token) => api.post('/2fa/disable', { token }),

  // Regenerate backup codes
  regenerateBackupCodes: (token) => api.post('/2fa/backup-codes', { token }),
};

export default twoFactorAPI;
