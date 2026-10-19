// Fullscreen toggle for the public restaurant display pages (queue board,
// kiosk, kitchen). Handles the standard API plus Safari's webkit prefix and
// degrades to a no-op where fullscreen is unsupported (e.g. iPad Safari,
// where the Add to Home Screen install path takes over instead).
import { useCallback, useEffect, useState } from 'react';

export function resolveFullscreenRequest(element) {
  if (!element) return null;
  if (typeof element.requestFullscreen === 'function') {
    return () => element.requestFullscreen();
  }
  if (typeof element.webkitRequestFullscreen === 'function') {
    return () => element.webkitRequestFullscreen();
  }
  return null;
}

export function isFullscreenActive(doc) {
  if (!doc) return false;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export function useFullscreen(targetRef) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const element = targetRef?.current;
    const doc = element?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return undefined;
    setSupported(Boolean(resolveFullscreenRequest(element || doc.documentElement)));
    const sync = () => setIsFullscreen(isFullscreenActive(doc));
    sync();
    doc.addEventListener('fullscreenchange', sync);
    doc.addEventListener('webkitfullscreenchange', sync);
    return () => {
      doc.removeEventListener('fullscreenchange', sync);
      doc.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [targetRef]);

  const toggle = useCallback(async () => {
    const element = targetRef?.current;
    if (!element) return;
    const doc = element.ownerDocument || document;
    try {
      if (isFullscreenActive(doc)) {
        if (typeof doc.exitFullscreen === 'function') {
          await doc.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === 'function') {
          doc.webkitExitFullscreen();
        }
      } else {
        const request = resolveFullscreenRequest(element);
        if (request) {
          const result = request();
          if (result && typeof result.catch === 'function') {
            await result.catch(() => {});
          }
        }
      }
    } catch {
      // Fullscreen denied (e.g. not from a user gesture): stay windowed.
    }
  }, [targetRef]);

  return { isFullscreen, supported, toggle };
}
