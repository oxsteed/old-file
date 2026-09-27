import JsBarcode from 'jsbarcode';

export const BARCODE_TYPES = {
  qr: { labelKey: 'codeTypeQr', descriptionKey: 'codeTypeQrHelp' },
  code128: { labelKey: 'codeTypeCode128', descriptionKey: 'codeTypeCode128Help' },
  ean13: { labelKey: 'codeTypeEan13', descriptionKey: 'codeTypeEan13Help' },
};

function ean13CheckDigit(digits) {
  const sum = digits
    .slice(0, 12)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

export function normalizeBarcodeValue(type, rawValue) {
  const value = String(rawValue || '').trim();
  if (type === 'code128') {
    const normalized = value.replace(/\s+/g, ' ');
    if (!normalized) return { value: '', error: 'barcodeValueRequired' };
    if (![...normalized].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) <= 126)) {
      return { value: normalized, error: 'barcodeCode128Invalid' };
    }
    return { value: normalized, error: '' };
  }
  if (type === 'ean13') {
    if (!/^\d{12,13}$/.test(value)) return { value, error: 'barcodeEan13Invalid' };
    if (value.length === 12) return { value: `${value}${ean13CheckDigit(value)}`, error: '' };
    return { value, error: value[12] === ean13CheckDigit(value) ? '' : 'barcodeEan13Invalid' };
  }
  return { value, error: '' };
}

function barcodeOptions(type, value, options = {}) {
  const isEan13 = type === 'ean13';
  return {
    format: isEan13 ? 'ean13' : 'CODE128',
    lineColor: options.lineColor || '#c2410c',
    background: options.background || '#ffffff',
    width: isEan13 ? 2 : 2,
    height: Math.max(100, Math.round(Number(options.height) || 180)),
    margin: 18,
    displayValue: true,
    font: 'Arial',
    fontSize: 18,
    textMargin: 8,
    flat: false,
  };
}

function renderSvg(type, value, options) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, barcodeOptions(type, value, options));
  return new Blob([svg.outerHTML], { type: 'image/svg+xml' });
}

function renderPng(type, value, options) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, barcodeOptions(type, value, options));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Barcode image could not be exported'))), 'image/png');
  });
}

export async function renderBarcode(type, rawValue, format = 'png', options = {}) {
  const normalized = normalizeBarcodeValue(type, rawValue);
  if (normalized.error) {
    const error = new Error(normalized.error);
    error.code = normalized.error;
    throw error;
  }
  return format === 'svg'
    ? renderSvg(type, normalized.value, options)
    : renderPng(type, normalized.value, options);
}
