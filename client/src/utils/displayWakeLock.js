// Pure Wake Lock helpers for the display pages. Kept free of React so they
// are unit-testable; the useWakeLock hook wires them to the DOM.

export function isWakeLockSupported(
  nav = typeof navigator !== 'undefined' ? navigator : undefined,
) {
  return Boolean(
    nav && 'wakeLock' in nav && typeof nav.wakeLock?.request === 'function',
  );
}
