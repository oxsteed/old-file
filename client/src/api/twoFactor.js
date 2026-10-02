// Two-Factor Authentication API Client
// OxSteed v2
import api from './axios';

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
  regenerateBackupCodes: (token) => api.post('/2fa/regenerate-backup', { token }),
  listPasskeys: () => api.get('/2fa/passkeys'),
  passkeyRegistrationOptions: () => api.post('/2fa/passkeys/registration/options'),
  verifyPasskeyRegistration: (response, deviceName) => api.post('/2fa/passkeys/registration/verify', { response, deviceName }),
  revokePasskey: (id) => api.delete(`/2fa/passkeys/${id}`),
};

export const userPasskeyAPI = {
  listPasskeys: () => api.get('/passkeys'),
  registrationOptions: () => api.post('/passkeys/registration/options'),
  verifyRegistration: (response, deviceName) => api.post('/passkeys/registration/verify', { response, deviceName }),
  revokePasskey: (id) => api.delete(`/passkeys/${id}`),
  authenticationOptions: (email) => api.post('/passkeys/authentication/options', { email }),
  verifyAuthentication: (token, response) => api.post('/passkeys/authentication/verify', { token, response }),
};

export default twoFactorAPI;
