#!/usr/bin/env node
/**
 * generate.mjs - Render the OxSteed Visual SOP library to print PDFs.
 *
 * Reads the guide data (client/src/sop/guides/<family>/<guide-id>.js) and the
 * screenshot sidecar (client/src/sop/screenshots.json), builds a print-optimized
 * standalone HTML document per guide and per role handbook (inline CSS, images
 * embedded as base64 data URIs, no external requests), then prints each to PDF
 * with headless Chromium (Playwright headless shell).
 *
 * Outputs (uncommitted build artifacts):
 *   client/public/sop/pdfs/guides/<guide-id>.pdf   (81 files, one per guide)
 *   client/public/sop/pdfs/handbooks/<role>.pdf    (5 files: customer, helper,
 *                                                   business, restaurant, logistics)
 *
 * Usage:
 *   node scripts/sop/pdf/generate.mjs [--guides-only | --handbooks-only] [--guide <id>]
 *
 * Dependencies:
 *   - playwright-core (already in client/node_modules)
 *   - headless shell at ~/.cache/ms-playwright/chromium_headless_shell-1243/
 *     chrome-headless-shell-linux64/chrome-headless-shell
 *     (override with SOP_PDF_CHROME=/path/to/chrome-headless-shell)
 *
 * Revision bumping: the `revision` field in each guide data file is the guide's
 * revision number. Bump it when the guide content changes, then re-run this
 * script. The revision date stamped on covers is the generation date.
 *
 * No em dashes are emitted anywhere in the PDFs (replaced with " - ").
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '/home/hatch/workspace/old-file/client/node_modules/playwright-core/index.mjs';

const REPO = '/home/hatch/workspace/old-file';
const GUIDES_DIR = path.join(REPO, 'client/src/sop/guides');
const SIDECAR_PATH = path.join(REPO, 'client/src/sop/screenshots.json');
const IMG_ROOT = path.join(REPO, 'client/public');
const OUT_GUIDES = path.join(REPO, 'client/public/sop/pdfs/guides');
const OUT_HANDBOOKS = path.join(REPO, 'client/public/sop/pdfs/handbooks');
const TMP_HTML = '/tmp/sop-pdf-html';

const CHROME = process.env.SOP_PDF_CHROME ||
  '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

// Area order and labels mirror client/src/sop/guides/index.js AREAS.
const AREAS = [
  { slug: 'account', title: 'Account' },
  { slug: 'hiring', title: 'Hiring' },
  { slug: 'helper-work', title: 'Helper work' },
  { slug: 'business-work', title: 'Business' },
  { slug: 'restaurants', title: 'Restaurants' },
  { slug: 'financial', title: 'Financial records' },
  { slug: 'logistics', title: 'Logistics' },
  { slug: 'media', title: 'Media' },
  { slug: 'direct', title: 'Direct' },
  { slug: 'delivery', title: 'Delivery' },
  { slug: 'calendar', title: 'Calendar' },
  { slug: 'messages', title: 'Messages' },
  { slug: 'consulting', title: 'Consulting' },
  { slug: 'rentals', title: 'Rentals' },
  { slug: 'other', title: 'More guides' },
];
const AREA_TITLE = new Map(AREAS.map(a => [a.slug, a.title]));
const AREA_RANK = new Map(AREAS.map((a, i) => [a.slug, i]));

const ROLES = [
  { slug: 'customer', title: 'Customer' },
  { slug: 'helper', title: 'Helper' },
  { slug: 'business', title: 'Business' },
  { slug: 'restaurant', title: 'Restaurant' },
  { slug: 'logistics', title: 'Logistics' },
];

const REVISION_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date());
const REVISION_DATE_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// No em dashes in user-visible output.
const clean = (s) => esc(s).replace(/—/g, ' - ').replace(/&mdash;/g, ' - ');

const guideSort = (a, b) =>
  (AREA_RANK.get(a.area) ?? 99) - (AREA_RANK.get(b.area) ?? 99) ||
  a.id.localeCompare(b.id);

async function loadGuides() {
  const files = [];
  for (const dir of fs.readdirSync(GUIDES_DIR)) {
    const p = path.join(GUIDES_DIR, dir);
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) {
      if (f.endsWith('.js')) files.push(path.join(p, f));
    }
  }
  const guides = [];
  for (const f of files) guides.push((await import(pathToFileURL(f).href)).default);
  guides.sort(guideSort);
  return guides;
}

const imageCache = new Map();
function imageDataUri(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const file = path.join(IMG_ROOT, src);
  const buf = fs.readFileSync(file);
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
  imageCache.set(src, uri);
  return uri;
}

// ---------------------------------------------------------------- CSS

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.5; color: #1c1c1c;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 22pt; margin: 0 0 6pt; color: #10243e; line-height: 1.2; }
  h2 { font-size: 15pt; margin: 22pt 0 8pt; color: #10243e; break-after: avoid; border-bottom: 2pt solid #e2a63d; padding-bottom: 4pt; }
  h3 { font-size: 12pt; margin: 16pt 0 6pt; color: #1f3a5f; break-after: avoid; }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; color: #1f3a5f; break-after: avoid; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 10pt; padding-left: 20pt; }
  li { margin-bottom: 4pt; }
  .breadcrumb { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6pt; }
  .lang-badge { display: inline-block; font-size: 9pt; font-weight: bold; color: #10243e;
    border: 1pt solid #10243e; border-radius: 3pt; padding: 1pt 6pt; margin-left: 8pt; vertical-align: middle; }
  .meta-table { width: 100%; border-collapse: collapse; margin: 10pt 0 14pt; font-size: 10pt; }
  .meta-table th, .meta-table td { text-align: left; vertical-align: top; padding: 5pt 8pt; border: 1pt solid #d1d5db; }
  .meta-table th { background: #f1f5f9; width: 26%; color: #334155; font-weight: bold; }
  .note-box { background: #fffbeb; border: 1pt solid #e2a63d; border-radius: 4pt;
    padding: 8pt 10pt; font-size: 10pt; margin: 0 0 14pt; break-inside: avoid; }
  .note-box strong { color: #92400e; }
  .section { margin-bottom: 6pt; }
  .step { break-inside: avoid; margin-bottom: 14pt; }
  figure.fig { margin: 8pt 0 10pt; break-inside: avoid; border: 1pt solid #cbd5e1;
    border-radius: 4pt; padding: 8pt; background: #f8fafc; }
  figure.fig img.shot { display: block; width: 100%; height: auto; border: 1pt solid #94a3b8; border-radius: 2pt; }
  .imgwrap { position: relative; }
  .ann-badge { position: absolute; transform: translate(-50%, -50%);
    width: 20pt; height: 20pt; border-radius: 50%;
    background: rgba(226, 166, 61, 0.95); color: #10243e;
    font-size: 10pt; font-weight: bold; line-height: 20pt; text-align: center;
    border: 1.5pt solid #10243e; }
  figcaption { font-size: 9.5pt; color: #475569; margin-top: 6pt; }
  figcaption .alt { color: #64748b; font-style: italic; }
  .ann-legend { font-size: 9.5pt; color: #334155; margin: 6pt 0 0; padding-left: 18pt; }
  .ann-legend li { margin-bottom: 2pt; }
  .placeholder { border: 2pt dashed #94a3b8; border-radius: 4pt; background: #f8fafc;
    padding: 26pt 16pt; text-align: center; color: #64748b; break-inside: avoid; margin: 8pt 0; }
  .placeholder .ph-title { font-weight: bold; font-size: 11pt; color: #475569; margin-bottom: 6pt; }
  .placeholder .ph-desc { font-size: 9.5pt; }
  .expected { background: #f0fdf4; border-left: 3pt solid #16a34a; padding: 6pt 10pt;
    font-size: 10.5pt; margin: 8pt 0; break-inside: avoid; }
  .expected strong { color: #166534; }
  /* process map */
  .flow { margin: 10pt 0 6pt; }
  .flow-node { break-inside: avoid; border: 1.5pt solid #1f3a5f; border-radius: 6pt;
    background: #ffffff; padding: 7pt 12pt; margin: 0 auto; max-width: 440pt; text-align: center; }
  .flow-node .n { display: inline-block; font-size: 9pt; font-weight: bold; color: #fff;
    background: #1f3a5f; border-radius: 50%; width: 17pt; height: 17pt; line-height: 17pt; margin-right: 6pt; vertical-align: middle; }
  .flow-node .t { font-weight: bold; font-size: 10.5pt; vertical-align: middle; }
  .flow-node .k { display: block; font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2pt; }
  .flow-node.terminal { border-radius: 20pt; background: #eff6ff; }
  .flow-node.decision { background: #fffbeb; border-color: #b45309; }
  .flow-node.decision .n { background: #b45309; }
  .flow-node.blocked { background: #fef2f2; border-color: #b91c1c; }
  .flow-node.blocked .n { background: #b91c1c; }
  .flow-arrow { text-align: center; color: #1f3a5f; font-size: 14pt; line-height: 1.1; margin: 1pt 0; }
  .flow-arrow .lbl { display: block; font-size: 8.5pt; color: #475569; font-style: italic; }
  .flow-branches { font-size: 10pt; margin: 8pt 0 0; padding-left: 18pt; color: #334155; }
  .flow-text { background: #f8fafc; border: 1pt solid #e2e8f0; border-radius: 4pt;
    padding: 8pt 10pt; font-size: 10pt; margin-top: 10pt; break-inside: avoid; }
  table.rec { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin: 6pt 0 12pt; }
  table.rec th, table.rec td { border: 1pt solid #d1d5db; padding: 6pt 8pt; vertical-align: top; text-align: left; }
  table.rec th { background: #f1f5f9; color: #334155; }
  table.rec tr { break-inside: avoid; }
  .rev-line { font-size: 9.5pt; color: #475569; background: #f8fafc; border: 1pt solid #e2e8f0;
    border-radius: 4pt; padding: 5pt 9pt; margin: 0 0 12pt; break-inside: avoid; }
  /* handbook cover */
  .cover { page-break-after: always; padding-top: 130pt; text-align: center; }
  .cover .brand { font-size: 11pt; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7280; margin-bottom: 18pt; }
  .cover h1 { font-size: 30pt; margin-bottom: 8pt; }
  .cover .role { font-size: 20pt; color: #1f3a5f; margin-bottom: 26pt; }
  .cover .cov-meta { font-size: 11pt; color: #334155; line-height: 2; }
  .cover .cov-note { margin: 30pt auto 0; max-width: 440pt; text-align: left; }
  /* handbook TOC */
  .toc { page-break-after: always; }
  .toc h2 { border: none; margin-top: 0; }
  .toc-area { font-size: 12pt; font-weight: bold; color: #1f3a5f; margin: 14pt 0 4pt;
    border-bottom: 1pt solid #cbd5e1; padding-bottom: 3pt; break-after: avoid; }
  .toc-entry { margin: 0 0 3pt 8pt; font-size: 10.5pt; line-height: 1.45; }
  .toc-entry a { color: #10243e; text-decoration: none; }
  .toc-entry .rev { color: #64748b; font-size: 9pt; white-space: nowrap; }
  .guide-section { page-break-before: always; }
  .guide-section.first { page-break-before: auto; }
  .avail-ok { color: #166534; font-weight: bold; }
  .avail-cond { color: #92400e; font-weight: bold; }
`;

// ---------------------------------------------------------------- rendering

const FIRST_PAGE_NOTE = (area, slug) =>
  `<div class="note-box"><strong>About this PDF.</strong> This PDF was generated from the online guide at ` +
  `<strong>/how-it-works/${clean(area)}/${clean(slug)}</strong>. The online version is the primary, most current edition.</div>`;

function renderProcessMap(pm, processMapText) {
  const nodes = new Map(pm.nodes.map(n => [n.id, n]));
  const incoming = new Map();
  for (const e of pm.edges) incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
  const start = pm.nodes.find(n => n.type === 'terminal' && !(incoming.get(n.id) > 0))
    || pm.nodes.find(n => n.id === 'start')
    || pm.nodes[0];

  // Walk the main path: prefer unlabeled edges, then the first edge.
  const main = [];
  const seen = new Set();
  let cur = start;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    main.push(cur);
    const outs = pm.edges.filter(e => e.from === cur.id);
    const next = outs.find(e => !e.label) || outs[0];
    cur = next ? nodes.get(next.to) : null;
  }
  const mainPairs = new Set();
  for (let i = 0; i < main.length - 1; i++) {
    const e = pm.edges.find(e => e.from === main[i].id && e.to === main[i + 1].id);
    if (e) mainPairs.add(e);
  }
  const branches = pm.edges.filter(e => !mainPairs.has(e));

  const kindLabel = { terminal: 'Start / end', step: 'Step', decision: 'Decision', blocked: 'Blocked path' };
  let html = '<div class="flow">';
  main.forEach((n, i) => {
    html += `<div class="flow-node ${clean(n.type)}"><span class="n">${i + 1}</span>` +
      `<span class="t">${clean(n.label)}</span><span class="k">${clean(kindLabel[n.type] || n.type)}</span></div>`;
    if (i < main.length - 1) {
      const e = pm.edges.find(e => e.from === main[i].id && e.to === main[i + 1].id);
      html += `<div class="flow-arrow">&#8595;${e && e.label ? `<span class="lbl">${clean(e.label)}</span>` : ''}</div>`;
    }
  });
  html += '</div>';
  if (branches.length) {
    html += '<ul class="flow-branches">';
    for (const e of branches) {
      const from = nodes.get(e.from), to = nodes.get(e.to);
      html += `<li>${e.label ? `<em>${clean(e.label)}:</em> ` : ''}` +
        `${clean(from ? from.label : e.from)} &#8594; ${clean(to ? to.label : e.to)}</li>`;
    }
    html += '</ul>';
  }
  html += `<div class="flow-text"><strong>Text version.</strong> ${clean(processMapText)}</div>`;
  return html;
}

function renderFigure(guide, step, shot, figNum, sidecar) {
  const key = `${guide.id}/${step.id}/${shot.viewport}`;
  const entry = sidecar[key];
  if (!entry) {
    // Known screenshot gap: labeled placeholder, never a failure.
    return `<div class="placeholder"><div class="ph-title">Screenshot planned</div>` +
      `<div class="ph-desc">Screen: <strong>${clean(shot.screen)}</strong><br>` +
      `State: ${clean(shot.state)}</div></div>`;
  }
  const badges = (entry.annotations || []).map(a =>
    `<span class="ann-badge" style="left:${Number(a.x)}%;top:${Number(a.y)}%">${Number(a.n)}</span>`
  ).join('');
  const legend = (entry.annotations || []).length
    ? `<ol class="ann-legend">` + (entry.annotations || [])
        .map(a => `<li><strong>${Number(a.n)}.</strong> ${clean(a.label)}</li>`).join('') + `</ol>`
    : '';
  return `<figure class="fig"><div class="imgwrap">` +
    `<img class="shot" src="${imageDataUri(entry.src)}" alt="${clean(entry.alt || shot.alt)}">` +
    `${badges}</div>` +
    `<figcaption><strong>Figure ${figNum}.</strong> ${clean(entry.caption || shot.caption)}` +
    (entry.alt ? ` <span class="alt">(Image description: ${clean(entry.alt)})</span>` : '') +
    `</figcaption>${legend}</figure>`;
}

function renderSteps(guide, sidecar) {
  let html = '';
  let figNum = 0;
  guide.steps.forEach((step, i) => {
    const desktop = (step.screenshots || []).find(s => s.viewport === 'desktop')
      || (step.screenshots || [])[0];
    let fig = '';
    if (desktop) {
      figNum += 1;
      fig = renderFigure(guide, step, desktop, figNum, sidecar);
    }
    html += `<div class="step"><h3>Step ${i + 1}: ${clean(step.title)}</h3>` +
      `<p>${clean(step.body)}</p>` +
      (step.expectedResult
        ? `<div class="expected"><strong>Expected result:</strong> ${clean(step.expectedResult)}</div>` : '') +
      fig + `</div>`;
  });
  return html;
}

function renderGuideBody(guide, sidecar, guidesById) {
  const areaTitle = AREA_TITLE.get(guide.area) || guide.area;
  const avail = guide.availability === 'supported'
    ? '<span class="avail-ok">Supported</span>'
    : '<span class="avail-cond">Conditional</span>';
  const conditions = (guide.conditions || []).length
    ? `<tr><th>Conditions</th><td><ul>` +
      guide.conditions.map(c => `<li>${clean(c)}</li>`).join('') + `</ul></td></tr>`
    : '';
  const prereqs = (guide.prerequisites || []).length
    ? `<div class="section"><h2>Before you start</h2><ol>` +
      guide.prerequisites.map(p => `<li>${clean(p.text)}</li>`).join('') + `</ol></div>`
    : '';
  const recovery = (guide.recovery || []).length
    ? `<div class="section"><h2>If something goes wrong</h2><table class="rec">` +
      `<tr><th style="width:38%">Problem</th><th>What to do</th></tr>` +
      guide.recovery.map(r => `<tr><td>${clean(r.problem)}</td><td>${clean(r.solution)}</td></tr>`).join('') +
      `</table></div>`
    : '';
  const related = (guide.relatedGuides || []).length
    ? `<div class="section"><h2>Related guides</h2><ul>` +
      guide.relatedGuides.map(id => {
        const g = guidesById.get(id);
        return `<li>${clean(g ? g.title : id)} <span style="color:#64748b">(${clean(id)})</span></li>`;
      }).join('') + `</ul></div>`
    : '';
  const siteLinks = (guide.siteLinks || []).length
    ? `<div class="section"><h2>Links in the app</h2><ul>` +
      guide.siteLinks.map(l => `<li>${clean(l.label)} <span style="color:#64748b">${clean(l.href)}</span></li>`).join('') +
      `</ul></div>`
    : '';

  return `
    <div class="breadcrumb">SOP Library / ${clean(areaTitle)}<span class="lang-badge">English</span></div>
    <h1>${clean(guide.title)}</h1>
    <table class="meta-table">
      <tr><th>Guide ID</th><td><strong>${clean(guide.id)}</strong></td></tr>
      <tr><th>Revision</th><td>Revision ${Number(guide.revision)} (generated ${clean(REVISION_DATE)})</td></tr>
      <tr><th>Intended for</th><td>${(guide.intendedRoles || []).map(clean).join(', ')}</td></tr>
      <tr><th>Availability</th><td>${avail}</td></tr>
      ${conditions}
      <tr><th>Online version</th><td>/how-it-works/${clean(guide.area)}/${clean(guide.slug)}</td></tr>
    </table>
    <div class="section"><h2>Goal</h2><p>${clean(guide.goal)}</p></div>
    ${prereqs}
    <div class="section"><h2>Process map</h2>${renderProcessMap(guide.processMap, guide.processMapText)}</div>
    <div class="section"><h2>Steps</h2>${renderSteps(guide, sidecar)}</div>
    <div class="section"><h2>Confirm it worked</h2><p>${clean(guide.confirmOutcome)}</p></div>
    ${recovery}
    <div class="section"><h2>Need help?</h2><p>${clean(guide.supportContact)}</p></div>
    ${related}
    ${siteLinks}`;
}

function pageShell({ title, body, headerTitle }) {
  const ht = `<div style="font-size:8pt;color:#6b7280;width:100%;padding:0 0.65in;box-sizing:border-box;">` +
    `<span style="float:left">OxSteed Visual SOP Library</span><span style="float:right">English</span></div>`;
  const ft = `<div style="font-size:8pt;color:#6b7280;width:100%;padding:0 0.65in;box-sizing:border-box;">` +
    `<span style="float:left;max-width:75%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${clean(headerTitle)}</span>` +
    `<span style="float:right">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  return { headerTemplate: ht, footerTemplate: ft, html:
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${clean(title)}</title>` +
    `<style>${CSS}</style></head><body>${body}</body></html>` };
}

// ---------------------------------------------------------------- documents

function buildGuideDoc(guide, sidecar, guidesById) {
  const body = FIRST_PAGE_NOTE(guide.area, guide.slug) +
    `<div class="guide-section first">${renderGuideBody(guide, sidecar, guidesById)}</div>`;
  const title = `${guide.title} - OxSteed SOP`;
  return pageShell({ title, body, headerTitle: guide.title });
}

function buildHandbookDoc(role, guides, sidecar, guidesById) {
  const roleTitle = ROLES.find(r => r.slug === role).title;
  let toc = '';
  let lastArea = null;
  for (const g of guides) {
    if (g.area !== lastArea) {
      lastArea = g.area;
      toc += `<div class="toc-area">${clean(AREA_TITLE.get(g.area) || g.area)}</div>`;
    }
    toc += `<div class="toc-entry"><a href="#guide-${clean(g.id)}">${clean(g.title)}</a> ` +
      `<span class="rev">(rev ${Number(g.revision)})</span></div>`;
  }
  const coverNote = `<div class="note-box"><strong>About this PDF.</strong> This handbook was generated from the ` +
    `online guides in the SOP library at <strong>/how-it-works</strong>. The online versions are the primary, ` +
    `most current editions.</div>`;
  const cover = `<div class="cover">
      <div class="brand">OxSteed</div>
      <h1>Standard Operating Procedures</h1>
      <div class="role">${clean(roleTitle)} Handbook</div>
      <div class="cov-meta">
        Language: <strong>English</strong><br>
        Revision date: <strong>${clean(REVISION_DATE)}</strong><br>
        Guides included: <strong>${guides.length}</strong>
      </div>
      <div class="cov-note">${coverNote}</div>
      <div class="cov-meta" style="margin-top:18pt;font-size:10pt;color:#6b7280">
        Revision info: this edition was generated on ${clean(REVISION_DATE_ISO)} from the guide
        data files. Each guide section below carries its own revision line
        (guide ID and revision number).
      </div>
    </div>`;
  const tocHtml = `<div class="toc"><h2>Contents</h2><p style="font-size:10pt;color:#475569">` +
    `Select a guide to jump to its section.</p>${toc}</div>`;

  let sections = '';
  guides.forEach((g, i) => {
    sections += `<div class="guide-section${i === 0 ? ' first' : ''}" id="guide-${clean(g.id)}">` +
      `<div class="rev-line"><strong>Guide ID:</strong> ${clean(g.id)} &nbsp;|&nbsp; ` +
      `<strong>Revision:</strong> ${Number(g.revision)} &nbsp;|&nbsp; ` +
      `<strong>Area:</strong> ${clean(AREA_TITLE.get(g.area) || g.area)}</div>` +
      renderGuideBody(g, sidecar, guidesById) + `</div>`;
  });
  const title = `OxSteed SOP ${roleTitle} Handbook`;
  return pageShell({ title, body: cover + tocHtml + sections, headerTitle: title });
}

// ---------------------------------------------------------------- main

const args = process.argv.slice(2);
const guidesOnly = args.includes('--guides-only');
const handbooksOnly = args.includes('--handbooks-only');
const onlyGuide = args.includes('--guide') ? args[args.indexOf('--guide') + 1] : null;

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error(`Chrome headless shell not found at ${CHROME}. Set SOP_PDF_CHROME.`);
    process.exit(1);
  }
  const guides = await loadGuides();
  const guidesById = new Map(guides.map(g => [g.id, g]));
  const sidecar = JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf8'));

  const targets = onlyGuide ? guides.filter(g => g.id === onlyGuide) : guides;
  if (onlyGuide && !targets.length) {
    console.error(`Unknown guide id: ${onlyGuide}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_GUIDES, { recursive: true });
  fs.mkdirSync(OUT_HANDBOOKS, { recursive: true });
  fs.mkdirSync(TMP_HTML, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();

  const pdfOpts = (headerTemplate, footerTemplate) => ({
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
    margin: { top: '0.75in', bottom: '0.75in', left: '0.65in', right: '0.65in' },
  });

  async function printDoc(doc, outPath) {
    const htmlPath = path.join(TMP_HTML, path.basename(outPath, '.pdf') + '.html');
    fs.writeFileSync(htmlPath, doc.html);
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.pdf({ ...pdfOpts(doc.headerTemplate, doc.footerTemplate), path: outPath });
    const size = fs.statSync(outPath).size;
    console.log(`wrote ${path.relative(REPO, outPath)} (${(size / 1024).toFixed(0)} KB)`);
  }

  if (!handbooksOnly) {
    for (const g of targets) {
      await printDoc(buildGuideDoc(g, sidecar, guidesById), path.join(OUT_GUIDES, `${g.id}.pdf`));
    }
  }
  if (!guidesOnly && !onlyGuide) {
    for (const role of ROLES) {
      const rg = guides.filter(g => (g.audiences || []).includes(role.slug));
      await printDoc(
        buildHandbookDoc(role.slug, rg, sidecar, guidesById),
        path.join(OUT_HANDBOOKS, `${role.slug}.pdf`));
    }
  }
  await browser.close();
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });
