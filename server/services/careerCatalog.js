'use strict';

// Careers enums and the stage machine (careers spec §5, §6).

const EMPLOYMENT_TYPES = Object.freeze([
  'full_time', 'part_time', 'contract', 'intern', 'seasonal', 'temporary',
]);

// §6.5: path_stage takes over the meaning of employment_type ("Gig → shift → job").
const PATH_STAGES = Object.freeze([
  'shift', 'part_time', 'full_time', 'seasonal', 'temporary', 'contract', 'intern',
]);
// Q1: employer of record is only offered for these.
const EOR_PATH_STAGES = Object.freeze(['shift', 'seasonal', 'temporary']);
const EMPLOYER_MODELS = Object.freeze(['direct', 'oxsteed_eor']);

const WORKPLACE_TYPES = Object.freeze(['onsite', 'hybrid', 'remote']);

const STAGES = Object.freeze([
  'received', 'screening', 'interview', 'assessment', 'offer', 'hired',
  'rejected', 'withdrawn', 'offer_declined', 'closed_unfilled',
]);
const ACTIVE_STAGES = Object.freeze(['received', 'screening', 'interview', 'assessment', 'offer']);
const FINAL_STAGES = Object.freeze(['hired', 'rejected', 'withdrawn', 'offer_declined', 'closed_unfilled']);

// C-15: openings state a requirement; applicants answer two lawful
// questions instead of picking a status. 'any' stays readable for old rows.
const WORK_AUTHORIZATION = Object.freeze(['local_authorized', 'visa_sponsorship', 'any']);
const OPENING_WORK_AUTHORIZATION = Object.freeze(['local_authorized', 'visa_sponsorship']);

const DEPARTMENTS = Object.freeze([
  'engineering', 'product', 'operations', 'support', 'people', 'finance',
  'marketing', 'restaurant', 'logistics', 'sales', 'legal', 'other',
]);

const TEAM_ROLES = Object.freeze(['employee', 'manager', 'representative', 'support_agent']);

const COMPENSATION_PERIODS = Object.freeze(['hourly', 'daily', 'per_shift', 'monthly', 'yearly']);

const INTERVIEW_MODES = Object.freeze(['video', 'phone', 'onsite']);

const OPENING_STATUSES = Object.freeze(['draft', 'open', 'paused', 'closed', 'filled']);

// C-09: opening status can no longer jump anywhere (filled → open).
const OPENING_STATUS_TRANSITIONS = Object.freeze({
  draft: ['open', 'closed'],
  open: ['paused', 'closed', 'filled'],
  paused: ['open', 'closed', 'filled'],
  closed: [],
  filled: [],
});

// §6.6 reason codes (fixed, localized list; no free text in v1).
const REJECTION_REASONS = Object.freeze([
  'requirements_not_met', 'schedule_mismatch', 'position_filled', 'location_mismatch',
  'withdrew_interest', 'no_response', 'other_business_reason',
]);

// Employer-driven moves only. 'offer' is reached by creating an offer,
// 'hired' only by the CANDIDATE accepting it (C-02), 'withdrawn' only by
// the candidate, 'offer_declined' only by a decline, 'closed_unfilled'
// only when the opening closes.
const STAGE_TRANSITIONS = Object.freeze({
  received: ['screening', 'interview', 'rejected'],
  screening: ['interview', 'assessment', 'rejected'],
  interview: ['assessment', 'rejected'],
  assessment: ['rejected'],
  offer: ['rejected'],
  hired: [],
  rejected: [],
  withdrawn: [],
  offer_declined: [],
  closed_unfilled: [],
});
// Neutral moves allowed in bulk (§8 #11: no bulk reject in v1).
const BULK_NEUTRAL_STAGES = Object.freeze(['screening', 'interview', 'assessment']);

const OFFER_CONDITIONS = Object.freeze(['identity_verified', 'background_check', 'documents', 'eor_enrollment']);

const VISIBILITY_LEVELS = Object.freeze(['private', 'apply_only', 'known_businesses', 'searchable']);

const FACT_TYPES = Object.freeze([
  'completed_jobs', 'avg_rating', 'on_time_rate', 'response_rate', 'training_completed',
  'certificate', 'badge', 'shifts_worked', 'tenure', 'id_verified',
]);
// Employer-specific facts, never stored with the profile (§9.1).
const EMPLOYER_ONLY_FACTS = Object.freeze(['background_check', 'rehire_eligible']);

const INVITATION_REASONS = Object.freeze(['worked_with_us', 'great_reviews', 'certified', 'skills_match', 'nearby']);

const BACKGROUND_CHECK_STATUSES = Object.freeze([
  'invited', 'consented', 'pending', 'clear', 'consider', 'pre_adverse_sent', 'disputed', 'adverse_sent', 'cancelled',
]);

const EEO_OPTIONS = Object.freeze({
  race_ethnicity: ['hispanic_latino', 'white', 'black', 'asian', 'native_american_alaska',
    'native_hawaiian_pacific', 'two_or_more', 'decline'],
  sex: ['female', 'male', 'nonbinary', 'decline'],
  disability: ['yes', 'no', 'decline'],
  veteran: ['protected_veteran', 'not_veteran', 'decline'],
});

const LOCALES = Object.freeze(['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi',
  'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th']);

const EU_COUNTRIES = Object.freeze(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

function slugify(value) {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  // C-04: an all-digit slug would be read as an id.
  if (!base) return 'role';
  return /^\d+$/.test(base) ? `role-${base}` : base;
}

function getCareerCatalog() {
  return {
    employmentTypes: EMPLOYMENT_TYPES,
    pathStages: PATH_STAGES,
    eorPathStages: EOR_PATH_STAGES,
    employerModels: EMPLOYER_MODELS,
    workplaceTypes: WORKPLACE_TYPES,
    stages: STAGES,
    activeStages: ACTIVE_STAGES,
    workAuthorization: WORK_AUTHORIZATION,
    openingWorkAuthorization: OPENING_WORK_AUTHORIZATION,
    departments: DEPARTMENTS,
    teamRoles: TEAM_ROLES,
    compensationPeriods: COMPENSATION_PERIODS,
    interviewModes: INTERVIEW_MODES,
    openingStatuses: OPENING_STATUSES,
    openingStatusTransitions: OPENING_STATUS_TRANSITIONS,
    stageTransitions: STAGE_TRANSITIONS,
    bulkNeutralStages: BULK_NEUTRAL_STAGES,
    rejectionReasons: REJECTION_REASONS,
    offerConditions: OFFER_CONDITIONS,
    visibilityLevels: VISIBILITY_LEVELS,
    factTypes: FACT_TYPES,
    invitationReasons: INVITATION_REASONS,
    eeoOptions: EEO_OPTIONS,
    locales: LOCALES,
  };
}

module.exports = {
  EMPLOYMENT_TYPES,
  PATH_STAGES,
  EOR_PATH_STAGES,
  EMPLOYER_MODELS,
  WORKPLACE_TYPES,
  STAGES,
  ACTIVE_STAGES,
  FINAL_STAGES,
  WORK_AUTHORIZATION,
  OPENING_WORK_AUTHORIZATION,
  DEPARTMENTS,
  TEAM_ROLES,
  COMPENSATION_PERIODS,
  INTERVIEW_MODES,
  OPENING_STATUSES,
  OPENING_STATUS_TRANSITIONS,
  REJECTION_REASONS,
  STAGE_TRANSITIONS,
  BULK_NEUTRAL_STAGES,
  OFFER_CONDITIONS,
  VISIBILITY_LEVELS,
  FACT_TYPES,
  EMPLOYER_ONLY_FACTS,
  INVITATION_REASONS,
  BACKGROUND_CHECK_STATUSES,
  EEO_OPTIONS,
  LOCALES,
  EU_COUNTRIES,
  slugify,
  getCareerCatalog,
};
