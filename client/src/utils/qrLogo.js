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
const WORKER_UNAVAILABLE = 'logoWorkerUnavailable';
const QR_LOGO_WORKER_SOURCE = `
self.onmessage = async ({ data }) => {
  if (typeof self.createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    self.postMessage({ ok: false, unavailable: true });
    return;
  }
  let bitmap;
  try {
    bitmap = await self.createImageBitmap(data.file, {
      resizeWidth: data.width,
      resizeHeight: data.height,
      resizeQuality: 'high',
    });
    const canvas = new OffscreenCanvas(data.width, data.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('logoInvalid');
    context.drawImage(bitmap, 0, 0, data.width, data.height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    self.postMessage({ ok: true, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || 'logoInvalid' });
  } finally {
    bitmap?.close?.();
  }
};`;

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

function abortError() {
  return new DOMException('Cancelled', 'AbortError');
}

function outputDimensions(width, height) {
  const ratio = Math.min(1, LOGO_OUTPUT_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('logoInvalid'));
    reader.readAsDataURL(blob);
  });
}

function runLogoWorker(file, dimensions, signal) {
  return new Promise((resolve, reject) => {
    let worker;
    let workerUrl;
    try {
      workerUrl = URL.createObjectURL(new Blob([QR_LOGO_WORKER_SOURCE], { type: 'application/javascript' }));
      worker = new Worker(workerUrl);
    } catch {
      reject(new Error(WORKER_UNAVAILABLE));
      return;
    }

    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => finish(reject, abortError());
    const timer = setTimeout(() => finish(reject, new Error('logoInvalid')), LOGO_DECODE_TIMEOUT_MS);

    worker.onmessage = ({ data }) => {
      if (data?.unavailable) {
        finish(reject, new Error(WORKER_UNAVAILABLE));
      } else if (data?.ok && data.buffer) {
        finish(resolve, new Blob([data.buffer], { type: 'image/png' }));
      } else {
        finish(reject, new Error(data?.error || 'logoInvalid'));
      }
    };
    worker.onerror = () => finish(reject, new Error(WORKER_UNAVAILABLE));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.postMessage({ file, width: dimensions.width, height: dimensions.height });
  });
}

async function normalizeWithBitmap(file, dimensions, signal) {
  if (typeof createImageBitmap !== 'function') throw new Error(WORKER_UNAVAILABLE);
  const bitmap = await Promise.race([
    createImageBitmap(file, {
      resizeWidth: dimensions.width,
      resizeHeight: dimensions.height,
      resizeQuality: 'high',
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('logoInvalid')), LOGO_DECODE_TIMEOUT_MS)),
    ...(signal ? [new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))] : []),
  ]);
  if (signal?.aborted) throw abortError();
  try {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('logoInvalid');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('logoInvalid')),
      'image/png'
    ));
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } finally {
    bitmap.close?.();
  }
}

async function normalizeWithImage(file, dimensions, signal) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        image.onload = null;
        image.onerror = null;
      };
      const abort = () => {
        cleanup();
        image.src = '';
        reject(abortError());
      };
      timer = setTimeout(() => {
        cleanup();
        image.src = '';
        reject(new Error('logoInvalid'));
      }, LOGO_DECODE_TIMEOUT_MS);
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('logoInvalid')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    if (signal?.aborted) throw abortError();
    checkDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('logoInvalid');
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('logoInvalid')),
      'image/png'
    ));
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}

export async function prepareQrLogo(file, signal, onProgress) {
  const dimensions = await validateQrLogo(file);
  onProgress?.({ stage: 'loading', dimensions });
  if (signal?.aborted) throw abortError();
  const resized = outputDimensions(dimensions.width, dimensions.height);
  onProgress?.({ stage: 'optimizing', dimensions: resized });

  let normalizedBlob;
  try {
    normalizedBlob = await runLogoWorker(file, resized, signal);
  } catch (error) {
    if (error.message !== WORKER_UNAVAILABLE) throw error;
    try {
      normalizedBlob = await normalizeWithBitmap(file, resized, signal);
    } catch (bitmapError) {
      if (bitmapError.message !== WORKER_UNAVAILABLE) throw bitmapError;
      normalizedBlob = await normalizeWithImage(file, resized, signal);
    }
  }

  if (signal?.aborted) throw abortError();
  const normalized = await blobToDataUrl(normalizedBlob);
  if (!normalized.startsWith('data:image/png;base64,')) throw new Error('logoInvalid');
  return normalized;
}
