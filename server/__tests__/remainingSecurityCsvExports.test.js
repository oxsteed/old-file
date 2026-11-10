'use strict';

// Pentest remainder: the three exporters below previously used local CSV
// escapers that missed tab/CR leads (audit, business launch) or did no
// formula neutralization at all (profile visibility). They now share
// server/utils/csv.js (csvCell), the escaper used by the pentest-fixed
// exporters. These tests prove every user-controlled cell is neutralized
// for all six formula triggers: =, +, -, @, tab, CR.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/auditService', () => ({
  getUserActionLogs: jest.fn().mockResolvedValue({
    rows: [{
      created_at: '2026-10-30T00:00:00.000Z',
      admin_email: '=2+5+cmd',
      admin_name: '+admin',
      target_email: '-target',
      target_name: '@target',
      action_type: 'update',
      field_name: '\tfield',
      old_value: '\rold',
      new_value: '=new',
      ip_address: '127.0.0.1',
      region_name: 'plain',
      user_notified: true,
    }],
    total: 1,
  }),
  logAdminAction: jest.fn().mockResolvedValue(true),
}));

const { csvCell } = require('../utils/csv');
const auditController = require('../controllers/auditController');
const businessLaunchController = require('../controllers/businessLaunchController');
const profileVisibilityController = require('../controllers/profileVisibilityController');

function reqDouble(overrides = {}) {
  return { body: {}, query: {}, params: {}, user: { id: 'admin-1' }, headers: {}, ...overrides };
}

function streamResDouble() {
  return {
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; return this; },
    write(chunk) { this.body += chunk; return this; },
    end() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function sendResDouble() {
  return {
    headers: {},
    sent: null,
    setHeader(k, v) { this.headers[k] = v; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    send(body) { this.sent = body; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async () => ({ rows: [] }));
});

describe('csvCell trigger coverage', () => {
  test('neutralizes tab and CR leads in addition to =, +, -, @', () => {
    expect(csvCell('\tformula')).toBe("'\tformula");
    // A raw CR inside a cell is also quoted (RFC 4180) so it cannot split rows.
    expect(csvCell('\rformula')).toBe("\"'\rformula\"");
    expect(csvCell('=formula')).toBe("'=formula");
    expect(csvCell('+formula')).toBe("'+formula");
    expect(csvCell('-formula')).toBe("'-formula");
    expect(csvCell('@formula')).toBe("'@formula");
    expect(csvCell('plain')).toBe('plain');
  });
});

describe('audit user-actions export', () => {
  test('neutralizes every trigger lead in user-controlled cells', async () => {
    const res = streamResDouble();
    await auditController.exportUserActions({ query: {}, isSuper: true }, res);
    expect(res.body).toContain("'=2+5+cmd");
    expect(res.body).toContain("'+admin");
    expect(res.body).toContain("'-target");
    expect(res.body).toContain("'@target");
    expect(res.body).toContain("'\tfield");
    expect(res.body).toContain("'\rold");
    expect(res.body).toContain("'=new");
    expect(res.body).not.toMatch(/(^|,)@target(,|\r)/);
  });
});

describe('business launch export', () => {
  test('neutralizes every trigger lead in every exported cell', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      first_name: '=John',
      last_name: '+Doe',
      email: '@evil',
      phone: '\t555',
      package_selected: '-pkg',
      operating_country: '@XX',
      operating_state: '\rCA',
      urgency: '=high',
      status: 'pending',
      created_at: new Date('2026-10-30T00:00:00.000Z'),
    }] });
    const res = sendResDouble();
    await businessLaunchController.exportBusinessLaunchRequests(reqDouble(), res);
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    const lines = res.sent.split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,Package,Country,State,Urgency,Status,Submitted');
    expect(lines[1]).toBe("'=John +Doe,'@evil,'\t555,'-pkg,'@XX,\"'\rCA\",'=high,pending,2026-10-30");
  });
});

describe('profile visibility export', () => {
  test('neutralizes every trigger lead in every exported cell', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      {
        profile_type: 'helper', display_name: '=Marie', detail: '+detail',
        is_visible: false, owner_visible: true, hidden_reason: '@reason',
      },
      {
        profile_type: 'business', display_name: '\ttab', detail: '\rCR',
        is_visible: true, owner_visible: false, hidden_reason: '-dash',
      },
    ] });
    const res = sendResDouble();
    await profileVisibilityController.exportAllProfiles(reqDouble({ query: {} }), res);
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    const lines = res.sent.trim().split('\r\n');
    expect(lines[0]).toBe('Type,Name,Detail,Visibility,Owner status,Reason');
    expect(lines[1]).toBe("helper,'=Marie,'+detail,Hidden,Listed,'@reason");
    expect(lines[2]).toBe("business,'\ttab,\"'\rCR\",Visible,Unlisted,'-dash");
  });
});

describe('F-15 hidden formula leads', () => {
  const { csvCell, csvQuotedCell, neutralizeCsvText } = require('../utils/csv');

  test.each([
    [' =HYPERLINK("http://x")'],
    ['\uFEFF=cmd|calc'],
    ['\u202E=cmd|calc'],
    ['\u200B+1'],
    ['\u2066@SUM(A1)'],
    ['\uFF1D1+1'],
  ])('neutralizes %j', (value) => {
    expect(neutralizeCsvText(value).startsWith("'")).toBe(true);
  });

  test('drops NUL bytes and JSON-encodes objects', () => {
    expect(csvCell('a\u0000b')).toBe('ab');
    expect(csvQuotedCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  test('allowNumeric keeps plain negative numbers numeric', () => {
    expect(csvCell('-42.10', { allowNumeric: true })).toBe('-42.10');
    expect(csvCell('-1+1', { allowNumeric: true })).toBe("'-1+1");
  });

  test('every hand-rolled export helper is gone', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      'controllers/oxsteedCreditController.js', 'controllers/oxsteedCreditPartnerController.js',
      'controllers/superAdminController.js', 'routes/growthInsights.js', 'routes/privacy.js',
      'routes/support.js', 'services/oxsteedCreditService.js', 'services/creditStatementPdf.js',
      'routes/settlementStatementArchive.js', 'services/creditStatementExport.js',
      'services/customer360Workspace.js', 'services/creditCompliance/reportPackService.js',
      'services/creditCompliance/safeguardingService.js', 'services/creditBankPayoutService.js',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(src).not.toMatch(/\[=\+\\-@[^\]]*\]\/\.test\(/);
    }
  });
});

