'use strict';

jest.mock('../services/permissionsService',()=>({getEffectivePermissions:jest.fn()}));
jest.mock('../utils/businessListRestaurantEnrichment',()=>({enrichBusinessesWithRestaurantFields:jest.fn(async (_db,rows)=>rows)}));
const {mockQuery,resetMocks}=require('./setup');
const permissions=require('../services/permissionsService');
const {listManagedBusinesses}=require('../controllers/businessMembersController');

beforeEach(()=>{resetMocks();jest.clearAllMocks();});
test('managed workspaces carry the authenticated membership effective permissions',async()=>{
  const req={user:{id:'synthetic-viewer'}},res={set:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn()};
  mockQuery.mockResolvedValue({rows:[{id:4,role:'manager',membership_id:9}]});
  permissions.getEffectivePermissions.mockResolvedValue({permissions:new Set(['business.view','calendar.view_self'])});
  await listManagedBusinesses(req,res);
  expect(mockQuery.mock.calls[0][0]).toContain('bm.id AS membership_id');
  expect(permissions.getEffectivePermissions).toHaveBeenCalledWith({businessId:4,userId:'synthetic-viewer',role:'manager',membershipId:9});
  expect(res.json).toHaveBeenCalledWith({businesses:[{id:4,role:'manager',membership_id:9,permissions:['business.view','calendar.view_self']}]});
  expect(res.set).toHaveBeenCalledWith('Cache-Control','private, no-store');
});
test('permission lookup failure cannot silently grant role defaults',async()=>{
  const req={user:{id:'synthetic-viewer'}},res={set:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn()};
  mockQuery.mockResolvedValue({rows:[{id:4,role:'manager',membership_id:9}]});
  permissions.getEffectivePermissions.mockRejectedValue(new Error('Synthetic unavailable'));
  await listManagedBusinesses(req,res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({error:'Failed to load managed businesses'});
});
