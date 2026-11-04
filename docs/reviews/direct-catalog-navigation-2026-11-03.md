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
Production measurements are recorded below.

The full client build and 16 route reliability tests passed. The built-app
browser check held the prefetched catalog chunk, verified that main
navigation remained visible, then confirmed that opening a quote loaded the
portal chunk without submitting a request.

## Production verification

PR #682 merged as `bf1df8ea41efdb7ca3eee0f4809bdf6ce57cddbf`. Its
deployment `4ogjouei2bdqwb8ethdoop7p` completed through the image observer.
The public monitor recorded 267 requests with zero failures. Its existing
browser document still navigated to Food and its original script returned
200. Realtime reconnected in 1,007 ms.

The same Chromium profile measured the actual site before and after that
deployment, using fresh contexts, blocked service workers, and the same
100 ms latency and 160,000 bytes/second throughput. Navigation started after
React attached to the homepage link, without hover prefetch. Both groups
remained on their expected release throughout the samples. All transitions
stayed in the same browser document.

| Live click to visible Direct catalog | Before | After |
| --- | --- | --- |
| Cold samples | 2,406 / 2,384 / 1,865 ms | 1,341 / 1,318 / 1,333 ms |
| Cold median | 2,384 ms | 1,333 ms |
| Warm samples | 1,365 / 820 / 807 ms | 832 / 806 / 799 ms |
| Warm median | 820 ms | 806 ms |

Each old cold navigation downloaded the request portal. Each new cold
navigation reached the catalog without downloading that portal. A separate
live check held the catalog script, confirmed that the main navigation stayed
visible, then opened the quote form and verified that its portal loaded only
then. Production Arabic mobile checks for Food and Direct in dark mode showed
no horizontal overflow. The single live restaurant appeared once and had an
hours label. These browser checks used unauthenticated sessions.
