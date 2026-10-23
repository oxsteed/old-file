import { useEffect, useRef } from 'react';
import { subscribeAppResume } from '../utils/pwaRuntime';
export default function useAppResume(callback, enabled = true) {
  const current = useRef(callback);
  current.current = callback;
  useEffect(
    () => (enabled ? subscribeAppResume(() => current.current?.()) : undefined),
    [enabled],
  );
}
