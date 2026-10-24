"use strict";

// This suite requires an explicitly created, fully migrated disposable database.
jest.unmock("pg");
jest.unmock("../utils/transaction");
jest.mock("../db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));
jest.mock("../services/scopeModel", () => ({
  resolveRestaurantAccess: jest.fn(),
}));
jest.mock("../services/notificationService", () => ({
  sendNotification: jest.fn(async () => ({
    success: true,
  })),
}));
const crypto = require("crypto");
const { Pool } = require("pg");
const db = require("../db");
const scopeModel = require("../services/scopeModel");
const permissions = require("../services/permissionsService");
const audits = require("../controllers/restaurantAuditsController");
const training = require("../controllers/restaurantTrainingController");
const ops = require("../controllers/restaurantOpsController");
const accounting = require("../services/restaurantAccountingService");
const accountingController = require("../controllers/restaurantAccountingController");
const hq = require("../services/restaurantHQService");
const lifecycle = require("../services/restaurantTrainingLifecycle");
const { sendNotification } = require("../services/notificationService");
jest.mock("../utils/storage", () => ({
  uploadFile: jest.fn(
    async () => `restaurants/test/${require("crypto").randomUUID()}.png`,
  ),
  getSignedDownloadUrl: jest.fn(async (key) => `/synthetic-signed/${key}`),
  deleteFile: jest.fn(async () => {}),
  normalizeStorageKey: (key) => key,
  knownObjectKeyFromUrl: () => null,
}));
jest.mock("../services/smsNotificationService", () => ({
  sendTransactionalSMS: jest.fn(async () => ({ success: true })),
}));
const documents = require("../controllers/restaurantStaffDocumentsController");
const hosting = require("../controllers/restaurantHostingController");
const team = require("../controllers/restaurantTeamCommsController");
const support = require("../controllers/restaurantSupportController");
const storage = require("../utils/storage");
const { sendTransactionalSMS } = require("../services/smsNotificationService");
const url = process.env.FRANCHISE_HUNDRED_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
    u.pathname !== "/franchise_hundred_test"
  )
    throw new Error(
      "Requires disposable migrated loopback franchise_hundred_test",
    );
}
(url ? describe : describe.skip)(
  "hundred-fix full-schema PostgreSQL regressions",
  () => {
    let pool,
      owner,
      staff,
      sibling,
      businessId,
      restaurantId,
      locationA,
      locationB,
      membership;
    async function call(
      handler,
      {
        body = {},
        params = {},
        query = {},
        user = owner,
        key = crypto.randomUUID(),
        file = undefined,
      } = {},
    ) {
      const req = {
        params: {
          restaurantId: String(restaurantId),
          ...params,
        },
        body,
        query,
        user: {
          id: user,
        },
        headers: {},
        file,
        get: () => key,
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
        },
      };
      let error;
      await handler(req, res, (e) => {
        error = e;
      });
      return {
        status: error?.statusCode || res.statusCode,
        error,
        data: res.data,
      };
    }
    async function template() {
      const r = await call(audits.createTemplate, {
        body: {
          name: `Inspection ${crypto.randomUUID()}`,
          items: [
            {
              label: "Floor",
              maxScore: 5,
            },
            {
              label: "Sink",
              maxScore: 5,
              weight: 2,
            },
          ],
        },
      });
      if (r.error) throw r.error;
      return r.data.template;
    }
    async function run(t, locationId = locationA) {
      const r = await call(audits.startAudit, {
        body: {
          locationId,
        },
        params: {
          templateId: t.id,
        },
      });
      if (r.error) throw r.error;
      return r.data.audit;
    }
    async function scoreAll(t, a) {
      for (const item of t.items) {
        const r = await call(audits.scoreItem, {
          body: {
            itemId: Number(item.id),
            score: 4,
          },
          params: {
            auditId: a.id,
          },
        });
        if (r.error) throw r.error;
      }
    }
    async function module(body = {}) {
      const r = await call(training.createModule, {
        body: {
          title: `Safety ${crypto.randomUUID()}`,
          questions: [
            {
              question: "Which?",
              options: ["Wrong", "Right"],
              correct_index: 1,
            },
          ],
          ...body,
        },
      });
      if (r.error) throw r.error;
      return r.data.module;
    }
    async function assign(m, userId = staff) {
      const r = await call(training.assignModule, {
        params: {
          moduleId: m.id,
        },
        body: {
          userId,
        },
      });
      if (r.error) throw r.error;
      return r.data.assignment;
    }
    beforeAll(async () => {
      pool = new Pool({
        connectionString: url,
        max: 8,
      });
      db.query.mockImplementation((...args) => pool.query(...args));
      db.connect.mockImplementation(() => pool.connect());
      [owner, staff, sibling] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      for (const id of [owner, staff, sibling])
        await pool.query(
          "INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic-test-hash','Test','Staff')",
          [id, `${id}@example.test`],
        );
      ({
        rows: [{ id: businessId }],
      } = await pool.query(
        "INSERT INTO businesses(user_id,business_name) VALUES($1,$2) RETURNING id",
        [owner, `Fifty ${crypto.randomUUID()}`],
      ));
      ({
        rows: [{ id: restaurantId }],
      } = await pool.query(
        "INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone) VALUES($1,$2,'Fifty Test','America/New_York') RETURNING id",
        [businessId, owner],
      ));
      ({
        rows: [{ id: locationA }],
      } = await pool.query(
        "SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE",
        [restaurantId],
      ));
      ({
        rows: [{ id: locationB }],
      } = await pool.query(
        "INSERT INTO restaurant_locations(restaurant_id,name,is_primary,status,timezone) VALUES($1,'Sibling',FALSE,'active','America/New_York') RETURNING id",
        [restaurantId],
      ));
      for (const [user, location] of [
        [staff, locationA],
        [sibling, locationB],
      ]) {
        const {
          rows: [m],
        } = await pool.query(
          "INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,'employee','active') RETURNING id",
          [businessId, owner, user, `${user}@example.test`],
        );
        if (user === staff) membership = m.id;
        await pool.query(
          "INSERT INTO restaurant_location_memberships(restaurant_id,location_id,membership_id,status) VALUES($1,$2,$3,'active')",
          [restaurantId, location, m.id],
        );
        await pool.query(
          "INSERT INTO membership_permission_overrides(membership_id,permission_id,effect) SELECT $1,id,'allow' FROM team_permissions WHERE code=ANY($2::text[])",
          [
            m.id,
            [
              "crew.manage",
              "audit.view",
              "audit.manage",
              "settings.view",
              "settings.manage",
              "restaurant.manage",
              "support.view",
              "support.manage",
              "pos.use",
              "payroll.view",
              "payroll.manage",
            ],
          ],
        );
      }
      scopeModel.resolveRestaurantAccess.mockImplementation(
        async (user, id) => {
          if (Number(id) !== Number(restaurantId))
            throw new Error("Unexpected restaurant");
          const {
            rows: [r],
          } = await pool.query("SELECT * FROM food_restaurants WHERE id=$1", [
            restaurantId,
          ]);
          const {
            rows: [member],
          } = await pool.query(
            "SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2",
            [businessId, user],
          );
          return {
            ...r,
            effective_role: user === owner ? "owner" : "employee",
            effective_membership_id: member?.id || null,
          };
        },
      );
    }, 30000);
    beforeEach(() => {
      permissions.invalidateCache();
      jest.clearAllMocks();
      sendTransactionalSMS.mockResolvedValue({ success: true });
      sendNotification.mockResolvedValue({
        success: true,
      });
    });
    afterAll(async () => {
      if (pool) {
        await pool
          .query("DELETE FROM businesses WHERE id=$1", [businessId])
          .catch(() => {});
        await pool
          .query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
            [owner, staff, sibling],
          ])
          .catch(() => {});
        await pool.end();
      }
    });
    const png = {
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      mimetype: "image/png",
      originalname: "synthetic.png",
    };
    async function checklist(body = {}) {
      const result = await call(ops.createChecklist, {
        body: {
          name: "Safety",
          tasks: [
            {
              label: "Check",
              requiresNote: true,
              instructions: "Inspect safely",
            },
          ],
          ...body,
        },
      });
      if (result.error) throw result.error;
      return result.data.checklist;
    }
    async function sop(body = {}) {
      const result = await call(ops.createSop, {
        body: { title: "Safe procedure", body: "Original body", ...body },
      });
      if (result.error) throw result.error;
      return result.data.sop;
    }
    async function table(locationId = locationA) {
      const r = await call(hosting.createTable, {
        body: { name: `T-${crypto.randomUUID()}`, capacity: 4, locationId },
      });
      if (r.error) throw r.error;
      return r.data.table;
    }
    async function walk(body = {}, key = crypto.randomUUID()) {
      const r = await call(hosting.createWaitlistEntry, {
        body: {
          guestName: "Test guest",
          partySize: 2,
          quotedWaitMin: 10,
          locationId: locationA,
          ...body,
        },
        key,
      });
      if (r.error) throw r.error;
      return r.data.entry;
    }
    async function upload(user = staff, extra = {}) {
      return call(documents.uploadDocument, {
        body: {
          docType: "certificate_other",
          title: "Test certificate",
          userId: user,
          issuedOn: "2026-01-01",
          expiresOn: "2027-01-01",
          ...extra,
        },
        file: png,
        key: crypto.randomUUID(),
      });
    }
    async function order(locationId = locationA) {
      return (
        await pool.query(
          `INSERT INTO food_orders(restaurant_id,business_id,location_id,fulfillment_type,guest_name,queue_number,total_cents,subtotal_cents,currency_code,status,payment_status) VALUES($1,$2,$3,'dine_in','Test',nextval('food_orders_id_seq'),1000,1000,'USD','received','unpaid') RETURNING *`,
          [restaurantId, businessId, locationId],
        )
      ).rows[0];
    }

    test("checklist validation rejects silently truncated tasks, invalid enums, booleans and partial sort values", async () => {
      for (const body of [
        { tasks: Array.from({ length: 51 }, () => ({ label: "x" })) },
        { tasks: [{ label: "" }] },
        { checklistType: "nonsense" },
        { tasks: [{ label: "x", requiresNote: [] }] },
        { sortOrder: "2oops" },
      ]) {
        expect(
          (
            await call(ops.createChecklist, {
              body: { name: "Safety", ...body },
            })
          ).status,
        ).toBe(400);
      }
      const c = await checklist();
      expect(
        (
          await call(ops.updateChecklist, {
            params: { checklistId: c.id },
            body: { isActive: "maybe" },
          })
        ).status,
      ).toBe(400);
    });
    test("checklist starts reject empty/inactive templates, bind retry identity and retain instructions", async () => {
      const empty = await checklist({ tasks: [] });
      expect(
        (
          await call(ops.startRun, {
            params: { checklistId: empty.id },
            body: { locationId: locationA },
          })
        ).error.code,
      ).toBe("checklist_empty");
      const c = await checklist();
      await call(ops.updateChecklist, {
        params: { checklistId: c.id },
        body: { isActive: false },
      });
      expect(
        (
          await call(ops.startRun, {
            params: { checklistId: c.id },
            body: { locationId: locationA },
          })
        ).status,
      ).toBe(404);
      await call(ops.updateChecklist, {
        params: { checklistId: c.id },
        body: { isActive: true },
      });
      const request = {
        params: { checklistId: c.id },
        body: { locationId: locationA },
        key: crypto.randomUUID(),
      };
      const a = await call(ops.startRun, request),
        b = await call(ops.startRun, request);
      expect(a.error).toBeUndefined();
      expect(b.data.run.id).toBe(a.data.run.id);
      expect(a.data.run.items[0].instructions).toBe("Inspect safely");
      expect(
        (
          await call(ops.startRun, {
            ...request,
            body: { locationId: locationB },
          })
        ).status,
      ).toBe(409);
    });
    test("required task/note completion, repeat completion and archival preserve runs and actor history", async () => {
      const c = await checklist(),
        r = await call(ops.startRun, {
          params: { checklistId: c.id },
          body: { locationId: locationA },
        });
      if (r.error) throw r.error;
      const run = r.data.run,
        params = { runId: run.id, itemId: run.items[0].id };
      expect((await call(ops.completeRun, { params })).error.code).toBe(
        "checklist_incomplete",
      );
      expect(
        (await call(ops.toggleRunItem, { params, body: { isDone: true } }))
          .error.code,
      ).toBe("note_required");
      expect(
        (
          await call(ops.toggleRunItem, {
            params,
            body: { isDone: true, note: "Checked" },
          })
        ).error,
      ).toBeUndefined();
      const completed = await call(ops.completeRun, { params });
      expect(completed.error).toBeUndefined();
      expect(completed.data.run.status).toBe("completed");
      expect(
        (await call(ops.completeRun, { params })).data.run.completed_at,
      ).toEqual(completed.data.run.completed_at);
      expect(
        (await call(ops.deleteChecklist, { params: { checklistId: c.id } }))
          .error,
      ).toBeUndefined();
      expect((await call(ops.getRun, { params })).data.run.items[0].note).toBe(
        "Checked",
      );
      expect(
        (await call(ops.listChecklists)).data.checklists.some(
          (row) => row.id === c.id,
        ),
      ).toBe(false);
      const events = await pool.query(
        "SELECT id FROM business_audit_log WHERE business_id=$1 AND action='restaurant.restaurant_checklist_run_items.changed'",
        [businessId],
      );
      expect(events.rows.length).toBeGreaterThan(0);
    });
    test("SOP draft isolation, immutable bodies, no-op version stability and archival retain acknowledgements", async () => {
      const draft = await sop({ isPublished: false, body: "" });
      expect(
        (await call(ops.listSops, { user: staff })).data.sops.some(
          (row) => row.id === draft.id,
        ),
      ).toBe(true);
      // Staff without authoring authority cannot retrieve unpublished bodies.
      await pool.query(
        "UPDATE membership_permission_overrides SET effect='deny' WHERE membership_id=$1 AND permission_id=(SELECT id FROM team_permissions WHERE code='crew.manage')",
        [membership],
      );
      permissions.invalidateCache();
      expect(
        (await call(ops.listSops, { user: staff })).data.sops.some(
          (row) => row.id === draft.id,
        ),
      ).toBe(false);
      await pool.query(
        "UPDATE membership_permission_overrides SET effect='allow' WHERE membership_id=$1 AND permission_id=(SELECT id FROM team_permissions WHERE code='crew.manage')",
        [membership],
      );
      permissions.invalidateCache();
      expect(
        (await call(ops.createSop, { body: { title: "Empty", body: "" } }))
          .status,
      ).toBe(400);
      const s = await sop();
      const ack = await call(documents.acknowledgeSop, {
        params: { sopId: s.id },
        body: { sopVersion: s.version },
        file: png,
        user: staff,
      });
      expect(ack.error).toBeUndefined();
      expect(
        (
          await call(ops.updateSop, {
            params: { sopId: s.id },
            body: { body: s.body },
          })
        ).data.sop.version,
      ).toBe(s.version);
      await call(ops.updateSop, {
        params: { sopId: s.id },
        body: { body: "Revised body" },
      });
      await call(ops.deleteSop, { params: { sopId: s.id } });
      const history = await call(documents.listSopAcknowledgements, {
        query: { sopId: s.id },
        user: staff,
      });
      expect(history.error).toBeUndefined();
      expect(history.data.acknowledgements[0].signed_body).toBe(
        "Original body",
      );
      expect(history.data.acknowledgements[0].is_current).toBe(false);
    });
    test("document inputs fail before storage writes, including impossible/inverted dates, malformed UUIDs and ids", async () => {
      for (const extra of [
        { issuedOn: "2026-02-30" },
        { issuedOn: "2028-01-01", expiresOn: "2027-01-01" },
        { title: "x".repeat(201) },
        { userId: "bad-uuid" },
      ])
        expect((await upload(staff, extra)).status).toBe(400);
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(
        (
          await call(documents.listDocuments, {
            query: { expiringDays: "1e9" },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(documents.verifyDocument, {
            params: { documentId: "1e2" },
          })
        ).status,
      ).toBe(400);
    });
    test("document pages and all manager mutation paths enforce assigned stores", async () => {
      const a = await upload(staff),
        b = await upload(sibling);
      expect(a.error).toBeUndefined();
      expect(b.error).toBeUndefined();
      const listed = await call(documents.listDocuments, {
        user: staff,
        query: { limit: 1 },
      });
      expect(listed.error).toBeUndefined();
      expect(listed.data.documents.every((row) => row.user_id === staff)).toBe(
        true,
      );
      for (const handler of [
        documents.verifyDocument,
        documents.deleteDocument,
      ])
        expect(
          (
            await call(handler, {
              user: staff,
              params: { documentId: b.data.document.id },
              body: { verificationStatus: "verified" },
            })
          ).status,
        ).toBe(404);
      expect(
        (
          await call(documents.uploadDocument, {
            user: staff,
            body: { userId: sibling, title: "x", docType: "other" },
            file: png,
          })
        ).status,
      ).toBe(404);
    });
    test("document uploads deduplicate concurrent retries and reject a changed payload", async () => {
      const req = {
        body: { docType: "other", title: "Concurrent", userId: staff },
        file: png,
        key: crypto.randomUUID(),
      };
      const [a, b] = await Promise.all([
        call(documents.uploadDocument, req),
        call(documents.uploadDocument, req),
      ]);
      expect(a.error).toBeUndefined();
      expect(b.error).toBeUndefined();
      expect(a.data.document.id).toBe(b.data.document.id);
      expect(
        (
          await call(documents.uploadDocument, {
            ...req,
            body: { ...req.body, title: "Changed" },
          })
        ).status,
      ).toBe(409);
    });
    test("document review clears pending verification stamps and deletion durably queues blob cleanup", async () => {
      const created = await upload(staff);
      const id = created.data.document.id;
      expect(
        (
          await call(documents.verifyDocument, {
            params: { documentId: id },
            body: { verificationStatus: "verified" },
          })
        ).data.document.verified_by,
      ).toBe(owner);
      const pending = await call(documents.verifyDocument, {
        params: { documentId: id },
        body: { verificationStatus: "pending" },
      });
      expect(pending.error).toBeUndefined();
      expect(pending.data.document.verified_by).toBeNull();
      expect(pending.data.document.verified_at).toBeNull();
      expect(
        (await call(documents.deleteDocument, { params: { documentId: id } }))
          .error,
      ).toBeUndefined();
      const {
        rows: [row],
      } = await pool.query(
        "SELECT d.deleted_at,q.id FROM restaurant_staff_documents d JOIN storage_deletion_queue q ON q.storage_key=d.storage_key WHERE d.id=$1",
        [id],
      );
      expect(row.deleted_at).not.toBeNull();
      expect(row.id).toBeTruthy();
      expect(
        (await call(documents.listDocuments)).data.documents.some(
          (d) => d.id === id,
        ),
      ).toBe(false);
    });
    test("SOP signatures reject stale versions and invalid image formats; duplicate/concurrent retries retain the first signature", async () => {
      const s = await sop(),
        req = {
          params: { sopId: s.id },
          body: { sopVersion: s.version },
          user: staff,
          file: png,
        };
      const [a, b] = await Promise.all([
        call(documents.acknowledgeSop, req),
        call(documents.acknowledgeSop, req),
      ]);
      expect(a.error).toBeUndefined();
      expect(b.error).toBeUndefined();
      expect(a.data.acknowledgement.signature_storage_key).toBe(
        b.data.acknowledgement.signature_storage_key,
      );
      expect(
        (
          await call(documents.acknowledgeSop, {
            ...req,
            file: { ...png, buffer: Buffer.from("not an image") },
          })
        ).status,
      ).toBe(400);
      await call(ops.updateSop, {
        params: { sopId: s.id },
        body: { body: "New instructions" },
      });
      expect((await call(documents.acknowledgeSop, req)).error.code).toBe(
        "sop_version_conflict",
      );
      const queued = await pool.query(
        "SELECT id FROM storage_deletion_queue WHERE reason='restaurant-unused-upload'",
      );
      expect(queued.rows.length).toBeGreaterThan(0);
    });
    test("waitlist retries, strict quoted waits and terminal transition rules", async () => {
      const key = crypto.randomUUID(),
        a = await walk({}, key),
        b = await walk({}, key);
      expect(a.id).toBe(b.id);
      for (const quotedWaitMin of [true, [], 1441, "2oops"])
        expect(
          (
            await call(hosting.createWaitlistEntry, {
              body: {
                locationId: locationA,
                guestName: "Bad",
                partySize: 2,
                quotedWaitMin,
              },
              key: crypto.randomUUID(),
            })
          ).status,
        ).toBe(400);
      expect(
        (
          await call(hosting.updateWaitlistEntry, {
            params: { entryId: a.id },
            body: { status: "cancelled" },
          })
        ).error,
      ).toBeUndefined();
      expect(
        (
          await call(hosting.updateWaitlistEntry, {
            params: { entryId: a.id },
            body: { status: "waiting" },
          })
        ).status,
      ).toBe(409);
    });
    test("an active SMS claim fences cancellation until acknowledged; notified guests can be seated", async () => {
      const entry = await walk({ guestPhone: "+15555550101" }),
        t = await table();
      let deliver;
      sendTransactionalSMS.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      );
      const sending = call(hosting.notifyWaitlistEntry, {
        params: { entryId: entry.id },
      });
      for (let i = 0; i < 100 && !deliver; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(deliver).toBeTruthy();
      expect(
        (
          await call(hosting.updateWaitlistEntry, {
            params: { entryId: entry.id },
            body: { status: "cancelled" },
          })
        ).error.code,
      ).toBe("waitlist_notification_in_progress");
      deliver({ success: true, sid: "synthetic" });
      expect((await sending).error).toBeUndefined();
      const seat = await call(hosting.setSeating, {
        params: { tableId: t.id },
        body: { waitlistId: entry.id },
      });
      expect(seat.error).toBeUndefined();
      expect(Number(seat.data.seating.waitlist_id)).toBe(Number(entry.id));
      const {
        rows: [updated],
      } = await pool.query(
        "SELECT status,table_id FROM restaurant_waitlist_entries WHERE id=$1",
        [entry.id],
      );
      expect(updated.status).toBe("seated");
      expect(Number(updated.table_id)).toBe(Number(t.id));
    });
    test("table occupancy serializes competing parties and validates POS/store linkage", async () => {
      const t = await table(),
        a = await walk(),
        b = await walk(),
        ticket = await order(),
        wrong = await order(locationB);
      const results = await Promise.all([
        call(hosting.setSeating, {
          params: { tableId: t.id },
          body: { waitlistId: a.id },
        }),
        call(hosting.setSeating, {
          params: { tableId: t.id },
          body: { waitlistId: b.id },
        }),
      ]);
      expect(results.filter((r) => !r.error)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(1);
      expect(
        (
          await call(hosting.setSeating, {
            params: { tableId: t.id },
            body: { orderId: wrong.id },
          })
        ).status,
      ).toBe(409);
      const linked = await call(hosting.setSeating, {
        params: { tableId: t.id },
        body: { orderId: ticket.id },
      });
      expect(linked.error).toBeUndefined();
      expect(Number(linked.data.seating.order_id)).toBe(Number(ticket.id));
      expect(
        (
          await call(hosting.setSeating, {
            params: { tableId: t.id },
            body: { action: "release" },
          })
        ).error,
      ).toBeUndefined();
    });
    test("the same guest cannot occupy two tables through concurrent requests", async () => {
      const entry = await walk(),
        a = await table(),
        b = await table();
      const results = await Promise.all([
        call(hosting.setSeating, {
          params: { tableId: a.id },
          body: { waitlistId: entry.id },
        }),
        call(hosting.setSeating, {
          params: { tableId: b.id },
          body: { waitlistId: entry.id },
        }),
      ]);
      expect(results.filter((r) => !r.error)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    });
    test("reservation pages return newer records and explicit date/store filters", async () => {
      for (let i = 0; i < 3; i++)
        await pool.query(
          "INSERT INTO restaurant_reservations(restaurant_id,location_id,guest_name,party_size,starts_at,ends_at) VALUES($1,$2,'Booking',2,$3::timestamptz,$3::timestamptz+INTERVAL '1 hour')",
          [restaurantId, locationA, `2027-01-0${i + 1}T12:00:00Z`],
        );
      const first = await call(hosting.listReservations, {
        query: {
          locationId: locationA,
          limit: 1,
          from: "2027-01-01T00:00:00Z",
          to: "2027-01-04T00:00:00Z",
        },
      });
      expect(first.error).toBeUndefined();
      expect(first.data.hasMore).toBe(true);
      const next = await call(hosting.listReservations, {
        query: {
          locationId: locationA,
          limit: 1,
          offset: 1,
          from: "2027-01-01T00:00:00Z",
          to: "2027-01-04T00:00:00Z",
        },
      });
      expect(next.data.reservations[0].id).not.toBe(
        first.data.reservations[0].id,
      );
    });
    test("training grades the displayed version after an edit and refuses an unbound version", async () => {
      const m = await module(),
        a = await assign(m);
      const started = await call(training.startAssignment, {
        params: { assignmentId: a.id },
        user: staff,
      });
      expect(started.error).toBeUndefined();
      expect(
        started.data.assignment.module.questions[0].correct_index,
      ).toBeUndefined();
      await call(training.updateModule, {
        params: { moduleId: m.id },
        body: {
          questions: [
            {
              question: "Changed",
              options: ["Right now", "Wrong now"],
              correct_index: 0,
            },
          ],
        },
      });
      expect(
        (
          await call(training.submitQuiz, {
            params: { assignmentId: a.id },
            user: staff,
            body: { answers: [1], moduleVersion: 99 },
          })
        ).error.code,
      ).toBe("training_version_conflict");
      const result = await call(training.submitQuiz, {
        params: { assignmentId: a.id },
        user: staff,
        body: { answers: [1], moduleVersion: 1 },
      });
      expect(result.error).toBeUndefined();
      expect(result.data.passed).toBe(true);
      expect(result.data.completion.module_version).toBe(1);
    });
    test("assigned managers cannot broadcast brand announcements or create/read global logbook entries", async () => {
      expect(
        (
          await call(team.createAnnouncement, {
            user: staff,
            body: { title: "Brand announcement" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(team.createLogbookEntry, {
            user: staff,
            body: { body: "Global note" },
          })
        ).status,
      ).toBe(403);
      const created = await call(team.createLogbookEntry, {
        body: { body: "Owner global note" },
      });
      expect(created.error).toBeUndefined();
      expect(
        (await call(team.listLogbook, { user: staff })).data.entries.some(
          (row) => row.id === created.data.entry.id,
        ),
      ).toBe(false);
    });

    test("HQ sales use partial-refund facts and each store business day", async () => {
      const ticket = await order(locationB);
      await pool.query(
        "UPDATE restaurant_locations SET timezone='Pacific/Honolulu',day_start_hour=4 WHERE id=$1",
        [locationB],
      );
      await pool.query(
        "UPDATE food_orders SET payment_status='paid',created_at='2027-01-02T10:30:00Z' WHERE id=$1",
        [ticket.id],
      );
      await pool.query(
        "INSERT INTO restaurant_pos_payments(restaurant_id,food_order_id,payment_type,amount_cents,status) VALUES($1,$2,'cash',1000,'recorded'),($1,$2,'refund',200,'recorded')",
        [restaurantId, ticket.id],
      );
      const report = await hq.rollupLocations(pool, {
        restaurantId,
        locationIds: [locationB],
        from: "2027-01-01",
        to: "2027-01-02",
        timezone: "America/New_York",
      });
      expect(Number(report.salesRows[0].net_collected_cents)).toBe(800);
      const otherDay = await hq.rollupLocations(pool, {
        restaurantId,
        locationIds: [locationB],
        from: "2027-01-02",
        to: "2027-01-03",
        timezone: "America/New_York",
      });
      expect(otherDay.salesRows).toHaveLength(0);
    });
    test("HQ menu preview includes inherited resets, rejects stale revisions, and verifies the store-status schema", async () => {
      const {
        rows: [item],
      } = await pool.query(
        "INSERT INTO food_menu_items(restaurant_id,name,price_cents) VALUES($1,'Item',1000) RETURNING id",
        [restaurantId],
      );
      await pool.query(
        "INSERT INTO restaurant_store_menu_overrides(restaurant_id,location_id,menu_item_id,price_cents) VALUES($1,$2,$3,1200)",
        [restaurantId, locationB, item.id],
      );
      const request = {
          restaurantId,
          sourceLocationId: locationA,
          targetLocationIds: [locationB],
        },
        preview = await hq.previewMenuOverrides(pool, request);
      expect(
        preview.changes.find((row) => row.itemId === Number(item.id)).after,
      ).toBeNull();
      await pool.query(
        "UPDATE restaurant_store_menu_overrides SET price_cents=1300 WHERE restaurant_id=$1 AND location_id=$2",
        [restaurantId, locationB],
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await expect(
          hq.publishMenuOverrides(client, {
            ...request,
            expectedRevision: preview.revision,
          }),
        ).rejects.toMatchObject({ code: "menu_preview_stale" });
        await client.query("ROLLBACK");
        await client.query("BEGIN");
        await hq.publishMenuOverrides(client, request);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      expect(
        (
          await pool.query(
            "SELECT menu_item_id FROM restaurant_store_menu_overrides WHERE restaurant_id=$1 AND location_id=$2 AND menu_item_id=$3",
            [restaurantId, locationB, item.id],
          )
        ).rows,
      ).toHaveLength(0);
      await expect(
        pool.query(
          "UPDATE restaurant_locations SET status='archived' WHERE id=$1",
          [locationB],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    test("support case lists, details, mutations and summary exclude sibling stores", async () => {
      const a = await order(),
        b = await order(locationB),
        ids = [];
      for (const ticket of [a, b])
        ids.push(
          (
            await pool.query(
              "INSERT INTO restaurant_support_cases(public_case_number,restaurant_id,order_id,customer_user_id,issue_type,title,description) VALUES($1,$2,$3,$4,'other','Test case','Synthetic test') RETURNING id",
              [
                crypto.randomUUID().slice(0, 25),
                restaurantId,
                ticket.id,
                staff,
              ],
            )
          ).rows[0].id,
        );
      const listed = await call(support.listRestaurantCases, { user: staff });
      expect(listed.error).toBeUndefined();
      expect(listed.data.cases.some((row) => row.id === ids[0])).toBe(true);
      expect(listed.data.cases.some((row) => row.id === ids[1])).toBe(false);
      expect(
        (
          await call(support.getRestaurantCase, {
            user: staff,
            params: { caseId: ids[1] },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(support.restaurantInternalNote, {
            user: staff,
            params: { caseId: ids[1] },
            body: { message: "Wrong store" },
          })
        ).status,
      ).toBe(403);
      const summary = await call(support.getRestaurantSummary, { user: staff });
      expect(summary.error).toBeUndefined();
      expect(summary.data.summary.unresolved_cases).toBe(1);
    });
  },
);
