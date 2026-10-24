const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright-core");

const axiosFixture = `const wrap=data=>Promise.resolve({data});
const member='10000000-0000-4000-8000-000000000001';
const tables=Array.from({length:15},(_,i)=>({id:i+1,name:'Table '+(i+1),capacity:4,status:'active',position:{}}));
export default {
 get:async(url,options={})=>{
  window.calls.push({method:'get',url,params:options.params});
  if(url.endsWith('/operations/stores'))return wrap({stores:[{id:1,name:'First store',timezone:'America/New_York',is_primary:true},{id:2,name:'Second store',timezone:'Pacific/Honolulu'}],brandAccess:true});
  if(url.endsWith('/audits/templates'))return wrap({templates:[{id:10,name:'Safety fixture',is_active:true,items:[{id:101,label:'Original check',max_score:5,weight:1}]}]});
  if(url.endsWith('/audits/runs'))return wrap({audits:[]});
  if(/audits\\/runs\\/17$/.test(url))return wrap({audit:{id:17,status:'in_progress',template_name:'Safety fixture',scores:[],findings:[],snapshot_items:[{id:101,label:'Original check',max_score:5,weight:1}]}});
  if(url.endsWith('/corrective-actions'))return wrap({actions:[]});
  if(url.endsWith('/staff'))return wrap({staff:[]});
  if(url.endsWith('/tables'))return wrap({tables,seatings:[],tickets:[]});
  if(url.endsWith('/reservations'))return wrap({reservations:[],hasMore:false});
  if(url.endsWith('/waitlist'))return wrap({entries:[{id:55,guest_name:'Notified guest',party_size:2,status:'notified',quoted_wait_min:10}],hasMore:true});
  if(url.endsWith('/reports/labor'))return wrap({employees:[{user_id:member,name:'Test staff',hours:1,wage_cents:100,net_tips_cents:0}],missing_wage_user_ids:[],total_hours:1});
  if(url.endsWith('/reports/exceptions'))return wrap({employees:[]});
  if(url.endsWith('/team/activity'))return wrap({entries:[],actors:[],total:80});
  if(url.endsWith('/tip-pool'))return wrap({settings:{pooling_enabled:false,tip_out_rules:[]}});
  return wrap({});
 },
 post:async(url,payload)=>{window.calls.push({method:'post',url,payload});if(/audits.*\\/runs$/.test(url))return wrap({audit:{id:17}});return wrap({seating:{id:1},declaration:{id:1}});},
 patch:async(url,payload)=>{window.calls.push({method:'patch',url,payload});return wrap({table:{id:1},action:{id:1}});},
 put:async()=>wrap({}),delete:async()=>wrap({})
};`;

test("restaurant operations use actual API helpers, explicit stores, correct quiz answers and currency precision", async () => {
  const root = path.resolve(__dirname, "..");
  const built = await build({
    stdin: {
      resolveDir: root,
      loader: "jsx",
      contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {AuditsPanel} from './src/pages/food/RestaurantAuditPanels.jsx';
 import RestaurantHostingPanel from './src/pages/food/RestaurantHostingPanel.jsx';
 import {ModuleForm} from './src/pages/food/RestaurantTrainingPanels.jsx';
 import {PayrollPanel} from './src/pages/food/RestaurantPayrollPanel.jsx';
 import en from './src/locales/en.json';
 window.calls=[];window.errors=[];
 const t=(key,options)=>{let value=key.split('.').reduce((object,k)=>object?.[k],en);return value??((typeof options==='string'?options:options?.defaultValue)||key);};
 const q=new URLSearchParams(location.search),mode=q.get('panel'),currency=q.get('currency')||'JPY';
 const restaurant={id:3,effective_role:'owner',permissions:['*'],currency_code:currency,timezone:'America/New_York'};
 let component=mode==='host'?<RestaurantHostingPanel t={t} restaurant={restaurant}/>:mode==='editor'?<ModuleForm t={t} module={{id:1,title:'Answer identity',content:'Lesson',questions:[{question:'Which option?',options:['A','B','C','D'],correct_index:2}]}} onCancel={()=>{}} onSave={async value=>{window.saved=value;}}/>:mode==='payroll'?<PayrollPanel t={t} restaurant={restaurant} from='2026-10-01' to='2026-10-22'/>:<AuditsPanel t={t} restaurant={restaurant}/>;
 createRoot(document.getElementById('root')).render(component);
 `,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    plugins: [
      {
        name: "synthetic-axios-only",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.endsWith("/axios") || args.path === "./axios")
              return { path: "axios-fixture", namespace: "fixture" };
            if (
              [
                "react-hot-toast",
                "react-i18next",
                "../../components/EmptyState",
              ].includes(args.path)
            )
              return { path: args.path, namespace: "fixture" };
          });
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "jsx",
            contents:
              args.path === "axios-fixture"
                ? axiosFixture
                : args.path === "react-hot-toast"
                  ? `export default {success(){},error(message){window.errors.push(message);}};`
                  : args.path === "react-i18next"
                    ? `export const useTranslation=()=>({t:(k)=>k,i18n:{language:'en'}});`
                    : `export default ()=>null;`,
          }));
          plugin.onLoad(
            { filter: /RestaurantTrainingPanels\.jsx$/ },
            (args) => ({
              loader: "jsx",
              contents:
                fs.readFileSync(args.path, "utf8") + "\nexport {ModuleForm};",
            }),
          );
        },
      },
    ],
  });
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(built.outputFiles[0].contents);
    } else
      res.end(
        '<div id="root"></div><script type="module" src="/app.js"></script>',
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page
      .getByRole("combobox", { name: "Store", exact: true })
      .selectOption("2");
    await page.getByRole("button", { name: /start audit/i }).click();
    await page.getByText("Original check", { exact: true }).waitFor();
    const start = await page.evaluate(() =>
      window.calls.find(
        (call) => call.method === "post" && /audits.*\/runs$/.test(call.url),
      ),
    );
    assert.equal(start.payload.locationId, 2);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    await page.goto(base + "/?panel=host");
    await page.getByText("Notified guest", { exact: false }).waitFor();
    const item = page.locator("li").filter({ hasText: "Notified guest" });
    assert.equal(
      await item.getByRole("button", { name: "Seat", exact: true }).count(),
      1,
    );
    await item
      .getByRole("combobox", { name: "Table", exact: true })
      .selectOption("1");
    await item.getByRole("button", { name: "Seat", exact: true }).click();
    await page.waitForFunction(() =>
      window.calls.some((call) => call.url.endsWith("/tables/1/seating")),
    );
    assert.equal(
      (
        await page.evaluate(() =>
          window.calls.find((call) => call.url.endsWith("/tables/1/seating")),
        )
      ).payload.waitlistId,
      55,
    );
    const floor = page.getByRole("button", {
      name: "Table 13 (4)",
      exact: true,
    });
    const position = await floor.evaluate((el) => ({
      left: parseFloat(el.style.left),
      top: parseFloat(el.style.top),
    }));
    assert.ok(position.top >= 0 && position.top <= 100);
    await floor.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() =>
      window.calls.some(
        (call) => call.method === "patch" && call.url.endsWith("/tables/13"),
      ),
    );
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    await page.goto(base + "/?panel=editor");
    await page
      .getByRole("button", { name: "Remove option", exact: true })
      .first()
      .click();
    const radios = page.getByRole("radio");
    assert.equal(await radios.nth(1).isChecked(), true);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => window.saved);
    assert.deepEqual(
      await page.evaluate(() => ({
        options: window.saved.questions[0].options,
        index: window.saved.questions[0].correct_index,
      })),
      { options: ["B", "C", "D"], index: 1 },
    );
    for (const [currency, input, minor] of [
      ["JPY", "5", 5],
      ["KWD", "1.005", 1005],
    ]) {
      await page.goto(base + "/?panel=payroll&currency=" + currency);
      await page
        .getByRole("combobox", { name: "Employee", exact: true })
        .selectOption("10000000-0000-4000-8000-000000000001");
      await page
        .getByRole("spinbutton", {
          name: /cash tips.*amount|amount.*cash tips|amount/i,
        })
        .last()
        .fill(input);
      await page
        .getByRole("button", { name: /add.*cash|declare|add declaration/i })
        .click();
      await page.waitForFunction(() =>
        window.calls.some((call) =>
          call.url.endsWith("/tips/cash-declarations"),
        ),
      );
      const cash = await page.evaluate(
        () =>
          window.calls.find((call) =>
            call.url.endsWith("/tips/cash-declarations"),
          ).payload,
      );
      assert.equal(cash.amountCents, minor);
      assert.equal(cash.locationId, 1);
      assert.ok(cash.idempotencyKey);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
