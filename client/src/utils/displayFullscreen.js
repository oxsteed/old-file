// Pure Fullscreen API helpers for the display pages. Kept free of React so
// they are unit-testable; the useFullscreen hook wires them to the DOM.

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

export function resolveFullscreenExit(doc) {
  if (!doc) return null;
  if (typeof doc.exitFullscreen === 'function') {
    return () => doc.exitFullscreen();
  }
  if (typeof doc.webkitExitFullscreen === 'function') {
    return () => doc.webkitExitFullscreen();
  }
  return null;
}
