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
const copy = Object.fromEntries(
  ["en", "es", "fr", "ht", "ar"].map((l) => [
    l,
    JSON.parse(
      fs.readFileSync(path.join(root, `src/locales/${l}.json`), "utf8"),
    ).customerWorkspace,
  ]),
);
const row = (id, status = "pending") => ({
  id: String(id),
  label: `Synthetic record ${id}`,
  status,
  occurred_at: "2026-10-18T01:00:00Z",
});
const section = (key, area, records, total = records.length) => ({
  key,
  area,
  source: `test_${key}`,
  state: "ready",
  records,
  total,
  groups: [
    {
      status: "pending",
      currency_code: "USD",
      count: total,
      recorded_amount_cents: "12345",
    },
  ],
  limit: 5,
  offset: 0,
  hasMore: total > records.length,
  route: "/admin/users",
});
const data = {
  userId: id,
  viewerId,
  generatedAt: new Date().toISOString(),
  sections: {
    jobs: section("jobs", "work", [row(1), row(2)], 150),
    payments: section("payments", "finance", [
      { ...row(3, "captured"), currency_code: "JPY", amount_major: "1200" },
    ]),
    creditAccounts: section("creditAccounts", "credit", [
      {
        ...row("wallet"),
        currency_code: "HTG",
        balance_cents: 10000,
        reserved_cents: 1000,
      },
    ]),
    devices: section("devices", "devices", [
      {
        ...row(4, "paired"),
        last_seen_at: "2026-01-01",
        last_sync_at: "2026-01-01",
        config_version: 4,
        applied_config_version: 1,
        pending_operations: 2,
      },
    ]),
    tasks: section("tasks", "cases", [
      { ...row(5, "open"), assigned_to: viewerId, revision: 1 },
    ]),
    foodOrders: section("foodOrders", "restaurants", [
      {
        ...row(6, "completed"),
        payment_status: "paid",
        total_cents: 2000,
        currency_code: "USD",
      },
    ]),
    privacyRequests: {
      key: "privacyRequests",
      area: "privacy",
      state: "restricted",
    },
    shipments: { key: "shipments", area: "logistics", state: "unavailable" },
  },
  eligibility: {
    helper: {
      applicable: true,
      missing: ["identity"],
      listing: false,
      work: false,
    },
    identity: {
      verified: false,
      diditStatus: "skipped",
      diditRequired: false,
      diditGateSatisfied: true,
      diditFresh: false,
    },
  },
};
test("customer workspace flows, account changes, errors and responsive localized layouts", async () => {
  const mocks = {
    "react-i18next": `export const useTranslation=()=>({i18n:{language:window.lang,resolvedLanguage:window.lang},t:(key,o={})=>{let v=key.startsWith('customerWorkspace.')?key.slice(18).split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]):null;return String(v||o.defaultValue||key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');}});`,
    "../../lib/adminApi": `const api={get:async(url,o={})=>{window.calls.push({method:'get',url,params:o.params});if(window.mode==='error')throw new Error('unavailable');if(url.endsWith('/alerts'))return{data:{rules:window.rules||[]}};const value=structuredClone(window.fixture);if(o.params?.source){const s=value.sections[o.params.source];s.offset=o.params.offset;s.records=[{id:'99',label:'Older synthetic record',status:'completed',occurred_at:'2026-01-01'}];s.hasMore=false;}return{data:value};},post:async(url,body,o={})=>{window.calls.push({method:'post',url,body,headers:o.headers});if(window.mode==='mutationError')throw new Error('failed');if(url.endsWith('/assistant'))return{data:{draft:null,evidence:[{source:'jobs',state:'ready',total:150,groups:[]}],generatedAt:new Date().toISOString()}};if(url.endsWith('/export'))return{data:{generatedAt:new Date().toISOString(),purpose:body.purpose,sections:[{source:'jobs',total:150,exported:2,partial:true}],records:window.fixture.sections.jobs.records.map(r=>({...r,source:'jobs'}))}};return{data:{},status:200};},patch:async(url,body)=>{window.calls.push({method:'patch',url,body});return{data:{}};},put:async(url,body)=>{window.calls.push({method:'put',url,body});window.rules=[{id:'rule',...body,min_age_minutes:body.minAgeMinutes}];return{data:{}};}};export default api;`,
    "../../lib/GrantGuard": `export const useHasGrant=()=>({allowed:true});`,
    "../../../hooks/useAuth": `export const useAuth=()=>({user:window.viewer});`,
    "../super/OxsteedCreditCustomerDetail": `export default()=>null;`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Page from './src/admin/pages/customer360/Workspace.jsx';window.fixture=${JSON.stringify(data)};window.catalogs=${JSON.stringify(copy)};window.viewer={id:'${viewerId}',role:'super_admin'};window.lang='en';window.calls=[];window.mode='success';const root=createRoot(document.getElementById('root'));window.render=()=>{root.render(<BrowserRouter><Page user={{id:window.customerId||'${id}'}}/></BrowserRouter>);};window.render();`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    format: "esm",
    write: false,
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "mocks",
        setup(p) {
          p.onResolve({ filter: /.*/ }, (a) =>
            mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined,
          );
          p.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "jsx",
          }));
        },
      },
    ],
  });
  const css = fs.readFileSync(
    path.join(root, "src/admin/pages/customer360/workspace.css"),
    "utf8",
  );
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(result.outputFiles[0].contents);
    }
    res.end(
      `<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-surface-2:#f5f7fb;--color-border:#cbd5e1;--color-primary:#b83f08;--color-primary-bg:#fff1e9}body{font-family:Arial;margin:8px;background:#f5f7fb}.dark{--color-text:#f3f5f9;--color-text-muted:#bac4d4;--color-surface:#111827;--color-surface-2:#1f2937;--color-border:#455167;--color-primary:#ff9248;--color-primary-bg:#382016}button,input,select,textarea{font-family:inherit}body.dark{background:#080f1d}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`,
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page
      .getByRole("heading", { name: copy.en.title, exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: copy.en.areas.all, exact: true })
      .click();
    await page.getByText("2 loaded of 150").waitFor();
    await page
      .locator("[data-source=jobs]")
      .getByRole("button", { name: /Synthetic record 1/ })
      .click();
    await page.locator("dialog[open]").waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: copy.en.openFull })
        .getAttribute("href"),
      "/admin/jobs/1",
    );
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => !!document.activeElement.closest("dialog")),
        true,
      );
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.match(
      await page.evaluate(() => document.activeElement.textContent),
      /Synthetic record 1/,
    );
    await page
      .locator("[data-source=jobs]")
      .getByRole("button", { name: copy.en.next })
      .click();
    await page.getByText("Older synthetic record").waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.calls.some(
          (c) => c.params?.source === "jobs" && c.params.offset === 2,
        ),
      ),
      true,
    );
    await page
      .getByRole("combobox", { name: copy.en.navigation, exact: true })
      .selectOption("restaurants");
    await page
      .locator('[data-source="foodOrders"]')
      .getByRole("button", { name: /Food orders/ })
      .click();
    await page
      .getByRole("button", { name: copy.en.refund, exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("dialog")
      .getByRole("textbox")
      .fill("Synthetic refund reason");
    await page
      .getByRole("button", { name: "common.confirm", exact: true })
      .click();
    await page.getByText(copy.en.saved, { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.calls.some(
          (c) =>
            c.url === "/admin/food-orders/6/refund" &&
            c.body.reason === "Synthetic refund reason",
        ),
      ),
      true,
    );
    await page
      .getByRole("button", { name: copy.en.areas.cases, exact: true })
      .click();
    await page.getByLabel(copy.en.taskTitle).fill("Review synthetic case");
    await page
      .getByRole("button", { name: copy.en.createTask, exact: true })
      .first()
      .click();
    await page.getByRole("status").first().waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.calls.some(
          (c) => c.url.endsWith("/tasks") && c.body.idempotencyKey,
        ),
      ),
      true,
    );
    await page.getByLabel(copy.en.source, { exact: true }).selectOption("jobs");
    await page.getByRole("button", { name: copy.en.saveRule }).click();
    await page
      .getByRole("button", { name: copy.en.disable, exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: copy.en.areas.eligibility, exact: true })
      .click();
    await page.getByText(copy.en.accountAccess).waitFor();
    await page
      .getByRole("button", { name: copy.en.areas.assistant, exact: true })
      .click();
    await page.getByRole("button", { name: copy.en.generate }).click();
    await page.getByText(copy.en.providerUnavailable).waitFor();
    await page
      .getByRole("button", { name: copy.en.areas.exports, exact: true })
      .click();
    await page
      .getByLabel(copy.en.purpose)
      .fill("Synthetic customer case report");
    await page.getByLabel(copy.en.sources.jobs, { exact: true }).check();
    await page.getByRole("button", { name: copy.en.export_print }).click();
    await page.locator("dialog[open]").waitFor();
    assert.match(await page.locator("dialog").innerText(), /2\/150/);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.mode = "error";
    });
    await page
      .getByRole("button", { name: copy.en.refresh, exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    await page.evaluate(() => {
      window.mode = "success";
    });
    await page
      .getByRole("button", { name: copy.en.retry, exact: true })
      .click();
    await page
      .getByRole("button", { name: copy.en.areas.all, exact: true })
      .click();
    await page.getByText("2 loaded of 150").waitFor();
    const shotDir = process.env.CUSTOMER360_EVIDENCE_DIR || path.join(require("node:os").tmpdir(), "oxsteed-customer360-evidence");
    fs.mkdirSync(shotDir, { recursive: true });
    for (const lang of ["en", "fr", "ar"])
      for (const dark of [false, true])
        for (const width of [320, 390, 768, 1360, 1600]) {
          await page.goto(url);
          await page
            .getByRole("heading", { name: copy.en.title, exact: true })
            .waitFor();
          await page.evaluate(
            ({ lang, dark }) => {
              window.lang = lang;
              document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
              document.body.classList.toggle("dark", dark);
              window.render();
            },
            { lang, dark },
          );
          await page.setViewportSize({ width, height: 1000 });
          await page
            .getByRole("heading", { name: copy[lang].title, exact: true })
            .waitFor();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
            `${lang}/${width}/${dark} horizontal overflow`,
          );
          await page
            .getByRole("button", { name: copy[lang].areas.all, exact: true })
            .click();
          await page.locator('[data-source="jobs"]').waitFor();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
          );
          if (width === 390 || width === 1360)
            await page.screenshot({
              path: path.join(
                shotDir,
                `${lang}-${dark ? "dark" : "light"}-${width}.png`,
              ),
              fullPage: true,
            });
        }
    await page.goto(url);
    await page
      .getByRole("button", { name: copy.en.areas.all, exact: true })
      .click();
    await page.getByText("2 loaded of 150").waitFor();
    await page.evaluate(() => {
      window.customerId = "99999999-9999-4999-8999-999999999999";
      window.fixture.userId = window.customerId;
      window.fixture.sections.jobs.records[0].label = "New customer record";
      window.render();
    });
    await page.getByText("New customer record").waitFor();
    assert.equal(
      await page.getByText("Synthetic record 1", { exact: true }).count(),
      0,
    );
    await page.evaluate(() => {
      window.viewer = {
        id: "11111111-1111-4111-8111-111111111111",
        role: "admin",
      };
      window.render();
    });
    await page.waitForFunction(
      () => !document.body.textContent.includes("New customer record"),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
