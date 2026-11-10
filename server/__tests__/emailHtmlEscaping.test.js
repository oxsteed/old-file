'use strict';

/** F-19 regression: user and listing text is HTML-escaped in emails. */

const { mockQuery, resetMocks } = require('./setup');
const email = require('../utils/email');

beforeEach(() => resetMocks());

describe('F-19 discover digest', () => {
  const { _digestHtml } = require('../controllers/discoverController');

  test('escapes titles, names and queries, including unterminated tags', () => {
    const html = _digestHtml(
      { first_name: '<b>Eve', query: '"><script>x</script>', radius_miles: 10 },
      [
        { title: 'Nice bike <a href="https://evil.example"', type: 'listing', url: '/listings/1' },
        { title: 'x', type: '<img src=x onerror=1>', url: '/listings/2' },
      ],
    );
    expect(html).not.toMatch(/<script>|<b>|<img|href="https:\/\/evil/);
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;');
    expect(html).toContain('&lt;b&gt;Eve');
  });

  test('drops non-relative result URLs to plain text', () => {
    const html = _digestHtml({ first_name: 'A', query: 'q', radius_miles: 5 }, [
      { title: 'T', type: 'job', url: 'https://evil.example/x' },
      { title: 'U', type: 'job', url: '//evil.example/x' },
    ]);
    expect(html).not.toMatch(/evil\.example/);
  });
});

describe('F-19 admin test email', () => {
  test('subject, message and sender are escaped in the HTML body', async () => {
    const direct = require('../controllers/directController');
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    mockQuery.mockResolvedValue({ rows: [] });
    await direct.sendAdminTestEmail({
      body: { recipientEmail: 'ops@example.com', subject: 'Hi <i>there', message: '<a href="https://evil.example">click' },
      user: { id: 'admin-1', first_name: '<u>Ann', last_name: 'Admin', email: 'ann@example.com' },
    }, res);
    const call = email.sendEmail.mock.calls.at(-1);
    expect(call).toBeTruthy();
    const { html } = call[0];
    expect(html).not.toMatch(/<i>|<a href|<u>/);
  });
});
