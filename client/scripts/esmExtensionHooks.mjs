// ESM resolve hooks for node --test files that import Vite-style source
// modules. The client source uses extensionless relative imports
// (e.g. `from './analytics'`), which Vite resolves but Node ESM does not.
// Register this file with `module.register` before dynamically importing
// the module under test; it falls through to Node's resolver first and
// only appends a known extension when resolution fails.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw error;
    if (!context.parentURL) throw error;
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    for (const ext of EXTENSIONS) {
      if (existsSync(base + ext)) {
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    throw error;
  }
}
