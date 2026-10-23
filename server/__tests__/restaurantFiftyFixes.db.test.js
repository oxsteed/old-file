'use strict';

// This suite requires an explicitly created, fully migrated disposable database.
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../db', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn()
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({
    success: true
  }))
}));
const crypto = require('crypto');
const {
  Pool
} = require('pg');
const db = require('../db');
const scopeModel = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const audits = require('../controllers/restaurantAuditsController');
const training = require('../controllers/restaurantTrainingController');
const ops = require('../controllers/restaurantOpsController');
const accounting = require('../services/restaurantAccountingService');
const accountingController = require('../controllers/restaurantAccountingController');
const hq = require('../services/restaurantHQService');
const lifecycle = require('../services/restaurantTrainingLifecycle');
const {
  sendNotification
} = require('../services/notificationService');
const url = process.env.FRANCHISE_FIFTY_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.pathname !== '/franchise_fifty_test') throw new Error('Requires disposable migrated loopback franchise_fifty_test');
}
(url ? describe : describe.skip)('fifty-fix full-schema PostgreSQL regressions', () => {
  let pool, owner, staff, sibling, businessId, restaurantId, locationA, locationB, membership;
  async function call(handler, {
    body = {},
    params = {},
    query = {},
    user = owner,
    key = 'fifty-key'
  } = {}) {
    const req = {
      params: {
        restaurantId: String(restaurantId),
        ...params
      },
      body,
      query,
      user: {
        id: user
      },
      headers: {},
      get: () => key
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        this.data = value;
        return this;
      }
    };
    let error;
    await handler(req, res, e => {
      error = e;
    });
    return {
      status: error?.statusCode || res.statusCode,
      error,
      data: res.data
    };
  }
  async function template() {
    const r = await call(audits.createTemplate, {
      body: {
        name: `Inspection ${crypto.randomUUID()}`,
        items: [{
          label: 'Floor',
          maxScore: 5
        }, {
          label: 'Sink',
          maxScore: 5,
          weight: 2
        }]
      }
    });
    if (r.error) throw r.error;
    return r.data.template;
  }
  async function run(t, locationId = locationA) {
    const r = await call(audits.startAudit, {
      body: {
        locationId
      },
      params: {
        templateId: t.id
      }
    });
    if (r.error) throw r.error;
    return r.data.audit;
  }
  async function scoreAll(t, a) {
    for (const item of t.items) {
      const r = await call(audits.scoreItem, {
        body: {
          itemId: Number(item.id),
          score: 4
        },
        params: {
          auditId: a.id
        }
      });
      if (r.error) throw r.error;
    }
  }
  async function module(body = {}) {
    const r = await call(training.createModule, {
      body: {
        title: `Safety ${crypto.randomUUID()}`,
        questions: [{
          question: 'Which?',
          options: ['Wrong', 'Right'],
          correct_index: 1
        }],
        ...body
      }
    });
    if (r.error) throw r.error;
    return r.data.module;
  }
  async function assign(m, userId = staff) {
    const r = await call(training.assignModule, {
      params: {
        moduleId: m.id
      },
      body: {
        userId
      }
    });
    if (r.error) throw r.error;
    return r.data.assignment;
  }
  beforeAll(async () => {
    pool = new Pool({
      connectionString: url,
      max: 8
    });
    db.query.mockImplementation((...args) => pool.query(...args));
    db.connect.mockImplementation(() => pool.connect());
    [owner, staff, sibling] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [owner, staff, sibling]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic-test-hash','Test','Staff')", [id, `${id}@example.test`]);
    ({
      rows: [{
        id: businessId
      }]
    } = await pool.query('INSERT INTO businesses(user_id,business_name) VALUES($1,$2) RETURNING id', [owner, `Fifty ${crypto.randomUUID()}`]));
    ({
      rows: [{
        id: restaurantId
      }]
    } = await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone) VALUES($1,$2,'Fifty Test','America/New_York') RETURNING id", [businessId, owner]));
    ({
      rows: [{
        id: locationA
      }]
    } = await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE', [restaurantId]));
    ({
      rows: [{
        id: locationB
      }]
    } = await pool.query("INSERT INTO restaurant_locations(restaurant_id,name,is_primary,status,timezone) VALUES($1,'Sibling',FALSE,'active','America/New_York') RETURNING id", [restaurantId]));
    for (const [user, location] of [[staff, locationA], [sibling, locationB]]) {
      const {
        rows: [m]
      } = await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,'employee','active') RETURNING id", [businessId, owner, user, `${user}@example.test`]);
      if (user === staff) membership = m.id;
      await pool.query("INSERT INTO restaurant_location_memberships(restaurant_id,location_id,membership_id,status) VALUES($1,$2,$3,'active')", [restaurantId, location, m.id]);
      await pool.query("INSERT INTO membership_permission_overrides(membership_id,permission_id,effect) SELECT $1,id,'allow' FROM team_permissions WHERE code=ANY($2::text[])", [m.id, ['crew.manage', 'audit.view', 'audit.manage', 'settings.view', 'settings.manage']]);
    }
    scopeModel.resolveRestaurantAccess.mockImplementation(async (user, id) => {
      if (Number(id) !== Number(restaurantId)) throw new Error('Unexpected restaurant');
      const {
        rows: [r]
      } = await pool.query('SELECT * FROM food_restaurants WHERE id=$1', [restaurantId]);
      const {
        rows: [member]
      } = await pool.query('SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2', [businessId, user]);
      return {
        ...r,
        effective_role: user === owner ? 'owner' : 'employee',
        effective_membership_id: member?.id || null
      };
    });
  }, 30000);
  beforeEach(() => {
    permissions.invalidateCache();
    jest.clearAllMocks();
    sendNotification.mockResolvedValue({
      success: true
    });
  });
  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM businesses WHERE id=$1', [businessId]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[owner, staff, sibling]]).catch(() => {});
      await pool.end();
    }
  });
  test('audit start snapshots items and template edits preserve run scores and history', async () => {
    const t = await template(),
      a = await run(t);
    expect(a.snapshot_items).toHaveLength(2);
    const edit = await call(audits.updateTemplate, {
      params: {
        templateId: t.id
      },
      body: {
        items: [{
          label: 'New item'
        }]
      }
    });
    expect(edit.error).toBeUndefined();
    await scoreAll(t, a);
    const done = await call(audits.completeAudit, {
      params: {
        auditId: a.id
      }
    });
    expect(done.error).toBeUndefined();
    expect(Number(done.data.audit.total_score)).toBe(12);
    expect(Number(done.data.audit.max_score)).toBe(15);
    expect((await call(audits.deleteTemplate, {
      params: {
        templateId: t.id
      }
    })).error).toBeUndefined();
    expect((await call(audits.getAudit, {
      params: {
        auditId: a.id
      }
    })).data.audit.scores).toHaveLength(2);
    expect((await call(audits.listTemplates)).data.templates.some(row => row.id === t.id)).toBe(false);
  });
  test('partial audit completion is rejected without changing status', async () => {
    const t = await template(),
      a = await run(t);
    expect((await call(audits.completeAudit, {
      params: {
        auditId: a.id
      }
    })).error.code).toBe('audit_incomplete');
    expect((await pool.query('SELECT status FROM restaurant_audits WHERE id=$1', [a.id])).rows[0].status).toBe('in_progress');
  });
  test('assigned staff cannot read or mutate sibling-store quality data', async () => {
    const t = await template(),
      a = await run(t, locationB);
    expect((await call(audits.getAudit, {
      params: {
        auditId: a.id
      },
      user: staff
    })).status).toBe(404);
    expect((await call(audits.scoreItem, {
      params: {
        auditId: a.id
      },
      body: {
        itemId: Number(t.items[0].id),
        score: 1
      },
      user: staff
    })).status).toBe(403);
    const listed = await call(audits.listAudits, {
      user: staff
    });
    expect(listed.error).toBeUndefined();
    expect(listed.data.audits.some(r => r.id === a.id)).toBe(false);
  });
  test('view-only audit grants cannot manage another auditor run', async () => {
    const t = await template(),
      a = await run(t);
    await pool.query("UPDATE membership_permission_overrides SET effect='deny' WHERE membership_id=$1 AND permission_id=(SELECT id FROM team_permissions WHERE code='audit.manage')", [membership]);
    permissions.invalidateCache();
    try {
      expect((await call(audits.scoreItem, {
        params: {
          auditId: a.id
        },
        body: {
          itemId: Number(t.items[0].id),
          score: 2
        },
        user: staff
      })).status).toBe(403);
    } finally {
      await pool.query("UPDATE membership_permission_overrides SET effect='allow' WHERE membership_id=$1 AND permission_id=(SELECT id FROM team_permissions WHERE code='audit.manage')", [membership]);
      permissions.invalidateCache();
    }
  });
  test('findings validate template membership and bind idempotency to the payload', async () => {
    const t = await template(),
      other = await template(),
      a = await run(t);
    expect((await call(audits.addFinding, {
      params: {
        auditId: a.id
      },
      body: {
        note: 'Wrong item',
        itemId: Number(other.items[0].id)
      }
    })).error.code).toBe('item_not_found');
    const body = {
      note: 'Spill',
      clientKey: 'same',
      itemId: Number(t.items[0].id)
    };
    expect((await call(audits.addFinding, {
      params: {
        auditId: a.id
      },
      body
    })).status).toBe(201);
    expect((await call(audits.addFinding, {
      params: {
        auditId: a.id
      },
      body
    })).data.replayed).toBe(true);
    expect((await call(audits.addFinding, {
      params: {
        auditId: a.id
      },
      body: {
        ...body,
        note: 'Changed'
      }
    })).status).toBe(409);
  });
  test('finding insertion and completion serialize on the same run', async () => {
    const t = await template(),
      a = await run(t);
    await scoreAll(t, a);
    const [finding, done] = await Promise.all([call(audits.addFinding, {
      params: {
        auditId: a.id
      },
      body: {
        note: 'Concurrent'
      }
    }), call(audits.completeAudit, {
      params: {
        auditId: a.id
      }
    })]);
    expect(done.error).toBeUndefined();
    if (finding.error) expect(finding.error.code).toBe('audit_closed');
    expect((await call(audits.addFinding, {
      params: {
        auditId: a.id
      },
      body: {
        note: 'Too late'
      }
    })).error.code).toBe('audit_closed');
  });
  test('corrective actions enforce assignment, store boundaries and ordered verification', async () => {
    const t = await template(),
      a = await run(t),
      f = await call(audits.addFinding, {
        params: {
          auditId: a.id
        },
        body: {
          note: 'Spill'
        }
      });
    const created = await call(audits.createCorrectiveAction, {
      params: {
        findingId: f.data.finding.id
      },
      body: {
        description: 'Clean it',
        assigneeId: staff,
        dueAt: '2026-10-30T12:00:00Z'
      }
    });
    expect(created.error).toBeUndefined();
    const params = {
      actionId: created.data.action.id
    };
    expect((await call(audits.updateCorrectiveAction, {
      params,
      body: {
        status: 'in_progress'
      },
      user: sibling
    })).status).toBe(403);
    expect((await call(audits.updateCorrectiveAction, {
      params,
      body: {
        status: 'verified'
      }
    })).error.code).toBe('action_transition_invalid');
    expect((await call(audits.updateCorrectiveAction, {
      params,
      body: {
        status: 'in_progress'
      },
      user: staff
    })).error).toBeUndefined();
    expect((await call(audits.updateCorrectiveAction, {
      params,
      body: {
        status: 'resolved'
      },
      user: staff
    })).error).toBeUndefined();
    expect((await call(audits.updateCorrectiveAction, {
      params,
      body: {
        status: 'verified'
      }
    })).error).toBeUndefined();
    expect((await call(audits.updateCorrectiveAction, {
      params,
      body: {
        status: 'in_progress'
      }
    })).status).toBe(409);
    expect((await call(audits.listCorrectiveActions, {
      user: sibling
    })).data.actions.some(r => r.id === params.actionId)).toBe(false);
  });
  test('checklist create, start and toggle execute through real transactions', async () => {
    const created = await call(ops.createChecklist, {
      body: {
        name: 'Opening',
        tasks: [{
          label: 'Doors'
        }]
      }
    });
    expect(created.error).toBeUndefined();
    const started = await call(ops.startRun, {
      params: {
        checklistId: created.data.checklist.id
      },
      body: {
        locationId: locationA
      }
    });
    expect(started.error).toBeUndefined();
    expect(Number(started.data.run.location_id)).toBe(Number(locationA));
    const item = started.data.run.items[0];
    const toggled = await call(ops.toggleRunItem, {
      params: {
        runId: started.data.run.id,
        itemId: item.id
      },
      body: {
        isDone: true
      }
    });
    expect(toggled.error).toBeUndefined();
    expect((await call(ops.getRun, {
      params: {
        runId: started.data.run.id
      },
      user: sibling
    })).status).toBe(403);
    expect((await call(ops.completeRun, {
      params: {
        runId: started.data.run.id
      },
      user: sibling
    })).status).toBe(403);
  });
  test('training archives retain assignments, attempts and version history', async () => {
    const m = await module(),
      a = await assign(m);
    await call(training.startAssignment,{params:{assignmentId:a.id},user:staff});
    const passed = await call(training.submitQuiz, {
      params: {
        assignmentId: a.id
      },
      body: {
        answers: [1],moduleVersion:1
      },
      user: staff
    });
    expect(passed.error).toBeUndefined();
    expect(passed.data.passed).toBe(true);
    expect((await call(training.deleteModule, {
      params: {
        moduleId: m.id
      }
    })).error).toBeUndefined();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM restaurant_training_completions WHERE assignment_id=$1', [a.id])).rows[0].n).toBe(1);
    expect((await call(training.startAssignment, {
      params: {
        assignmentId: a.id
      },
      user: staff
    })).status).toBe(404);
    expect((await call(training.listModules)).data.modules.some(row => row.id === m.id)).toBe(false);
  });
  test('training assignment rejects archived modules and invalid due dates', async () => {
    const m = await module();
    await call(training.deleteModule, {
      params: {
        moduleId: m.id
      }
    });
    expect((await call(training.assignModule, {
      params: {
        moduleId: m.id
      },
      body: {
        userId: staff
      }
    })).status).toBe(404);
    expect((await call(training.assignModule, {
      params: {
        moduleId: m.id
      },
      body: {
        userId: staff,
        dueAt: '2026-02-30T12:00:00Z'
      }
    })).status).toBe(400);
  });
  test('training staff, assignments and completions respect member store assignments', async () => {
    const m = await module();
    await assign(m, staff);
    await assign(m, sibling);
    const listed = await call(training.listStaff, {
      user: staff
    });
    expect(listed.data.staff.map(r => r.user_id)).toEqual([staff]);
    const assignments = await call(training.listAssignments, {
      user: staff
    });
    expect(assignments.data.assignments.every(r => r.user_id === staff)).toBe(true);
    expect((await call(training.assignModule, {
      params: {
        moduleId: m.id
      },
      body: {
        userId: sibling
      },
      user: staff
    })).status).toBe(404);
    expect((await call(training.updateModule, {
      params: {
        moduleId: m.id
      },
      body: {
        title: 'Cross-store edit'
      },
      user: staff
    })).status).toBe(403);
  });
  test('quiz answer validation does not consume attempts and repeated starts remain idempotent', async () => {
    const m = await module(),
      a = await assign(m);
    for (let i = 0; i < 2; i++) expect((await call(training.startAssignment, {
      params: {
        assignmentId: a.id
      },
      user: staff
    })).data.assignment.status).toBe('in_progress');
    for (const answers of [[true], [], [9], ['1']]) expect((await call(training.submitQuiz, {
      params: {
        assignmentId: a.id
      },
      body: {
        answers
      },
      user: staff
    })).status).toBe(400);
    expect((await pool.query('SELECT attempts_used FROM restaurant_training_assignments WHERE id=$1', [a.id])).rows[0].attempts_used).toBe(0);
  });
  test('concurrent training edits retain distinct consistent versions', async () => {
    const m = await module();
    const result = await Promise.all(['A', 'B'].map(title => call(training.updateModule, {
      params: {
        moduleId: m.id
      },
      body: {
        title,
        questions: [{
          question: title,
          options: ['No', 'Yes'],
          correct_index: 1
        }]
      }
    })));
    expect(result.every(r => !r.error)).toBe(true);
    const {
      rows
    } = await pool.query('SELECT version,title,questions FROM restaurant_training_module_versions WHERE module_id=$1 ORDER BY version', [m.id]);
    expect(rows.map(r => r.version)).toEqual([1, 2, 3]);
    expect(rows.slice(1).every(r => r.title === r.questions[0].question)).toBe(true);
  });
  test('recertification distinguishes newer passing completions with identical timestamps', async () => {
    const m = await module(),
      a = await assign(m);
    await pool.query("UPDATE restaurant_training_assignments SET status='completed' WHERE id=$1", [a.id]);
    await pool.query(`INSERT INTO restaurant_training_completions(assignment_id,score_pct,passed,answers,module_version,attempt_number,expires_at,completed_at)
    VALUES($1,100,TRUE,'[1]',1,1,NOW()-INTERVAL '1 day',NOW()),($1,100,TRUE,'[1]',1,2,NOW()+INTERVAL '1 day',NOW())`, [a.id]);
    const reopened = await lifecycle.expireCompletionsForRecertification(pool);
    expect(reopened.some(r => r.id === a.id)).toBe(false);
  });
  test('accounting retry payloads and status changes remain safe against real JSONB rows', async () => {
    await accounting.upsertIntegration(pool, {
      restaurantId,
      provider: 'xero',
      status: 'configured',
      externalCompanyId: 'synthetic-test',
      actorUserId: owner
    });
    const lines = [{
      date: '2026-10-01',
      account: '4000',
      debit: '0.00',
      credit: '10.00',
      currency: 'USD'
    }, {
      date: '2026-10-01',
      account: '1000',
      debit: '10.00',
      credit: '0.00',
      currency: 'USD'
    }];
    const input = {
      restaurantId,
      provider: 'xero',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      currencyCode: 'USD',
      idempotencyKey: crypto.randomUUID(),
      lines,
      actorUserId: owner
    };
    const concurrent = await Promise.all([accounting.queueExport(pool, input), accounting.queueExport(pool, input)]);
    expect(concurrent.filter(r => r.replayed === false)).toHaveLength(1);
    const first = concurrent[0];
    expect((await accounting.queueExport(pool, input)).replayed).toBe(true);
    await expect(accounting.queueExport(pool, {
      ...input,
      lines: lines.map(l => ({
        ...l,
        description: 'Changed'
      }))
    })).rejects.toMatchObject({
      code: 'accounting_idempotency_conflict'
    });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await accounting.updateExportStatus(c, {
        restaurantId,
        exportId: first.export.id,
        status: 'sending'
      });
      await accounting.updateExportStatus(c, {
        restaurantId,
        exportId: first.export.id,
        status: 'posted',
        externalBatchId: 'proof'
      });
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    expect((await accounting.updateExportStatus(pool, {
      restaurantId,
      exportId: first.export.id,
      status: 'posted',
      externalBatchId: 'proof'
    })).status).toBe('posted');
  });
  test('accounting body cannot redirect an integration write to another restaurant', async () => {
    const response = await call(accountingController.upsert, {
      body: {
        restaurantId: 999999,
        provider: 'quickbooks',
        status: 'configured',
        externalCompanyId: 'test'
      }
    });
    expect(response.error).toBeUndefined();
    expect(response.data.integration.restaurantId).toBe(Number(restaurantId));
  });
  test('HQ quality metrics use each store audit and checklist records', async () => {
    const t = await template(),
      a = await run(t, locationA);
    await scoreAll(t, a);
    await call(audits.completeAudit, {
      params: {
        auditId: a.id
      }
    });
    const rows = await hq.rollupLocations(pool, {
      restaurantId,
      locationIds: [Number(locationA), Number(locationB)],
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
      timezone: 'UTC'
    });
    expect(rows.healthRows.find(r => r.location_id === locationA).latest_audit_score_percent).not.toBeNull();
    expect(rows.healthRows.find(r => r.location_id === locationB).latest_audit_score_percent).toBeNull();
    expect(rows.complianceRows.find(r => r.location_id === locationA).checklist_runs).toBeGreaterThan(0);
    expect(rows.complianceRows.find(r => r.location_id === locationB).checklist_runs).toBe(0);
  });
  test.each(['audit', 'training'])('required %s activity logs roll back the content mutation on failure', async kind => {
    await pool.query("ALTER TABLE business_audit_log ADD CONSTRAINT reject_fifty_test CHECK(COALESCE(after_state->>'title',after_state->>'name','') <> 'Fail audit')");
    try {
      const result = kind === 'audit' ? await call(audits.createTemplate, {
        body: {
          name: 'Fail audit',
          items: [{
            label: 'One'
          }]
        }
      }) : await call(training.createModule, {
        body: {
          title: 'Fail audit'
        }
      });
      expect(result.error.code).toBe('23514');
      const table = kind === 'audit' ? 'restaurant_audit_templates' : 'restaurant_training_modules',
        column = kind === 'audit' ? 'name' : 'title';
      expect((await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE restaurant_id=$1 AND ${column}='Fail audit'`, [restaurantId])).rows[0].n).toBe(0);
    } finally {
      await pool.query('ALTER TABLE business_audit_log DROP CONSTRAINT reject_fifty_test');
    }
  });
  test('certificate expiry alerts acknowledge only confirmed deliveries', async () => {
    const {
      rows: [doc]
    } = await pool.query("INSERT INTO restaurant_staff_documents(restaurant_id,user_id,doc_type,title,storage_key,expires_on) VALUES($1,$2,'certificate_other','Synthetic certificate','synthetic-test-key',CURRENT_DATE+1) RETURNING id", [restaurantId, staff]);
    sendNotification.mockResolvedValue({
      success: false
    });
    await lifecycle.sendCertificateExpiryAlerts(pool);
    expect((await pool.query('SELECT expiry_alert_sent_at FROM restaurant_staff_documents WHERE id=$1', [doc.id])).rows[0].expiry_alert_sent_at).toBeNull();
    sendNotification.mockResolvedValue({
      success: true
    });
    await lifecycle.sendCertificateExpiryAlerts(pool);
    expect((await pool.query('SELECT expiry_alert_sent_at FROM restaurant_staff_documents WHERE id=$1', [doc.id])).rows[0].expiry_alert_sent_at).not.toBeNull();
  });
  test('migration pins legacy open audit items once and preserves the snapshot on replay', async () => {
    const t = await template();
    const {
      rows: [a]
    } = await pool.query('INSERT INTO restaurant_audits(template_id,restaurant_id,auditor_id,location_id) VALUES($1,$2,$3,$4) RETURNING *', [t.id, restaurantId, owner, locationA]);
    const sql = require('fs').readFileSync(require('path').join(__dirname, '../migrations/995_restaurant_quality_run_integrity.sql'), 'utf8');
    await pool.query(sql);
    const first = (await pool.query('SELECT snapshot_items FROM restaurant_audits WHERE id=$1', [a.id])).rows[0].snapshot_items;
    expect(first.map(i => i.id)).toEqual(t.items.map(i => Number(i.id)));
    await call(audits.updateTemplate, {
      params: {
        templateId: t.id
      },
      body: {
        items: [{
          label: 'New policy'
        }]
      }
    });
    await pool.query(sql);
    expect((await pool.query('SELECT snapshot_items FROM restaurant_audits WHERE id=$1', [a.id])).rows[0].snapshot_items).toEqual(first);
    await scoreAll(t, a);
    expect((await call(audits.completeAudit, {
      params: {
        auditId: a.id
      }
    })).error).toBeUndefined();
  });
});
