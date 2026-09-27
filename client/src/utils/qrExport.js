const TITLE_FONT = '700 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const PROMO_TITLE_FONT = '800 42px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const PROMO_BODY_FONT = '400 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const PROMO_CTA_FONT = '700 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const TITLE_PADDING = 28;
const TITLE_GAP = 18;
const PROMO_PADDING = 56;

function cleanTitle(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').slice(0, 255);
}

function cleanCopy(value, limit = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function fileNamePart(title) {
  return cleanTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'qr-code';
}

function escapeXml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;',
  }[character]));
}

function fitTitle(context, title, maxWidth) {
  let value = title;
  while (value.length > 1 && context.measureText(value).width > maxWidth) {
    value = value.slice(0, -1);
  }
  if (value !== title) value = `${value.slice(0, -1).trimEnd()}…`;
  return value;
}

function readImage(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('QR image could not be read'));
    };
    image.src = objectUrl;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('QR image could not be read'));
    reader.readAsDataURL(blob);
  });
}

async function composePng(blob, title) {
  const image = await readImage(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  const titleHeight = title ? 26 + TITLE_GAP + TITLE_PADDING * 2 : 0;
  canvas.width = width;
  canvas.height = height + titleHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('QR image could not be composed');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  if (title) {
    context.font = TITLE_FONT;
    context.fillStyle = '#16323a';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fitTitle(context, title, width - TITLE_PADDING * 2), width / 2, height + TITLE_PADDING + TITLE_GAP / 2 + 13);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('QR image could not be exported')), 'image/png');
  });
}

async function composeSvg(blob, title) {
  if (!title) return blob;
  const source = await blobToDataUrl(blob);
  const sizeMatch = (await blob.text()).match(/(?:width|height)="([0-9]+)"/g) || [];
  const size = Number(sizeMatch[0]?.match(/"([0-9]+)"/)?.[1]) || 300;
  const titleHeight = 26 + TITLE_GAP + TITLE_PADDING * 2;
  const safeTitle = escapeXml(title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + titleHeight}" viewBox="0 0 ${size} ${size + titleHeight}"><rect width="100%" height="100%" fill="#ffffff"/><image href="${source}" width="${size}" height="${size}" x="0" y="0"/><text x="${size / 2}" y="${size + TITLE_PADDING + TITLE_GAP / 2 + 13}" text-anchor="middle" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="26" font-weight="700" fill="#16323a">${safeTitle}</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function wrapLines(context, value, maxWidth) {
  const words = value.split(' ');
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

async function composePromoPng(blob, title, options) {
  const image = await readImage(blob);
  const qrSize = Math.min(720, Math.max(280, image.naturalWidth || image.width));
  const width = Math.max(640, qrSize + PROMO_PADDING * 2);
  const description = cleanCopy(options.description);
  const cta = cleanCopy(options.cta, 80);
  const textWidth = width - PROMO_PADDING * 2;
  const bodyLines = description ? wrapLines({ measureText: (value) => ({ width: value.length * 11 }) }, description, textWidth) : [];
  const qrY = PROMO_PADDING + 82 + (bodyLines.length ? bodyLines.length * 30 + 20 : 0);
  const height = Math.max(qrY + qrSize + (cta ? 90 : 40) + PROMO_PADDING, Math.round(width * 1.25));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('QR image could not be composed');
  context.fillStyle = options.backgroundColor || '#ffffff';
  context.fillRect(0, 0, width, height);
  context.textAlign = 'center';
  context.fillStyle = options.accentColor || '#16323a';
  context.font = PROMO_TITLE_FONT;
  context.fillText(fitTitle(context, title, textWidth), width / 2, PROMO_PADDING + 42);
  let cursor = PROMO_PADDING + 82;
  if (bodyLines.length) {
    context.font = PROMO_BODY_FONT;
    context.fillStyle = '#52636a';
    bodyLines.forEach((line) => {
      context.fillText(line, width / 2, cursor);
      cursor += 30;
    });
    cursor += 20;
  }
  context.drawImage(image, (width - qrSize) / 2, qrY, qrSize, qrSize);
  cursor = qrY + qrSize + 42;
  if (cta) {
    context.font = PROMO_CTA_FONT;
    context.fillStyle = options.accentColor || '#ff6b35';
    context.fillText(cta, width / 2, cursor);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('QR image could not be exported')), 'image/png');
  });
}

async function composePromoSvg(blob, title, options) {
  const source = await blobToDataUrl(blob);
  const sizeMatch = (await blob.text()).match(/(?:width|height)="([0-9]+)"/g) || [];
  const qrSize = Number(sizeMatch[0]?.match(/"([0-9]+)"/)?.[1]) || 300;
  const width = Math.max(640, qrSize + PROMO_PADDING * 2);
  const description = cleanCopy(options.description);
  const cta = cleanCopy(options.cta, 80);
  const lines = description ? description.match(/.{1,56}(?:\s|$)/g)?.map((line) => line.trim()).slice(0, 4) || [] : [];
  const qrY = PROMO_PADDING + 82 + (lines.length ? lines.length * 30 + 20 : 0);
  const titleHeight = Math.max(qrY + qrSize + (cta ? 90 : 40) + PROMO_PADDING, Math.round(width * 1.25));
  const safe = (value) => escapeXml(String(value || ''));
  const text = [
    `<text x="${width / 2}" y="${PROMO_PADDING + 42}" text-anchor="middle" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="42" font-weight="800" fill="${safe(options.accentColor || '#16323a')}">${safe(title)}</text>`,
    ...lines.map((line, index) => `<text x="${width / 2}" y="${PROMO_PADDING + 82 + index * 30}" text-anchor="middle" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="22" fill="#52636a">${safe(line)}</text>`),
    cta ? `<text x="${width / 2}" y="${titleHeight - PROMO_PADDING - 25}" text-anchor="middle" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="22" font-weight="700" fill="${safe(options.accentColor || '#ff6b35')}">${safe(cta)}</text>` : '',
  ].join('');
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${titleHeight}" viewBox="0 0 ${width} ${titleHeight}"><rect width="100%" height="100%" fill="${safe(options.backgroundColor || '#ffffff')}"/>${text}<image href="${source}" width="${qrSize}" height="${qrSize}" x="${(width - qrSize) / 2}" y="${qrY}"/></svg>`], { type: 'image/svg+xml' });
}

export async function composeQrDownload(blob, title, format, options = {}) {
  const safeTitle = cleanTitle(title);
  const mode = options.mode || (safeTitle ? 'branded' : 'simple');
  if (mode === 'simple' || !safeTitle) return blob;
  if (mode === 'promotional') {
    return format === 'svg' ? composePromoSvg(blob, safeTitle, options) : composePromoPng(blob, safeTitle, options);
  }
  return format === 'svg' ? composeSvg(blob, safeTitle) : composePng(blob, safeTitle);
}

export function qrDownloadFileName(title, format) {
  return `${fileNamePart(title)}.${format}`;
}
