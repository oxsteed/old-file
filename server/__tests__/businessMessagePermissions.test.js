'use strict';

jest.mock('../utils/storage',()=>({ uploadFile: jest.fn(), getSignedDownloadUrl: jest.fn() }));
jest.mock('../services/businessConversationSync',()=>({ ensureLegacyConversationLink: jest.fn() }));
const { requireBusinessMessageAccess } = require('../middleware/requireBusinessMessageAccess');
const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/businessMessagingController');
const storage = require('../utils/storage');
const self = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
function grant(permissions, action='view', role='employee') {
  const req = { user:{id:self},business:{id:4},businessRole:role,permissions:new Set(['business.view',...permissions]),
    params:{businessId:'4',conversationId:'7'},query:{},body:{},headers:{},get:()=>undefined };
  const res = { set:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn() },next=jest.fn();
  requireBusinessMessageAccess(action)(req,res,next);
  return {req,res,next};
}
beforeEach(()=>{resetMocks();jest.clearAllMocks();});
test('role names and reply permission do not bypass revoked read permissions',()=>{
  for(const role of ['owner','manager','representative','employee']) {
    const f=grant(['messages.reply'],'reply',role);
    expect(f.res.status).toHaveBeenCalledWith(403);expect(f.next).not.toHaveBeenCalled();
  }
});
test('assignment administration requires its explicit permission and business-wide visibility',()=>{
  expect(grant(['messages.view_assigned','messages.assign_threads'],'assign','manager').res.status).toHaveBeenCalledWith(403);
  expect(grant(['messages.view_all'],'assign','manager').res.status).toHaveBeenCalledWith(403);
  expect(grant(['messages.view_all','messages.assign_threads'],'assign','manager').next).toHaveBeenCalledTimes(1);
});
test('list and total scope private customer threads while retaining shared team channels',async()=>{
  const f=grant(['messages.view_assigned']);
  mockQuery.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{count:'0'}]});
  await controller.getConversations(f.req,f.res,jest.fn());
  const [list,total]=mockQuery.mock.calls;
  expect(list[0]).toContain('bc.assigned_to_user_id = $3::uuid');
  expect(list[0]).toContain("bc.conversation_type = 'team'");
  expect(list[1].slice(0,3)).toEqual(['4',self,self]);
  expect(total[0]).toContain('business_conversations.assigned_to_user_id = $2::uuid');
  expect(total[1]).toEqual(['4',self]);
  expect(f.res.json.mock.calls[0][0]).toMatchObject({total:0,permissions:{all:false,canReply:false}});
});
test.each(['getConversation','sendMessage','uploadAttachment'])('%s refuses an inaccessible thread before storage or message writes',async method=>{
  const f=grant(['messages.view_assigned','messages.reply'],method==='getConversation'?'view':'reply');
  f.req.body={content:'Synthetic reply'};
  f.req.file={buffer:Buffer.from('synthetic'),originalname:'synthetic.txt',mimetype:'text/plain',size:9};
  mockQuery.mockResolvedValue({rows:[]});
  const next=jest.fn();await controller[method](f.req,f.res,next);
  expect(next.mock.calls[0][0].statusCode).toBe(404);
  const [sql,params]=mockQuery.mock.calls[0];
  expect(sql).toContain('business_conversations.assigned_to_user_id = $3::uuid');
  expect(params).toEqual(['7','4',self]);
  if(method==='sendMessage')expect(sql).toContain('FOR UPDATE');
  expect(mockQuery.mock.calls.some(([statement])=>/^\s*(INSERT|UPDATE|DELETE)/.test(statement))).toBe(false);
  expect(storage.uploadFile).not.toHaveBeenCalled();
});
test('new assigned-scope conversations belong to the authenticated creator, ignoring body assignment',async()=>{
  const f=grant(['messages.view_assigned','messages.reply'],'create');
  f.req.body={conversation_type:'customer',customer_email:'synthetic@example.test',assigned_to_user_id:other};
  mockQuery.mockResolvedValue({rows:[{id:7,assigned_to_user_id:self}]});
  await controller.createConversation(f.req,f.res,jest.fn());
  const [sql,params]=mockQuery.mock.calls[0];
  expect(sql).toContain('assigned_to_user_id, assigned_at');
  expect(params.at(-1)).toBe(self);
  expect(f.res.status).toHaveBeenCalledWith(201);
});
test.each(['archiveConversation','restoreConversation'])('%s authorizes the mutation in its UPDATE predicate',async method=>{
  const f=grant(['messages.view_assigned','messages.reply'],'reply');
  mockQuery.mockResolvedValue({rows:[]});const next=jest.fn();
  await controller[method](f.req,f.res,next);
  expect(next.mock.calls[0][0].statusCode).toBe(404);
  const [sql,params]=mockQuery.mock.calls[0];
  expect(sql).toContain('business_conversations.assigned_to_user_id = $3::uuid');
  expect(params).toEqual(['7','4',self]);
});
test('message windows recheck scope for content and receipts, returning the newest page in reading order',async()=>{
  const f=grant(['messages.view_assigned']);f.req.query={limit:'99999',offset:'-1'};
  mockQuery.mockResolvedValueOnce({rows:[{id:7,conversation_type:'team',legacy_conversation_id:'synthetic'}]})
    .mockResolvedValueOnce({rows:[{id:2,attachments:[]},{id:1,attachments:[]}]});
  const next=jest.fn();await controller.getConversation(f.req,f.res,next);
  expect(next).not.toHaveBeenCalled();
  const [sql,params]=mockQuery.mock.calls[1];
  expect(sql).toContain('WITH allowed_conversation AS');
  expect(sql).toContain('business_id = $5');
  expect(sql).toContain('business_conversations.assigned_to_user_id = $6::uuid');
  expect(sql).toContain('bm.conversation_id IN (SELECT id FROM allowed_conversation)');
  expect(sql).toContain('ORDER BY bm.created_at DESC, bm.id DESC');
  expect(params).toEqual(['7',100,0,self,'4',self]);
  expect(f.res.json.mock.calls[0][0].messages.map(m=>m.id)).toEqual([1,2]);
});
test('all business messaging HTTP routes register their fine permission gate',()=>{
  const router=require('../routes/businessOperations');
  const routes=router.stack.filter(layer=>layer.route?.path.includes('/messages'));
  expect(routes).toHaveLength(11);
  for(const {route}of routes){
    const handlers=route.stack.map(layer=>layer.handle);
    const business=handlers.findIndex(handler=>handler.scopeGate?.kind==='business');
    const fine=handlers.findIndex(handler=>handler.messagePermissionGate);
    expect(business).toBeGreaterThan(-1);expect(fine).toBeGreaterThan(business);
  }
});
