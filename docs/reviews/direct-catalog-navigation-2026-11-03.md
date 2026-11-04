# Direct catalog route size and timing

The public Direct route loaded the request portal, including quote, booking,
payment, and account screens. It now opens the catalog directly through the
shared prefetch loader. The portal still opens on its existing routes. Food
prefetch applies only to the directory, so merchant, restaurant-detail, and
order links do not warm an unrelated landing page.

Both builds used default-branch commit `d89274619` as the base. The manifest
comparison sums additional static JavaScript dependencies after excluding
assets already loaded by the application shell and homepage. Gzip sizes are
computed per file. CSS, API responses, and network headers are excluded.

| Additional Direct JavaScript | Before | After |
| --- | ---: | ---: |
| Files | 38 | 29 |
| Raw bytes | 123,857 | 31,477 |
| Gzip bytes | 33,149 | 12,443 |

In Chromium with the same synthetic API, fresh browser contexts, and
throttling enabled after the homepage loaded, median click-to-visible-catalog
time was 1,925 ms before and 1,411 ms after. The emulated connection used
100 ms latency and 160,000 bytes per second each way. The three samples per
build were 2,005 / 1,919 / 1,925 ms and 1,412 / 1,411 / 1,368 ms. All
transitions stayed in the same document. These are controlled local results.
Production timing for the new release is pending.

The full client build and 16 route reliability tests passed. The built-app
browser check held the prefetched catalog chunk, verified that main
navigation remained visible, then confirmed that opening a quote loaded the
portal chunk without submitting a request.
