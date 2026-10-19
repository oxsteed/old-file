'use strict';

/**
 * Unit tests: server/services/escposPrinter.js
 *
 * Asserts the exact ESC/POS byte sequences for init, alignment, bold,
 * character size, feed, cut, and the cash-drawer kick pulse, plus the
 * fire-and-forget transport contract of sendToPrinter (resolves
 * { ok, error }, never rejects, never throws).
 *
 * No database, no network printer, no order/payment logic involved.
 */

const net = require('net');
const escpos = require('../services/escposPrinter');

const bytes = (buf) => Array.from(buf);

describe('escposPrinter command bytes', () => {
  test('init emits ESC @', () => {
    expect(bytes(escpos.init())).toEqual([0x1b, 0x40]);
  });

  test('align emits ESC a n', () => {
    expect(bytes(escpos.align('left'))).toEqual([0x1b, 0x61, 0x00]);
    expect(bytes(escpos.align('center'))).toEqual([0x1b, 0x61, 0x01]);
    expect(bytes(escpos.align('right'))).toEqual([0x1b, 0x61, 0x02]);
    expect(bytes(escpos.align())).toEqual([0x1b, 0x61, 0x00]);
  });

  test('bold emits ESC E n', () => {
    expect(bytes(escpos.bold(true))).toEqual([0x1b, 0x45, 0x01]);
    expect(bytes(escpos.bold(false))).toEqual([0x1b, 0x45, 0x00]);
  });

  test('charSize emits GS ! n with width/height bits', () => {
    expect(bytes(escpos.charSize({}))).toEqual([0x1d, 0x21, 0x00]);
    expect(bytes(escpos.charSize({ doubleWidth: true }))).toEqual([0x1d, 0x21, 0x10]);
    expect(bytes(escpos.charSize({ doubleHeight: true }))).toEqual([0x1d, 0x21, 0x01]);
    expect(bytes(escpos.charSize({ doubleWidth: true, doubleHeight: true }))).toEqual([0x1d, 0x21, 0x11]);
  });

  test('feed emits ESC d n', () => {
    expect(bytes(escpos.feed(3))).toEqual([0x1b, 0x64, 0x03]);
    expect(bytes(escpos.feed(0))).toEqual([0x1b, 0x64, 0x00]);
  });

  test('cut emits GS V m (full by default, partial on request)', () => {
    expect(bytes(escpos.cut())).toEqual([0x1d, 0x56, 0x00]);
    expect(bytes(escpos.cut({ partial: true }))).toEqual([0x1d, 0x56, 0x01]);
  });

  test('drawerKick emits ESC p m t1 t2', () => {
    // Defaults: pin 0, 25x2ms on, 250x2ms off.
    expect(bytes(escpos.drawerKick())).toEqual([0x1b, 0x70, 0x00, 25, 250]);
    expect(bytes(escpos.drawerKick({ pin: 1, onTime: 10, offTime: 20 }))).toEqual([0x1b, 0x70, 0x01, 10, 20]);
  });

  test('textLine wraps text with alignment/emphasis and restores state', () => {
    const out = bytes(escpos.textLine('Hi', { align: 'center', bold: true }));
    expect(out).toEqual([
      0x1b, 0x61, 0x01, // ESC a 1 (center)
      0x1b, 0x45, 0x01, // ESC E 1 (bold on)
      0x48, 0x69,       // "Hi"
      0x0a,             // newline
      0x1b, 0x45, 0x00, // ESC E 0 (bold off)
      0x1b, 0x61, 0x00, // ESC a 0 (left)
    ]);
  });

  test('textLine doubleSize toggles GS ! around the text', () => {
    const out = bytes(escpos.textLine('AB', { doubleSize: true }));
    expect(out.slice(0, 3)).toEqual([0x1d, 0x21, 0x11]);
    expect(out.slice(3, 5)).toEqual([0x41, 0x42]);
    expect(out.slice(5, 9)).toEqual([0x0a, 0x1d, 0x21, 0x00]);
  });

  test('encodeText replaces non-latin1 glyphs with ?', () => {
    expect(escpos.encodeText('caf\u00e9').toString('latin1')).toBe('caf\u00e9');
    expect(escpos.encodeText('A\u4e2dB').toString('latin1')).toBe('A?B');
  });

  test('twoColumn pads to the line width', () => {
    const line = escpos.twoColumn('Subtotal', '$4.50');
    expect(line.length).toBe(escpos.LINE_WIDTH);
    expect(line.startsWith('Subtotal')).toBe(true);
    expect(line.endsWith('$4.50')).toBe(true);
  });
});

describe('buildReceipt', () => {
  const receipt = {
    headerLines: ['Test Diner'],
    metaLines: ['Order #7'],
    items: [{ qty: 2, name: 'Burger', amount: '$9.00', subLines: ['+ Cheese ($1.00)'] }],
    totals: [{ label: 'Subtotal', amount: '$9.00' }, { label: 'TOTAL', amount: '$9.00', grand: true }],
    footerLines: ['Thank you!'],
    kickDrawer: true,
  };

  test('starts with init and ends with feed + drawer kick + cut', () => {
    const out = escpos.buildReceipt(receipt);
    expect(bytes(out.slice(0, 2))).toEqual([0x1b, 0x40]);
    // feed(4) ++ drawerKick() ++ cut()
    const expectedTail = [0x1b, 0x64, 0x04, 0x1b, 0x70, 0x00, 25, 250, 0x1d, 0x56, 0x00];
    expect(bytes(out.slice(-expectedTail.length))).toEqual(expectedTail);
  });

  test('omits the drawer kick when kickDrawer is false', () => {
    const out = escpos.buildReceipt({ ...receipt, kickDrawer: false });
    expect(bytes(out).includes(0x70)).toBe(false); // no ESC p anywhere
  });

  test('renders item text and totals as printable ASCII', () => {
    const out = escpos.buildReceipt(receipt).toString('latin1');
    expect(out).toContain('Test Diner');
    expect(out).toContain('2 x Burger');
    expect(out).toContain('+ Cheese ($1.00)');
    expect(out).toContain('TOTAL');
  });
});

describe('sendToPrinter (fire-and-forget contract)', () => {
  test('never throws on a missing host; resolves { ok: false }', async () => {
    const result = await escpos.sendToPrinter('', 9100, Buffer.from([0x1b, 0x40]));
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('never throws on an invalid port; resolves { ok: false }', async () => {
    const result = await escpos.sendToPrinter('127.0.0.1', 99999, Buffer.from([0x1b, 0x40]));
    expect(result.ok).toBe(false);
  });

  test('never throws on an empty buffer; resolves { ok: false }', async () => {
    const result = await escpos.sendToPrinter('127.0.0.1', 9100, Buffer.alloc(0));
    expect(result.ok).toBe(false);
  });

  test('resolves { ok: false } on connection refused (no listener)', async () => {
    // Port 1 is closed on loopback; connect must fail fast, not hang or throw.
    const result = await escpos.sendToPrinter('127.0.0.1', 1, Buffer.from([0x1b, 0x40]), { timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('delivers the exact bytes to a listening TCP server', async () => {
    const payload = escpos.buildReceipt({
      headerLines: ['Loopback'],
      items: [],
      totals: [{ label: 'TOTAL', amount: '$1.00', grand: true }],
      kickDrawer: false,
    });
    const received = await new Promise((resolve, reject) => {
      const chunks = [];
      const server = net.createServer((socket) => {
        socket.on('data', (c) => chunks.push(c));
        socket.on('end', () => {
          server.close(() => resolve(Buffer.concat(chunks)));
        });
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        try {
          const result = await escpos.sendToPrinter('127.0.0.1', server.address().port, payload);
          expect(result).toEqual({ ok: true });
        } catch (err) {
          reject(err);
        }
      });
    });
    expect(received.equals(payload)).toBe(true);
  });
});
