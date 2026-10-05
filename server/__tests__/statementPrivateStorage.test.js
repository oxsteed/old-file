'use strict';
const express = require('express');
const request = require('supertest');
const privateStorage = require('../utils/statementStorage');
const { S3Client } = require('@aws-sdk/client-s3');
const { Readable } = require('node:stream');
const router = require('../routes/storage');

const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; jest.restoreAllMocks(); });
function configure() {
  process.env.STATEMENT_ARTIFACT_BUCKET = 'oxsteed-private-statements';
  process.env.STATEMENT_R2_ENDPOINT = 'https://syntheticaccount.r2.cloudflarestorage.com';
  process.env.STATEMENT_R2_ACCESS_KEY_ID = 'synthetic-not-a-real-key';
  process.env.STATEMENT_R2_SECRET_ACCESS_KEY = 'synthetic-not-a-real-secret';
  process.env.STATEMENT_R2_PRIVACY_ATTESTED = '1';
  process.env.S3_BUCKET = 'oxsteed-public-uploads';
  delete process.env.AWS_S3_BUCKET;
}
test('requires a dedicated private R2 configuration, never a local fallback', () => {
  configure();
  expect(privateStorage.configuration().bucket).toBe('oxsteed-private-statements');
  delete process.env.STATEMENT_R2_SECRET_ACCESS_KEY;
  expect(() => privateStorage.configuration()).toThrow('Private statement R2 storage is not configured');
});
test('requires an operator privacy review before private storage activates', () => {
  configure(); delete process.env.STATEMENT_R2_PRIVACY_ATTESTED;
  expect(() => privateStorage.configuration()).toThrow();
});
test('SDK commands target the private bucket rather than the public upload bucket', async () => {
  configure();
  const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValueOnce({})
    .mockResolvedValueOnce({ Body: Readable.from(['verified']) });
  await privateStorage.uploadFile('statements/stmt/synthetic.pdf', Buffer.from('%PDF-synthetic'), 'application/pdf');
  const stream = await privateStorage.getObjectStream('statements/stmt/synthetic.pdf');
  for await (const _chunk of stream) { /* consume and release the SDK body */ }
  expect(send.mock.calls.map(([command]) => command.input.Bucket))
    .toEqual(['oxsteed-private-statements', 'oxsteed-private-statements']);
  expect(send.mock.calls[0][0].input.CacheControl).toBe('private, no-store');
});
test.each(['oxsteed-public-uploads', 'oxsteed-backups'])('rejects shared bucket %s', bucket => {
  configure();
  process.env.STATEMENT_ARTIFACT_BUCKET = bucket;
  expect(() => privateStorage.configuration()).toThrow();
});
test.each(['http://syntheticaccount.r2.cloudflarestorage.com', 'https://s3.amazonaws.com',
  'https://syntheticaccount.r2.cloudflarestorage.com/elsewhere'])('rejects unintended endpoint %s', endpoint => {
  configure(); process.env.STATEMENT_R2_ENDPOINT = endpoint;
  expect(() => privateStorage.configuration()).toThrow();
});
test.each(['statements/old.pdf', 'custom-private/stmt/123.pdf', 'stmt/renditions/accessible/123.html',
  'old-statements/123.pdf'])('blocks legacy statements on both generic routes: %s', async key => {
  process.env.STATEMENT_LEGACY_PREFIXES = 'old-statements';
  const app = express(); app.use('/api/storage', router);
  for (const route of ['public', 'files']) {
    const response = await request(app).get(`/api/storage/${route}/${key}?exp=9999999999&sig=ignored`);
    expect(response.status).toBe(404);
  }
});
