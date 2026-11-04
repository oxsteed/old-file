# November 4 release and product acceptance

## Readiness release

PR #691 passed the four required checks on head `41bbce99ce1755d4187daaeff4698cd304e0877a`
and merged as `9cf07860649fdf1792474a3784a85c1a8d9edd22`. The merged default-branch
CI run `41893764473` also passed. Verified image run `41893814010` published
`sha256:44f281b2d7cbc295f251ae4c703fc10446330e335776a139229e85f77b37da08`.
The existing automatic observer promoted it as deployment
`5jzztowtw74n7zzphaxrshih`; no second deployment controller was started.

The replacement started at 19:14:39 UTC, became healthy at 19:14:58.637, and
the old container received its stop signal at 19:14:59.903. It exited at
19:15:06.313. The new container has the health5 service/router namespace,
15-second private proxy timeout, and bounded five-second background confirmation.
Public readiness confirmed the exact commit, image and deployment ID.
Worker, PostgreSQL and Redis container IDs and November 2 start times were
unchanged. Upload and asset storage were preserved.

The monitor ran from 18:50:24 to 19:27:59 UTC. It recorded 3,125 requests.
Twenty-two failures occurred during recovery-image archive preparation from
18:54:52 to 18:55:42, before any schema change or rollout. After the pre-schema
counter snapshot of 1,577 requests, 1,548 additional requests passed with zero
failures through SQL application, replacement and the post-switch window. The
old entry asset still returned 200. The public socket reconnected in 1,361 ms.
These are observed windows, not a guarantee against single-host resource loss.

## Backup and schema boundaries

A throttled physical PostgreSQL 16.4 backup passed archive checksums, file/WAL
verification and isolated networkless startup on the exact production image.
The restored copy had 1,057 applied markers and zero incomplete. An atomic
rehearsal of the two exact pending migrations refused a conflicting lock in
1,422 ms and fully rolled back. An injected failure before commit also left
the baseline unchanged; normal application committed in 483 ms, and repetition
applied zero.

Both exact serving-role images passed seven positive/fail-closed startup and
runtime schema cases with their reviewed compatibility manifests. Worker
approvals retained the previous twenty hashes and appended only the two new
hashes. Those exact manifests were installed atomically and read back. Both
private readiness checks passed before and after the production SQL batch.
The production batch committed in 533 ms, leaving 1,059 applied markers, zero
incomplete, and the unchanged legacy null checksum.

Full image export/reload on the shared Colima VM coincided with host load above
18 and the 22 early failures. This preparation was stopped before worker export.
The web archive was already complete and reloaded; configuration/layers and
seven schema cases passed. For worker recovery, a protected, checksum-verified
previous archive preserves the same original image layers. A protected exact
manifest and small COPY-layer recipe provide reproducible recovery without
another bulk export. A local metadata-layer build passed the schema cases.
Full worker failover was not exercised. Existing physical index defects are
preserved in the backup; this operation did not repair that separate debt.
Keep bulk image export/reload off the serving VM during ordinary traffic.

## Live owner and product checks

The existing owner session recovered after the archive-related transient
without signing in again. An unsaved inventory name hidden behind Checklists
survived the release. The synthetic text was cleared and the empty inventory
list returned without creating an item.

The new entry bundle `/assets/main-CzTVdfWL.js` retained an unsaved service
profile headline while visiting Overview and returning three times. Returns
took 252, 229 and 195 ms including automation overhead. The earlier single
observation was 2,377 ms. These small samples are diagnostic, not a controlled
population benchmark. The original headline was restored, Save Profile became
disabled, and no profile write was submitted.

Food shows one deduplicated restaurant, local opening hours, location and
configured fulfillment options. Desktop/dark skip-link activation focused
`main-content`; one visible main landmark and no horizontal overflow were
confirmed. The 390px Arabic/light view used RTL and fit without horizontal
overflow. Original English, dark theme and viewport were restored.

The mobile English review found the AI launcher overlapping Show map. The
repair uses native IntersectionObserver tracking to hide a closed launcher
when it covers a page control, retain its rectangle to avoid flicker, and
restore it once that area clears. It covers AI and human-support launchers,
reserves no update-notice clearance for a hidden launcher, and does not run
layout scans on scroll. A browser regression failed before the repair and
passes afterward, including actual page taps, scroll, inserted/removed actions,
RTL, cookie clearance, route changes and desktop keyboard activation.
The existing overlay suite now uses the actual shared launcher. Full CI,
publication and live collision verification remain pending.

Finish live Direct/Messages/workspace visual checks and hidden dirty-profile
update deferral during the next verified release before closing all eight items.
