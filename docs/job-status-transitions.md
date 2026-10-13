# Job status transitions

Source of truth: `server/services/jobStatusPolicy.js`. `models/jobModel.js`
imports its `TRANSITIONS`, and the client mirrors the open statuses in
`client/src/utils/jobDetailModel.js` (`BIDDABLE_JOB_STATUSES`) and
`client/src/utils/jobEditModel.js`.

| Status | Next statuses | Owner can edit | Admin can edit | Helpers can bid | Customer can accept a bid |
|---|---|---|---|---|---|
| draft | published, cancelled | yes | yes | no | no |
| published | matched, negotiating, accepted, cancelled | yes | yes | yes | yes |
| matched | published, negotiating, accepted, cancelled | yes | yes | yes | yes |
| negotiating | matched, accepted, cancelled | yes | yes | yes | yes |
| accepted | in_progress, cancelled | no (change order) | non-financial fields only | no | no |
| in_progress | completed, cancelled | no (change order) | non-financial fields only | no | no |
| completed | closed | no | no | no | no |
| cancelled | (terminal) | no | no | no | no |
| closed | (terminal) | no | no | no | no |

Notes

- `negotiating` is an open status. Before this change it blocked accepting
  bids even though the customer had not hired anyone yet.
- After a helper is hired, these fields are locked for everyone:
  `budget_type`, `budget_min_cents`, `budget_max_cents`, `description`,
  `category_name`, `requirements`, `required_skills`, `recurrence`. To change
  them, approve a work-agreement change order (see `docs/job-editing.md`).
- Only `published` and `matched` jobs appear in the public feed and trigger
  saved-search alerts.
