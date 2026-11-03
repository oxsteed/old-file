// Browser check for the customer "Your data" page (Customer 360 upgrade 11):
// real React page, mocked API, all 20 languages, light/dark, narrow/wide,
// RTL, and the verified export flow (password -> emailed code -> download).
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");
const { build } = require("esbuild"),
  { chromium } = require("playwright-core");
const root = path.resolve(__dirname, "..");
const LANGS = fs.readdirSync(path.join(root, "src/locales")).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2));
const copy = Object.fromEntries(LANGS.map((l) => [l, { yourData: JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`), "utf8")).yourData }]));
const RTL = new Set(["ar", "ur"]);
const fixtures = `
window.summary={generatedAt:'2026-11-03T10:00:00Z',categories:[
 {key:'work',group:'account',count:12,lastAt:'2026-10-01T10:00:00Z',complete:true,export:'included',onErasure:'anonymized'},
 {key:'finance',group:'account',count:123456,lastAt:'2026-11-01T10:00:00Z',complete:false,export:'included',onErasure:'retained'},
 {key:'support',group:'account',count:0,lastAt:null,complete:true,export:'included',onErasure:'anonymized'},
 {key:'scores',group:'derived',count:1,lastAt:'2026-11-02T10:00:00Z',complete:true,export:'included',onErasure:'removed'},
 {key:'cases',group:'internal',count:null,lastAt:null,complete:true,export:'described',onErasure:'retained'},
 {key:'securityReviews',group:'internal',count:null,lastAt:null,complete:true,export:'described',onErasure:'retained'}]};`;
async function bundle() {
  const mocks = {
    "react-i18next": `export const useTranslation=()=>({i18n:{language:window.lang,resolvedLanguage:window.lang},t:(key,o={})=>{const v=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);if(v==null)window.missing.push(window.lang+':'+key);return String(v??key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>o[k]??'');}});`,
    "react-router-dom": `export const Link=({to,children,...p})=><a href={to} {...p}>{children}</a>;`,
    "../../components/Navbar": `export default function N(){return null}`,
    "../../components/Footer": `export default function F(){return null}`,
    "../../api/privacyData": `const call=(n,a)=>{window.calls.push({n,a});};export const privacyDataAPI={
      yourData:async()=>{call('yourData');if(window.fail)throw new Error('x');return{data:structuredClone(window.summary)};},
      requestExportCode:async(p)=>{call('request',p);if(p!=='right'){const e=new Error('x');e.response={data:{code:'EXPORT_PASSWORD_INVALID'}};throw e;}return{data:{challengeToken:'c'.repeat(64),emailHint:'y***@example.com'}};},
      verifyExportCode:async(t,c)=>{call('verify',[t,c]);if(c!=='123456'){const e=new Error('x');e.response={data:new Blob([JSON.stringify({code:'EXPORT_CODE_INVALID'})])};throw e;}return{data:{exportToken:'e'.repeat(64)}};},
      downloadExport:async(t)=>{call('download',t);return{data:new Blob(['zip']),headers:{'content-disposition':'attachment; filename="oxsteed-data-export.zip"'}};}};`,
    "lucide-react": `export const ArrowLeft=()=>null;export const Database=()=>null;`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import P from './src/pages/Settings/YourData.jsx';${fixtures}window.catalogs=${JSON.stringify(copy)};window.lang='en';window.calls=[];window.missing=[];const root=createRoot(document.getElementById('root'));window.render=(k)=>{root.render(<P key={k||'a'}/>);};window.render();`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    jsx: "automatic",
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
// Minimal stand-ins for the Tailwind utilities the page relies on for wrapping.
const CSS = `*{box-sizing:border-box}body{font-family:Arial;margin:0;color:#162033;background:#fff}body.dark{background:#080f1d;color:#f3f5f9}
.flex{display:flex}.flex-wrap{flex-wrap:wrap}.flex-col{flex-direction:column}.flex-1{flex:1 1 0}.min-w-0{min-width:0}.break-words{overflow-wrap:anywhere}
.grid{display:grid}.gap-3{gap:.75rem}.p-4{padding:1rem}.p-6{padding:1.5rem}.px-4{padding-inline:1rem}.max-w-3xl{max-width:48rem;margin-inline:auto}
input{max-width:100%;min-width:0}dl{grid-template-columns:auto minmax(0,1fr)}dd{margin:0;overflow-wrap:anywhere}@media(min-width:640px){.sm\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
async function serve(js) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/app.js")) {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(js);
    }
    res.end(`<style>${CSS}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server;
}

test("your data page: categories, verified export and 20-language layouts", async () => {
  assert.equal(LANGS.length, 20);
  const server = await serve(await bundle());
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const en = copy.en.yourData;
    await page.locator('[data-category="work"]').getByText(en.categories.work.title).waitFor();
    assert.equal(await page.locator('[data-category="securityReviews"]').getByText(en.records).count(), 0);
    await page.getByText(en.partial).waitFor();
    // Wrong password, then the code step, a wrong code, then the download.
    await page.getByLabel(en.export.password).fill("wrong");
    await page.getByRole("button", { name: en.export.sendCode }).click();
    await page.getByText(en.export.errors.EXPORT_PASSWORD_INVALID).waitFor();
    await page.getByLabel(en.export.password).fill("right");
    await page.getByRole("button", { name: en.export.sendCode }).click();
    await page.getByText(en.export.codeSent.replace("{{email}}", "y***@example.com")).waitFor();
    await page.getByLabel(en.export.code).fill("000000");
    await page.getByRole("button", { name: en.export.download }).click();
    await page.getByText(en.export.errors.EXPORT_CODE_INVALID).waitFor();
    await page.getByLabel(en.export.code).fill("123456");
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: en.export.download }).click();
    assert.equal((await dl).suggestedFilename(), "oxsteed-data-export.zip");
    await page.getByText(en.export.done).waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls.map((c) => c.n)), ["yourData", "request", "request", "verify", "verify", "download"]);

    for (const lang of LANGS)
      for (const dark of [false, true])
        for (const width of [320, 1360]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(({ lang, dark, rtl }) => {
            window.lang = lang;
            document.documentElement.dir = rtl ? "rtl" : "ltr";
            document.body.classList.toggle("dark", dark);
            window.render(`${lang}${dark}${Math.random()}`);
          }, { lang, dark, rtl: RTL.has(lang) });
          await page.locator('[data-category="work"]').getByText(copy[lang].yourData.categories.work.title).waitFor();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.equal(overflow, false, `${lang}/${width}/${dark} overflow`);
        }
    await page.evaluate(() => { window.fail = true; window.lang = "en"; window.render("fail"); });
    await page.getByText(en.loadFailed).waitFor();
    assert.deepEqual(await page.evaluate(() => window.missing), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
