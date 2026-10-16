import captures from './screenshots.json';
export async function loadScreenshotSidecar() { return captures; }
export function screenshotRecord(sidecar, guideId, stepId, viewport) {
  return sidecar?.[`${guideId}/${stepId}/${viewport}`] || null;
}
