'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
const wa = require('../controllers/workAgreementController');

const HELPER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const AGREEMENT_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_ID = '66666666-6666-4666-8666-666666666666';

const SIG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUg'.repeat(20);

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.post('/api/work-agreements', wa.createAgreement);
  app.get('/api/work-agreements', wa.listAgreements);
  app.get('/api/work-agreements/:id', wa.getAgreement);
  app.post('/api/work-agreements/:id/versions', wa.createVersion);
  app.post('/api/work-agreements/:id/complete', wa.completeAgreement);
  app.post('/api/work-agreements/:id/sign', wa.signAgreement);
  app.get('/api/work-agreements/:id/signatures', wa.listSignatures);
  app.post('/api/work-agreements/:id/change-orders', wa.proposeChangeOrder);
  app.post('/api/work-agreements/:id/change-orders/:coId/approve', wa.approveChangeOrder);
  app.post('/api/work-agreements/:id/change-orders/:coId/reject', wa.rejectChangeOrder);
  app.post('/api/work-agreements/:id/evidence', wa.addEvidence);
  app.get('/api/work-agreements/:id/evidence', wa.listEvidence);
  app.post('/api/work-agreements/:id/documents', wa.addDocument);
  app.post('/api/work-agreements/:id/warranty-claims', wa.fileWarrantyClaim);
  app.post('/api/work-agreements/:id/warranty-claims/:claimId/resolve', wa.resolveWarrantyClaim);
  app.use(errorHandler);
  return app;
}

const agreementRow = (over = {}) => ({
  id: AGREEMENT_ID,
  job_id: JOB_ID,
  helper_id: HELPER_ID,
  customer_id: CUSTOMER_ID,
  status: 'pending_signatures',
  ...over,
});

const versionRow = (over = {}) => ({
  id: VERSION_ID,
  agreement_id: AGREEMENT_ID,
  version_number: 1,
  content: { scope: 'Fix sink' },
  ...over,
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('work agreement creation', () => {
  test('helper can create an agreement from their job', async () => {
    const agreement = agreementRow({ status: 'pending_signatures' });
    const version = versionRow();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, client_id: CUSTOMER_ID, assigned_helper_id: HELPER_ID }] })
      .mockResolvedValueOnce({})                        // BEGIN
      .mockResolvedValueOnce({ rows: [agreement] })
      .mockResolvedValueOnce({ rows: [version] })
      .mockResolvedValueOnce({});                       // COMMIT

    const res = await request(buildApp(HELPER_ID))
      .post('/api/work-agreements')
      .send({ jobId: JOB_ID, content: { scope: 'Fix sink', priceCents: 5000 } });

    expect(res.status).toBe(201);
    expect(res.body.agreement.helper_id).toBe(HELPER_ID);
    expect(res.body.version.version_number).toBe(1);
  });

  test('stranger cannot create an agreement on someone else job', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: JOB_ID, client_id: CUSTOMER_ID, assigned_helper_id: HELPER_ID }],
    });
    const res = await request(buildApp(STRANGER_ID))
      .post('/api/work-agreements')
      .send({ jobId: JOB_ID, content: { scope: 'Fix sink' } });
    expect(res.status).toBe(403);
  });

  test('non-party cannot read an agreement', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow()] });
    const res = await request(buildApp(STRANGER_ID)).get(`/api/work-agreements/${AGREEMENT_ID}`);
    expect(res.status).toBe(403);
  });
});

describe('signature flow', () => {
  test('first signature records without activating', async () => {
    const agreement = agreementRow({ status: 'pending_signatures' });
    const version = versionRow();
    mockQuery
      .mockResolvedValueOnce({ rows: [agreement] })   // loadAgreement
      .mockResolvedValueOnce({ rows: [version] })     // currentVersion
      .mockResolvedValueOnce({})                       // BEGIN
      .mockResolvedValueOnce({ rows: [] })             // INSERT signature
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })      // maybeActivate: 1 role
      .mockResolvedValueOnce({});                      // COMMIT

    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/sign`)
      .send({ versionId: VERSION_ID, signatureData: SIG, role: 'helper' });
    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(false);
  });

  test('second signature from counterparty activates the agreement', async () => {
    const agreement = agreementRow({ status: 'pending_signatures' });
    const version = versionRow();
    mockQuery
      .mockResolvedValueOnce({ rows: [agreement] })
      .mockResolvedValueOnce({ rows: [version] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ c: 2 }] })      // both roles signed
      .mockResolvedValueOnce({ rows: [] })              // UPDATE status -> active
      .mockResolvedValueOnce({});

    const res = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/sign`)
      .send({ versionId: VERSION_ID, signatureData: SIG, role: 'customer' });
    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(true);
  });

  test('rejects empty signature data', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow()] });
    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/sign`)
      .send({ versionId: VERSION_ID, signatureData: '   ', role: 'helper' });
    expect(res.status).toBe(400);
  });

  test('rejects signing a stale version', async () => {
    const agreement = agreementRow();
    const current = versionRow({ id: 'new-version-id', version_number: 2 });
    mockQuery
      .mockResolvedValueOnce({ rows: [agreement] })
      .mockResolvedValueOnce({ rows: [current] });
    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/sign`)
      .send({ versionId: VERSION_ID, signatureData: SIG, role: 'helper' });
    expect(res.status).toBe(409);
  });
});

describe('versioning', () => {
  test('new version returns status to pending_signatures', async () => {
    const agreement = agreementRow({ status: 'active' });
    mockQuery
      .mockResolvedValueOnce({ rows: [agreement] })
      .mockResolvedValueOnce({})                        // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] }) // FOR UPDATE lock
      .mockResolvedValueOnce({ rows: [{ id: VERSION_ID, created_by: HELPER_ID, sig_count: 2 }] }) // latest version
      .mockResolvedValueOnce({ rows: [{ m: 1 }] })       // MAX(version_number)
      .mockResolvedValueOnce({ rows: [versionRow({ version_number: 2 })] })
      .mockResolvedValueOnce({ rows: [] })              // UPDATE status
      .mockResolvedValueOnce({});                       // COMMIT
    const res = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/versions`)
      .send({ content: { scope: 'Fix sink + paint' } });
    expect(res.status).toBe(201);
    expect(res.body.version.version_number).toBe(2);
  });

  test('cannot version a closed agreement', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow({ status: 'closed' })] });
    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/versions`)
      .send({ content: { scope: 'x' } });
    expect(res.status).toBe(409);
  });
});

describe('change orders', () => {
  const coRow = (over = {}) => ({
    id: 'co-1', agreement_id: AGREEMENT_ID, description: 'Add faucet replacement',
    price_change_cents: 2500, status: 'proposed', proposed_by: HELPER_ID, ...over,
  });

  test('party can propose a change order with integer cents', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [versionRow()] })
      .mockResolvedValueOnce({ rows: [coRow()] });
    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/change-orders`)
      .send({ description: 'Add faucet replacement', priceChangeCents: 2500, signatureData: SIG });
    expect(res.status).toBe(201);
    expect(res.body.changeOrder.price_change_cents).toBe(2500);
  });

  test('rejects non-integer price', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] });
    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/change-orders`)
      .send({ description: 'Add faucet replacement', priceChangeCents: 25.5, signatureData: SIG });
    expect(res.status).toBe(400);
  });

  test('rejects change order without signature', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] });
    const res = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/change-orders`)
      .send({ description: 'Add faucet replacement', priceChangeCents: 2500 });
    expect(res.status).toBe(400);
  });

  test('counterparty approves; proposer cannot approve own order', async () => {
    // proposer tries to approve own (with signature, still forbidden)
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [coRow()] });
    const own = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/change-orders/co-1/approve`)
      .send({ signatureData: SIG });
    expect(own.status).toBe(403);

    // counterparty approves without signature -> 400
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] });
    const noSig = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/change-orders/co-1/approve`)
      .send({});
    expect(noSig.status).toBe(400);

    // counterparty approves with signature
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [coRow()] })
      .mockResolvedValueOnce({ rows: [coRow({ status: 'approved' })] });
    const ok = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/change-orders/co-1/approve`)
      .send({ signatureData: SIG });
    expect(ok.status).toBe(200);
    expect(ok.body.changeOrder.status).toBe('approved');
  });
});

describe('warranty claims', () => {
  test('party can file and resolve a claim', async () => {
    const claim = { id: 'claim-1', agreement_id: AGREEMENT_ID, status: 'filed', description: 'Sink leaks again' };
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [claim] });
    const filed = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/warranty-claims`)
      .send({ description: 'Sink leaks again after two weeks' });
    expect(filed.status).toBe(201);

    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [{ filed_by: CUSTOMER_ID }] })
      .mockResolvedValueOnce({ rows: [{ ...claim, status: 'resolved' }] });
    const resolved = await request(buildApp(HELPER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/warranty-claims/claim-1/resolve`)
      .send({ decision: 'resolved', note: 'Replaced washer, tested OK' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.claim.status).toBe('resolved');
  });

  test('rejects short claim descriptions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] });
    const res = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/warranty-claims`)
      .send({ description: 'bad' });
    expect(res.status).toBe(400);
  });
});

describe('review fixes (P1 area 3)', () => {
  test('creation without content builds version 1 from the job and returns id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, client_id: CUSTOMER_ID, assigned_helper_id: HELPER_ID, title: 'Fix sink', description: 'Kitchen sink leaks', final_price_cents: 12000 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [agreementRow()] })
      .mockResolvedValueOnce({ rows: [versionRow()] })
      .mockResolvedValueOnce({});
    const res = await request(buildApp(HELPER_ID))
      .post('/api/work-agreements')
      .send({ jobId: JOB_ID, warrantyMonths: 3, warrantyTerms: 'Three months on parts' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(AGREEMENT_ID);
    const versionInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO work_agreement_versions/.test(String(sql)));
    const content = JSON.parse(versionInsert[1][1]);
    expect(content).toMatchObject({ title: 'Fix sink', scope: 'Kitchen sink leaks', priceCents: 12000, warrantyMonths: 3, warrantyTerms: 'Three months on parts' });
    const { sendNotification } = require('../services/notificationService');
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: CUSTOMER_ID, type: 'work_agreement_signature_requested' }));
  });

  test('self-dealing job is rejected before creation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: JOB_ID, client_id: HELPER_ID, assigned_helper_id: HELPER_ID, title: 'x' }] });
    const res = await request(buildApp(HELPER_ID)).post('/api/work-agreements').send({ jobId: JOB_ID });
    expect(res.status).toBe(400);
  });

  test('detail returns versions, evidence, documents, claims and signature images', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM work_agreements WHERE id')) return { rows: [agreementRow()] };
      if (t.includes('ORDER BY version_number DESC LIMIT 1')) return { rows: [versionRow()] };
      if (t.includes('FROM work_agreement_signatures')) return { rows: [{ id: 's1', signer_role: 'helper', signature_data: SIG }] };
      if (t.includes('FROM work_agreement_versions')) return { rows: [versionRow()] };
      if (t.includes('FROM work_agreement_evidence')) return { rows: [{ id: 'e1' }] };
      if (t.includes('FROM work_agreement_documents')) return { rows: [{ id: 'd1' }] };
      if (t.includes('FROM work_agreement_warranty_claims')) return { rows: [{ id: 'c1' }] };
      return { rows: [] };
    });
    const res = await request(buildApp(CUSTOMER_ID)).get(`/api/work-agreements/${AGREEMENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.evidence).toHaveLength(1);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.warrantyClaims).toHaveLength(1);
    expect(res.body.signatures[0].signature_data).toBe(SIG);
    expect(res.body.myRole).toBe('customer');
  });

  test('an unsigned proposal by the same party is replaced, not stacked', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'pending_signatures' })] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ status: 'pending_signatures' }] })
      .mockResolvedValueOnce({ rows: [{ id: VERSION_ID, created_by: CUSTOMER_ID, sig_count: 0 }] })
      .mockResolvedValueOnce({ rows: [versionRow({ content: { scope: 'New scope' } })] })
      .mockResolvedValueOnce({});
    const res = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/versions`)
      .send({ content: { scope: 'New scope' } });
    expect(res.status).toBe(200);
    expect(res.body.replaced).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO work_agreement_versions/.test(String(sql)))).toBe(false);
  });

  test('warranty claims need a signed agreement and an open window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow({ status: 'pending_signatures' })] });
    const unsigned = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/warranty-claims`).send({ description: 'Sink leaks again after two weeks' });
    expect(unsigned.status).toBe(409);

    const longAgo = new Date(Date.now() - 400 * 86400000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [agreementRow({ status: 'completed', completed_at: longAgo, warranty_months: 6 })] });
    const expired = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/warranty-claims`).send({ description: 'Sink leaks again after two weeks' });
    expect(expired.status).toBe(409);
    expect(expired.body.code).toBe('warranty_expired');
  });

  test('the filer cannot deny their own claim', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [{ filed_by: CUSTOMER_ID }] });
    const res = await request(buildApp(CUSTOMER_ID))
      .post(`/api/work-agreements/${AGREEMENT_ID}/warranty-claims/claim-1/resolve`).send({ decision: 'denied' });
    expect(res.status).toBe(403);
  });

  test('AI draft reads assigned_helper_id/client_id from jobs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: JOB_ID, client_id: CUSTOMER_ID, assigned_helper_id: HELPER_ID, title: 'Fix sink' }] });
    const app = express(); app.use(express.json());
    app.use((req, _r, n) => { req.user = { id: STRANGER_ID }; n(); });
    app.post('/draft', wa.draftAgreement);
    const res = await request(app).post('/draft').send({ jobId: JOB_ID });
    expect(res.status).toBe(403);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/assigned_helper_id, client_id/);
    expect(sql).not.toMatch(/helper_id, customer_id/);
  });
});
