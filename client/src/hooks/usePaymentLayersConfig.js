import { useEffect, useState } from 'react';
import api from '../api/axios';

let cached = null;
let inflight = null;

/** Launch flags for the payment layers (booleans only; all default off). */
export default function usePaymentLayersConfig() {
  const [flags, setFlags] = useState(cached);
  useEffect(() => {
    if (cached) return undefined;
    let alive = true;
    inflight = inflight || api.get('/payment-layers/config').then(({ data }) => data?.flags || {}).catch(() => ({}));
    inflight.then((value) => { cached = value; if (alive) setFlags(value); });
    return () => { alive = false; };
  }, []);
  return flags || {};
}
