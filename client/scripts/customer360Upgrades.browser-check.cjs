// Browser check for the Customer 360 upgrade panels: real React bundle,
// mocked admin API, five languages, light/dark, narrow and wide, RTL.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");
const { build } = require("esbuild"),
  { chromium } = require("playwright-core");
const root = path.resolve(__dirname, ".."),
  id = "77777777-7777-4777-8777-777777777777",
  viewerId = "88888888-8888-4888-8888-888888888888";
const LANGS = ["en", "es", "fr", "ht", "ar"];
const copy = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`), "utf8")).customerWorkspace]),
);
const workspace = {
  userId: id,
  viewerId,
  generatedAt: new Date().toISOString(),
  sections: {
    jobs: { key: "jobs", area: "work", source: "jobs", state: "ready", records: [], total: 0, groups: [], limit: 5, offset: 0, hasMore: false, route: "/admin/jobs" },
  },
  eligibility: { helper: { applicable: false, missing: [], listing: false, work: false }, identity: {} },
};
// Each upgrade adds its mocked endpoints here: [method, url suffix regex, response].
const routes = `window.routes=[
  ['get',/\\/workspace\\/events\\/verify$/,()=>({intact:true,total:3,firstBrokenId:null})],
  ['get',/\\/workspace\\/events\\/replay$/,(o)=>({entityType:'support_ticket',entityId:'T-1',at:new Date().toISOString(),state:{status:o.params.at?'waiting_user':'open'},unknownFields:['subject'],steps:[{id:'1',occurredAt:'2026-10-01T10:00:00Z',eventType:'support_ticket.open',actorType:'customer'},{id:'2',occurredAt:'2026-10-02T10:00:00Z',eventType:'support_ticket.waiting_user',actorType:'system'}],truncated:false})],
  ['get',/\\/workspace\\/events$/,(o)=>o.params.before?{events:[{id:'1',occurred_at:'2026-09-01T10:00:00Z',source:'login',event_type:'login.succeeded',actor_type:'customer',actor_id:'${id}',entity_type:'login',entity_id:'9',changes:{country:'HT'}}],nextBefore:null,sources:['login','support','admin_audit'],backfill:[]}:{events:[
    {id:'3',occurred_at:'2026-10-02T10:00:00Z',source:'support',event_type:'support_ticket.waiting_user',actor_type:'system',actor_id:null,entity_type:'support_ticket',entity_id:'T-1',changes:{status:{from:'open',to:'waiting_user'}}},
    {id:'2',occurred_at:'2026-10-01T10:00:00Z',source:'admin_audit',event_type:'admin.user_role_changed',actor_type:'admin',actor_id:'${viewerId}',entity_type:'admin_action',entity_id:'44',changes:{role:{from:'customer',to:'helper'},email:{changed:true,redacted:true}}}
  ],nextBefore:'2',sources:['login','support','admin_audit'],backfill:[{source:'payment',completed:false}]}],
  ['get',/\\/workspace\\/health$/,()=>window.healthFixture],
  ['post',/\\/workspace\\/health\\/recompute$/,()=>({...window.healthFixture,computedAt:new Date().toISOString()})],
  ['post',/\\/workspace\\/assistant$/,(o,b)=>({mode:b.mode,requiresReview:true,generatedAt:new Date().toISOString(),evidence:[{source:'jobs',state:'ready',total:0,groups:[]}],
    draft:b.mode==='summary'?{summary:'No open work items.',citations:['jobs']}:b.mode==='next_step'?{steps:[{text:'Confirm the job list is complete.',citation:'jobs',guide:'verification'}]}:{subject:'Your account',body:'Thank you for reaching out.'}})],
  ['get',/\\/workspace\\/anomalies$/,()=>({kinds:['refund_spike','payout_failures','new_country_login'],anomalies:window.anomalyRows})],
  ['post',/\\/workspace\\/anomalies\\/\\d+\\/(snooze|unsnooze|acknowledge|resolve)$/,(o,b)=>{window.anomalyRows[0]={...window.anomalyRows[0],status:'snoozed',snoozed_until:b.until,revision:2};return{anomaly:window.anomalyRows[0]};}],
  ['get',/\\/customer360\\/anomaly-watches$/,()=>({watches:window.watches||[]})],
  ['put',/\\/customer360\\/anomaly-watches$/,(o,b)=>{window.watches=[{id:'w',source:b.source,statuses:['open'],min_age_minutes:0,enabled:b.enabled}];return{watch:window.watches[0]};}],
  ['get',/\\/workspace\\/lifecycle$/,()=>({state:'ready',modelVersion:'c360-lifecycle-v1',stage:'lapsing',stageSince:'2026-10-01T00:00:00Z',computedAt:'2026-11-03T10:00:00Z',country:'HT',cohortMonth:'2026-01-01',factors:{daysSinceLastTransaction:45,daysSinceFirstTransaction:280,transactions90d:2},cohortState:'ready',minCell:10,cohort:{country:'HT',cohortMonth:'2026-01-01',countryCohort:{total:120,suppressed:false,stages:{new:{count:20,share:16.7},never_activated:{count:null,share:null,suppressed:true},active:{count:60,share:50},lapsing:{count:30,share:25},dormant:{count:10,share:8.3},closed:{count:0,share:0}}},platformCohort:{total:5,suppressed:true,stages:{}}}})],
  ['get',/\\/customer360\\/cohorts$/,(o)=>o.params.countries==='XX1'?(()=>{throw{response:{data:{code:'invalid_countries'}}}})():({modelVersion:'c360-lifecycle-v1',minCell:10,months:o.params.months,computedAt:'2026-11-03T06:00:00Z',stages:['new','never_activated','active','lapsing','dormant','closed'],countries:o.params.countries.split(',').map((c)=>({country:c,...{total:120,suppressed:false,stages:{new:{count:20,share:16.7},never_activated:{count:null,share:null,suppressed:true},active:{count:60,share:50},lapsing:{count:30,share:25},dormant:{count:10,share:8.3},closed:{count:0,share:0}}}})),cohorts:[]})],
  ['get',/\\/workspace\\/links$/,()=>({signalsEnabled:true,kinds:['address','card','bank'],common:[{kind:'address',holders:40}],checklist:['identityCompared','contactCompared','paymentInstrumentsCompared','activityReviewed'],optionalChecklist:['customerContacted'],
    nodes:[{userId:'00000000-0000-4000-8000-0000000000bb',name:'Ana B.',emailMasked:'a***@example.com',createdAt:'2026-01-01T00:00:00Z',suspended:false,kinds:['card','address'],score:0.93}],edges:[],reviews:window.linkReview?[window.linkReview]:[]})],
  ['post',/\\/workspace\\/links\\/[0-9a-f-]+\\/review$/,()=>{window.linkReview={id:'7',user_a:'${id}',user_b:'00000000-0000-4000-8000-0000000000bb',status:'in_review',checklist:{},score:0.93,revision:1};return{review:window.linkReview};}],
  ['post',/\\/workspace\\/link-reviews\\/7\\/(checklist|duplicate|confirm|reject|distinct|dismiss)$/,(o,b,m)=>{const a=o.url.split('/').pop();const r=window.linkReview;
    if(b.revision!==r.revision)throw{response:{data:{code:'revision_conflict'}}};
    window.linkReview={...r,checklist:{...r.checklist,...(b.checklist||{})},status:a==='duplicate'?'awaiting_second_review':r.status,revision:r.revision+1};return{review:window.linkReview};}],
  ['get',/\\/workspace\\/inbox$/,()=>({items:window.inboxItems,nextBefore:null,tickets:[{id:'11',ticket_number:'T-11',subject:'Login help',status:'open'}],grants:{support:true,internal:false,messages:true},canSend:true,
    channels:{email:{available:true,verified:true,to:'c***@example.com'},sms:{available:false,enabled:false,to:'********1234'}},language:'ht',firstName:'Rose',languages:['en','es','fr','ht','ar'],templates:['general','verification','payment','resolved']})],
  ['get',/\\/workspace\\/inbox\\/templates\\/verification$/,(o)=>({key:'verification',language:o.params.language,subject:'Subject '+o.params.language,body:'Body '+o.params.language})],
  ['post',/\\/workspace\\/inbox\\/send$/,(o,b)=>{window.inboxItems=[{channel:'email',id:'9',at:new Date().toISOString(),outbound:true,internal:false,author:'Admin',subject:b.subject,body:b.body,status:'sent'},...window.inboxItems];return{message:{id:'9',status:'sent'}};}],
  ['post',/\\/admin\\/support\\/tickets\\/11\\/reply$/,()=>({ok:true})],
  ['get',/\\/workspace\\/playbooks$/,()=>({playbooks:[{key:'verification_help',version:1,steps:[{key:'check_unverified',kind:'check'},{key:'resend_verification',kind:'safe_action'},{key:'confirm_with_customer',kind:'manual'}]},
    {key:'payment_issue',version:1,steps:[{key:'review_payments',kind:'check'},{key:'contact_customer',kind:'manual',route:'inbox'},{key:'refund_or_credit',kind:'money_handoff',route:'/admin/payments'}]}],runs:window.pbRuns})],
  ['post',/\\/workspace\\/playbooks\\/payment_issue\\/run$/,()=>{window.pbRuns=[{id:'3',playbook_key:'payment_issue',status:'open',started_by_name:'Admin',created_at:new Date().toISOString(),
    steps:[{key:'review_payments',kind:'check',status:'done',result:{failed:1}},{key:'contact_customer',kind:'manual',status:'pending',result:{}},{key:'refund_or_credit',kind:'money_handoff',status:'pending',result:{}}]}];return{run:window.pbRuns[0]};}],
  ['post',/\\/workspace\\/playbook-runs\\/3\\/steps\\/refund_or_credit\\/complete$/,(o,b)=>{window.pbRuns[0].steps[2]={...window.pbRuns[0].steps[2],status:'handed_off',note:b.note};return{run:window.pbRuns[0]};}],
  ['get',/\\/workspace\\/queues$/,()=>({items:window.qItems.filter((i)=>i.customer_id==='${id}'),queues:[{queue_key:'general',name:'General follow-up',sla_minutes:1440}]})],
  ['get',/\\/customer360\\/queues$/,(o)=>({queues:[{id:'1',queue_key:'anomalies',name:'Anomaly alerts',sla_minutes:240,feed:'anomalies',active:true,open:3,claimed:1,breached:2,resolved_30d:10,sla_met_pct_30d:80,median_resolve_minutes_30d:95.5},
    {id:'3',queue_key:'general',name:'General follow-up',sla_minutes:1440,feed:null,active:true,open:1,claimed:0,breached:0,resolved_30d:0,sla_met_pct_30d:null,median_resolve_minutes_30d:null}],
    items:window.qItems,nextCursor:null,filters:o.params.view?{queues:['anomalies'],statuses:['open','claimed'],assignee:'me',breachedOnly:true,sort:'due'}:{queues:o.params.queues?o.params.queues.split(','):[],statuses:['open','claimed'],assignee:o.params.assignee||'any',breachedOnly:!!o.params.breachedOnly,sort:o.params.sort||'due'},topics:['general']})],
  ['get',/\\/customer360\\/saved-views$/,()=>({views:window.qViews})],
  ['post',/\\/customer360\\/saved-views$/,(o,b)=>{window.qViews=[...window.qViews,{id:'9',name:b.name,scope:b.scope,filters:b.filters,mine:true,owner_name:'Me',revision:1}];return{view:window.qViews.at(-1)};}],
  ['post',/\\/workspace\\/queue-items$/,(o,b)=>{window.qItems=[...window.qItems,{id:'21',queue_key:b.queueKey,queue_name:'General follow-up',customer_id:'${id}',customer_name:'Rose',topic:'general',source:'manual',reason:b.reason,status:'open',created_at:new Date().toISOString(),breached:false,minutes_left:1440,revision:1}];return{item:window.qItems.at(-1)};}],
  ['post',/\\/customer360\\/queue-items\\/20\\/claim$/,(o,b)=>{window.qItems[0]={...window.qItems[0],status:'claimed',assigned_name:'Me',revision:b.revision+1};return{item:window.qItems[0]};}],
  ['get',/\\/workspace\\/summary$/,()=>window.summaryBody('dirty')],
  ['post',/\\/workspace\\/summary\\/recompute$/,()=>window.summaryBody('fresh')],
];
window.pbRuns=[];
window.qViews=[];
window.qItems=[{id:'20',queue_key:'anomalies',queue_name:'Anomaly alerts',customer_id:'00000000-0000-4000-8000-0000000000cc',customer_name:'سارة',topic:'refund_spike',source:'anomaly',reason:'refund_spike',status:'open',created_at:'2026-11-03T05:00:00Z',breached:true,minutes_left:-75,revision:1}];
window.summaryBody=(state)=>({modelVersion:'c360-summary-v1',computedNow:state==='fresh',computeMs:42,incomplete:state!=='fresh',
  staleness:{state,computedAt:'2026-11-03T09:00:00Z',ageSeconds:600,ttlHours:24,dirtySince:state==='dirty'?'2026-11-03T09:05:00Z':null},
  areas:[{area:'support',count:12345,last30:3,lastAt:'2026-11-03T08:00:00Z',sources:[]},{area:'communications',count:0,last30:0,lastAt:null,sources:[]}],
  events:{n:98765,lastAt:'2026-11-03T08:59:00Z'},health:{churnBand:'high'},lifecycle:{stage:'lapsing'},anomalies:{refund_spike:2},queues:{general:{open:1,breached:1}}});
window.inboxItems=[{channel:'support',id:'1',at:'2026-11-01T10:00:00Z',outbound:false,internal:false,author:'Rose',subject:null,body:'مرحبا\\nI cannot log in',thread_label:'T-11'}];
window.anomalyRows=[{id:'5',customer_id:'${id}',kind:'new_country_login',status:'open',occurrences:2,first_detected_at:'2026-11-01T10:00:00Z',last_detected_at:'2026-11-02T10:00:00Z',evidence:{country:'FR',previousCountries:['HT']},snoozed_until:null,revision:1},
  {id:'4',customer_id:'${id}',kind:'refund_spike',status:'acknowledged',occurrences:1,first_detected_at:'2026-10-01T10:00:00Z',last_detected_at:'2026-10-01T10:00:00Z',evidence:{refunds7d:4,baselineWeekly:0.5},snoozed_until:null,revision:3}];
window.healthFixture={advisory:true,modelVersion:'c360-health-v1',computedAt:'2026-11-03T10:00:00Z',
  churn:{state:'ready',score:83,band:'high',factors:[{key:'inactivity',value:120,level:1,weight:45,contribution:45},{key:'activityDrop',value:0,previous:4,level:1,weight:35,contribution:35},{key:'newAccount',value:400,level:0,weight:20,contribution:0}]},
  payment:{state:'restricted'},
  support:{state:'ready',score:40,band:'medium',factors:[{key:'openTickets',value:3,level:1,weight:40,contribution:40},{key:'recentTickets',value:3,level:0.5,weight:30,contribution:0},{key:'slaBreaches',value:0,level:0,weight:30,contribution:0}]}};`;
async function bundle() {
  const mocks = {
    "react-i18next": `export const useTranslation=()=>({i18n:{language:window.lang,resolvedLanguage:window.lang},t:(key,o={})=>{let v=key.startsWith('customerWorkspace.')?key.slice(18).split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]):null;return String(v||o.defaultValue||key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');}});`,
    "../../lib/adminApi": `const call=async(method,url,body,o={})=>{window.calls.push({method,url,body,params:o.params});if(url.endsWith('/workspace'))return{data:structuredClone(window.fixture)};for(const [m,re,fn] of window.routes){if(m===method&&re.test(url))return{data:fn(o.params?{...o,url}:{params:{},...o,url},body),status:200};}throw new Error('unmocked '+method+' '+url);};const api={get:(u,o={})=>call('get',u,undefined,{params:{},...o}),post:(u,b,o)=>call('post',u,b,o),put:(u,b,o)=>call('put',u,b,o),patch:(u,b,o)=>call('patch',u,b,o),delete:(u,o)=>call('delete',u,undefined,o)};export default api;`,
    "../../../lib/adminApi": "export { default } from '../../lib/adminApi';",
    "../../lib/GrantGuard": `export const useHasGrant=()=>({allowed:true});`,
    "../../../hooks/useAuth": `export const useAuth=()=>({user:window.viewer});`,
    "../super/OxsteedCreditCustomerDetail": `export default()=>null;`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Page from './src/admin/pages/customer360/Workspace.jsx';${routes}window.fixture=${JSON.stringify(workspace)};window.catalogs=${JSON.stringify(copy)};window.viewer={id:'${viewerId}',role:'super_admin'};window.lang='en';window.calls=[];const root=createRoot(document.getElementById('root'));window.render=()=>{root.render(<BrowserRouter><Page user={{id:'${id}'}}/></BrowserRouter>);};window.render();`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    format: "esm",
    write: false,
    loader: { ".css": "empty" },
    plugins: [{
      name: "mocks",
      setup(p) {
        p.onResolve({ filter: /.*/ }, (a) => {
          if (mocks[a.path]) return { path: a.path, namespace: "mock" };
          return undefined;
        });
        p.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "jsx", resolveDir: root }));
      },
    }],
  });
  return result.outputFiles[0].contents;
}
async function serve(js) {
  const css = fs.readFileSync(path.join(root, "src/admin/pages/customer360/workspace.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/app.js")) {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(js);
    }
    res.end(`<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-surface-2:#f5f7fb;--color-border:#cbd5e1;--color-primary:#b83f08;--color-primary-bg:#fff1e9}body{font-family:Arial;margin:8px}.dark{--color-text:#f3f5f9;--color-text-muted:#bac4d4;--color-surface:#111827;--color-surface-2:#1f2937;--color-border:#455167}body.dark{background:#080f1d}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server;
}
async function openArea(page, lang, area) {
  await page.getByRole("combobox", { name: copy[lang].navigation, exact: true }).selectOption(area);
}
async function noOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} horizontal overflow`);
}
async function setLang(page, lang, dark, width) {
  await page.evaluate(({ lang, dark }) => {
    window.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.body.classList.toggle("dark", dark);
    window.render();
  }, { lang, dark });
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole("heading", { name: copy[lang].title, exact: true }).waitFor();
}

test("customer 360 upgrade panels work and lay out in five languages", async () => {
  const server = await serve(await bundle());
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.getByRole("heading", { name: copy.en.title, exact: true }).waitFor();

    // Upgrade 1: change history with replay and integrity check.
    await page.getByRole("button", { name: copy.en.areas.events, exact: true }).click();
    const events = page.locator('[data-panel="events"]');
    await events.getByText(copy.en.events.importing).waitFor();
    await events.getByText(copy.en.events.redacted).waitFor();
    assert.equal(await events.getByText("helper").count() > 0, true);
    await events.getByRole("button", { name: copy.en.events.older }).click();
    await events.locator('[data-event="login.succeeded"]').waitFor();
    await events.getByRole("button", { name: copy.en.events.replay }).first().click();
    await events.locator(".c360u-replay").getByText("open", { exact: true }).waitFor();
    await events.getByLabel(copy.en.events.asOf).fill("2026-10-01T12:00");
    await events.getByRole("button", { name: copy.en.events.rebuild }).click();
    await events.locator(".c360u-replay").getByText("waiting_user", { exact: true }).waitFor();
    await events.getByRole("button", { name: copy.en.events.verify }).click();
    await events.getByText(copy.en.events.chainIntact.replace("{{count}}", "3")).waitFor();
    await events.getByLabel(copy.en.events.source).selectOption("support");
    await page.waitForFunction(() => window.calls.some((c) => c.url.endsWith("/events") && c.params?.sources === "support"));

    // Upgrade 2: advisory scores, explained factors, restricted payment score.
    await page.getByRole("button", { name: copy.en.areas.health, exact: true }).click();
    const hp = page.locator('[data-panel="health"]');
    await hp.getByText(copy.en.health.advisory).waitFor();
    await hp.locator('[data-score="payment"]').getByText(copy.en.health.restricted).waitFor();
    await hp.locator('[data-score="churn"]').getByText(copy.en.health.factors.inactivity.label).waitFor();
    assert.match(await hp.locator('[data-score="churn"]').innerText(), /83/);
    await hp.getByRole("button", { name: copy.en.health.recompute }).click();
    await page.waitForFunction(() => window.calls.some((c) => c.method === "post" && c.url.endsWith("/health/recompute")));

    // Upgrade 3: review-only Ollama drafts in three modes.
    await page.getByRole("button", { name: copy.en.areas.assistant, exact: true }).click();
    const ap = page.locator('[data-panel="assistant"]');
    await ap.getByText(copy.en.ai.policy).waitFor();
    await ap.getByRole("button", { name: copy.en.generate }).click();
    await ap.getByText("No open work items.").waitFor();
    await ap.getByLabel(copy.en.ai.mode).selectOption("next_step");
    await ap.getByRole("button", { name: copy.en.generate }).click();
    await ap.getByText("Confirm the job list is complete.").waitFor();
    await ap.getByLabel(copy.en.ai.mode).selectOption("reply_draft");
    await ap.getByLabel(copy.en.ai.topic).selectOption("order");
    await ap.getByRole("button", { name: copy.en.generate }).click();
    assert.equal(await ap.getByLabel(copy.en.ai.subject).inputValue(), "Your account");
    await ap.getByLabel(copy.en.ai.body).fill("Edited reply");
    assert.equal(await page.evaluate(() => window.calls.filter((c) => c.url.endsWith("/assistant")).map((c) => c.body.mode).join()), "summary,next_step,reply_draft");
    assert.equal(await page.evaluate(() => window.calls.some((c) => /send|reply$/.test(c.url))), false);

    // Upgrade 4: bundled anomalies, snooze with reason, platform watch.
    await page.getByRole("button", { name: copy.en.areas.anomalies, exact: true }).click();
    const an = page.locator('[data-panel="anomalies"]');
    await an.getByText(copy.en.anomalies.evidence.country.replace("{{country}}", "FR").replace("{{previous}}", "HT")).waitFor();
    await an.locator('[data-anomaly="new_country_login"]').getByRole("button", { name: copy.en.anomalies.actions.snooze, exact: true }).click();
    await an.getByLabel(copy.en.anomalies.until).fill("2026-11-10T09:00");
    await an.getByLabel(copy.en.anomalies.reason).fill("Customer travelling");
    await an.locator("form").getByRole("button", { name: copy.en.anomalies.actions.snooze, exact: true }).click();
    await an.getByText(copy.en.anomalies.statuses.snoozed, { exact: false }).first().waitFor();
    const snooze = await page.evaluate(() => window.calls.find((c) => c.url.endsWith("/anomalies/5/snooze")).body);
    assert.equal(snooze.reason, "Customer travelling");
    assert.equal(snooze.revision, 1);
    await an.getByLabel(copy.en.anomalies.watch.anomaliesSecurity).check();
    await page.waitForFunction(() => window.calls.some((c) => c.method === "put" && c.body?.source === "anomaliesSecurity" && c.body.enabled));

    // Upgrade 5: link graph with guided review; nothing is merged.
    await page.getByRole("button", { name: copy.en.areas.links, exact: true }).click();
    const ln = page.locator('[data-panel="links"]');
    await ln.getByText(copy.en.links.neverMerge).waitFor();
    await ln.getByText(copy.en.links.score.replace("{{score}}", "93"), { exact: false }).waitFor();
    await ln.getByRole("img", { name: copy.en.links.graphLabel.replace("{{count}}", "1") }).waitFor();
    await ln.getByRole("button", { name: copy.en.links.review, exact: true }).click();
    const propose = ln.getByRole("button", { name: copy.en.links.actions.duplicate, exact: true });
    for (const k of ["identityCompared", "contactCompared", "paymentInstrumentsCompared", "activityReviewed"]) {
      const before = await page.evaluate(() => window.linkReview.revision);
      await ln.getByLabel(copy.en.links.checklist[k]).check();
      await page.waitForFunction((b) => window.linkReview.revision > b, before);
    }
    assert.equal(await propose.isDisabled(), true);
    await ln.getByLabel(copy.en.anomalies.reason).fill("Same card and address");
    await propose.click();
    await ln.getByText(copy.en.links.awaiting).waitFor();
    assert.ok(await ln.getByRole("button", { name: copy.en.links.actions.confirm, exact: true }).isVisible());

    // Upgrade 7: lifecycle stage, cohort distribution and country comparison.
    await page.getByRole("button", { name: copy.en.areas.lifecycle, exact: true }).click();
    const lc = page.locator('[data-panel="lifecycle"]');
    await lc.getByText(copy.en.lifecycle.explain.lapsing).waitFor();
    await lc.getByText(copy.en.lifecycle.suppressed.replace("{{min}}", "10")).waitFor();
    assert.ok(await lc.getByText(copy.en.lifecycle.small).count());
    await lc.getByLabel(copy.en.lifecycle.countries).fill("XX1");
    await lc.getByRole("button", { name: copy.en.lifecycle.compare, exact: true }).click();
    await lc.getByText(copy.en.lifecycle.invalidCountries).waitFor();
    await lc.getByLabel(copy.en.lifecycle.countries).fill("HT,US");
    await lc.getByRole("button", { name: copy.en.lifecycle.compare, exact: true }).click();
    await lc.locator('table[data-compare="countries"] tbody tr').nth(1).waitFor();
    const cohortCall = await page.evaluate(() => window.calls.filter((c) => c.url.endsWith("/customer360/cohorts")).pop().params);
    assert.deepEqual(cohortCall, { countries: "HT,US", months: 12 });

    // Upgrade 8: unified inbox; nothing leaves before the explicit Send now.
    await page.getByRole("button", { name: copy.en.areas.inbox, exact: true }).click();
    const ib = page.locator('[data-panel="inbox"]');
    await ib.locator('li[data-channel="support"]').waitFor();
    await ib.getByLabel(copy.en.inbox.channel).selectOption("email");
    assert.equal(await ib.getByLabel(copy.en.inbox.language).inputValue(), "ht");
    await ib.getByLabel(copy.en.inbox.template).selectOption("verification");
    await page.waitForFunction(() => document.querySelector('[data-panel="inbox"] textarea')?.value === "Body ht");
    await ib.getByLabel(copy.en.inbox.language).selectOption("ar");
    await page.waitForFunction(() => document.querySelector('[data-panel="inbox"] textarea')?.value === "Body ar");
    assert.equal(await ib.locator("textarea").getAttribute("dir"), "rtl");
    await ib.getByRole("button", { name: copy.en.inbox.review, exact: true }).click();
    await ib.locator('[data-review="send"]').waitFor();
    assert.equal(await page.evaluate(() => window.calls.some((c) => c.method === "post" && /inbox\/send$/.test(c.url))), false);
    await ib.getByRole("button", { name: copy.en.inbox.sendNow, exact: true }).click();
    await ib.getByText(copy.en.inbox.sent).waitFor();
    const sendCall = await page.evaluate(() => window.calls.find((c) => /inbox\/send$/.test(c.url)).body);
    assert.equal(sendCall.confirm, true);
    assert.equal(sendCall.channel, "email");
    assert.equal(sendCall.language, "ar");
    assert.equal(sendCall.templateKey, "verification");
    assert.match(sendCall.clientMessageId, /^[0-9a-f-]{36}$/);
    await ib.locator('li[data-channel="email"]').waitFor();
    // Support replies go to the existing ticket reply endpoint.
    await ib.getByLabel(copy.en.inbox.channel).selectOption("support");
    await ib.getByLabel(copy.en.inbox.body, { exact: true }).fill("We reset your link.");
    await ib.getByRole("button", { name: copy.en.inbox.review, exact: true }).click();
    await ib.getByRole("button", { name: copy.en.inbox.sendNow, exact: true }).click();
    await ib.getByText(copy.en.inbox.sent).waitFor();
    assert.ok(await page.evaluate(() => window.calls.some((c) => c.url === "/admin/support/tickets/11/reply" && c.body.is_internal === false)));

    // Upgrade 9: playbooks; nothing runs before the confirmation; the money step is a hand-off.
    await page.getByRole("button", { name: copy.en.areas.playbooks, exact: true }).click();
    const pb = page.locator('[data-panel="playbooks"]');
    await pb.locator('[data-playbook="payment_issue"] button').click();
    await pb.locator('[data-confirm="payment_issue"]').waitFor();
    assert.equal(await page.evaluate(() => window.calls.some((c) => /playbooks\/.+\/run$/.test(c.url))), false);
    await pb.getByRole("button", { name: copy.en.playbooks.runNow, exact: true }).click();
    await pb.locator('[data-run="3"]').waitFor();
    const runCall = await page.evaluate(() => window.calls.find((c) => /run$/.test(c.url)).body);
    assert.equal(runCall.confirm, true);
    const handoff = pb.locator('[data-step="refund_or_credit"]');
    assert.equal(await handoff.getByRole("button", { name: copy.en.playbooks.markHandedOff }).isDisabled(), true);
    assert.equal(await handoff.getByRole("link", { name: copy.en.playbooks.openApprovals }).getAttribute("href"), "/admin/payments");
    await handoff.getByLabel(copy.en.playbooks.handoffNote).fill("Refund request 12");
    await handoff.getByRole("button", { name: copy.en.playbooks.markHandedOff }).click();
    await pb.locator('[data-step="refund_or_credit"][data-step-status="handed_off"]').waitFor();
    await pb.locator('[data-step="contact_customer"]').getByRole("button", { name: copy.en.playbooks.openInbox }).click();
    await page.locator('[data-panel="inbox"]').waitFor();

    // Upgrade 10: team queues, SLA display, saved views.
    await page.getByRole("button", { name: copy.en.areas.queues, exact: true }).click();
    const qp = page.locator('[data-panel="queues"]');
    await qp.locator('[data-item="20"] [data-sla="breached"]').waitFor();
    assert.equal(await qp.locator('[data-item="20"] a').getAttribute("href"), "/admin/customers/00000000-0000-4000-8000-0000000000cc/360?area=queues");
    await qp.locator('tr[data-queue="anomalies"]').getByText("80%").waitFor();
    await qp.locator('section[aria-labelledby="c360u-q-mine"] select').selectOption("general");
    await qp.getByLabel(copy.en.queues.reason).fill("Call back");
    await qp.getByRole("button", { name: copy.en.queues.add, exact: true }).click();
    await qp.getByText(copy.en.queues.added).waitFor();
    await qp.locator('[data-item="20"]').getByRole("button", { name: copy.en.queues.claim, exact: true }).click();
    await qp.locator('[data-item="20"][data-status="claimed"]').first().waitFor();
    const claimBody = await page.evaluate(() => window.calls.find((c) => /queue-items\/20\/claim$/.test(c.url)).body);
    assert.deepEqual(claimBody, { revision: 1 });
    await qp.getByLabel(copy.en.queues.assignee).selectOption("me");
    await qp.getByLabel(copy.en.queues.breachedOnly).check();
    await qp.getByRole("button", { name: copy.en.queues.apply, exact: true }).click();
    const boardCall = await page.evaluate(() => window.calls.filter((c) => c.url.endsWith("/customer360/queues")).pop().params);
    assert.equal(boardCall.assignee, "me");
    assert.equal(boardCall.breachedOnly, true);
    await qp.getByLabel(copy.en.queues.viewName).fill("My overdue");
    await qp.getByLabel(copy.en.queues.shareTeam).check();
    await qp.getByRole("button", { name: copy.en.queues.saveView, exact: true }).click();
    await qp.getByText(copy.en.queues.viewSaved).waitFor();
    const viewBody = await page.evaluate(() => window.calls.find((c) => c.method === "post" && c.url.endsWith("/saved-views")).body);
    assert.equal(viewBody.scope, "team");
    assert.equal(viewBody.filters.assignee, "me");
    await qp.getByLabel(copy.en.queues.savedView).selectOption("9");
    await page.waitForFunction(() => window.calls.some((c) => c.url.endsWith("/customer360/queues") && c.params.view === "9"));

    // Upgrade 12: precomputed summary with staleness and explicit recompute.
    await page.getByRole("button", { name: copy.en.areas.summary, exact: true }).click();
    const sp = page.locator('[data-panel="summary"]');
    await sp.locator('[data-staleness="dirty"]').waitFor();
    await sp.getByText(copy.en.summary.states.dirty).waitFor();
    await sp.getByText(copy.en.summary.incomplete).waitFor();
    assert.equal(await sp.locator('[data-area="support"] td').first().textContent(), "12345");
    await sp.getByRole("button", { name: copy.en.summary.recompute, exact: true }).click();
    await sp.locator('[data-staleness="fresh"]').waitFor();
    await sp.getByText(copy.en.summary.recomputed).waitFor();
    assert.ok(await page.evaluate(() => window.calls.some((c) => c.method === "post" && c.url.endsWith("/summary/recompute"))));
    await sp.locator('[data-area="support"] button').click();
    await sp.waitFor({ state: "detached" });

    const panels = [["summary", '[data-panel="summary"]'], ["queues", '[data-panel="queues"]'], ["playbooks", '[data-panel="playbooks"]'], ["inbox", '[data-panel="inbox"]'], ["lifecycle", '[data-panel="lifecycle"]'], ["links", '[data-panel="links"]'], ["anomalies", '[data-panel="anomalies"]'], ["assistant", '[data-panel="assistant"]'], ["events", '[data-panel="events"]'], ["health", '[data-panel="health"]']];
    for (const lang of LANGS)
      for (const dark of [false, true])
        for (const width of [320, 1360]) {
          await setLang(page, lang, dark, width);
          for (const [area, selector] of panels) {
            await openArea(page, lang, area);
            await page.locator(selector).waitFor();
            await noOverflow(page, `${lang}/${area}/${width}/${dark}`);
          }
        }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
