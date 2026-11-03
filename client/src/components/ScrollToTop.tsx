import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import {
  readNavigationState,
  saveNavigationState,
} from '../utils/navigationMemory';

/** Restore history-entry positions after lazy content becomes tall enough. */
export default function ScrollToTop() {
  const location = useLocation(),
    navigationType = useNavigationType();
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);
  useEffect(() => {
    const key = 'scroll:' + location.key;
    const position = navigationType === 'POP' ? readNavigationState(key) : null;
    let frame = 0,
      stopped = false;
    let lastPosition = position || { x: window.scrollX, y: window.scrollY };
    const started = performance.now();
    const restore = () => {
      if (stopped) return;
      const ready =
        document.documentElement.scrollHeight - window.innerHeight >=
        (position?.y || 0);
      if (ready || performance.now() - started > 5000) {
        stopped = true;
        window.scrollTo(position?.x || 0, position?.y || 0);
        return;
      }
      frame = requestAnimationFrame(restore);
    };
    if (position) frame = requestAnimationFrame(restore);
    else if (navigationType === 'PUSH') window.scrollTo(0, 0);
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
    const save = () => {
      lastPosition = { x: window.scrollX, y: window.scrollY };
      saveNavigationState(key, lastPosition);
    };
    const scrolled = () => {
      if (!stopped && position) return;
      save();
    };
    // Scroll events arrive asynchronously (after the next frame), so a click or
    // key press that navigates right after a scroll could leave lastPosition
    // stale. Record the live position at the start of every interaction, while
    // this page is still rendered, unless a restore is still pending.
    const intent = () => {
      if (stopped || !position) save();
    };
    window.addEventListener('scroll', scrolled, { passive: true });
    window.addEventListener('pagehide', save);
    for (const event of ['pointerdown', 'keydown', 'touchstart'])
      window.addEventListener(event, intent, { capture: true, passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      window.addEventListener(event, stop, { once: true, passive: true });
    return () => {
      stop();
      saveNavigationState(key, lastPosition);
      window.removeEventListener('scroll', scrolled);
      window.removeEventListener('pagehide', save);
      for (const event of ['pointerdown', 'keydown', 'touchstart'])
        window.removeEventListener(event, intent, { capture: true });
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        window.removeEventListener(event, stop);
    };
  }, [location.key, navigationType]);
  return null;
}
