// Shared "is this a mobile-width viewport" hook: one breakpoint token
// (MOBILE_BREAKPOINT_PX = 1024px, the Tailwind lg: breakpoint) consumed by
// the support FAB colour, the sticky Book bar and the chat fullscreen logic,
// so tablets and narrow desktop windows stop getting a mixed mobile/desktop
// UI. State is initialised from the live width so the first paint already
// matches; the resize listener keeps it in sync afterwards.
import { useEffect, useState } from 'react';
import { MOBILE_BREAKPOINT_PX, isMobileWidth } from '../utils/mobileBreakpoint.js';

export { MOBILE_BREAKPOINT_PX, isMobileWidth } from '../utils/mobileBreakpoint.js';

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT_PX) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : isMobileWidth(window.innerWidth, breakpoint),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => setIsMobile(isMobileWidth(window.innerWidth, breakpoint));
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [breakpoint]);

  return isMobile;
}

export default useIsMobile;
