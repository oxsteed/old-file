// Entry point for node --test unit tests under src/: registers the
// extension-resolving loader. Usage:
//   node --import ./src/register-test-loader.mjs --test src/hooks/...
import { register } from 'node:module';

register('./test-extension-loader.mjs', import.meta.url);
