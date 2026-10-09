# OxSteed Media — Cloudflare CSAM Scanning Tool runbook

**Policy:** `MEDIA_CSAM_MODE=cloudflare` (owner decision, 2026-10-09)  
**Related:** `docs/oxsteed-media-safety-policy.md`, `docs/oxsteed-media-implementation-status.md`

## What Cloudflare provides (per [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/))

- Zone-level **CSAM Scanning Tool** under **Caching → Configuration**.
- Hashes **images as they enter the Cloudflare cache** (fuzzy-hash match against NCMEC/INHOPE lists).
- On a potential match: Cloudflare **blocks the content URL** when possible and sends **at most one email per day** listing matched file paths (not a real-time webhook in the CSAM tool docs).
- Operators review blocks in **Security Center → Blocked Content** and can request review after takedown or false-positive analysis.
- The tool does **not** scan uploaded **video** before publication.

OxSteed does **not** assume Cloudflare Notifications can deliver CSAM match events to a webhook; match handling is **email + manual admin takedown** in the app.

## OxSteed application behavior (`MEDIA_CSAM_MODE=cloudflare`)

| Asset | Public publication |
|-------|-------------------|
| **Photos** | Allowed when processed, malware-clean, and `MEDIA_CLOUDFLARE_HOST` (and optional `MEDIA_CLOUDFLARE_PUBLIC_BASE_URL`) point at the Cloudflare-proxied media host so cached delivery is scannable. Misconfiguration blocks public photos in production (startup error log). |
| **Video** | Allowed only when `MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM=true` (owner override, startup warning) or when a **certified vendor** is enabled (`MEDIA_CSAM_MODE=vendor` + `MEDIA_CSAM_CERTIFIED=true`). Otherwise blocked. |

All uploads still require Didit-verified identity (video), ClamAV, quarantine/transcode, rate limits, flags, auto-hide at five open flags, and admin/DMCA takedown.

Each asset records `csam_mode`; videos published under the override set `published_without_csam=true` and an audit row `media_video_published_without_csam`.

## Enable Cloudflare (owner steps)

1. In Cloudflare dashboard: select the **zone** that proxies public Media image URLs.
2. **Caching → Configuration → CSAM Scanning Tool → Configure**.
3. Provide a **verified notification email** (daily digest of matches).
4. Ensure Media **image URLs** are served through that zone (set `MEDIA_CLOUDFLARE_HOST` / `MEDIA_CLOUDFLARE_PUBLIC_BASE_URL` on the server to match).
5. Set server env: `MEDIA_CSAM_MODE=cloudflare`, `MEDIA_CLOUDFLARE_HOST=<your-host>`.
6. If publishing video without upload-time CSAM is intentional: `MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM=true` (review startup warning; turn off when a vendor is live).
7. Deploy with `OXSTEED_MEDIA_LAUNCHED=true` only when ready to expose Media.

## When Cloudflare emails a match

1. Note the **file path** from the daily email.
2. In OxSteed admin (**Media Flags**), use **Cloudflare CSAM takedown** and paste the **full public URL**.
3. Confirm the post is removed/quarantined and appears in admin audit (`media_cloudflare_csam_takedown`).
4. Follow legal obligations (NCMEC CyberTip, preservation, etc.) per Cloudflare’s guidance.

## Verify it is working

- Confirm images are requested via the configured Cloudflare hostname (not only signed direct-to-origin URLs).
- Upload a test image in a staging zone with the tool enabled; check cache hit and response headers.
- Confirm production startup logs **no** `[mediaCloudflareDelivery] … MEDIA_CLOUDFLARE_HOST is not configured` error when `MEDIA_CSAM_MODE=cloudflare`.

## Turn off the video override later

Set `MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM=false` (or unset), enable vendor mode with certification, and reprocess or restrict existing `published_without_csam` assets as needed.
