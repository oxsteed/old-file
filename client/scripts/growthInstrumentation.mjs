import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
const routes = new Set(
  JSON.parse(fs.readFileSync(path.join(root, 'src/growth/routes.json'))),
);
const appText = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const app = ts.createSourceFile(
  'App.jsx',
  appText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JSX,
);
const components = new Set();
function visit(node) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(app) === 'Route'
  ) {
    const attrs = node.attributes.properties;
    const route = attrs.find(
      (a) => ts.isJsxAttribute(a) && a.name.getText(app) === 'path',
    );
    if (
      route?.initializer &&
      ts.isStringLiteral(route.initializer) &&
      routes.has(route.initializer.text)
    ) {
      const element = attrs.find(
        (a) => ts.isJsxAttribute(a) && a.name.getText(app) === 'element',
      );
      if (element)
        for (const match of element.getText(app).matchAll(/<([A-Z][\w]*)/g))
          components.add(match[1]);
    }
  }
  ts.forEachChild(node, visit);
}
visit(app);
const seeds = [];
for (const match of appText.matchAll(
  /const (\w+) = lazyWithRetry\(\(\) => import\('([^']+)'\)/g,
))
  if (components.has(match[1])) seeds.push(path.resolve(root, 'src', match[2]));
const resolve = (file) =>
  ['', '.jsx', '.tsx', '.js', '.ts', '/index.jsx', '/index.tsx', '/index.js']
    .map((s) => file + s)
    .find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
const visited = new Set(),
  queue = seeds;
let total = 0,
  named = 0;
const edits = [];
const elementKeys=new Set();
const privatePath =
  /admin|growth|credit|wallet|payment|support|message|chat|auth|login|register|password|identity|verification|dispute|statement/i;
while (queue.length) {
  const file = resolve(queue.pop());
  if (!file || visited.has(file) || !file.startsWith(path.join(root, 'src')))
    continue;
  visited.add(file);
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8'),
    ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
    );
  for (const match of source.matchAll(
    /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g,
  ))
    if (match[1].startsWith('.'))
      queue.push(path.resolve(path.dirname(file), match[1]));
  const privateFile = privatePath.test(relative);
  const prefix = `ui.${crypto.createHash('sha256').update(relative).digest('hex').slice(0, 10)}.`;
  let sequence = Math.max(
    0,
    ...[...source.matchAll(/data-track="(ui\.[a-f0-9]+\.)([0-9]+)"/g)]
      .filter((m) => m[1] === prefix)
      .map((m) => Number(m[2])),
  );
  const inserts = [];
  const scan = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast),
        attributes = node.attributes.properties;
      const attr = (name) =>
        attributes.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText(ast) === name,
        );
      const role = attr('role')?.initializer?.text;
      const type = attr('type')?.initializer?.text;
      if (
        ['a', 'button', 'form'].includes(tag) ||
        ['button', 'tab'].includes(role) ||
        (tag === 'input' && ['checkbox', 'radio', 'submit'].includes(type))
      ) {
        const controlText=(ts.isJsxElement(node.parent)?node.parent:node).getText(ast);
        const privateControl=privateFile||/\b(?:credit|wallet|password|cardnumber|cvv|ssn|identity)\b/i.test(controlText);
        let ancestor = node.parent,
          privateElement = privateControl;
        while (ancestor) {
          if (
            (ts.isJsxElement(ancestor) ||
              ts.isJsxSelfClosingElement(ancestor)) &&
            ancestor
              .getText(ast)
              .slice(0, ancestor.openingElement?.end - ancestor.pos || 200)
              .includes('data-track-private')
          ) {
            privateElement = true;
            break;
          }
          ancestor = ancestor.parent;
        }
        if (privateControl && !attr('data-track-private'))
          inserts.push({
            offset: node.attributes.end,
            text: ' data-track-private',
          });
        if (!privateElement) {
          total++;
          if (attr('data-track')&&ts.isStringLiteral(attr('data-track').initializer)) {named++;elementKeys.add(attr('data-track').initializer.text);}
          else {
            sequence++;
            const key = `ui.${crypto.createHash('sha256').update(relative).digest('hex').slice(0, 10)}.${sequence}`;
            elementKeys.add(key);
            inserts.push({
              offset: node.attributes.end,
              text: ` data-track="${key}"`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, scan);
  };
  scan(ast);
  if (inserts.length) {
    let text = source;
    for (const edit of inserts.sort((a, b) => b.offset - a.offset))
      text = text.slice(0, edit.offset) + edit.text + text.slice(edit.offset);
    edits.push({ file, text });
  }
}
const report = {
  eligibleFiles: visited.size,
  interactive: total,
  named,
  coverage: total ? named / total : 1,
  filesToAnnotate: edits.length,
};
console.log(JSON.stringify(report));
const registry=JSON.stringify([...elementKeys].sort(),null,2)+'\n';
for(const file of [path.join(root,'src/growth/elementKeys.json'),path.join(root,'../server/growth/events/elementKeys.json')]){
  if(process.argv.includes('--write'))fs.writeFileSync(file,registry);
  else if(process.argv.includes('--check')&&(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==registry)){console.error('Tracking key registry is stale. Run growthInstrumentation.mjs --write.');process.exitCode=1;}
}
if (process.argv.includes('--write'))
  for (const edit of edits) fs.writeFileSync(edit.file, edit.text);
if (process.argv.includes('--check') && report.coverage < 0.95)
  process.exitCode = 1;
