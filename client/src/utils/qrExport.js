const TITLE_FONT = '700 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const TITLE_PADDING = 28;
const TITLE_GAP = 18;

function cleanTitle(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').slice(0, 255);
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

export async function composeQrDownload(blob, title, format) {
  const safeTitle = cleanTitle(title);
  if (!safeTitle) return blob;
  return format === 'svg' ? composeSvg(blob, safeTitle) : composePng(blob, safeTitle);
}

export function qrDownloadFileName(title, format) {
  return `${fileNamePart(title)}.${format}`;
}
