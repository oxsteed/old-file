import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * ScrollToTop - Scrolls to the top of the page on PUSH navigations only.
 * POP navigations (Back/Forward) keep the scroll position so Back from a
 * detail page returns to where the user was on the list.
 * Place inside <Router> but outside <Routes>.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'PUSH') {
      window.scrollTo(0, 0);
    }
  }, [pathname, navigationType]);

  return null;
}
