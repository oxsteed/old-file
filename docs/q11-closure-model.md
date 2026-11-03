# Q11 closure model (draft for approval)

Status: draft operating rule, not yet enforced by code. It needs Emile's approval before any queue UI or enforcement work is built on top of it.

Applies to three queues: support, incident, and compliance. The same ownership, escalation, and closure rules govern all three, so an item cannot be closed in one queue under a weaker rule than the same risk would face in another.

## 1. Every queue item shows an owner and an age

No queue item is ever unowned, and no queue view hides age.

- Owner: one named person or role, shown on the queue row. A queue (support, incident, compliance) has a default owner role, but the row owner is the accountable individual. "Team" is not an owner.
- Age: time since the item opened, shown on the row, plus time since the last owner action. An item that is old but recently acted on reads differently from an item that is old and untouched, and the view must show both numbers.
- Reassignment transfers ownership explicitly: the old owner, the new owner, and the reason are recorded. Ownership never lapses in between; there is no moment when an item has no owner.
- Items with no owner action inside their response band (section 3) appear in an overdue view that the queue lead reviews daily. The overdue view is the escalation trigger, not a report anyone has to remember to open.

## 2. Who owns what

| Queue | Default owner | Owns the decision | Cannot close alone |
| Support | Assigned support agent | Response, workaround, and refund recommendation | Refund approval above the agent limit, account bans, legal holds |
| Incident | Incident commander for that incident | Containment, mitigation, and customer communication | Declaring the incident over (needs verification, section 4), and any money remediation |
| Compliance | Assigned compliance reviewer | Evidence gathering, screening decision, and case notes | Sanctions clears, identity tier grants after appeal, and any decision that unblocks frozen money |

Rules that apply to all three queues:

- The person who opened an item never closes their own item when money, access, or a sanctions decision is involved. A second person verifies and closes.
- The queue lead owns the queue itself: staffing, overdue review, and escalation. The queue lead does not own every item, and queue lead ownership never substitutes for a named item owner.
- Money remediation (refunds, payouts, reversals, credits) is owned by the money workflow, not by the queue. A support or incident item that needs money moved stays open until the money workflow reports completion, even if the customer conversation is finished.
- Compliance items that block money (frozen accounts, held payouts, pending identity verification) stay open until the compliance decision is recorded and the money workflow confirms the block is lifted or sustained.

## 3. Escalation path

Escalation is by age and by risk, whichever fires first. Age bands are maximums, not targets.

- Band 1, owner action: the owner acts within one business day for support, within one hour for a live incident, and within two business days for compliance. Missing the band moves the item to the overdue view.
- Band 2, queue lead: the queue lead reassigns or assists within one further band. The lead may not close the item to clear the overdue view; reassignment is not closure.
- Band 3, operations lead (super-admin): items that are overdue past band 2, items involving money above the queue lead's limit, items involving a sanctions hit, and any item where the owner and the requester disagree on closure go to the operations lead.
- Band 4, Emile: items that change policy, items with legal or regulatory exposure, items where the operations lead cannot decide, and any incident with customer money at risk that is not contained within one day. Emile's decision is recorded on the item, not given verbally and left unrecorded.

Risk escalation bypasses age bands entirely: a sanctions hit, a suspected fraud ring, a data exposure, a payout failure, or a safety report goes straight to band 3 on discovery, and to band 4 if it is not contained within one day.

An escalated item keeps its original owner until reassignment is recorded. Escalation adds oversight, it does not remove accountability from the owner.

## 4. Closure definition

An item is closed only when all of its applicable conditions hold. Partial completion is not closure; it is progress, and the item stays open with its progress noted.

Support item closure requires all of:

1. The customer request is resolved or a documented workaround is accepted by the customer.
2. Any promised money movement is completed and confirmed, not merely requested or approved.
3. The linked dispute, ticket, or case record shows the same outcome as the customer message. A ticket closed as resolved while its linked dispute is still open (or the reverse) is a data error, not a closure.
4. The closing note states what was done, what money (if any) moved, and the reference for it. A closing note with no money reference on an item that promised money is rejected by the closure check.

Incident closure requires all of:

1. The failure is contained and the affected service is verified working, not merely restarted.
2. Affected customers and money are accounted for: who was affected, what money (if any) is owed, and whether remediation is complete or tracked as its own open item.
3. A root cause note exists, even if it is short. "Unknown" is acceptable only with a named follow-up investigation item and an owner.
4. A second person (not the incident commander) verifies the service and the customer accounting before closure.

Compliance item closure requires all of:

1. The decision is recorded with decision maker, reason, evidence relied on, and timestamp.
2. Any audit record the decision requires exists and is retrievable by item id.
3. The affected customer or partner was notified where notification is required, and the notification is linked to the item.
4. Any money block the item imposed is either lifted through the money workflow or sustained with a written reason and a review date. A compliance item is never closed while its money block is in an unknown state.

Reopening: any party (customer, owner, queue lead, operations lead) may reopen a closed item with a reason. Reopening restores the item to its queue with its full history, resets the age clock for response purposes, and keeps the original closure record intact. Reopened items escalate one band higher than their original band on first review.

## 5. What the queues must show (UI requirement for later work)

This model is written so queue UIs can enforce it. Each queue view must show, per row: owner, age, age since last owner action, escalation band, and closure checklist state. A close action must be rejected by the UI (and, once built, by the server) when a required closure condition is missing, with the missing condition named. This UI work is out of scope for this draft; the draft only defines what it must enforce.

## 6. Open questions for Emile

- The exact money limits that move a support item from queue lead to operations lead are not set here; they should match the existing money approval limits rather than inventing new ones.
- Whether compliance items get a separate second-person rule (maker-checker) for sanctions clears is recommended in the money-batch audit (finding F5) and needs a decision here too, since it changes who can close a compliance item.
- Response bands above are proposed defaults. Emile may tighten or loosen them per queue, but the bands must stay maximums with an overdue view, or escalation stops working.
