// Synthetic browser acceptance for the WebAuthn ceremony. This uses Chrome's
// virtual authenticator only; it never contacts OxSteed or uses a real key.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright-core');

async function fixture() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>WebAuthn fixture</title>');
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  await page.goto(`http://localhost:${server.address().port}`);
  return {
    page,
    async close() {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('Chrome virtual authenticator completes registration and assertion ceremonies', async () => {
  const env = await fixture();
  try {
    const result = await env.page.evaluate(async () => {
      const encoder = new TextEncoder();
      const registration = await navigator.credentials.create({
        publicKey: {
          challenge: encoder.encode('synthetic-registration-challenge-123456'),
          rp: { name: 'OxSteed', id: 'localhost' },
          user: {
            id: encoder.encode('synthetic-user'),
            name: 'synthetic@example.invalid',
            displayName: 'Synthetic User',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        },
      });
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: encoder.encode('synthetic-assertion-challenge-123456'),
          rpId: 'localhost',
          allowCredentials: [{ type: 'public-key', id: new Uint8Array(registration.rawId) }],
          userVerification: 'required',
        },
      });
      return {
        registrationType: registration.type,
        assertionType: assertion.type,
        registrationId: registration.id,
        assertionId: assertion.id,
        userHandle: Array.from(new Uint8Array(assertion.response.userHandle || [])),
      };
    });

    assert.equal(result.registrationType, 'public-key');
    assert.equal(result.assertionType, 'public-key');
    assert.equal(result.registrationId, result.assertionId);
    assert.deepEqual(result.userHandle, Array.from(new TextEncoder().encode('synthetic-user')));
  } finally {
    await env.close();
  }
});
