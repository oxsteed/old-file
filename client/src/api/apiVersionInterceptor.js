// Axios interceptor for API versioning with v2 → v1 fallback

import { getAPIVersion, API_VERSIONS, buildVersionHeaders } from '../utils/apiVersion';

const MAX_RETRIES = 1;
const FALLBACK_VERSION = API_VERSIONS.V1;

// Track which endpoints have already been downgraded to v1 in this session
const downgradedEndpoints = new Set();

export function setupAPIVersionInterceptor(axiosInstance) {
  // Request interceptor: Add version header
  axiosInstance.interceptors.request.use((config) => {
    const currentVersion = getAPIVersion();
    const endpoint = `${config.method?.toUpperCase()} ${config.url}`;

    // Don't use v2 for endpoints already known to be v1-only
    if (downgradedEndpoints.has(endpoint) && currentVersion === API_VERSIONS.V2) {
      config.headers = {
        ...config.headers,
        ...buildVersionHeaders(FALLBACK_VERSION),
      };
    } else {
      config.headers = {
        ...config.headers,
        ...buildVersionHeaders(currentVersion),
      };
    }

    config.metadata = config.metadata || {};
    config.metadata.startTime = Date.now();
    config.metadata.retryCount = config.metadata.retryCount || 0;

    return config;
  });

  // Response interceptor: Handle v2 → v1 fallback
  axiosInstance.interceptors.response.use(
    (response) => {
      // Success: log if this was a v2 request
      if (response.config.headers?.['API-Version'] === API_VERSIONS.V2) {
        logAPIVersionUsage('v2', response.config.url, response.status);
      }
      return response;
    },
    async (error) => {
      const config = error.config;
      if (!config) return Promise.reject(error);

      const currentVersion = getAPIVersion();
      const endpoint = `${config.method?.toUpperCase()} ${config.url}`;
      const hasRetried = (config.metadata?.retryCount ?? 0) > 0;

      // Only retry if:
      // 1. Server returned 404 (endpoint not found in v2)
      // 2. Current version is v2
      // 3. Haven't already retried
      // 4. Endpoint hasn't been marked as v1-only
      if (
        error.response?.status === 404 &&
        currentVersion === API_VERSIONS.V2 &&
        !hasRetried &&
        !downgradedEndpoints.has(endpoint)
      ) {
        logAPIVersionFallback('v2', FALLBACK_VERSION, config.url);

        // Mark endpoint as v1-only for future requests
        downgradedEndpoints.add(endpoint);

        // Retry with v1 headers
        config.headers = {
          ...config.headers,
          ...buildVersionHeaders(FALLBACK_VERSION),
        };
        config.metadata.retryCount = (config.metadata?.retryCount ?? 0) + 1;

        return axiosInstance.request(config);
      }

      return Promise.reject(error);
    }
  );
}

function logAPIVersionUsage(version, endpoint, status) {
  if (import.meta.env.DEV) {
    console.log(`[API ${version}] ${status} ${endpoint}`);
  }
}

function logAPIVersionFallback(fromVersion, toVersion, endpoint) {
  console.warn(
    `[API Fallback] ${fromVersion} not supported for ${endpoint}, falling back to ${toVersion}`
  );
}

// Reset downgrades (useful for testing)
export function resetAPIVersionDowngrades() {
  downgradedEndpoints.clear();
}

// Get list of downgraded endpoints
export function getDowngradedEndpoints() {
  return Array.from(downgradedEndpoints);
}
