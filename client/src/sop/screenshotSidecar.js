/**
 * screenshotSidecar.js - guarded loader for client/src/sop/screenshots.json.
 *
 * The capture worker publishes screenshots.json keyed by
 * "<guideId>/<stepId>/<viewport>". The file does not exist until the worker
 * runs; the guarded load below resolves to null in that case so the build and
 * the renderer keep working with labeled placeholders instead of images.
 */

let cached = null;
let attempted = false;

/**
 * Load the sidecar once and cache the result (object or null).
 * @returns {Promise<object|null>}
 */
export async function loadScreenshotSidecar() {
  if (attempted) return cached;
  attempted = true;
  try {
    // Vite resolves import.meta.glob at build time; an absent file yields {}.
    // Outside Vite (Node scripts, CJS test bundles) the call throws and the
    // catch below keeps the renderer on placeholders. A static dynamic
    // import() is deliberately avoided: rollup fails the build resolving a
    // missing file even in a branch that never executes.
    const matched = import.meta.glob('./screenshots.json', { eager: true });
    const mod = matched['./screenshots.json'];
    cached = mod && mod.default ? mod.default : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Look up one capture record for a guide step screenshot target.
 */
export function screenshotRecord(sidecar, guideId, stepId, viewport) {
  if (!sidecar || typeof sidecar !== 'object') return null;
  const record = sidecar[`${guideId}/${stepId}/${viewport}`];
  return record && typeof record === 'object' ? record : null;
}
