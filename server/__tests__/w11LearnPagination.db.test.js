'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const schema=`w11_learn_${crypto.randomBytes(6).toString('hex')}`;
const url=process.env.STATEMENT_TEST_DATABASE_URL;
if(url){
  const target=new URL(url);
  if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!='/credit_statement_test') throw new Error('Disposable statement DB required');
  target.searchParams.set('options',`-c search_path=${schema},public`); process.env.DATABASE_URL=target.toString();
}
jest.unmock('pg');jest.unmock('../db');
const db=require('../db');
const learn=require('../controllers/learnController');
const describeDb=url?describe:describe.skip;
describeDb('W11 review queues retain access beyond 200 rows',()=>{
  beforeAll(async()=>{
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users(id UUID PRIMARY KEY,email TEXT)`);
    await db.query(`CREATE TABLE ${schema}.learn_guides(id TEXT PRIMARY KEY,title TEXT,status TEXT,video_url TEXT)`);
    for(const file of ['630_learn_guide_video_submissions.sql','631_learn_guide_video_playlists.sql']) await db.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
    await db.query("INSERT INTO learn_guides(id,title,status) VALUES('w11-guide','Synthetic guide','published')");
    await db.query(`INSERT INTO learn_guide_video_submissions(guide_id,video_url,video_provider,created_at)
      SELECT 'w11-guide','https://vimeo.com/'||n,'vimeo',TIMESTAMPTZ '2026-10-13 00:00:00.100000+00'+n*INTERVAL '1 microsecond' FROM generate_series(1,205) n`);
    const {rows:[video]}=await db.query("INSERT INTO learn_guide_videos(guide_id,video_url,video_provider) VALUES('w11-guide','https://vimeo.com/1','vimeo') RETURNING id");
    await db.query(`INSERT INTO learn_guide_video_flags(video_id,reason,created_at)
      SELECT $1,'spam',TIMESTAMPTZ '2026-10-13 00:00:00.100000+00'+n*INTERVAL '1 microsecond' FROM generate_series(1,205) n`,[video.id]);
  });
  afterAll(async()=>{await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();});
  async function invoke(handler,query={}){
    const next=jest.fn(),res={json:jest.fn()};
    await handler({query},res,next);
    return {body:res.json.mock.calls[0]?.[0],error:next.mock.calls[0]?.[0]};
  }
  test.each([['submissions','adminListVideoSubmissions'],['flags','adminListVideoFlags']])('%s: 200 then 5 rows, preserving microsecond cursor precision',async(field,method)=>{
    const first=await invoke(learn[method]); expect(first.error).toBeUndefined();
    expect(first.body[field]).toHaveLength(200);expect(first.body.has_more).toBe(true);
    const decoded=JSON.parse(Buffer.from(first.body.next_cursor,'base64url').toString());
    expect(decoded.ts).toMatch(/\.\d{4,6}/);
    expect(first.body[field].some(row=>Object.hasOwn(row,'cursor_timestamp'))).toBe(false);
    const second=await invoke(learn[method],{cursor:first.body.next_cursor});
    expect(second.error).toBeUndefined();expect(second.body[field]).toHaveLength(5);
    expect(second.body.has_more).toBe(false);expect(second.body.next_cursor).toBeNull();
    expect(new Set([...first.body[field],...second.body[field]].map(row=>row.id)).size).toBe(205);
  });
  test.each([['submissions','adminListVideoSubmissions'],['flags','adminListVideoFlags']])('%s: small page limit visits every row without duplicates',async(field,method)=>{
    let cursor;const ids=[];
    for(let page=0;page<20;page++){
      const result=await invoke(learn[method],{cursor,limit:'25'});expect(result.error).toBeUndefined();
      ids.push(...result.body[field].map(row=>row.id));
      cursor=result.body.next_cursor;
      if(!result.body.has_more)break;
    }
    expect(ids).toHaveLength(205);expect(new Set(ids).size).toBe(205);
  });
  test.each(['adminListVideoSubmissions','adminListVideoFlags'])('%s rejects malformed cursor with 400, not a database 500',async method=>{
    expect((await invoke(learn[method],{cursor:'malformed'})).error).toMatchObject({statusCode:400,code:'invalid_review_cursor'});
    const invalid=Buffer.from(JSON.stringify({ts:'2026-10-13',id:"' OR 1=1"})).toString('base64url');
    expect((await invoke(learn[method],{cursor:invalid})).error).toMatchObject({statusCode:400});
  });
  test('status changes use the requested queue, independently of previous-page cursor',async()=>{
    const result=await invoke(learn.adminListVideoSubmissions,{status:'blocked'});
    expect(result.body).toMatchObject({submissions:[],has_more:false,next_cursor:null});
  });
});
