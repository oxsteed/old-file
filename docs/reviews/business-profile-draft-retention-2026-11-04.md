# Business profile draft retention

Returning to Edit Profile reloaded its API data and unmounted the editor. That
discarded unsaved fields and reset the editor's dirty baseline. The regression
was reproduced against the previous production client build before the repair.

The workspace now retains an editor after its first visit, hides it while other
tools are selected, and skips repeated profile reads within that workspace.
It remains lazy before the first visit. Account and business route changes
remount the workspace; delayed reads from the previous instance are ignored.
Successful saves explicitly revalidate the profile. If an initial editor read
fails, the page offers Retry instead of treating a partial business listing as
a complete editable profile.

The retained editor intercepts its save shortcut only while active. Its dirty
state continues to protect page exit and service-worker activation while it is
hidden. Its saved baseline is reactive, so a successful save clears the dirty
state. Drafts stay in memory for the current workspace; this change does not
add browser storage of profile data or automatically replay writes.

## Verification

- The new unsaved-return assertion failed against the previous build.
- Three focused workspace browser cases pass. They cover English desktop,
  Arabic mobile, retained dirty fields and save availability, no warm refetch,
  hidden-editor shortcut behavior, exit protection, unavailable reads and Retry,
  post-save revalidation, late responses from another business, account changes,
  and the existing employee deep-link restrictions.
- Synthetic warm profile round trips measured 197 ms in English and 154 ms in
  Arabic. These are local functional-run diagnostics, not a production benchmark.
- The full client `npm run build:ci` passed, verifying 1,163 emitted assets.
- The homepage acceptance case now holds authentication before holding the
  discovery chunk. React retains one hidden auth-loading tree during Suspense;
  only one loader, navigation bar, and main landmark are visible. The test checks
  visible/accessible UI and retains all fourteen role/viewport cases.

## Live owner checks and remaining release boundary

The owner account opened restaurant inventory and the service workspace.
An unsaved synthetic inventory name survived switching to Checklists and back
and resizing to 390px. The test text was cleared; no item or profile was saved.
The service overview led with bookings, unanswered conversations and overdue
invoices, with detailed analytics separate. A single measured profile return
took 2,377 ms including browser automation overhead. An earlier combined timing
attempt exceeded an automation wait deadline and is not treated as a completed
navigation sample.

The old tab remained usable across releases. A clean reload later reached the
offline fallback. Proxy access logs recorded a 503 without an origin response
at 11:50:09 UTC on November 4, while the surrounding profile requests returned
200. A fresh owner tab recovered on the current `afbdf8e5b` entry bundle and
opened inventory. This is an unresolved availability observation, not a passed
reconnect check.

The profile repair still requires PR CI, publication, and live warm-return
verification. The broader eight-item goal remains active.
