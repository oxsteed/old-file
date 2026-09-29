import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAbortableFetch — fetch state with AbortController + sequence guard.
 *
 * Fixes the systemic stale-response pattern across admin pages: rapid
 * filter/tab/record switching could resolve out of order and clobber the
 * view with another record's data, and load failures were swallowed into
 * misleading "empty" states.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetchFn  receives an AbortSignal; must pass it to the request
 * @param {Array} deps  re-fetch when these change
 * @returns {{ data, loading, error, reload }}
 */
export function useAbortableFetch(fetchFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seqRef = useRef(0);
  const controllerRef = useRef(null);

  const run = useCallback(
    async (signal) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchFn(signal);
        if (seqRef.current === seq) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        // Aborted or superseded: never surface.
        if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
        if (seqRef.current === seq) {
          setError(err);
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  const reload = useCallback(() => {
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    run(controller.signal);
  }, [run]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    run(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Invalidate pending sequence on unmount so late resolutions are dropped.
  useEffect(() => () => { seqRef.current += 1; }, []);

  return { data, loading, error, reload };
}

export default useAbortableFetch;
