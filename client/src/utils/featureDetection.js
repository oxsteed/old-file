// Feature detection and availability checks

class FeatureDetector {
  constructor() {
    this.detectedFeatures = new Map();
    this.detectionPromises = new Map();
  }

  /**
   * Detect if a feature is available by making a test call
   * @param {string} featureName - Name of the feature (e.g., 'webhooks')
   * @param {Function} testFn - Async function that returns true if feature is available
   * @returns {Promise<boolean>}
   */
  async detect(featureName, testFn) {
    // Return cached result if already detected
    if (this.detectedFeatures.has(featureName)) {
      return this.detectedFeatures.get(featureName);
    }

    // Return existing promise if detection is in progress
    if (this.detectionPromises.has(featureName)) {
      return this.detectionPromises.get(featureName);
    }

    // Start detection
    const promise = testFn()
      .then(available => {
        this.detectedFeatures.set(featureName, available);
        this.detectionPromises.delete(featureName);
        return available;
      })
      .catch(() => {
        this.detectedFeatures.set(featureName, false);
        this.detectionPromises.delete(featureName);
        return false;
      });

    this.detectionPromises.set(featureName, promise);
    return promise;
  }

  /**
   * Check if feature is available (from cache or fallback value)
   * @param {string} featureName
   * @param {boolean} fallback - Default if not yet detected
   * @returns {boolean}
   */
  isAvailable(featureName, fallback = false) {
    if (this.detectedFeatures.has(featureName)) {
      return this.detectedFeatures.get(featureName);
    }
    return fallback;
  }

  /**
   * Invalidate cached detection
   * @param {string} featureName - null to clear all
   */
  invalidate(featureName = null) {
    if (featureName) {
      this.detectedFeatures.delete(featureName);
    } else {
      this.detectedFeatures.clear();
    }
  }
}

export const featureDetector = new FeatureDetector();

// Common feature detection tests
export const FeatureTests = {
  // Test if server supports webhooks (v2 feature)
  webhooks: async (api) => {
    try {
      const res = await api.get('/api/features/webhooks');
      return res.status === 200 && res.data.available === true;
    } catch {
      return false;
    }
  },

  // Test if server supports batch operations (v2 feature)
  batchOperations: async (api) => {
    try {
      const res = await api.get('/api/features/batch-operations');
      return res.status === 200 && res.data.available === true;
    } catch {
      return false;
    }
  },

  // Test if server supports realtime sockets
  realtimeSockets: async (api) => {
    try {
      const res = await api.get('/api/features/realtime-sockets');
      return res.status === 200 && res.data.available === true;
    } catch {
      return true; // Sockets available in both v1 and v2
    }
  },
};
