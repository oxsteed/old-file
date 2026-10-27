import ts from 'typescript';

// Capitalized references include both JSX tags and lazy pages supplied as
// component props. The caller resolves them against actual lazy imports.
export function routePageReferences(element) {
  const references = new Set();
  const collect = node => {
    if (ts.isIdentifier(node) && /^[A-Z]/.test(node.text)) references.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(element);
  return references;
}
