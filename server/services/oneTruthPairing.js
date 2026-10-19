'use strict';

/**
 * One Truth duplicate-signal linking (decision 10).
 *
 * Users sharing a signal (same phone, same last login IP) form a group. The
 * linear comparison links each member to ONE reference user, the earliest
 * account in the group, so a group of k users yields k-1 links instead of
 * k(k-1)/2. A NAT IP shared by 5,000 users is now 4,999 links, not ~12.5M.
 *
 * The old pairwise shape (every pair in every group) is kept for one release
 * behind `?comparison=pairwise` and is marked deprecated in the response.
 * Pair keys are unchanged (`pairKeyFor`), so existing review state still
 * applies to the reference links.
 */

const COMPARISON_MODES = Object.freeze(['linear', 'pairwise']);
const PAIRWISE_DEPRECATION = Object.freeze({
  deprecated: true,
  replacement: 'comparison=linear',
  message: 'Pairwise suspect comparison is deprecated and will be removed in the next release. Use the default linear comparison (each member against the group reference).',
});

function comparisonMode(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'pairwise' ? 'pairwise' : 'linear';
}

/**
 * groups: [{ signalType, label, weight, userIds }] with userIds ordered
 * earliest account first. Returns { pairs, groups }.
 */
function linkSignalGroups(groups, mode = 'linear') {
  const pairs = [];
  const seen = new Set();
  const outGroups = [];
  const push = (aId, bId, g, referenceUserId) => {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
    if (seen.has(`${key}|${g.signalType}`)) return;
    seen.add(`${key}|${g.signalType}`);
    pairs.push({
      userA: { id: aId }, userB: { id: bId },
      signals: [{ type: g.signalType, label: g.label, weight: g.weight }],
      score: g.weight,
      ...(referenceUserId ? { referenceUserId } : {}),
    });
  };
  for (const g of groups) {
    const ids = [...new Set((g.userIds || []).map(String))];
    if (ids.length < 2) continue;
    const referenceUserId = ids[0];
    outGroups.push({ signalType: g.signalType, label: g.label, weight: g.weight, referenceUserId, memberIds: ids, size: ids.length });
    if (mode === 'pairwise') {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) push(ids[i], ids[j], g, null);
    } else {
      for (let i = 1; i < ids.length; i++) push(referenceUserId, ids[i], g, referenceUserId);
    }
  }
  return { pairs, groups: outGroups };
}

module.exports = { COMPARISON_MODES, PAIRWISE_DEPRECATION, comparisonMode, linkSignalGroups };
