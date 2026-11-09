// Browser check for the standalone Customer 360 operations pages (PR #679
// gap fills 5-8, 11, 15): real React bundle, mocked admin API, five
// languages, light/dark, narrow and wide, RTL.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");
const { build } = require("esbuild"),
  { chromium } = require("playwright-core");
const root = path.resolve(__dirname, "..");
const LANGS = ["en", "es", "fr", "ht", "ar"];
const copy = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`), "utf8")).customerWorkspace]),
);
const routes = `window.routes=[
  ['get',/\\/customer360\\/queues$/,(o)=>({queues:window.qQueues,items:window.qItems,nextCursor:null,filters:{queues:[],statuses:['open','claimed'],assignee:'any',breachedOnly:false,sort:'due'},topics:['general']})],
  ['post',/\\/customer360\\/queues$/,(o,b)=>{window.qQueues=[...window.qQueues,{id:'9',queue_key:b.queueKey,name:b.name,description:b.description,sla_minutes:b.slaMinutes,feed:null,active:true,revision:1,open:0,claimed:0,breached:0,sla_met_pct_30d:null,median_resolve_minutes_30d:null}];return{queue:window.qQueues.at(-1)};}],
  ['patch',/\\/customer360\\/queues\\/\\d+$/,(o,b)=>{const id=o.url.split('/').pop();const i=window.qQueues.findIndex((q)=>q.id===id);if(b.revision!==window.qQueues[i].revision)throw{response:{data:{code:'revision_conflict'}}};window.qQueues[i]={...window.qQueues[i],name:b.name,description:b.description,sla_minutes:b.slaMinutes,active:b.active,revision:b.revision+1};return{queue:window.qQueues[i]};}],
  ['get',/\\/customer360\\/saved-views$/,()=>({views:window.qViews})],
  ['put',/\\/customer360\\/saved-views\\/\\d+$/,(o,b)=>{const v=window.qViews[0];if(b.revision!==v.revision)throw{response:{data:{code:'revision_conflict'}}};window.qViews[0]={...v,name:b.name,scope:b.scope,filters:b.filters,revision:v.revision+1};return{view:window.qViews[0]};}],
  ['get',/\\/customer360\\/anomalies$/,(o)=>o.params.before?{kinds:['refund_spike','new_country_login','payout_failures'],anomalies:[window.anomalyRows[2]],nextBefore:null}:{kinds:['refund_spike','new_country_login','payout_failures'],anomalies:window.anomalyRows.slice(0,2),nextBefore:'4'}],
  ['post',/\\/users\\/[0-9a-f-]+\\/workspace\\/anomalies\\/\\d+\\/(snooze|unsnooze|acknowledge|resolve)$/,(o,b)=>{window.anomalyRows[0]={...window.anomalyRows[0],status:'acknowledged',revision:2};return{anomaly:window.anomalyRows[0]};}],
  ['get',/\\/customer360\\/summaries\\/health$/,()=>window.healthBody],
];
window.qQueues=[{id:'1',queue_key:'anomalies',name:'Anomaly alerts',description:null,sla_minutes:240,feed:'anomalies',active:true,revision:1,open:3,claimed:1,breached:2,sla_met_pct_30d:80,median_resolve_minutes_30d:95.5},
  {id:'3',queue_key:'general',name:'General follow-up',description:'Manual',sla_minutes:1440,feed:null,active:true,revision:4,open:1,claimed:0,breached:0,sla_met_pct_30d:null,median_resolve_minutes_30d:null}];
window.qViews=[{id:'7',name:'Overdue',scope:'private',filters:{queues:[],statuses:['open'],assignee:'me',breachedOnly:true,sort:'due'},mine:true,owner_name:'Me',revision:2}];
window.qItems=[{id:'20',queue_key:'anomalies',queue_name:'Anomaly alerts',customer_id:'00000000-0000-4000-8000-0000000000cc',customer_name:'سارة',topic:'refund_spike',source:'anomaly',reason:'refund_spike',status:'open',created_at:'2026-11-03T05:00:00Z',breached:true,minutes_left:-75,revision:1}];
window.anomalyRows=[
  {id:'6',customer_id:'00000000-0000-4000-8000-0000000000aa',customer_name:'Rose Pierre',kind:'new_country_login',status:'open',occurrences:2,first_detected_at:'2026-11-01T10:00:00Z',last_detected_at:'2026-11-02T10:00:00Z',evidence:{country:'FR',previousCountries:['HT']},snoozed_until:null,revision:1},
  {id:'4',customer_id:'00000000-0000-4000-8000-0000000000bb',customer_name:'سارة',kind:'refund_spike',status:'open',occurrences:1,first_detected_at:'2026-10-01T10:00:00Z',last_detected_at:'2026-10-01T10:00:00Z',evidence:{refunds7d:4,baselineWeekly:0.5},snoozed_until:null,revision:3},
  {id:'2',customer_id:'00000000-0000-4000-8000-0000000000dd',customer_name:'Ana B.',kind:'payout_failures',status:'open',occurrences:1,first_detected_at:'2026-09-01T10:00:00Z',last_detected_at:'2026-09-01T10:00:00Z',evidence:{failures7d:3},snoozed_until:null,revision:1}];
window.healthBody={enabled:true,state:'failing',modelVersion:'c360-summary-v1',ttlHours:24,estimatedRows:'125000',dirty:12,oldestDirtySeconds:5400,stale:{count:100000,capped:true},outdatedModel:{count:0,capped:false},
  events:{latestEventId:'900',consumerEventId:'880',lag:'20'},checkedAt:'2026-11-03T10:00:00Z',
  workers:[{task:'summary-dirty',status:'failing',last_ok_at:'2026-11-03T09:00:00Z',last_error_at:'2026-11-03T09:59:00Z',last_error_code:'ECONNRESET',consecutive_failures:3},
    {task:'summary-events',status:'ok',last_ok_at:'2026-11-03T09:59:30Z',last_error_at:null,last_error_code:null,consecutive_failures:0},
    {task:'summary-stale',status:'late',last_ok_at:'2026-11-03T08:00:00Z',last_error_at:null,last_error_code:null,consecutive_failures:0}]};`;
async function bundle() {
  const mocks = {
    "react-i18next": `export const useTranslation=()=>({i18n:{language:window.lang,resolvedLanguage:window.lang},t:(key,o={})=>{let v=key.startsWith('customerWorkspace.')?key.slice(18).split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]):null;return String(v||o.defaultValue||key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');}});`,
    "../../../lib/adminApi": `const call=async(method,url,body,o={})=>{window.calls.push({method,url,body,params:o.params});for(const [m,re,fn] of window.routes){if(m===method&&re.test(url))return{data:fn({params:{},...o,url},body),status:200};}throw new Error('unmocked '+method+' '+url);};const api={get:(u,o={})=>call('get',u,undefined,{params:{},...o}),post:(u,b,o)=>call('post',u,b,o),put:(u,b,o)=>call('put',u,b,o),patch:(u,b,o)=>call('patch',u,b,o),delete:(u,o)=>call('delete',u,undefined,o)};export default api;`,
    "../../../hooks/useAuth": `export const useAuth=()=>({user:window.viewer});`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,useLocation}from'react-router-dom';import Ops from './src/admin/pages/customer360/OpsPage.jsx';${routes}
window.catalogs=${JSON.stringify(copy)};window.viewer={id:'v1',role:'super_admin'};window.lang='en';window.calls=[];window.loadedOnce=Math.random();
function Where(){const l=useLocation();return <output data-where>{l.pathname+l.search}</output>;}
const root=createRoot(document.getElementById('root'));
window.render=()=>root.render(<BrowserRouter><Where/><Routes>
  <Route path="/admin/customer360/queues" element={<Ops view="queues"/>}/>
  <Route path="/admin/customer360/anomalies" element={<Ops view="anomalies"/>}/>
  <Route path="/admin/customer360/summaries" element={<Ops view="summaries"/>}/>
  <Route path="/admin/customers/:id/360" element={<p data-customer-page>customer</p>}/>
</Routes></BrowserRouter>);window.render();`,
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
        p.onResolve({ filter: /.*/ }, (a) => (mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined));
        p.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "jsx", resolveDir: root }));
      },
    }],
  });
  return result.outputFiles[0].contents;
}
async function serve(js) {
  const css = fs.readFileSync(path.join(root, "src/admin/pages/customer360/workspace.css"), "utf8");
  let documents = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/app.js")) {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(js);
    }
    if (req.url.startsWith("/favicon")) return res.end();
    documents += 1;
    res.end(`<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-surface-2:#f5f7fb;--color-border:#cbd5e1;--color-primary:#b83f08;--color-primary-bg:#fff1e9}body{font-family:Arial;margin:8px}.dark{--color-text:#f3f5f9;--color-text-muted:#bac4d4;--color-surface:#111827;--color-surface-2:#1f2937;--color-border:#455167}body.dark{background:#080f1d}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.documents = () => documents;
  return server;
}
const noOverflow = async (page, label) =>
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} horizontal overflow`);

test("customer 360 operations pages work and lay out in five languages", async () => {
  const server = await serve(await bundle());
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}/admin/customer360/queues`);
    const board = page.locator('[data-panel="team-board"]');
    await board.locator('[data-item="20"] [data-sla="breached"]').waitFor();

    // Gap fill 11: rename / share a saved view and store the current filters (PUT with revision).
    await board.getByLabel(copy.en.queues.savedView).selectOption("7");
    await board.getByRole("button", { name: copy.en.queues.renameView, exact: true }).click();
    await board.getByLabel(copy.en.queues.newViewName).fill("Overdue (team)");
    await board.locator('[data-section="manage-view"]').getByLabel(copy.en.queues.shareTeam).check();
    await board.getByRole("button", { name: copy.en.queues.saveRename, exact: true }).click();
    await board.getByText(copy.en.queues.viewRenamed).waitFor();
    const put = await page.evaluate(() => window.calls.find((c) => c.method === "put").body);
    assert.equal(put.name, "Overdue (team)");
    assert.equal(put.scope, "team");
    assert.equal(put.revision, 2);
    await board.getByRole("button", { name: copy.en.queues.updateView, exact: true }).click();
    await board.getByText(copy.en.queues.viewUpdated).waitFor();
    assert.equal(await page.evaluate(() => window.calls.filter((c) => c.method === "put").pop().body.revision), 3);

    // Gap fill 5: super admins edit a queue's SLA and create a queue.
    const setup = board.locator('[data-section="queue-setup"]');
    const general = setup.locator('[data-setup-queue="general"]');
    await general.getByLabel(copy.en.queues.setup.slaMinutes).fill("90");
    await general.getByRole("button", { name: copy.en.queues.setup.save, exact: true }).click();
    await board.getByText(copy.en.queues.setup.saved).waitFor();
    const patch = await page.evaluate(() => window.calls.find((c) => c.method === "patch"));
    assert.match(patch.url, /\/admin\/customer360\/queues\/3$/);
    assert.deepEqual(patch.body, { revision: 4, name: "General follow-up", description: "Manual", slaMinutes: 90, active: true });
    await board.locator('tr[data-queue="general"]').getByText("90", { exact: false }).waitFor();
    const form = setup.getByRole("form", { name: copy.en.queues.setup.new });
    assert.equal(await form.getByRole("button", { name: copy.en.queues.setup.create }).isDisabled(), true);
    await form.getByLabel(copy.en.queues.setup.key).fill("escalations");
    await form.getByLabel(copy.en.queues.setup.name).fill("Escalations");
    await form.getByLabel(copy.en.queues.setup.slaMinutes).fill("30");
    await form.getByRole("button", { name: copy.en.queues.setup.create }).click();
    await board.getByText(copy.en.queues.setup.created).waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls.find((c) => c.method === "post" && c.url.endsWith("/customer360/queues")).body),
      { queueKey: "escalations", name: "Escalations", description: null, slaMinutes: 30 });
    await setup.locator('[data-setup-queue="escalations"]').waitFor();

    // Without super admin the setup form is not offered.
    await page.evaluate(() => { window.viewer = { id: "v2", role: "admin" }; window.render(); });
    await page.waitForFunction(() => !document.querySelector('[data-section="queue-setup"]'));
    await page.evaluate(() => { window.viewer = { id: "v1", role: "super_admin" }; window.render(); });
    await board.locator('[data-section="queue-setup"]').waitFor();

    // Gap fill 15: the customer link navigates inside the app (no new document).
    const docs = server.documents();
    const marker = await page.evaluate(() => window.loadedOnce);
    await board.locator('[data-item="20"] a').click();
    await page.locator("[data-customer-page]").waitFor();
    assert.equal(await page.locator("[data-where]").textContent(), "/admin/customers/00000000-0000-4000-8000-0000000000cc/360?area=queues");
    assert.equal(await page.evaluate(() => window.loadedOnce), marker);
    assert.equal(server.documents(), docs);
    await page.goBack();
    await board.waitFor();

    // Gap fill 7: the platform anomaly list, paging and an action through the customer route.
    await page.locator('[data-ops-tab="anomalies"]').click();
    const aq = page.locator('[data-panel="anomaly-queue"]');
    await aq.locator('[data-anomaly="new_country_login"]').getByRole("link", { name: "Rose Pierre" }).waitFor();
    assert.equal(server.documents(), docs, "tabs are SPA links too");
    await aq.getByRole("button", { name: copy.en.queues.more, exact: true }).click();
    await aq.locator('[data-anomaly="payout_failures"]').waitFor();
    assert.equal(await page.evaluate(() => window.calls.filter((c) => c.url.endsWith("/customer360/anomalies")).pop().params.before), "4");
    await aq.locator('[data-anomaly="new_country_login"]').getByRole("button", { name: copy.en.anomalies.actions.acknowledge, exact: true }).click();
    await aq.getByLabel(copy.en.anomalies.reason).fill("Known travel");
    await aq.locator("form").getByRole("button", { name: copy.en.anomalies.actions.acknowledge, exact: true }).click();
    await aq.getByText(copy.en.saved, { exact: true }).waitFor();
    const ack = await page.evaluate(() => window.calls.find((c) => c.method === "post" && /acknowledge$/.test(c.url)));
    assert.equal(ack.url, "/admin/users/00000000-0000-4000-8000-0000000000aa/workspace/anomalies/6/acknowledge");
    assert.deepEqual({ reason: ack.body.reason, revision: ack.body.revision }, { reason: "Known travel", revision: 1 });
    await aq.getByLabel(copy.en.anomalies.show).selectOption("resolved");
    await page.waitForFunction(() => window.calls.filter((c) => c.url.endsWith("/customer360/anomalies")).pop().params.status === "resolved");

    // Gap fill 8: summary health with the flag, backlog and worker states.
    await page.locator('[data-ops-tab="summaries"]').click();
    const sh = page.locator('[data-panel="summary-health"]');
    await sh.locator('[data-health="failing"]').getByText(copy.en.summaryHealth.states.failing).waitFor();
    await sh.getByText(copy.en.summaryHealth.enabled.replace("{{flag}}", "CUSTOMER360_UPGRADES_ENABLED")).waitFor();
    await sh.getByText(copy.en.summaryHealth.atLeast.replace("{{count}}", "100,000")).waitFor();
    await sh.locator('[data-worker="summary-dirty"][data-status="failing"]').getByText("ECONNRESET").waitFor();
    await sh.locator('[data-worker="summary-stale"]').getByText(copy.en.summaryHealth.workerStates.late).waitFor();

    const views = [["queues", '[data-panel="team-board"]'], ["anomalies", '[data-panel="anomaly-queue"]'], ["summaries", '[data-panel="summary-health"]']];
    for (const lang of LANGS)
      for (const dark of [false, true])
        for (const width of [320, 1360]) {
          await page.evaluate(({ lang, dark }) => {
            window.lang = lang;
            document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
            document.documentElement.lang = lang;
            document.body.classList.toggle("dark", dark);
            window.render();
          }, { lang, dark });
          await page.setViewportSize({ width, height: 900 });
          for (const [view, selector] of views) {
            await page.locator(`[data-ops-tab="${view}"]`).click();
            await page.locator(selector).waitFor();
            await page.getByRole("heading", { name: copy[lang].ops.title, exact: true }).waitFor();
            await noOverflow(page, `${lang}/${view}/${width}/${dark}`);
          }
        }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
