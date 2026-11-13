import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AREAS } from "../src/admin/pages/customer360/model.js";
import { changeRows, eventLabel } from "../src/admin/pages/customer360/upgrades/model.js";

const root = new URL("../src/", import.meta.url);
const LANGS = fs.readdirSync(new URL("locales/", root)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const CORE = ["en", "es", "fr", "ht", "ar"];
const walk = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : walk(v, `${p}${k}.`)));
const legacy = (l) => JSON.parse(fs.readFileSync(new URL(`locales/${l}.json`, root)));

test("event changes render without inventing redacted values", () => {
  assert.deepEqual(changeRows({ status: { from: "open", to: "closed" }, email: { changed: true, redacted: true }, meta: { changed: true }, role: "payer" }), [
    { field: "status", kind: "value", from: "open", to: "closed" },
    { field: "email", kind: "redacted" },
    { field: "meta", kind: "changed" },
  ]);
  assert.deepEqual(changeRows(null), []);
  const copy = (key, o) => (key === "events.types.payment" ? `Payment ${o.action}` : o.defaultValue);
  assert.equal(eventLabel({ event_type: "payment.captured" }, copy), "Payment captured");
  assert.equal(eventLabel({ event_type: "unknown.thing_done" }, copy), "unknown thing done");
});

test("every upgrade area and key exists in all 20 legacy locales with core translations", () => {
  const en = legacy("en").customerWorkspace;
  const upgradeRoots = ["events", "health", "ai", "anomalies", "links", "lifecycle", "inbox", "playbooks", "queues", "summary", "ops", "summaryHealth"];
  const keys = walk(Object.fromEntries(upgradeRoots.map((k) => [k, en[k]])));
  assert.ok(keys.length > 30);
  for (const l of LANGS) {
    const cw = legacy(l).customerWorkspace;
    for (const key of keys) assert.equal(typeof key.split(".").reduce((a, k) => a?.[k], cw), "string", `${l}: ${key}`);
    for (const a of AREAS) if (upgradeRoots.includes(a)) assert.equal(typeof cw.areas?.[a], "string", `${l}: areas.${a}`);
  }
  for (const l of CORE.filter((x) => x !== "en")) {
    const cw = legacy(l).customerWorkspace;
    const same = keys.filter((key) => key.split(".").reduce((a, k) => a?.[k], cw) === key.split(".").reduce((a, k) => a?.[k], en));
    // Cognates ("Points", "Factor") are fine; whole untranslated blocks are not.
    assert.ok(same.length <= Math.ceil(keys.length * 0.05), `${l} has untranslated upgrade copy: ${same.join(", ")}`);
  }
});

test("upgrade panels use logical CSS only", () => {
  const css = fs.readFileSync(new URL("admin/pages/customer360/workspace.css", root), "utf8");
  const upgrade = css.slice(css.indexOf("/* Customer 360 upgrade panels"));
  assert.ok(upgrade.length > 100);
  assert.doesNotMatch(upgrade, /\b(margin|padding|border)-(left|right)\b|\b(left|right)\s*:|text-align:\s*(left|right)/);
});

const src = (p) => fs.readFileSync(new URL(p, root), "utf8");

test("gap fill 15: queue items navigate inside the admin app", () => {
  const board = src("admin/pages/customer360/upgrades/TeamBoard.jsx");
  assert.match(board, /import \{ Link \} from "react-router-dom"/);
  assert.match(board, /<Link to=\{`\/admin\/customers\/\$\{encodeURIComponent\(item\.customer_id\)\}\/360\?area=queues`\}>/);
  for (const f of ["TeamBoard.jsx", "Queues.jsx", "AnomalyQueue.jsx"]) assert.doesNotMatch(src(`admin/pages/customer360/upgrades/${f}`), /<a href=/, f);
});

test("gap fills 5 and 11: super-only queue setup and saved-view rename send the revision", () => {
  const board = src("admin/pages/customer360/upgrades/TeamBoard.jsx");
  assert.match(board, /\{isSuper && <QueueSetup /);
  assert.match(board, /adminApi\.post\(`\/admin\/customer360\/queues`, \{\s*queueKey:/);
  assert.match(board, /adminApi\.patch\(`\/admin\/customer360\/queues\/\$\{encodeURIComponent\(q\.id\)\}`, \{\s*revision: q\.revision/);
  assert.match(board, /adminApi\.put\(`\/admin\/customer360\/saved-views\/\$\{encodeURIComponent\(current\.id\)\}`, \{[\s\S]{0,120}revision: current\.revision/);
  assert.match(board, /current\?\.mine && \(/, "only the owner may rename a view");
  const queues = src("admin/pages/customer360/upgrades/Queues.jsx");
  assert.match(queues, /<TeamBoard [^>]*isSuper=\{isSuper\}/);
});

test("gap fills 6-8: standalone routes are registered, grant-guarded, served and in the nav", async () => {
  const { ADMIN_ROUTE_MANIFEST } = await import("../src/admin/adminRouteManifest.js");
  const app = src("admin/AdminApp.jsx");
  const spa = fs.readFileSync(new URL("../../server/utils/adminSpaRoutes.js", root), "utf8");
  for (const [key, view] of [["customer360Queues", "queues"], ["customer360Anomalies", "anomalies"], ["customer360Summaries", "summaries"]]) {
    assert.equal(ADMIN_ROUTE_MANIFEST[key].grant, "manage_users", key);
    assert.match(app, new RegExp(`path=\\{adminRoute\\('${key}'\\)\\.relative\\} element=\\{<GrantGuard grant=\\{adminRoute\\('${key}'\\)\\.grant\\}><Customer360Ops view="${view}" \\/>`), key);
    assert.ok(spa.includes(`'${ADMIN_ROUTE_MANIFEST[key].path}'`), `${key} served by the server SPA allowlist`);
  }
  const layout = src("admin/layouts/AdminLayout.jsx");
  assert.match(layout, /tabKey: 'customer360Ops', to: routePath\('customer360Queues'\).*labelKey: 'adminNav\.customer360Ops', grant: adminRoute\('customer360Queues'\)\.grant/);
  for (const l of LANGS) assert.equal(typeof legacy(l).adminNav?.customer360Ops, "string", `${l}: adminNav.customer360Ops`);
  const routes = fs.readFileSync(new URL("../../server/routes/admin.js", root), "utf8");
  assert.match(routes, /router\.get\('\/customer360\/summaries\/health', requireAdmin, requirePermission\('manage_users'\)/);
});

test("gap fill 7: the platform anomaly list pages with nextBefore and acts through the customer route", () => {
  const q = src("admin/pages/customer360/upgrades/AnomalyQueue.jsx");
  assert.match(q, /adminApi\.get\(`\/admin\/customer360\/anomalies`/);
  assert.match(q, /setNext\(r\.data\.nextBefore\)/);
  assert.match(q, /\/admin\/users\/\$\{encodeURIComponent\(a\.customer_id\)\}\/workspace\/anomalies\//);
  assert.match(q, /revision: a\.revision/);
});

test("gap fill 8: summary health shows the flag and every worker state with translated copy", () => {
  const h = src("admin/pages/customer360/upgrades/SummaryHealth.jsx");
  assert.match(h, /\/admin\/customer360\/summaries\/health/);
  const en = legacy("en").customerWorkspace.summaryHealth;
  for (const s of ["healthy", "disabled", "not_started", "failing", "behind"]) assert.equal(typeof en.states[s], "string", s);
  for (const s of ["ok", "late", "failing"]) assert.equal(typeof en.workerStates[s], "string", s);
});

test("domain 1 audit #4: TeamBoard load failure offers retry and keeps queue setup reachable", () => {
  const board = src("admin/pages/customer360/upgrades/TeamBoard.jsx");
  const errorBranch = board.slice(board.indexOf("if (board?.error)"), board.indexOf("if (!board)"));
  assert.ok(errorBranch.length > 0, "error branch exists");
  assert.match(errorBranch, /<button[^>]*onClick=\{retryLoad\}[^>]*>\{copy\("retry"\)\}<\/button>/, "error branch renders a retry button");
  assert.match(errorBranch, /<QueueSetup /, "queue setup stays reachable when the board fails");
  assert.match(errorBranch, /queuesLoaded=\{false\}/, "error branch marks the queue list as not loaded");
  assert.match(board, /const retryLoad = \(\) => run\(async \(\) => \{[\s\S]*?loadBoard\(EMPTY_FILTERS, "", undefined\)[\s\S]*?loadViews\(\)[\s\S]*?setBoard\(\{ error:/, "retry reloads the board and the saved views, and restores the error on failure");
  assert.match(board, /queues\.setup\.listUnavailable/, "QueueSetup distinguishes a failed queue list from an empty one");
  assert.equal(typeof legacy("en").customerWorkspace.queues.setup.listUnavailable, "string", "en: queues.setup.listUnavailable");
});

test("domain 1 audit #16: TeamBoard saved-views failure is surfaced with a retry", () => {
  const board = src("admin/pages/customer360/upgrades/TeamBoard.jsx");
  assert.doesNotMatch(board, /loadViews\(c\.signal\)\.catch\(\(\) => \{\}\)/, "saved-views failure is no longer silently swallowed");
  assert.match(board, /const \[viewsError, setViewsError\] = useState\(""\)/, "views load failure is tracked in state");
  assert.match(board, /copy\("queues\.viewsLoadFailed"\)/, "views failure renders the load-failed copy");
  assert.match(board, /\{viewsError && \(/, "views error renders in the board");
  assert.match(board, /onClick=\{\(\) => run\(\(\) => loadViews\(\)\)\}>\{copy\("retry"\)\}<\/button>/, "views error has a retry that reloads the views");
  assert.equal(typeof legacy("en").customerWorkspace.queues.viewsLoadFailed, "string", "en: queues.viewsLoadFailed");
});

test("domain 1 audit #21: TeamBoard manual filters auto-apply debounced, Apply still works", () => {
  const board = src("admin/pages/customer360/upgrades/TeamBoard.jsx");
  assert.match(board, /appliedRef = useRef\(EMPTY_FILTERS\)/, "tracks the last applied filters");
  assert.match(board, /appliedRef\.current = r\.data\.filters/, "a loaded view records its filters as applied");
  assert.match(board, /setTimeout\(\(\) => \{[\s\S]*?loadBoard\(filters, ""\)[\s\S]*?\}, 300\)/, "manual filter changes auto-apply after a 300ms debounce");
  assert.match(board, /if \(!board \|\| board\.error \|\| viewId\) return;/, "auto-apply skips while a saved view is active");
  assert.match(board, /JSON\.stringify\(filters\) === JSON\.stringify\(appliedRef\.current\)/, "auto-apply skips when filters already match the applied set");
  assert.match(board, /onClick=\{\(\) => run\(\(\) => loadBoard\(filters, ""\)\)\}>\{copy\("queues\.apply"\)\}/, "Apply still reloads immediately");
});
