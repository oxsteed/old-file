import { PNG } from 'image-size/types/png';
import { JPG } from 'image-size/types/jpg';
import { WEBP } from 'image-size/types/webp';

export const MAX_LOGO_BYTES = 15 * 1024 * 1024;
export const MAX_LOGO_PIXELS = 24_000_000;
export const MAX_LOGO_DIMENSION = 8192;
export const LOGO_OUTPUT_DIMENSION = 512;
export const LOGO_DECODE_TIMEOUT_MS = 60_000;
const HEADER_BYTES = 64 * 1024;
const parsers = { 'image/png': PNG, 'image/jpeg': JPG, 'image/webp': WEBP };

function checkDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('logoInvalid');
  }
  if (width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION || width * height > MAX_LOGO_PIXELS) {
    throw new Error('logoDimensions');
  }
}

// Read only bounded headers, before asking the browser to allocate decoded pixels.
// The MIME label alone is not evidence of image content.
export async function validateQrLogo(file) {
  if (file.size > MAX_LOGO_BYTES) throw new Error('logoTooLarge');
  if (!parsers[file.type]) throw new Error('logoUnsupported');
  if (!file.size) throw new Error('logoInvalid');
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  let dimensions;
  try {
    const parser = parsers[file.type];
    if (file.type === 'image/png' && header[0] !== 137) throw new Error();
    if (!parser.validate(header)) throw new Error();
    dimensions = parser.calculate(header);
  } catch {
    throw new Error('logoInvalid');
  }
  checkDimensions(dimensions.width, dimensions.height);
  return dimensions;
}

export async function prepareQrLogo(file, signal, onProgress) {
  const dimensions = await validateQrLogo(file);
  onProgress?.({ stage: 'loading', dimensions });
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        image.onload = null;
        image.onerror = null;
      };
      const abort = () => {
        cleanup();
        image.src = '';
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        cleanup();
        image.src = '';
        reject(new Error('logoInvalid'));
      }, LOGO_DECODE_TIMEOUT_MS);
      image.onload = () => {
        cleanup();
        onProgress?.({ stage: 'optimizing', dimensions: {
          width: image.naturalWidth,
          height: image.naturalHeight,
        } });
        resolve();
      };
      image.onerror = () => { cleanup(); reject(new Error('logoInvalid')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    checkDimensions(image.naturalWidth, image.naturalHeight);
    const ratio = Math.min(1, LOGO_OUTPUT_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('logoInvalid');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Re-encoding retains transparency but drops original metadata and extra payloads.
    const normalized = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    if (!normalized.startsWith('data:image/png;base64,')) throw new Error('logoInvalid');
    return normalized;
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
