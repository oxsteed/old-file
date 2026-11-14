'use strict';
const {mockQuery,resetMocks}=require('./setup');
jest.mock('node-cron',()=>({schedule:jest.fn()}));
jest.mock('../services/notificationService',()=>({sendNotification:jest.fn(async()=>{})}));
jest.mock('../growth/marketingLog',()=>({recordMarketingContact:jest.fn(async()=>{})}));
const cron=require('node-cron');
const {sendNotification}=require('../services/notificationService');
const { sendEmail } = require('../utils/email');
const {startCustomerReengagementJob}=require('../jobs/customerReengagementJob');

async function runJobWithPeople(people) {
  resetMocks();
  sendEmail.mockClear();
  sendNotification.mockClear();
  let reads = 0;
  mockQuery.mockImplementation(async (sql) => ({
    rows: sql.includes('SELECT DISTINCT ON') ? (reads++ === 0 ? people : []) : [],
  }));
  startCustomerReengagementJob();
  await cron.schedule.mock.calls[0][1]();
}

function reengagementPerson(overrides = {}) {
  return {
    id: 'user-001',
    first_name: 'Test',
    email: 'test@example.com',
    preferred_language: 'en',
    last_job_id: 'job-1',
    last_job_title: 'Fix the sink',
    email_frequency: 'real-time',
    email_notifications: true,
    unsubscribe_all: false,
    marketing_emails: true,
    ...overrides,
  };
}

function digestQueueInserts() {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO email_digest_queue'));
}
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

test('frequency off skips reengagement mail but keeps the in-app nudge', async () => {
  // Item 27: the job filtered only on marketing_emails/unsubscribe_all
  // and mailed directly via sendEmail, so email_frequency='off' users
  // still got the mail.
  await runJobWithPeople([reengagementPerson({ email_frequency: 'off' })]);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(digestQueueInserts()).toHaveLength(0);
});

test('daily frequency queues reengagement mail for the digest instead of sending now', async () => {
  await runJobWithPeople([reengagementPerson({ email_frequency: 'daily' })]);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendEmail).not.toHaveBeenCalled();
  const inserts = digestQueueInserts();
  expect(inserts).toHaveLength(1);
  expect(inserts[0][1][1]).toBe('daily');
  expect(inserts[0][1][2]).toBe('reengagement_nudge');
});

test('real-time frequency sends reengagement mail immediately with one-click headers', async () => {
  await runJobWithPeople([reengagementPerson({ email_frequency: 'real-time' })]);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'test@example.com',
    headers: expect.objectContaining({ 'List-Unsubscribe': expect.stringContaining('unsubscribe-one-click') }),
  }));
  expect(digestQueueInserts()).toHaveLength(0);
});

test('in-app reengagement nudge is marked promotional so the promo governor applies', async () => {
  // Item 27: the nudge went through sendNotification without
  // promotional:true, so the 2-per-7-days governor never applied and the
  // nudge had no per-type opt-out.
  await runJobWithPeople([reengagementPerson()]);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ promotional: true }));
});
