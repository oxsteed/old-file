'use strict';

// Network receipt printer support (ESC/POS over a raw TCP socket, usually
// port 9100), plus cash-drawer kick.
//
// Design rules:
//  - Every builder below is a pure function: bytes in, bytes out. No I/O,
//    no database, no order or payment logic lives in this file.
//  - Printing is fire-and-forget. sendToPrinter() resolves { ok, error } and
//    NEVER throws into the caller and NEVER mutates caller state, so a dead
//    printer, a bad host, or a network blip cannot block or alter an order,
//    payment, or any other money path.
//  - Text is encoded in the printer's default code page (latin-1); characters
//    outside it are replaced with '?' so one bad glyph cannot corrupt the
//    rest of the receipt.

const net = require('net');

const LINE_WIDTH = 42;

const ESC = 0x1b;
const GS = 0x1d;

// ── pure byte builders ───────────────────────────────────────────────────────

/** Initialize the printer (ESC @). */
function init() {
  return Buffer.from([ESC, 0x40]);
}

/** Line alignment: 'left' | 'center' | 'right' (ESC a n). */
function align(mode = 'left') {
  const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0;
  return Buffer.from([ESC, 0x61, n]);
}

/** Emphasized (bold) mode on/off (ESC E n). */
function bold(on = true) {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

/** Character size: doubleWidth/doubleHeight (GS ! n, bits 4/5). */
function charSize({ doubleWidth = false, doubleHeight = false } = {}) {
  const n = (doubleWidth ? 0x10 : 0) | (doubleHeight ? 0x01 : 0);
  return Buffer.from([GS, 0x21, n]);
}

/** Feed n lines (ESC d n). */
function feed(n = 3) {
  const lines = Math.max(0, Math.min(255, Math.floor(n) || 0));
  return Buffer.from([ESC, 0x64, lines]);
}

/** Cut the paper. Full cut is default; partial on request (GS V m). */
function cut({ partial = false } = {}) {
  return Buffer.from([GS, 0x56, partial ? 1 : 0]);
}

/**
 * Cash-drawer kick pulse (ESC p m t1 t2).
 * pin: 0 or 1 (which drawer connector pin), t1/t2: on/off pulse times in
 * 2ms units (ESC/POS standard).
 */
function drawerKick({ pin = 0, onTime = 25, offTime = 250 } = {}) {
  const m = pin === 1 ? 1 : 0;
  const clamp = (v) => Math.max(1, Math.min(255, Math.floor(v) || 1));
  return Buffer.from([ESC, 0x70, m, clamp(onTime), clamp(offTime)]);
}

/** Encode text for the printer code page (latin-1, unknown glyphs -> '?'). */
function encodeText(text) {
  return Buffer.from(String(text == null ? '' : text).replace(/[^\x20-\x7e\xa0-\xff\r\n\t]/g, '?'), 'latin1');
}

/** Pad a line to the printer width. */
function padLine(text, width = LINE_WIDTH) {
  const s = String(text == null ? '' : text);
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

/** A two-column line: left label, right value, padded to LINE_WIDTH. */
function twoColumn(left, right, width = LINE_WIDTH) {
  const l = String(left == null ? '' : left);
  const r = String(right == null ? '' : right);
  if (l.length + r.length + 1 >= width) return (l + ' ' + r).slice(0, width);
  return l + ' '.repeat(width - l.length - r.length) + r;
}

/**
 * One text line with optional alignment and emphasis.
 * Returns the raw bytes including the trailing newline.
 */
function textLine(text, { align: alignment = 'left', bold: isBold = false, doubleSize = false } = {}) {
  const parts = [];
  if (alignment !== 'left') parts.push(align(alignment));
  if (isBold) parts.push(bold(true));
  if (doubleSize) parts.push(charSize({ doubleWidth: true, doubleHeight: true }));
  parts.push(encodeText(String(text == null ? '' : text)));
  parts.push(Buffer.from([0x0a]));
  if (doubleSize) parts.push(charSize({}));
  if (isBold) parts.push(bold(false));
  if (alignment !== 'left') parts.push(align('left'));
  return Buffer.concat(parts);
}

/**
 * Build a generic sales receipt. All content comes from the caller; this
 * function formats but never computes money.
 *
 * receipt: {
 *   headerLines: string[],       // store name / address lines (bold double)
 *   metaLines: string[],         // order no, date, cashier ...
 *   items: [{ qty, name, amount }], // amount already formatted, e.g. "$4.50"
 *   totals: [{ label, amount }], // subtotal, tax, total ...
 *   footerLines: string[],
 *   kickDrawer: boolean,
 * }
 */
function buildReceipt(receipt = {}) {
  const parts = [init()];
  const rule = '-'.repeat(LINE_WIDTH);

  for (const line of receipt.headerLines || []) {
    parts.push(textLine(line, { align: 'center', bold: true, doubleSize: true }));
  }
  if ((receipt.headerLines || []).length) parts.push(textLine(''));
  for (const line of receipt.metaLines || []) parts.push(textLine(line));
  if ((receipt.metaLines || []).length) parts.push(textLine(rule));

  for (const item of receipt.items || []) {
    const qty = item.qty != null ? `${item.qty} x ` : '';
    parts.push(textLine(twoColumn(`${qty}${item.name || ''}`, item.amount || '')));
    for (const sub of item.subLines || []) parts.push(textLine(`  ${sub}`));
  }
  if ((receipt.items || []).length) parts.push(textLine(rule));

  for (const total of receipt.totals || []) {
    const isGrand = Boolean(total.grand);
    parts.push(textLine(
      twoColumn(total.label || '', total.amount || ''),
      isGrand ? { bold: true, doubleSize: true } : { bold: Boolean(total.bold) }
    ));
  }
  if ((receipt.footerLines || []).length) parts.push(textLine(''));
  for (const line of receipt.footerLines || []) {
    parts.push(textLine(line, { align: 'center' }));
  }

  parts.push(feed(4));
  if (receipt.kickDrawer) parts.push(drawerKick({}));
  parts.push(cut());
  return Buffer.concat(parts);
}

/** A small self-describing test page for verifying the printer connection. */
function buildTestPage({ title = 'PRINTER TEST', lines = [] } = {}) {
  return buildReceipt({
    headerLines: [title],
    metaLines: [`Printed: ${new Date().toLocaleString()}`],
    items: [],
    totals: [],
    footerLines: [
      'If you can read this, the printer',
      'is connected and working.',
      ...lines,
    ],
    kickDrawer: false,
  });
}

// ── transport (fire-and-forget; never throws) ───────────────────────────────

/**
 * Send a byte buffer to a network printer over TCP.
 * Resolves { ok: true } on success or { ok: false, error: 'human message' }
 * on any failure (DNS, refused, timeout, socket error). Never rejects, never
 * throws, never touches the caller's state.
 */
function sendToPrinter(host, port, buffer, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const fail = (error) => resolve({ ok: false, error: String(error || 'Print failed') });
    let socket;
    let portNum;
    let cleanHost;
    try {
      if (!host || typeof host !== 'string' || !host.trim()) return fail('No printer host configured.');
      portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return fail('Invalid printer port.');
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) return fail('Nothing to print.');
      cleanHost = host.trim();
      socket = new net.Socket();
    } catch (err) {
      return fail(err && err.message ? err.message : err);
    }
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) { /* best effort */ }
      resolve(result);
    };
    try {
      socket.setTimeout(Math.max(1000, Math.min(30000, timeoutMs || 5000)));
      socket.once('timeout', () => done({ ok: false, error: 'Printer connection timed out.' }));
      socket.once('error', (err) => done({ ok: false, error: err && err.message ? err.message : 'Printer connection failed.' }));
      socket.connect(portNum, cleanHost, () => {
        socket.write(buffer, (err) => {
          if (err) return done({ ok: false, error: err.message || 'Failed to write to printer.' });
          // Half-close so the printer flushes; resolve once drained.
          socket.end(() => done({ ok: true }));
        });
      });
    } catch (err) {
      done({ ok: false, error: err && err.message ? err.message : 'Print failed.' });
    }
  });
}

module.exports = {
  LINE_WIDTH,
  init,
  align,
  bold,
  charSize,
  feed,
  cut,
  drawerKick,
  encodeText,
  padLine,
  twoColumn,
  textLine,
  buildReceipt,
  buildTestPage,
  sendToPrinter,
};
