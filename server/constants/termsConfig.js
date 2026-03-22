// ─── Terms & Policy Version Config ────────────────────────────
// Bump these versions whenever terms/privacy/security policies change.
// The re-accept gate will require users to accept the new version.

const TERMS_CONFIG = {
  terms_of_service: {
    version: '2025-06-01',
    label: 'Terms of Service',
    url: '/terms',
  },
  privacy_policy: {
    version: '2025-06-01',
    label: 'Privacy Policy',
    url: '/privacy',
  },
  security_policy: {
    version: '2025-06-01',
    label: 'Security Policy',
    url: '/security',
  },
};

// All consent types that must be accepted before using the platform
const REQUIRED_CONSENTS = ['terms_of_service', 'privacy_policy'];

module.exports = { TERMS_CONFIG, REQUIRED_CONSENTS };
