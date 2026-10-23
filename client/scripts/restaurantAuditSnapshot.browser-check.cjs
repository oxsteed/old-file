const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  build
} = require('esbuild');
const {
  chromium
} = require('playwright-core');
test('audit runner renders and scores persisted items after the template changes', async () => {
  const apiNames = ['listAuditTemplates', 'createAuditTemplate', 'updateAuditTemplate', 'deleteAuditTemplate', 'startAuditRun', 'listAuditRuns', 'completeAuditRun', 'listRestaurantStaff', 'createCorrectiveAction', 'listCorrectiveActions', 'updateCorrectiveAction'];
  const mocks = {
    '../../api/axios': 'export default {};',
    '../../api/restaurants': `export const getAuditRun = async () => window.fixture; const noop = async () => ({}); export const ${apiNames.map(n => `${n}=noop`).join(',')};`,
    '../../api/restaurantsOffline': `export const scoreAuditItemOffline = async (r,a,p) => { window.saved.push(p); return {score:p.score}; }; export const addAuditFindingOffline=async()=>({});`,
    'react-hot-toast': 'export default {success(){},error(){}};',
    'lucide-react': 'export const ClipboardList=()=>null, CheckCircle2=()=>null;',
    '../../components/EmptyState': 'export default ()=>null;'
  };
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AuditRunView} from './src/pages/food/RestaurantAuditPanels.jsx';
    window.saved=[]; window.fixture={id:1,status:'in_progress',template_name:'Safety',scores:[],findings:[],snapshot_items:[{id:101,label:'Original safety item',max_score:5,weight:2}]};
    if(location.search) window.fixture={id:1,status:'completed',template_name:'Archived audit',total_score:5,max_score:10,scores:[{id:51,item_id:null,label:'Historical deleted item',score:3,max_score:5,weight:1},{id:52,item_id:null,label:'Another historical item',score:2,max_score:5,weight:1}],findings:[]};
    createRoot(document.getElementById('root')).render(<AuditRunView t={(key,fallback)=>typeof fallback==='string'?fallback:key} restaurantId={3} auditId={1} templateItems={[{id:999,label:'Changed template item',max_score:2,weight:1}]} staff={[]} isManager={true} onClose={()=>{}}/>);`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'jsx'
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    plugins: [{
      name: 'audit-fixture',
      setup(plugin) {
        plugin.onResolve({
          filter: /.*/
        }, args => mocks[args.path] ? {
          path: args.path,
          namespace: 'fixture'
        } : undefined);
        plugin.onLoad({
          filter: /.*/,
          namespace: 'fixture'
        }, args => ({
          contents: mocks[args.path],
          loader: 'jsx'
        }));
        plugin.onLoad({
          filter: /RestaurantAuditPanels\.jsx$/
        }, args => ({
          contents: fs.readFileSync(args.path, 'utf8') + '\nexport {AuditRunView};',
          loader: 'jsx'
        }));
      }
    }]
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles[0].contents);
    } else res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome'
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Original safety item', {
      exact: true
    }).waitFor();
    assert.equal(await page.getByText('Changed template item', {
      exact: true
    }).count(), 0);
    await page.getByRole('spinbutton', {
      name: 'Score',
      exact: true
    }).fill('3');
    await page.getByRole('button', {
      name: 'Save',
      exact: true
    }).click();
    await page.waitForFunction(() => window.saved.length === 1);
    assert.deepEqual(await page.evaluate(() => window.saved[0]), {
      itemId: 101,
      score: 3,
      note: ''
    });
    assert.deepEqual(errors, []);
    await page.goto(`http://127.0.0.1:${server.address().port}/?legacy`);
    await page.getByText('Historical deleted item', {
      exact: true
    }).waitFor();
    await page.getByText('Another historical item', {
      exact: true
    }).waitFor();
    assert.equal(await page.getByText('Changed template item', {
      exact: true
    }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
