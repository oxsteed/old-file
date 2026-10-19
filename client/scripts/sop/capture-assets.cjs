const { createHash } = require('node:crypto');

function screenshotName(fileName, directory, manifest, currentKeys, bytes) {
  const src = `/sop/screenshots/${directory}/${fileName}`;
  const sharedOutsideCapture = Object.entries(manifest).some(([key, record]) =>
    record.src === src && !currentKeys.has(key));
  return sharedOutsideCapture
    ? fileName.replace(/\.jpg$/, `-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.jpg`)
    : fileName;
}
module.exports = { screenshotName };
