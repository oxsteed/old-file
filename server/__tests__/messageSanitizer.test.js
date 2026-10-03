'use strict';

const {
  escapeHtml,
  sanitizeMessage,
  stripHtml,
  detectOffPlatformContact,
  maskPhoneNumbers,
} = require('../utils/messageSanitizer');

describe('sanitizeMessage XSS behavior (unchanged)', () => {
  test('escapes HTML tags', () => {
    expect(sanitizeMessage('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('returns empty string for falsy input', () => {
    expect(sanitizeMessage('')).toBe('');
    expect(sanitizeMessage(null)).toBe('');
  });
});

describe('maskPhoneNumbers', () => {
  test('masks a full international phone number, keeping separators', () => {
    expect(maskPhoneNumbers('Call me at +1 (555) 123-4567'))
      .toBe('Call me at +· (···) ···-····');
  });

  test('masks dot- and dash-separated numbers', () => {
    expect(maskPhoneNumbers('my number is 555.123.4567 ok'))
      .toBe('my number is ···.···.···· ok');
  });

  test('masks plain 7+ digit runs', () => {
    expect(maskPhoneNumbers('call 5551234 tomorrow'))
      .toBe('call ······· tomorrow');
  });

  test('does not mask short numeric strings', () => {
    expect(maskPhoneNumbers('Call 911 now')).toBe('Call 911 now');
    expect(maskPhoneNumbers('zip 90210')).toBe('zip 90210');
  });

  test('does not mask street addresses', () => {
    expect(maskPhoneNumbers('Meet at 123 Main St')).toBe('Meet at 123 Main St');
  });

  test('does not mask ISO dates', () => {
    expect(maskPhoneNumbers('on 2026-10-03')).toBe('on 2026-10-03');
  });

  test('does not touch digits inside emails or URLs', () => {
    expect(maskPhoneNumbers('mail bob123@example.com please'))
      .toBe('mail bob123@example.com please');
    expect(maskPhoneNumbers('see https://example.com/order/5551234'))
      .toBe('see https://example.com/order/5551234');
  });
});

describe('detectOffPlatformContact', () => {
  test('flags phone numbers', () => {
    expect(detectOffPlatformContact('Call me at +1 (555) 123-4567'))
      .toEqual({ phone: true, email: false, url: false });
  });

  test('flags email addresses', () => {
    expect(detectOffPlatformContact('Reach me at bob@example.com'))
      .toEqual({ phone: false, email: true, url: false });
  });

  test('flags URLs', () => {
    expect(detectOffPlatformContact('see https://example.com/x and www.foo.com'))
      .toEqual({ phone: false, email: false, url: true });
  });

  test('returns all false for ordinary text', () => {
    expect(detectOffPlatformContact('I need help tomorrow at noon.'))
      .toEqual({ phone: false, email: false, url: false });
  });

  test('handles empty input', () => {
    expect(detectOffPlatformContact('')).toEqual({ phone: false, email: false, url: false });
    expect(detectOffPlatformContact(null)).toEqual({ phone: false, email: false, url: false });
  });
});

describe('sanitizeMessage off-platform handling', () => {
  test('masks phones in the stored output', () => {
    expect(sanitizeMessage('Call me at +1 (555) 123-4567'))
      .toBe('Call me at +· (···) ···-····');
  });

  test('leaves emails and URLs visible', () => {
    const out = sanitizeMessage('mail bob@example.com or see https://example.com');
    expect(out).toContain('bob@example.com');
    expect(out).toContain('https://example.com');
  });

  test('still escapes HTML before masking', () => {
    expect(sanitizeMessage('<b>Call 5551234</b>')).toBe('&lt;b&gt;Call ·······&lt;/b&gt;');
  });
});

describe('stripHtml (unchanged)', () => {
  test('removes tags', () => {
    expect(stripHtml('<p>hi</p>')).toBe('hi');
  });
});

describe('escapeHtml (unchanged)', () => {
  test('escapes entities', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#x27;');
  });
});
