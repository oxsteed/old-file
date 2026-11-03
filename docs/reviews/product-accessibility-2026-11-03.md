# Product navigation and loading review

The shared skip link now moves keyboard focus to the main landmark and scrolls
there. Food announces its loading state while hiding decorative skeletons from
assistive technology. Direct and Messages expose their loading copy as a
status. Workspace section buttons expose the current selection and an inset
focus outline that stays visible inside the scrolling strip. The panel loading
status appears without removing the navigation.

## Live navigation timing

Chromium on this Mac, anonymous production session, unthrottled network and
fresh browser context per destination and viewport. Measured from activating
a visible homepage link to visible destination content. For Food this also
waited for the directory skeleton to clear. The first visit can include
prefetching and the returns reuse the context. Values include browser
automation overhead and are diagnostic samples, not population estimates.

| Destination | Viewport | First visit | Returns |
| --- | --- | ---: | ---: |
| Food directory | 1440px | 3,464 ms | 2,159 ms, 494 ms |
| Direct | 1440px | 2,047 ms | 350 ms, 855 ms |
| Food directory | 390px | 633 ms | 504 ms, 1,162 ms |
| Direct | 390px | 992 ms | 90 ms |

All eleven observed transitions stayed in the same browser document. The last
mobile Direct repetition was unavailable because the harness timed out waiting
for the homepage link after navigating back. Authenticated production timings
and a repeatable comparison under network throttling remain open.

## Production rollout follow-up

The post-merge CI run for `42938cd86` was canceled, so the automatic image
workflow skipped it. Its merged PR had passed all four required checks. The
verified image workflow was dispatched, and the host observer promoted it as
deployment `2ul3u3r7w2uq4su8lwlyguyd` from image run `41599189304`.
Public readiness confirmed the commit, deployment ID, and all 1,039 migrations.

The 323-request observation recorded four failures. Three were proxy-generated
503s before the new app container started, with no origin response. The other
was a readiness 503 during candidate startup. The old web container logged a
failed background readiness observation at that time and recovered. The test
tab stayed usable after the switch, its old asset returned 200, and its socket
reconnected in 1.58 seconds. The November 2 clean rollout remains valid
evidence for that window, but the November 3 failures reopen continuous
availability acceptance. Next, trace the pre-start proxy withdrawal and
rehearse the behavior of an already-serving web replica during a transient
background probe failure. Keep candidate startup and confirmed dependency
failure checks strict.

## Local verification

The full client build and verification of 1,156 emitted assets passed. Six
built-app browser cases with held API responses covered Food, Direct, and
Messages in English desktop/light and Arabic mobile/dark. They verified one
main landmark, skip-link focus, loading announcements, and visible focus on
Food and Direct product links. The workspace browser suite passed its matching
desktop and mobile checks, plus selection, navigation during a delayed panel,
modal keyboard behavior, and the existing employee access case. Its synthetic
cold workspace timings were 807 and 1,133 ms and warm profile returns were
158 and 133 ms. Production publication of the accessibility changes is pending.
