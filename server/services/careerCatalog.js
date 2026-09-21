'use strict';

const EMPLOYMENT_TYPES = Object.freeze([
  'full_time', 'part_time', 'contract', 'intern', 'seasonal', 'temporary',
]);

const WORKPLACE_TYPES = Object.freeze(['onsite', 'hybrid', 'remote']);

const STAGES = Object.freeze([
  'received', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn',
]);

const WORK_AUTHORIZATION = Object.freeze(['local_authorized', 'visa_sponsorship', 'any']);

const DEPARTMENTS = Object.freeze([
  'engineering', 'product', 'operations', 'support', 'people', 'finance',
  'marketing', 'restaurant', 'logistics', 'sales', 'legal', 'other',
]);

const TEAM_ROLES = Object.freeze(['employee', 'manager', 'representative', 'support_agent']);

const COMPENSATION_PERIODS = Object.freeze(['hourly', 'monthly', 'yearly']);

const INTERVIEW_MODES = Object.freeze(['video', 'phone', 'onsite']);

const OPENING_STATUSES = Object.freeze(['draft', 'open', 'paused', 'closed', 'filled']);

const STAGE_TRANSITIONS = Object.freeze({
  received: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'assessment', 'rejected', 'withdrawn'],
  interview: ['assessment', 'offer', 'rejected', 'withdrawn'],
  assessment: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
});

function slugify(value) {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return base || 'role';
}

function getCareerCatalog() {
  return {
    employmentTypes: EMPLOYMENT_TYPES,
    workplaceTypes: WORKPLACE_TYPES,
    stages: STAGES,
    workAuthorization: WORK_AUTHORIZATION,
    departments: DEPARTMENTS,
    teamRoles: TEAM_ROLES,
    compensationPeriods: COMPENSATION_PERIODS,
    interviewModes: INTERVIEW_MODES,
    openingStatuses: OPENING_STATUSES,
    stageTransitions: STAGE_TRANSITIONS,
  };
}

module.exports = {
  EMPLOYMENT_TYPES,
  WORKPLACE_TYPES,
  STAGES,
  WORK_AUTHORIZATION,
  DEPARTMENTS,
  TEAM_ROLES,
  COMPENSATION_PERIODS,
  INTERVIEW_MODES,
  OPENING_STATUSES,
  STAGE_TRANSITIONS,
  slugify,
  getCareerCatalog,
};
