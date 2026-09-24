import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { prefetchPath } from '../utils/routePrefetch';

function pathFromTarget(to) {
  if (typeof to === 'string') return to;
  return to?.pathname || '';
}

export default function PrefetchLink({
  to,
  children,
  prefetch = true,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onTouchStart,
  ...props
}) {
  const timerRef = useRef(null);

  const schedulePrefetch = () => {
    if (!prefetch || timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      prefetchPath(pathFromTarget(to));
    }, 90);
  };

  const cancelPrefetch = () => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  return (
    <Link
      {...props}
      to={to}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        schedulePrefetch();
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        cancelPrefetch();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        schedulePrefetch();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        schedulePrefetch();
      }}
    >
      {children}
    </Link>
  );
}
