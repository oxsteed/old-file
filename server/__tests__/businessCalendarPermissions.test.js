'use strict';

const { requireBusinessCalendarAccess, calendarScopeClause } = require('../middleware/requireBusinessCalendarAccess');
const { mockQuery, resetMocks } = require('./setup');
const appointments = require('../controllers/businessAppointmentsController');
const self = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
function grant(permissions, action = 'view', role = 'employee') {
  const req = { user: { id: self }, business: { id: 4 }, businessRole: role,
    permissions: new Set(['business.view', ...permissions]), params: { businessId: '4', appointmentId: '7' }, query: {}, body: {} };
  const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  requireBusinessCalendarAccess(action)(req, res, next);
  return { req, res, next };
}
beforeEach(resetMocks);

test('calendar permissions default to denial, including a manager with revoked permissions', () => {
  for (const role of ['owner', 'manager', 'representative', 'employee']) {
    const f = grant([], 'view', role);
    expect(f.res.status).toHaveBeenCalledWith(403);
    expect(f.next).not.toHaveBeenCalled();
  }
});

test('self access binds the authenticated user and exposes no payment or assignment capability', () => {
  const f = grant(['calendar.view_self', 'calendar.manage_self'], 'manage');
  expect(f.next).toHaveBeenCalledTimes(1);
  expect(f.req.calendarAccess).toEqual({ all: false, userId: self, canManageAll: false, canManageSelf: true, canCreate: false, canRecordPayment: false });
  expect(f.res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  const params = [4];
  expect(calendarScopeClause(f.req, params, 'ba.staff_id')).toBe(' AND ba.staff_id = $2::uuid');
  expect(params).toEqual([4, self]);
});

test('view-all does not authorize managing another employee or recording money', () => {
  const permissions = ['calendar.view_all','calendar.manage_self','invoices.create'];
  expect(grant(permissions, 'manage').req.calendarAccess.all).toBe(false);
  for (const action of ['manageAll', 'payment']) expect(grant(permissions, action).res.status).toHaveBeenCalledWith(403);
  expect(grant(['calendar.view_all'], 'manage').res.status).toHaveBeenCalledWith(403);
});

test('recording a payment requires the finance role and both calendar and invoice permissions', () => {
  const p = ['calendar.view_all','calendar.manage_all','invoices.create'];
  expect(grant(p, 'payment', 'manager').next).toHaveBeenCalledTimes(1);
  expect(grant(p, 'payment', 'employee').res.status).toHaveBeenCalledWith(403);
  expect(grant(p.slice(0,2), 'payment', 'manager').res.status).toHaveBeenCalledWith(403);
});

test('list rows and totals share assignment, status and date filters even when a different staff ID is requested', async () => {
  const f = grant(['calendar.view_self']);
  f.req.query = { staff_id: other, status: 'pending', start_date: '2026-03-08', end_date: '2026-03-09' };
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
  const next = jest.fn();
  await appointments.listAppointments(f.req, f.res, next);
  expect(next).not.toHaveBeenCalled();
  for (const [sql, params] of mockQuery.mock.calls) {
    expect(sql).toContain('ba.staff_id = $2::uuid');
    expect(sql).toContain('ba.status = $3');
    expect(sql).toContain('ba.end_time > $4');
    expect(sql).toContain('ba.start_time < $5');
    expect(params.slice(0,6)).toEqual(['4',self,'pending','2026-03-08','2026-03-09',other]);
  }
  expect(f.res.json.mock.calls[0][0]).toMatchObject({ appointments: [], total: 0 });
});

test.each(['getAppointment','updateAppointmentStatus','cancelAppointment','rescheduleAppointment','reassignAppointmentStaff','recordAppointmentPayment'])(
  '%s cannot read or mutate an appointment assigned outside its SQL scope', async method => {
    const f = grant(['calendar.view_self','calendar.manage_self'], method === 'getAppointment' ? 'view' : 'manage');
    f.req.body = { status: 'confirmed', amount_cents: 100, new_start_time: new Date(Date.now()+86400000).toISOString(), new_end_time: new Date(Date.now()+90000000).toISOString() };
    mockQuery.mockResolvedValue({ rows: [] });
    const next = jest.fn();
    await appointments[method](f.req, f.res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(404);
    const read = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM business_appointments'));
    expect(read[0]).toContain(method === 'getAppointment' ? 'ba.staff_id = $3::uuid' : 'staff_id = $3::uuid');
    expect(read[1]).toEqual(['7','4',self]);
    expect(mockQuery.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql))).toBe(false);
  });

test('a note is inserted only by a single business- and assignee-scoped statement', async () => {
  const f = grant(['calendar.view_self','calendar.manage_self'], 'manage');
  f.req.body = { content: 'Synthetic note' };
  mockQuery.mockResolvedValue({ rows: [] });
  const next = jest.fn();
  await appointments.addAppointmentNote(f.req, f.res, next);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('a.business_id = $5');
  expect(sql).toContain('a.staff_id = $6::uuid');
  expect(params).toEqual(['7',self,'internal','Synthetic note','4',self]);
  expect(next.mock.calls[0][0].statusCode).toBe(404);
});

test('every private appointment route registers the fine permission gate after business access', () => {
  const router = require('../routes/businessOperations');
  const routes = router.stack.filter(layer => layer.route?.path.includes('/appointments'));
  let guarded = 0;
  for (const { route } of routes) {
    if (route.path === '/:businessId/appointments' && route.methods.post) continue; // Validated public customer intake.
    const handlers = route.stack.map(layer => layer.handle);
    const business = handlers.findIndex(handler => handler.scopeGate?.kind === 'business');
    const fine = handlers.findIndex(handler => handler.calendarPermissionGate);
    expect(business).toBeGreaterThan(-1);
    expect(fine).toBeGreaterThan(business);
    guarded++;
  }
  expect(guarded).toBe(10);
});
