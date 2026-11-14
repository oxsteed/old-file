'use strict';
const {mockQuery,resetMocks}=require('./setup');
jest.mock('node-cron',()=>({schedule:jest.fn()}));
jest.mock('../services/notificationService',()=>({sendNotification:jest.fn(async()=>{})}));
jest.mock('../growth/marketingLog',()=>({recordMarketingContact:jest.fn(async()=>{})}));
const cron=require('node-cron');
const {sendNotification}=require('../services/notificationService');
const {startCustomerReengagementJob}=require('../jobs/customerReengagementJob');
test('idle customers continue beyond the first page and business eligibility uses canonical ownership',async()=>{
 resetMocks();
 const people=Array.from({length:103},(_,i)=>({id:`user-${String(i).padStart(3,'0')}`,first_name:'Test',last_job_id:`job-${i}`,preferred_language:'en'}));
 let reads=0;
 mockQuery.mockImplementation(async sql=>({rows:sql.includes('SELECT DISTINCT ON')?people.slice(reads++*100,reads*100):[]}));
 startCustomerReengagementJob();await cron.schedule.mock.calls[0][1]();
 expect(sendNotification).toHaveBeenCalledTimes(103);
 const pages=mockQuery.mock.calls.filter(([sql])=>sql.includes('SELECT DISTINCT ON'));
 expect(pages).toHaveLength(3);
 expect(pages[1][1]).toEqual([people[99].id]);
 expect(pages[0][0]).toContain('owned.user_id=u.id');
 expect(pages[0][0]).not.toContain("'business_owner'");
});

test('reengagement log insert refreshes sent_at on conflict (7-day guard)',async()=>{
 // Item 2 [HIGH]: the guard skips users with a reengagement_log row sent
 // in the last 7 days, but the insert used ON CONFLICT DO NOTHING on
 // UNIQUE(user_id, trigger_job_id) while the trigger (last completed job)
 // does not change until the user completes another job. Eight days after
 // the first nudge the guard passed again, the insert conflicted, sent_at
 // never refreshed, and the guard passed every day after. The upsert must
 // refresh sent_at so the 7-day window restarts on every send.
 resetMocks();
 const person={id:'user-001',first_name:'Test',last_job_id:'job-1',preferred_language:'en'};
 let reads=0;
 mockQuery.mockImplementation(async sql=>({rows:sql.includes('SELECT DISTINCT ON')?(reads++===0?[person]:[]):[]}));
 startCustomerReengagementJob();await cron.schedule.mock.calls[0][1]();
 const inserts=mockQuery.mock.calls.filter(([sql])=>sql.includes('INSERT INTO reengagement_log'));
 expect(inserts).toHaveLength(1);
 expect(inserts[0][0]).toContain('ON CONFLICT (user_id, trigger_job_id) DO UPDATE SET sent_at = NOW()');
 expect(inserts[0][0]).not.toContain('ON CONFLICT DO NOTHING');
 expect(inserts[0][1]).toEqual([person.id, person.last_job_id]);
});
