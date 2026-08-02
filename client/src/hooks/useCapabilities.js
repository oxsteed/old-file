import { useEffect, useState } from 'react';
import api from '../api/axios';

let cachedCapabilities = null;
let capabilityRequest = null;

function loadCapabilities() {
  if (cachedCapabilities) return Promise.resolve(cachedCapabilities);
  if (!capabilityRequest) {
    capabilityRequest = api.get('/config/capabilities')
      .then(({ data }) => {
        cachedCapabilities = data?.capabilities || {};
        return cachedCapabilities;
      })
      .finally(() => { capabilityRequest = null; });
  }
  return capabilityRequest;
}

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState(cachedCapabilities);
  const [loading, setLoading] = useState(!cachedCapabilities);

  useEffect(() => {
    let active = true;
    loadCapabilities()
      .then((next) => { if (active) setCapabilities(next); })
      .catch(() => { if (active) setCapabilities({}); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return {
    capabilities: capabilities || {},
    loading,
    isAvailable: (name) => capabilities?.[name]?.available === true,
  };
}
