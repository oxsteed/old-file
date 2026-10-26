// S-24: accessibility guard for staff and restaurant-operations screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auditSource, auditFiles } from './a11yStaticAudit.mjs';

// Staff-facing screens must have zero findings.
const STAFF_SURFACES = [
  'src/components/businessHub/StaffScheduler.jsx',
  'src/components/businessHub/StaffLaborRulesPanel.jsx',
  'src/components/businessHub/StaffSchedulingTab.jsx',
  'src/components/businessHub/StaffCreateAppointmentModal.jsx',
  'src/components/businessHub/MemberPermissionsEditor.jsx',
  'src/pages/food/RestaurantTrainingPanels.jsx',
  'src/pages/food/RestaurantMyShiftPanel.jsx',
  'src/pages/food/RestaurantTimeClockCard.jsx',
  'src/pages/food/RestaurantOfflineCardQueue.jsx',
  'src/pages/food/RestaurantHQPanel.jsx',
  'src/pages/food/BrandHQPanel.jsx',
  'src/pages/food/RestaurantPayrollPanel.jsx',
  'src/pages/food/PosStaffSession.jsx',
  'src/pages/food/RestaurantOpsPanels.jsx',
  'src/pages/food/RestaurantRunnerPage.jsx',
  'src/pages/food/RestaurantPOSPage.jsx',
  'src/pages/food/RestaurantInventoryPage.jsx',
  'src/pages/food/TimezoneSelect.jsx',
];

test('staff screens have no static accessibility findings', () => {
  const findings = auditFiles(STAFF_SURFACES);
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.rule}`), []);
});

test('TimezoneSelect callers always pass an id that a <label htmlFor> points at', () => {
  for (const file of ['src/pages/food/FoodMerchantPage.jsx', 'src/pages/food/FoodLocationsPanel.jsx']) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<TimezoneSelect id="([^"]+)"/g)) {
      assert.match(src, new RegExp(`htmlFor="${m[1]}"`), `${file} labels ${m[1]}`);
    }
  }
});

// Everything else under the restaurant and business hub may only improve.
const BASELINE = JSON.parse(fs.readFileSync(path.resolve('scripts/a11yBaseline.json'), 'utf8'));
test('restaurant and business-hub screens never add accessibility findings (ratchet)', () => {
  const dirs = ['src/pages/food', 'src/components/businessHub'];
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.jsx')).map((f) => `${d}/${f}`));
  const counts = {};
  for (const f of auditFiles(files)) counts[f.file] = (counts[f.file] || 0) + 1;
  const worse = Object.entries(counts).filter(([file, n]) => n > (BASELINE[file] || 0)).map(([file, n]) => `${file}: ${n} > ${BASELINE[file] || 0}`);
  assert.deepEqual(worse, []);
});

test('auditor rules', () => {
  const rules = (src) => auditSource(src).map((f) => f.rule);
  assert.deepEqual(rules('const A=()=> <input value={v} />;'), ['control-has-label']);
  assert.deepEqual(rules('const A=()=> <label>Name <input value={v} /></label>;'), []);
  assert.deepEqual(rules('const A=()=> <><label htmlFor="x">N</label><input id="x" /></>;'), []);
  assert.deepEqual(rules('const A=()=> <input aria-label={t("k")} />;'), []);
  assert.deepEqual(rules('const A=()=> <input type="hidden" />;'), []);
  assert.deepEqual(rules('const A=()=> <button><X size={4} /></button>;'), ['button-has-name']);
  assert.deepEqual(rules('const A=()=> <button>{t("ok")}</button>;'), []);
  assert.deepEqual(rules('const A=()=> <div onClick={go}>x</div>;'), ['click-needs-keyboard']);
  assert.deepEqual(rules('const A=()=> <div role="button" onClick={go} onKeyDown={k}>x</div>;'), []);
  assert.deepEqual(rules('const A=()=> <img src={s} />;'), ['img-alt']);
  assert.deepEqual(rules('const A=()=> <span tabIndex={2}>x</span>;'), ['no-positive-tabindex']);
  assert.deepEqual(rules('const A=()=> (\n// a11y-ok: test waiver\n<input />);'), []);
});
