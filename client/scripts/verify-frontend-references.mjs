// A bounded binding check, not full checkJs/type inference. Vite/tsc remain
// responsible for module resolution and type checks; browser tests cover data
// and interaction paths. Deferred callback captures are intentionally allowed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isReference(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
    || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent) || ts.isJsxAttribute(parent) || ts.isJsxNamespacedName(parent)
    || ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent))
    && parent.tagName === node && /^[a-z]/.test(node.text)) return false;
  return true;
}

function functionOwner(node) {
  while (node && !ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent;
  return node;
}

function evaluationOwner(node) {
  while (node && !ts.isSourceFile(node)) {
    if (ts.isFunctionLike(node)) {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && (parent.expression === node
        || ['useMemo', 'useState'].includes(parent.expression.getText().split('.').at(-1)))) {
        node = parent;
        continue;
      }
      return node;
    }
    node = node.parent;
  }
  return node;
}

export function scanReferences(fileNames, options = {}, overrides = new Map()) {
  const compilerOptions = { ...options, allowJs: true, noEmit: true, noResolve: true };
  const host = ts.createCompilerHost(compilerOptions);
  const originalSourceFile = host.getSourceFile;
  // TypeScript normalizes separators before calling the host. Match virtual
  // fixtures by canonical absolute path on Windows as well as Linux.
  const canonicalPath = name => host.getCanonicalFileName(path.resolve(name));
  const sourceOverrides = new Map([...overrides].map(([name, text]) => [canonicalPath(name), text]));
  host.getSourceFile = (name, ...args) => sourceOverrides.has(canonicalPath(name))
    ? ts.createSourceFile(name, sourceOverrides.get(canonicalPath(name)), compilerOptions.target ?? ts.ScriptTarget.ES2020, true)
    : originalSourceFile(name, ...args);
  const program = ts.createProgram(fileNames, compilerOptions, host);
  const checker = program.getTypeChecker();
  const included = new Set(fileNames.map(canonicalPath));
  const findings = [];
  let files = 0;
  for (const source of program.getSourceFiles()) {
    if (!included.has(canonicalPath(source.fileName)) || source.isDeclarationFile) continue;
    files++;
    function walk(node) {
      if (ts.isIdentifier(node) && isReference(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
        const location = source.getLineAndCharacterOfPosition(node.getStart());
        const report = kind => findings.push({ file: source.fileName, line: location.line + 1,
          column: location.character + 1, name: node.text, kind });
        // An unknown global in typeof is safe, but a known lexical variable
        // read in typeof before its declaration still has a temporal dead zone.
        let outer = node.parent;
        while (outer && ts.isParenthesizedExpression(outer)) outer = outer.parent;
        if (!symbol && !ts.isTypeOfExpression(outer)) report('undefined-reference');
        else if (symbol) {
          for (const declaration of symbol.declarations || []) {
            if (declaration.getSourceFile() !== source || declaration.pos <= node.pos
              || (!ts.isVariableDeclaration(declaration) && !ts.isBindingElement(declaration))) continue;
            let list = declaration;
            while (list && !ts.isVariableDeclarationList(list)) list = list.parent;
            if (!list || !(list.flags & ts.NodeFlags.BlockScoped)) continue;
            if (functionOwner(declaration) === evaluationOwner(node)) report('read-before-initialization');
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  return { files, findings };
}

export function verifyFrontendReferences() {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n'));
  const files = parsed.fileNames.filter(name => !/[\\/]__tests__[\\/]|\.(?:test|spec)\.[jt]sx?$/.test(name));
  return scanReferences(files, parsed.options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyFrontendReferences();
  for (const item of result.findings) {
    console.error(`${path.relative(root, item.file)}:${item.line}:${item.column} ${item.kind}: ${item.name}`);
  }
  console.log(`Frontend reference check: ${result.files} files, ${result.findings.length} findings.`);
  if (result.findings.length) process.exitCode = 1;
}
