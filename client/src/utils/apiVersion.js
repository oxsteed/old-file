// API versioning detection and utilities

const API_VERSION_HEADER = 'API-Version';
const API_VERSION_QUERY_PARAM = 'v';

export const API_VERSIONS = {
  V1: 'v1',
  V2: 'v2',
};

// Detect API version from environment or default to v1
export function getAPIVersion() {
  return import.meta.env.VITE_API_VERSION || API_VERSIONS.V1;
}

// Build headers with API version
export function buildVersionHeaders(version = null) {
  const targetVersion = version || getAPIVersion();
  return {
    [API_VERSION_HEADER]: targetVersion,
  };
}

// Build query string with API version
export function appendVersionQuery(url, version = null) {
  const targetVersion = version || getAPIVersion();
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${API_VERSION_QUERY_PARAM}=${targetVersion}`;
}

// Check if API supports a feature based on version
export function supportsFeature(featureName, currentVersion = null) {
  const version = currentVersion || getAPIVersion();
  const featuresByVersion = {
    [API_VERSIONS.V1]: {
      'webhooks': false,
      'batch_operations': false,
      'long_polling': true,
      'realtime_sockets': true,
    },
    [API_VERSIONS.V2]: {
      'webhooks': true,
      'batch_operations': true,
      'long_polling': false,
      'realtime_sockets': true,
    },
  };

  return featuresByVersion[version]?.[featureName] ?? false;
}

// Log API version on startup
export function logAPIVersion() {
  const version = getAPIVersion();
  console.log(`API Version: ${version}`);
}
