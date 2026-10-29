# Dependency alerts 228 and 229

## Runtime qs alert 228

[GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)
affects comma-array serialization of attacker-controlled object elements.
The existing 6.16.0 install reproduces the reported TypeError.

The server override and lockfile now resolve qs 6.17.1 for Express, body-parser,
Stripe, Twilio, and Superagent. This is newer than the first fixed release,
6.16.1. No unrelated dependency versions changed.

## Development deepmerge alert 229

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
has no published patched release as of this check. npm latest is 4.3.1; the
latest jest-config still depends on it. The reported nested null-placeholder
payload reproduces returned-object prototype poisoning, without changing
Object.prototype.

The dependency is brought in by jest-config for test configuration merging.
It is marked development-only in the lockfile and absent from
`npm ls deepmerge --omit=dev`. Dockerfile uses `npm ci --omit=dev` for the server
runtime stage. These checks establish dependency/build configuration, not an
inspection of the running production image.

Leave alert 229 open. Do not downgrade to a pre-4.2 release merely to escape
the advisory's listed range, or accept npm audit's suggested Jest 25 downgrade
as a verified security fix. Recheck for an upstream patched deepmerge release
or a Jest release that removes it. If the issue must be eliminated from the
development graph before then, replacing that dependency needs a separate
compatibility review of Jest configuration merging.

## Verification

- Clean dependency install from the updated lockfile with lifecycle scripts
  disabled: `npm ci --ignore-scripts --no-audit --no-fund` passed.
- `npm test -- --runInBand __tests__/querystringSecurity.test.js __tests__/securityHardening.test.js __tests__/responseSanitizer.test.js`:
  3 suites and 19 tests passed. Regressions cover hostile JSON, extended queries,
  null-prototype objects, nested arrays, both comma-encoding paths, and normal
  Express query/form parsing.
- `npm ls qs`: every installed server copy resolves to 6.17.1.
- `npm audit --omit=dev --json`: zero reported vulnerabilities.
- Full `npm audit --json`: five low entries describe deepmerge and its Jest
  dependency chain. The underlying development advisory remains unresolved.
- `git diff --check` passed. Merge, deployment, and GitHub's alert rescan are
  separate from these local checks.
