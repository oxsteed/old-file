'use strict';

const { mockQuery, resetMocks } = require('./setup');

const mockHasGlobalGrant = jest.fn();
jest.mock('../middleware/adminAuth', () => ({
  hasGlobalGrant: (...args) => mockHasGlobalGrant(...args),
}));
jest.mock('../services/customer360Workspace', () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  target: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const controller = require('../controllers/customer360WorkspaceController');

const REQUESTER = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const TASK = '00000000-0000-4000-8000-000000000003';
const ASSIGNEE = '00000000-0000-4000-8000-000000000004';

function response() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

function request() {
  return {
    user: { id: REQUESTER, role: 'admin' },
    params: { userId: CUSTOMER, taskId: TASK },
    body: { status: 'in_progress', resolution: '', revision: 2, assignedTo: ASSIGNEE },
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockHasGlobalGrant.mockResolvedValue(false);
});

function queueAssignee(role = 'admin') {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: TASK, customer_id: CUSTOMER, revision: 2, status: 'open', assigned_to: null }] })
    .mockResolvedValueOnce({ rows: [{ id: ASSIGNEE, role }] })
    .mockResolvedValueOnce({ rows: [{ id: TASK, customer_id: CUSTOMER, revision: 3, status: 'in_progress', assigned_to: ASSIGNEE }] });
}

test('allows assignment to a delegated manage_users admin', async () => {
  mockHasGlobalGrant.mockResolvedValue(true);
  queueAssignee();
  const res = response();
  const next = jest.fn();
  await controller.updateTask(request(), res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ assigned_to: ASSIGNEE }) }));
  expect(mockHasGlobalGrant).toHaveBeenCalledWith(ASSIGNEE, 'manage_users');
});

test('rejects assignment to an admin without the manage_users grant', async () => {
  queueAssignee();
  const res = response();
  const next = jest.fn();
  await controller.updateTask(request(), res, next);

  expect(res.json).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/authorized active admin/i) }));
});
