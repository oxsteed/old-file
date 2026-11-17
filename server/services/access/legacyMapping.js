'use strict';

/**
 * Legacy entitlement mapping (spec: "Legacy entitlement mapping").
 *
 * Pure: given one user's legacy facts, return the grants the backfill should
 * upsert, the exceptions to queue for human review, and draft applications
 * that preserve an expressed-but-unapproved intent. A historic mode string is
 * never proof of organization ownership or approval to operate.
 *
 * facts = {
 *   user: { id, role, default_mode },
 *   helperProfile: boolean,            // helper_profiles row exists
 *   modeApprovals: [{ mode, status }], // mode_platform_approvals rows
 *   ownedBusinessCount: number,        // businesses.user_id = user (not deleted)
 *   activeMembershipCount: number,     // business_members active rows
 *   toolListingCount: number,
 *   investorAudience: boolean,         // investor audience/authority record
 *   franchiseTerritory: boolean,       // current territory assignment
 * }
 */

const PROVENANCE = 'legacy_backfill';

function grant(capability, reason) {
  return { capability, subject_type: 'self', subject_id: null, provenance: PROVENANCE, reason };
}

function mapLegacyUser(facts) {
  const u = facts.user || {};
  const mode = u.default_mode || null;
  const role = u.role || null;
  const approvals = facts.modeApprovals || [];
  const approved = (m) => approvals.some((a) => a.mode === m && a.status === 'approved');
  const grants = [];
  const exceptions = [];
  const drafts = [];

  // Staff accounts keep their internal roles; no marketplace grant is inferred.
  if (role === 'admin' || role === 'super_admin') return { grants, exceptions, drafts };

  // Helper: role 'helper' today, or a helper profile they can switch back to
  // instantly under the legacy model. Existing access survives (Decision 7).
  if (role === 'helper' || role === 'helper_pro' || facts.helperProfile) {
    grants.push(grant('helper.offer_services', role === 'helper' || role === 'helper_pro' ? 'legacy_helper_role' : 'legacy_helper_profile'));
  }
  // Historic roles with no capability equivalent are reviewed by a human.
  if (role === 'broker') exceptions.push({ reason: 'unmapped_legacy_role' });

  if (approved('consultant')) grants.push(grant('consultant.accept_paying_clients', 'legacy_mode_approval'));
  else if (mode === 'consultant') drafts.push({ capability: 'consultant.accept_paying_clients', reason: 'legacy_mode_unapproved' });

  // A historic mode is an expressed preference, not approval. Existing
  // listings and explicit platform approvals are canonical evidence that can
  // preserve access; mode-only users resume as drafts for review instead.
  if (approved('tool_owner') || (facts.toolListingCount || 0) > 0) {
    grants.push(grant('tool_owner.list_equipment', approved('tool_owner') ? 'legacy_mode_approval' : 'existing_listings'));
  } else if (mode === 'tool_owner') {
    drafts.push({ capability: 'tool_owner.list_equipment', reason: 'legacy_mode_unapproved' });
  }
  if (approved('logistics')) grants.push(grant('logistics.ship', 'legacy_mode_approval'));
  else if (mode === 'logistics') drafts.push({ capability: 'logistics.ship', reason: 'legacy_mode_unapproved' });

  if (facts.investorAudience) grants.push(grant('investor.reporting', 'investor_audience_record'));
  else if (mode === 'investor') exceptions.push({ reason: 'investor_mode_without_audience' });

  if (facts.franchiseTerritory) grants.push(grant('franchise.operate', 'territory_assignment'));

  // Ownership modes: authority comes from canonical business rows only.
  if ((mode === 'business_owner' || mode === 'restaurant_owner') && !(facts.ownedBusinessCount > 0)) {
    drafts.push({ capability: mode === 'business_owner' ? 'business.own' : 'restaurant.own', reason: 'legacy_owner_mode_without_business' });
  }
  if (['restaurant_manager', 'restaurant_staff', 'restaurant_runner', 'business_manager', 'business_representative',
    'business_employee', 'business_support_agent'].includes(mode) && !(facts.activeMembershipCount > 0)) {
    exceptions.push({ reason: 'staff_mode_without_membership' });
  }

  // Dedupe by capability (first reason wins, deterministic order above).
  const seen = new Set();
  return {
    grants: grants.filter((g) => (seen.has(g.capability) ? false : seen.add(g.capability))),
    exceptions,
    drafts,
  };
}

module.exports = { mapLegacyUser, PROVENANCE };
