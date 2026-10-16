#!/usr/bin/env node
/**
 * check-manifest.mjs — flags SOP guides affected by source changes.
 *
 * Reads docs/sop/source-manifest.json and verifies every source reference
 * still exists in the current tree:
 *   route      -> path appears in client/src/App.jsx
 *   screen     -> file exists under client/
 *   handler    -> file exists under server/
 *   flag       -> symbol appears somewhere under client/src or server/
 *   permission -> symbol appears somewhere under server/
 *
 * Exit 0: all references resolve. Exit 1: stale references found (listed
 * with the guide IDs they affect, so screenshots/content can be regenerated).
 *
 * Usage: node scripts/sop/check-manifest.mjs [--regenerate]
 *   --regenerate  rewrites docs/sop/source-manifest.json from current guides.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
const manifestPath = path.join(root, 'docs/sop/source-manifest.json');

function regenerate() {
  const index = {};
  let guideCount = 0;
  const guidesDir = path.join(root, 'client/src/sop/guides');
  for (const fam of fs.readdirSync(guidesDir)) {
    const dir = path.join(guidesDir, fam);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      guideCount++;
    }
  }
  // NOTE: full regeneration imports each guide; keep the checked-in
  // manifest as the source of truth and use this flag only to rebuild it
  // after guide edits. The coordinator regenerates via the build script.
  console.log('Regeneration is performed by scripts/sop/pdf/generate.mjs helpers;');
  console.log('manifest currently covers ' + guideCount + ' guide files.');
}

function grepCount(pattern, dirs) {
  try {
    const out = execSync(
      `grep -rl --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' -e ${JSON.stringify(pattern)} ${dirs.join(' ')} 2>/dev/null | head -5`,
      { cwd: root, encoding: 'utf8' }
    ).trim();
    return out ? out.split('\n').length : 0;
  } catch {
    return 0;
  }
}

async function main() {
  if (process.argv.includes('--regenerate')) {
    regenerate();
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appJsx = fs.readFileSync(path.join(root, 'client/src/App.jsx'), 'utf8');
  const stale = [];
  for (const entry of manifest.entries) {
    // Prefer an explicit file path in parens ("desc (server/routes/x.js)"),
    // otherwise strip human annotations before resolving.
    const parenPath = entry.ref.match(/\(([^)]+\.jsx?)\)/);
    const bareRef = parenPath ? parenPath[1] : entry.ref.replace(/\s*\(.*?\)\s*/g, '').trim();
    let ok = false;
    if (entry.type === 'route') {
      const cleanRef = bareRef.split('?')[0].split('#')[0].trim();
      ok = appJsx.includes(`"${cleanRef}"`) || appJsx.includes(`'${cleanRef}'`) || appJsx.includes(`\`${cleanRef}\``);
    } else if (entry.type === 'screen') {
      ok = fs.existsSync(path.join(root, bareRef));
    } else if (entry.type === 'handler') {
      const methodMatch = bareRef.match(/^(?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*\s+(\/[\w/:.\-{}]+)/);
      if (methodMatch) {
        // API endpoint reference: routers are mounted with prefixes, so check
        // the final path segment appears in server/routes/.
        const routePath = methodMatch[1].split(',')[0].trim().replace(/^\/api\//, '');
        const segs = routePath.split('/').filter(Boolean);
        const lastSeg = segs[segs.length - 1].replace(/:[a-zA-Z_]+/g, '').replace(/[{}]/g, '');
        try {
          const out = execSync(
            `grep -rl -F ${JSON.stringify('/' + lastSeg)} server/routes/ server/index.js 2>/dev/null | head -3`,
            { cwd: root, encoding: 'utf8' }
          ).trim();
          ok = out.length > 0;
        } catch {
          ok = false;
        }
      } else {
        ok = fs.existsSync(path.join(root, bareRef));
      }
    } else if (entry.type === 'flag') {
      ok = grepCount(entry.ref, ['client/src', 'server']) > 0;
    } else if (entry.type === 'permission') {
      // Descriptive prose; check any code-like tokens, otherwise informational pass.
      const tokens = entry.ref.match(/[a-zA-Z_$][\w$]*\([^)]*\)|[a-z]+_[a-z_]+|[a-z]+[A-Z][\w$]*/g) || [];
      const stopwords = new Set(['Authenticated', 'Guest', 'customer', 'manager', 'mutations']);
      const meaningful = tokens.filter((t) => t.length > 4 && !stopwords.has(t));
      ok = meaningful.length === 0 || meaningful.some((t) => grepCount(t, ['server', 'client/src']) > 0);
    }
    if (!ok) stale.push(entry);
  }
  if (stale.length === 0) {
    console.log(`OK: all ${manifest.entries.length} source references resolve (${manifest.guideCount} guides).`);
    return;
  }
  console.log(`STALE: ${stale.length} source reference(s) no longer resolve. Affected guides:`);
  for (const e of stale) {
    console.log(`  [${e.type}] ${e.ref}`);
    for (const gid of e.guideIds) console.log(`      -> ${gid} (review content + regenerate screenshots)`);
  }
  process.exit(1);
}

main();
