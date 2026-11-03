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
];
window.healthFixture={advisory:true,modelVersion:'c360-health-v1',computedAt:'2026-11-03T10:00:00Z',
  churn:{state:'ready',score:83,band:'high',factors:[{key:'inactivity',value:120,level:1,weight:45,contribution:45},{key:'activityDrop',value:0,previous:4,level:1,weight:35,contribution:35},{key:'newAccount',value:400,level:0,weight:20,contribution:0}]},
  payment:{state:'restricted'},
  support:{state:'ready',score:40,band:'medium',factors:[{key:'openTickets',value:3,level:1,weight:40,contribution:40},{key:'recentTickets',value:3,level:0.5,weight:30,contribution:0},{key:'slaBreaches',value:0,level:0,weight:30,contribution:0}]}};`;
async function bundle() {
  const mocks = {
    "react-i18next": `export const useTranslation=()=>({i18n:{language:window.lang,resolvedLanguage:window.lang},t:(key,o={})=>{let v=key.startsWith('customerWorkspace.')?key.slice(18).split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]):null;return String(v||o.defaultValue||key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');}});`,
    "../../lib/adminApi": `const call=async(method,url,body,o={})=>{window.calls.push({method,url,body,params:o.params});if(url.endsWith('/workspace'))return{data:structuredClone(window.fixture)};for(const [m,re,fn] of window.routes){if(m===method&&re.test(url))return{data:fn(o.params?o:{params:{},...o},body),status:200};}throw new Error('unmocked '+method+' '+url);};const api={get:(u,o={})=>call('get',u,undefined,{params:{},...o}),post:(u,b,o)=>call('post',u,b,o),put:(u,b,o)=>call('put',u,b,o),patch:(u,b,o)=>call('patch',u,b,o),delete:(u,o)=>call('delete',u,undefined,o)};export default api;`,
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

    const panels = [["events", '[data-panel="events"]'], ["health", '[data-panel="health"]']];
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
