# Origin authentication deployment prerequisite

## Checkpoint: 2026-10-13

PR569 merged as 79273afb after CI38467387313 passed. Coolify automatically
started deployment q7rriumxfykqzx2hilpymqlb. It was cancelled before rollout:
the running application had no origin secret, and the Coolify production
ORIGIN_SHARED_SECRET entry was blank. The existing application remained healthy.
Cloudflare had no Request Header Transform Rules for oxsteed.com.

The Cloudflare rule form and Coolify variable editor were prepared but not saved.
No secret was generated, read back, entered, or changed. Browser credential entry
requires the owner to take over. Keep the rollout stopped until both sides match.

## Configure both sides before deployment

1. Generate a random 32-byte secret in the owner's secure secret-management
   workflow; a 64-character hexadecimal value is suitable. Do not put it in
   source, logs, chat, screenshots, or browser-facing VITE variables. Agent
   access to stored secrets must use the installed aws-secrets-manager skill's
   runtime dynamic references through asm-exec, never plaintext retrieval.
2. Cloudflare: create a **Request Header Transform Rule**, named
   `OxSteed origin authentication`, matching
   `(http.host in {"oxsteed.com" "www.oxsteed.com"})`. Set static header
   `x-origin-auth` to the secret. This replaces any client-supplied value.
   Confirm these application hostnames have proxied DNS records; scope any
   additional application hostname explicitly rather than sending the secret
   to unrelated origins. Deploy the rule before rolling out the app.
3. Coolify application `OxSteed Website GitHub`, UUID tdrapz1vvcoftfwsk7fcdq0h:
   set production `ORIGIN_SHARED_SECRET` to the same value, with runtime enabled
   and build-time disabled. The default header name is already `x-origin-auth`.
   Keep `ORIGIN_LOCK_DISABLED` unset or false. Save the variable.
4. Include the readiness-exemption fix before deploying. Dockerfile and
   docker-compose.coolify.yml probe `/ready`; both `/ready` and `/api/ready`
   must pass the origin and maintenance gates without a secret. They still
   return the actual readiness service's 200/503 result. Configure and save both
   secret settings before merging the fix: a merge may trigger Coolify's automatic
   deployment.

Cloudflare's [Set static operation](https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/)
overwrites an existing request header. Use a request-header rule, not a response
header rule, so the secret is sent to the origin rather than website visitors.

## Acceptance after a controlled rollout

- Production starts with the configured secret; boot fails without it unless
  the explicit opt-out is set. Do not use that opt-out for this rollout.
- Proxied application requests work with Cloudflare injecting the header.
- Direct-origin requests to a protected application route return 403 when the
  header is missing or wrong, including forged X-Forwarded-For requests.
- The real Docker/Coolify `/ready` probe works without the header. Similar
  paths such as `/ready/other` remain protected.
- Check representative authenticated requests and realtime connections after
  deployment. These live acceptance checks remain outstanding at this checkpoint.

The preparation does not prove production origin authentication is active.
Report saved configuration, deployment, and live acceptance separately.

Local validation: four focused Jest suites / 113 tests passed, covering origin
boot refusal, secret matching, actual Express readiness requests, forged-XFF
rejection, maintenance-mode exemptions, deployment wiring and proxy-hop parsing.
`git diff --check` passed. Remote CI and live configuration acceptance remain
separate requirements; no deployment was resumed.
