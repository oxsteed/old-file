'use strict';

function displayManifest(manifest, startUrl) {
  if (
    typeof startUrl !== 'string' ||
    !/^\/(restaurants|food)\/(queue|kiosk|kitchen)\/\d+$/.test(startUrl)
  )
    return null;
  const { share_target, ...base } = manifest;
  return {
    ...base,
    id: startUrl,
    scope: '/',
    start_url: startUrl,
    orientation: /\/(kitchen|queue)\//.test(startUrl) ? 'landscape' : 'any',
    shortcuts: [],
    screenshots: [],
  };
}
module.exports = { displayManifest };
