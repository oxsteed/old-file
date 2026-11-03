// Browser check for the business-scoped Customer 360 (upgrade 6): real React
// component, mocked business API, five languages, light/dark, narrow/wide, RTL.
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
  LANGS.map((l) => {
    const c = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`), "utf8"));
    return [l, { businessCustomer360: c.businessCustomer360, businessClients: c.businessClients }];
  }),
);
const fixtures = `
window.list={customers:[{key:'u-a',clientId:'1',name:'Anne Client',lastAt:'2026-11-01T10:00:00Z',via:['crm','order']},{key:'c-9',clientId:'9',name:'Walk-in Wally with a very long name that must wrap nicely',lastAt:null,via:['crm']}],nextOffset:null,access:{customers:'all',appointments:'all',invoices:true,orders:true}};
window.detail={customer:{key:'u-a',name:'Anne Client',via:['crm','order'],client:{id:'1',status:'active',email:'anne@biz.example',phone:'+509 555 0100',notes:'Prefers mornings',lifetimeValueCents:12000}},
  sections:{appointments:{state:'ready',total:1,noShows:1,items:[{id:'x',at:'2026-10-30T10:00:00Z',status:'no_show',service:'Tasting'}]},
    orders:{state:'ready',total:2,paidCents:3500,partialStores:true,items:[{id:'1',at:'2026-10-29T10:00:00Z',status:'completed',totalCents:2500,currency:'USD',restaurant:'Lakay Grill'}]},
    invoices:{state:'restricted'}},access:{}};`;
async function bundle() {
  const mocks = {
    "react-i18next": `export const useTranslation=()=>({i18n:{language:window.lang},t:(key,o={})=>{const v=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);return String(v??o.defaultValue??key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');}});`,
    "../../api/businesses": `export const listBusinessCustomers360=async(id,params)=>{window.calls.push({id,params});if(window.forbid){const e=new Error('x');e.response={status:403};throw e;}return structuredClone(window.list);};export const getBusinessCustomer360=async(id,key)=>{window.calls.push({id,key});return structuredClone(window.detail);};`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import C from './src/components/businessHub/BusinessCustomer360.jsx';${fixtures}window.catalogs=${JSON.stringify(copy)};window.lang='en';window.calls=[];const root=createRoot(document.getElementById('root'));window.render=(k)=>{root.render(<C key={k||'a'} bizId={7} currency="USD"/>);};window.render();`,
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
  const css = fs.readFileSync(path.join(root, "src/styles/BusinessCustomer360.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/app.js")) {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(js);
    }
    res.end(`<style>:root{--muted-text:#46556b;--border-color:#cbd5e1;--card-bg:#fff}body{font-family:Arial;margin:8px;color:#162033}body.dark{background:#080f1d;color:#f3f5f9;--muted-text:#bac4d4;--card-bg:#111827;--border-color:#455167}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server;
}

test("business customer 360 list, profile and localized layouts", async () => {
  const server = await serve(await bundle());
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); if (process.env.DEBUG_BC360) console.error(e.stack); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const en = copy.en.businessCustomer360;
    await page.getByText(en.intro).waitFor();
    await page.locator('[data-customer="u-a"]').click();
    const panel = page.locator('[data-panel="business-customer360"]');
    await panel.getByText("Prefers mornings").waitFor();
    await panel.getByText(en.partialStores).waitFor();
    await panel.getByText(en.restricted).waitFor();
    await panel.getByText(en.noShows.replace("{{count}}", "1")).waitFor();
    assert.ok(await panel.getByText(en.appointmentStatus.no_show, { exact: false }).count());
    await page.getByLabel(en.search).fill("anne");
    await page.waitForFunction(() => window.calls.some((c) => c.params?.search === "anne"));

    for (const lang of LANGS)
      for (const dark of [false, true])
        for (const width of [320, 1360]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(({ lang, dark }) => {
            window.lang = lang;
            document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
            document.body.classList.toggle("dark", dark);
            window.render(`${lang}${dark}${Math.random()}`);
          }, { lang, dark });
          await page.getByText(copy[lang].businessCustomer360.intro).waitFor();
          await page.locator('[data-customer="c-9"]').click();
          await page.locator('[data-panel="business-customer360"]').waitFor();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.equal(overflow, false, `${lang}/${width}/${dark} overflow`);
        }
    await page.evaluate(() => { window.forbid = true; window.lang = "en"; window.render("forbid"); });
    await page.getByText(en.forbidden).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
