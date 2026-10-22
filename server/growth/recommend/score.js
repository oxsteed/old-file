"use strict";
function score({
  reach,
  clicks = 0,
  delivered = 0,
  conversions = 0,
  commission_minor = 0,
  fatigue = 0,
  overlap = 0,
}) {
  if (
    ![
      reach,
      clicks,
      delivered,
      conversions,
      commission_minor,
      fatigue,
      overlap,
    ].every((n) => Number.isFinite(n) && n >= 0) ||
    clicks > delivered ||
    conversions > clicks
  )
    throw new Error("invalid_recommendation_evidence");
  const ctr = (clicks + 2) / (delivered + 100),
    cvr = (conversions + 1) / (clicks + 20);
  const expected = reach * ctr * cvr * commission_minor;
  return {
    ctr,
    cvr,
    expected_minor: expected,
    score: expected / (1 + fatigue + overlap) + 1 / Math.sqrt(delivered + 1),
    rationale:
      "Estimated from smoothed observed rates. Review audience, current product terms and copy before sending.",
  };
}
function gap(demand, supply, priorDemand = 0, priorSupply = 0, m = 1) {
  if (
    ![demand, supply, priorDemand, priorSupply, m].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  )
    throw new Error("invalid_gap_input");
  return (
    (demand + priorDemand * m) /
    (1 + m) /
    ((supply + priorSupply * m) / (1 + m) + 1)
  );
}
module.exports = { score, gap };
