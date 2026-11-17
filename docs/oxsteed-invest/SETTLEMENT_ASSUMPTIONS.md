# Settlement assumptions (OxSteed Invest)

Date: 2026-11-17. Status: BEST GUESS, not validated. Counsel and the
registered intermediary must strike or confirm each assumption. If the
partner cannot support Credit-only settlement in this shape, STOP:
document the blocker, keep live commitments disabled, and do not build
an unauthorized fallback. Live activity is disabled by design behind
`INVEST_ENABLED` / `INVEST_COMMITMENTS_ENABLED` (both default off).

Each assumption is numbered here and cited in code comments as A1-A8
so a reviewer can find every place that depends on it.

## A1. Investor-facing method is Credit only, always

The investor never touches fiat. No card, bank, or crypto checkout for
investments exists in this build, and none may be added as a silent
fallback. What changes if wrong: the entire commit flow, the lot model,
and the settlement records would need a fiat leg, and the Credit-only
hard line set by Emile would need a new explicit decision.

## A2. Commitment reserves eligible Credit in a dedicated subledger

At commitment, eligible Credit is reserved (a real
`oxsteed_credit_reservations` row plus lot allocations in
`investment_commitment_lots`): unavailable for ordinary spending, not
yet an investment position. Atomic transaction plus idempotency key;
concurrent requests cannot overspend a balance or overfill an
opportunity; retries cannot duplicate a commitment. What changes if
wrong: if the partner requires funds to move at commitment rather than
at closing, the reservation step becomes a transfer step and the
cancellation path must reverse a transfer instead of releasing a hold.

## A3. Underlying value: Credit maps to a monetary reference value, and the partner holds it in escrow

Reserved Credit maps to a monetary reference value at the Credit
reference rate in force at reservation (stored per commitment as
`credit_reference_rate`; this build records 1 Credit cent as 1 USD
cent until counsel or the partner defines the rate source). The
regulated partner holds the corresponding monetary value in escrow
from commitment through closing. OxSteed holds no investor funds
directly; the Credit reservation is the investor-facing mirror of the
partner escrow hold. The `investment_settlements` rows of kind
`escrow_expectation` record that expectation as
`pending_partner_confirmation`; there is no partner integration, no
fiat movement, and no external call in this build. What changes if
wrong: if the partner holds nothing until closing, or holds value in a
different form, the escrow-expectation records are wrong and the
closing flow must be reworked around the real custody arrangement. If
no partner can hold value against a Credit reservation at all, live
commitments stay disabled and the blocker is documented.

## A4. Closing is all-or-nothing

Target plus deadline plus conditions plus a separate closing approval,
enforced in the settlement service, not the caller. On close,
reservations complete (Credit debited through the journal, becomes an
investment position under the exact agreement version accepted) and
proceeds release to the entity goes through the partner settlement flow
and is recorded in the subledger (entity proceeds awaiting release,
then released). Proceeds cannot release before approved closing
conditions. What changes if wrong: if the partner or the offering
terms allow partial closing, the target check, the per-commitment
completion loop, and the proceeds records all need rework, and
investors who committed to an all-or-nothing close would need new
agreement versions and reconfirmation.

## A5. Failed closing returns value to the original classification

If closing does not occur (target missed, conditions fail,
cancellation), reservations are released back to the ORIGINAL balance
classification and restrictions. Returned commitments restore the
original classification. This build implements that by releasing the
lot allocations without touching lot balances. What changes if wrong:
if the partner's escrow return lands as a different kind of value
(for example, a new issuance rather than a release), the release path
must create new lots with the correct source instead of restoring the
original ones, and investors would need to be told the classification
changed.

## A6. Distributions come back as Credit through the settlement flow

The entity pays through the partner; the investor is credited back as
Credit through the approved settlement flow, with a traceable record
(a journal transaction, a `distribution` lot, a settlement row, and a
subledger entry). No promise of distributions, cash redeemability, or
principal protection is made anywhere in this build. What changes if
wrong: if distributions must be paid in fiat, or if Credit
distributions are not permitted, the distribution flow must be rebuilt
and the `distribution` lot source removed. If distributions are
taxable events with withholding, the flow needs a tax leg that does
not exist here.

## A7. What this model does NOT assume

An internal ledger transfer alone does not satisfy custody or
settlement; Credit is not redeemable for cash; there is no guaranteed
return. Nothing in this build treats the journal entries as proof of
partner custody. What changes if wrong: if counsel finds that the
internal records would be read as custody claims, the records and the
copy around them must be rewritten before any live activity.

## A8. Eligibility is purchased settled only in practice

The brief allows earned settled plus approved Credit, but there is no
earned issuance path and no ledger definition of earned approval, so
no earned lot can exist yet. The eligible set is therefore purchased
settled only until an earned issuance path is defined and built. The
backfill classifies existing balances as `unknown` (ineligible) except
for provably completed top-ups. What changes if wrong: if counsel or
Emile defines earned issuance, the lot model already has the category;
the issuance path, the approval record, and the settlement-time rule
must be built, and the eligibility function must be re-verified.
