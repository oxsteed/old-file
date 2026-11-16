import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/components/ProductReviewsSection.tsx'), 'utf8');

assert.match(source, /hasHelperAccess/);
assert.match(source, /const isHelper = Boolean\(user && hasHelperAccess\)/);
assert.doesNotMatch(source, /\['helper', 'helper_pro', 'broker'\]\.includes\(user\.role\)/);

console.log('progressive access product review contract passed');
