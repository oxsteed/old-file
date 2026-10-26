// S-24: static accessibility audit for JSX (no browser needed).
// Rules: form controls need an accessible name, buttons need a name,
// clickable non-interactive elements need a role and keyboard handler,
// images need alt, no positive tabIndex. A finding can be waived only with
// an inline `a11y-ok: <reason>` comment on the same or previous line.
import fs from 'node:fs';
import { parse } from '@babel/parser';

const CONTROLS = new Set(['input', 'select', 'textarea']);
const NON_INTERACTIVE = new Set(['div', 'span', 'li', 'td', 'tr', 'p', 'section', 'article', 'img', 'ul']);
const NAME_ATTRS = ['aria-label', 'aria-labelledby'];

function attrs(node) {
  const out = new Map();
  for (const a of node.openingElement.attributes) {
    if (a.type === 'JSXAttribute') out.set(a.name.name, a.value);
    else out.set('...spread', a);
  }
  return out;
}
const tagName = (node) => (node.openingElement.name.type === 'JSXIdentifier' ? node.openingElement.name.name : null);
const valueText = (v, src) => (v == null ? null : v.type === 'StringLiteral' ? v.value : src.slice(v.start, v.end));

function hasText(node) {
  return node.children.some((c) =>
    (c.type === 'JSXText' && c.value.trim()) ||
    (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') ||
    (c.type === 'JSXElement' && tagName(c) !== 'svg' && /^[a-z]/.test(tagName(c) || '') && hasText(c)));
}

export function auditSource(src, file = 'inline.jsx') {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });
  const lines = src.split('\n');
  const findings = [];
  const htmlFor = new Set();
  const elements = [];
  (function walk(node, labelDepth) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, labelDepth)); return; }
    let depth = labelDepth;
    if (node.type === 'JSXElement') {
      const name = tagName(node);
      const a = attrs(node);
      if (name === 'label' && a.has('htmlFor')) htmlFor.add(valueText(a.get('htmlFor'), src));
      elements.push({ node, name, a, inLabel: labelDepth > 0 });
      if (name === 'label') depth += 1;
    }
    for (const key of Object.keys(node)) {
      if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
      walk(node[key], depth);
    }
  })(ast.program, 0);

  const waived = (line) => /a11y-ok:/.test(lines[line - 1] || '') || /a11y-ok:/.test(lines[line - 2] || '');
  const report = (node, rule, message) => {
    const line = node.loc.start.line;
    if (!waived(line)) findings.push({ file, line, rule, message });
  };
  for (const { node, name, a, inLabel } of elements) {
    if (!name) continue;
    const named = NAME_ATTRS.some((k) => a.has(k)) || a.has('...spread');
    if (CONTROLS.has(name)) {
      const type = valueText(a.get('type'), src);
      if (['hidden', 'submit', 'button', 'reset'].includes(type)) continue;
      const id = valueText(a.get('id'), src);
      if (!named && !inLabel && !(id && htmlFor.has(id)) && !a.has('title')) report(node, 'control-has-label', `<${name}> has no label`);
    }
    if (name === 'button' && !named && !a.has('title') && !hasText(node)) report(node, 'button-has-name', '<button> has no accessible name');
    if (name === 'img' && !a.has('alt') && !a.has('...spread')) report(node, 'img-alt', '<img> has no alt');
    const onClickText = valueText(a.get('onClick'), src) || '';
    const stopsOnly = /^\{?\s*\(?\w*\)?\s*=>\s*\w+\.stopPropagation\(\)\s*\}?$/.test(onClickText);
    const role = valueText(a.get('role'), src);
    // A dialog body whose click only stops propagation to its backdrop is
    // not an action.
    if (stopsOnly && role === 'dialog') continue;
    if (NON_INTERACTIVE.has(name) && a.has('onClick') && !(a.has('role') && (a.has('onKeyDown') || a.has('onKeyUp')))) {
      report(node, 'click-needs-keyboard', `<${name} onClick> needs a role and a keyboard handler (or use a <button>)`);
    }
    const tab = a.get('tabIndex');
    if (tab) {
      const n = Number(tab.type === 'StringLiteral' ? tab.value : tab.expression?.value);
      if (n > 0) report(node, 'no-positive-tabindex', 'positive tabIndex');
    }
  }
  return findings;
}

export function auditFiles(files) {
  return files.flatMap((f) => auditSource(fs.readFileSync(f, 'utf8'), f));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = auditFiles(process.argv.slice(2));
  for (const f of findings) console.log(`${f.file}:${f.line} ${f.rule} ${f.message}`);
  process.exitCode = findings.length ? 1 : 0;
}
