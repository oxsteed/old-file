import {
  Briefcase,
  CalendarCheck,
  ClipboardList,
  DollarSign,
  FileText,
  Image,
  MessageSquare,
  ShieldCheck,
  Star,
  Users,
  Wrench,
} from 'lucide-react';
import { LAUNCH_VISIBILITY } from '../../utils/launchScope';

const PROPERTY_MANAGER_BEHAVIOR = {
  mode: 'property_manager',
  label: 'Property manager mode',
  headline: 'Built for tenant repair requests and maintenance records.',
  description:
    'This profile can guide tenants toward reporting issues, help the owner schedule work, assign a helper or team member, and keep repair costs organized for year-end records.',
  primaryCta: 'Report a maintenance issue',
  secondaryCta: 'Message property manager',
  primaryIntent: 'maintenance_request',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'Tenant reports issue', text: 'Collect issue type, urgency, photos, access notes, and preferred times.', icon: ClipboardList },
    { title: 'Owner schedules repair', text: 'Accept the request, propose a repair date, or ask for more detail.', icon: CalendarCheck },
    { title: 'Assign the work', text: 'Use a nearby helper, invite a handyman, or handle it with an internal team member.', icon: Users },
    { title: 'Track cost history', text: 'Keep job notes, invoices, and property maintenance records together.', icon: DollarSign },
  ],
  setup: [
    'Add service areas or managed properties',
    'Add repair categories and response expectations',
    'Add policies for access, emergencies, and tenant communication',
    'Invite internal maintenance staff or preferred helpers',
  ],
  recommendedFeatures: ['Maintenance requests', 'Jobs', 'Messages', 'Calendar', 'Invoices', 'Business Hub'],
};

const TRADES_DIAGNOSTIC_BEHAVIOR = {
  mode: 'trades_diagnostic',
  label: 'Trades diagnostic mode',
  headline: 'Built for diagnostics, technical trust, and quote-first repair decisions.',
  description:
    'This profile should capture the problem clearly, route it into diagnosis, preserve technical notes, and turn recommendations into approved repair or upgrade work.',
  primaryCta: 'Request a diagnostic',
  secondaryCta: 'Message technician',
  primaryIntent: 'trades_diagnostic',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'Capture the issue', text: 'Collect symptoms, urgency, safety risk, asset context, and photos before the visit.', icon: ClipboardList },
    { title: 'Diagnose and document', text: 'Move the request into triage, diagnosis, and written findings instead of vague back-and-forth.', icon: Wrench },
    { title: 'Quote the right fix', text: 'Turn findings into repair, replacement, maintenance, or safety recommendations with estimates.', icon: FileText },
    { title: 'Build long-term trust', text: 'Keep licenses, technical records, and completed recommendations visible across repeat jobs.', icon: ShieldCheck },
  ],
  setup: [
    'Add diagnostic or inspection offers',
    'Define supported issue types and response expectations',
    'Load licenses, certifications, or shop trust documents',
    'Set estimate follow-up and emergency response rules',
  ],
  recommendedFeatures: ['Trades Ops', 'Quotes', 'Calendar', 'Messages', 'Reviews', 'Business Hub'],
};

const APPOINTMENT_BEHAVIOR = {
  mode: 'appointment_business',
  label: 'Appointment business mode',
  headline: 'Built for scheduled services, repeat clients, and clear booking decisions.',
  description:
    'This profile should emphasize service menus, availability, portfolio photos, cancellation rules, reminders, and repeat-client history.',
  primaryCta: 'Book an appointment',
  secondaryCta: 'Ask a question',
  primaryIntent: 'appointment',
  workflow: [
    { title: 'Choose a service', text: 'Customers compare service names, prices, duration, and photos.', icon: Briefcase },
    { title: 'Pick a time', text: 'Availability and calendar slots reduce back-and-forth.', icon: CalendarCheck },
    { title: 'Confirm policies', text: 'Deposits, cancellation rules, and no-show expectations are clear before booking.', icon: ShieldCheck },
    { title: 'Build loyalty', text: 'Reviews, reminders, photos, and booking history help customers come back.', icon: Star },
  ],
  setup: [
    'Add services with prices and duration',
    'Add business hours and appointment availability',
    'Add cancellation and deposit policies',
    'Add portfolio photos and review requests',
  ],
  recommendedFeatures: ['Direct booking', 'Calendar', 'Photos', 'Reviews', 'Messages', 'Payments'],
};

const BEAUTY_APPOINTMENT_BEHAVIOR = {
  mode: 'beauty_intake',
  label: 'Beauty retention mode',
  headline: 'Built for look intake, prep expectations, and repeat-beauty retention.',
  description:
    'This profile should capture style goals, prep and sensitivity context, no-show expectations, and package or membership interest before the appointment is locked in.',
  primaryCta: 'Start beauty intake',
  secondaryCta: 'Ask a beauty question',
  primaryIntent: 'beauty_intake',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'Capture look goals', text: 'Collect desired service, inspiration, preferred staff, and timing before the chair is reserved.', icon: ClipboardList },
    { title: 'Review prep and consent', text: 'Keep patch-test, sensitivity, prep, and no-show expectations visible before booking.', icon: ShieldCheck },
    { title: 'Deliver and rebook', text: 'Move clients through prep, visit, aftercare, and the next recommended rebook window.', icon: CalendarCheck },
    { title: 'Grow retention plans', text: 'Turn one-off appointments into memberships, maintenance plans, or ritual packages.', icon: Star },
  ],
  setup: [
    'Add service categories by look, ritual, or grooming outcome',
    'Set prep, deposit, and no-show expectations',
    'Add memberships, series, or bridal package logic',
    'Load licenses, sanitation, or treatment trust records',
  ],
  recommendedFeatures: ['Beauty Ops', 'Calendar', 'Gallery', 'Loyalty', 'Messages', 'Packages'],
};

const CONTINUITY_INTAKE_BEHAVIOR = {
  mode: 'continuity_intake',
  label: 'Continuity intake mode',
  headline: 'Built for guided intake, recurring sessions, and progress-led follow-through.',
  description:
    'This profile should capture goals, routine context, trust considerations, and next-session fit before the business moves someone into a recurring plan, supported schedule, or continuity workflow.',
  primaryCta: 'Start guided intake',
  secondaryCta: 'Ask a question',
  primaryIntent: 'continuity_intake',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'Capture the goal', text: 'Collect the main concern, current routine, schedule rhythm, and any trust-sensitive context first.', icon: ClipboardList },
    { title: 'Match the right plan', text: 'Route the lead into the right session type, membership, learning plan, or care cadence.', icon: Briefcase },
    { title: 'Support continuity', text: 'Keep appointments, progress notes, and next-step recommendations in one recurring workflow.', icon: CalendarCheck },
    { title: 'Retain with trust', text: 'Use guardian, safety, or continuity expectations to make repeat support feel reliable and intentional.', icon: ShieldCheck },
  ],
  setup: [
    'Add recurring plans, packages, or cadence-based support offers',
    'Set trust, guardian, or intake acknowledgement expectations',
    'Define progress prompts and next-session timing',
    'Load credentials, care standards, or learning/process trust records',
  ],
  recommendedFeatures: ['Continuity Ops', 'Calendar', 'Messages', 'Loyalty', 'Reviews', 'Business Hub'],
};

const TOOL_RENTAL_BEHAVIOR = {
  mode: 'tool_rental',
  label: 'Tool rental mode',
  headline: 'Built for local inventory, pickup rules, deposits, and rental agreements.',
  description:
    'This profile should highlight rentable tools, condition, owner rules, replacement value, availability, pickup/return expectations, and bad-actor reporting.',
  primaryCta: 'Browse rentable tools',
  secondaryCta: 'Ask about a tool',
  primaryIntent: 'tool_rental',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'List equipment', text: 'Add photos, condition, make/model, replacement value, and owner rules.', icon: Wrench },
    { title: 'Set rental terms', text: 'Use deposits, pickup notes, return rules, and owner-provided terms.', icon: FileText },
    { title: 'Coordinate handoff', text: 'Use messages and booking records to keep pickup/return details clear.', icon: MessageSquare },
    { title: 'Keep a record', text: 'Track bookings, reports, and tool performance over time.', icon: DollarSign },
  ],
  setup: [
    'Add tool photos and condition notes',
    'Set replacement value and deposit expectations',
    'Add owner-provided rental terms',
    'Review booking and report flows',
  ],
  recommendedFeatures: ['Tool rentals', 'Agreements', 'Messages', 'Reports', 'Bookings'],
};

const PORTFOLIO_BEHAVIOR = {
  mode: 'portfolio_business',
  label: 'Portfolio mode',
  headline: 'Built for trust through proof, style, and past work.',
  description:
    'This profile should make photos, case studies, reviews, service packages, and consultation requests easy to scan.',
  primaryCta: 'Request a consultation',
  secondaryCta: 'Message provider',
  primaryIntent: 'consultation',
  workflow: [
    { title: 'Show the work', text: 'Lead with gallery, before/after images, and project categories.', icon: Image },
    { title: 'Package services', text: 'Turn vague interest into clear service options.', icon: Briefcase },
    { title: 'Capture intent', text: 'Let customers request a consultation or message with context.', icon: MessageSquare },
    { title: 'Convert with trust', text: 'Reviews, policies, and proof reduce hesitation.', icon: Star },
  ],
  setup: [
    'Add strong project photos',
    'Add service packages or starting prices',
    'Add FAQs for timeline, revisions, and scope',
    'Add policies that explain what happens after inquiry',
  ],
  recommendedFeatures: ['Gallery', 'Services', 'Messages', 'Reviews', 'Business Hub'],
};

const CREATIVE_PROJECT_BEHAVIOR = {
  mode: 'creative_intake',
  label: 'Creative project mode',
  headline: 'Built for discovery, proposal clarity, approvals, and delivery follow-through.',
  description:
    'This profile should collect project goals, style direction, package fit, and delivery expectations before moving the client into a quote, proof, or production workflow.',
  primaryCta: 'Start creative discovery',
  secondaryCta: 'Ask about the project',
  primaryIntent: 'creative_intake',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'Capture the brief', text: 'Collect the project goal, references, timeline, and deliverables before quoting.', icon: ClipboardList },
    { title: 'Package and propose', text: 'Route the lead into discovery, a productized package, or a custom proposal.', icon: Briefcase },
    { title: 'Manage approvals', text: 'Keep proofs, revisions, and client approvals documented instead of scattered across messages.', icon: FileText },
    { title: 'Deliver and follow up', text: 'Close the project with final assets, testimonial prompts, and referral-ready proof.', icon: Star },
  ],
  setup: [
    'Add clear packages and deliverables',
    'Define revision and approval expectations',
    'Curate gallery work by project type',
    'Set delivery windows and testimonial follow-up prompts',
  ],
  recommendedFeatures: ['Creative Ops', 'Gallery', 'Quotes', 'Messages', 'Reviews', 'Business Hub'],
};

const PROFESSIONAL_ENGAGEMENT_BEHAVIOR = {
  mode: 'professional_intake',
  label: 'Professional engagement mode',
  headline: 'Built for documented intake, package clarity, and recurring obligation follow-through.',
  description:
    'This profile should collect the service need, document context, and engagement timeline before the client is moved into a proposal, delivery, or recurring support rhythm.',
  primaryCta: 'Start engagement intake',
  secondaryCta: 'Ask a question',
  primaryIntent: 'professional_intake',
  allowPrimaryWithoutServices: true,
  workflow: [
    { title: 'Capture the need', text: 'Collect the service request, timeline, and required document context before quoting.', icon: ClipboardList },
    { title: 'Scope the engagement', text: 'Turn the request into a consultation, package, or recurring support path with clear boundaries.', icon: Briefcase },
    { title: 'Track documents and obligations', text: 'Keep milestones, records, and recurring deadlines organized instead of buried in messages.', icon: FileText },
    { title: 'Retain and follow up', text: 'Move completed work into repeat support, filing reminders, or future strategic check-ins.', icon: Star },
  ],
  setup: [
    'Add package tiers or recurring support offers',
    'Define document and deadline expectations',
    'Load compliance or trust-ready records',
    'Set follow-up prompts and recurring reminder cadence',
  ],
  recommendedFeatures: ['Professional Ops', 'Quotes', 'Messages', 'Recurring', 'Reviews', 'Business Hub'],
};

const STANDARD_SERVICE_BEHAVIOR = {
  mode: 'service_business',
  label: 'Service business mode',
  headline: 'Built for clear services, fast contact, and reliable local work.',
  description:
    'This profile should help customers understand what you do, when you are available, what it may cost, and how to book or message you.',
  primaryCta: 'Book service',
  secondaryCta: 'Message provider',
  primaryIntent: 'service_booking',
  workflow: [
    { title: 'Compare services', text: 'Clear services and pricing help customers decide quickly.', icon: Briefcase },
    { title: 'Check availability', text: 'Hours and slots make booking feel dependable.', icon: CalendarCheck },
    { title: 'Coordinate details', text: 'Messages keep scope, access, and expectations together.', icon: MessageSquare },
    { title: 'Keep records', text: 'Jobs, invoices, reviews, and repeat work build the business over time.', icon: DollarSign },
  ],
  setup: [
    'Add services and prices',
    'Add availability and service area',
    'Add policies and FAQs',
    'Ask for reviews after completed jobs',
  ],
  recommendedFeatures: ['Services', 'Booking', 'Messages', 'Calendar', 'Invoices'],
};

const BEHAVIOR_BY_SLUG = {
  property_manager: PROPERTY_MANAGER_BEHAVIOR,
  landlord_property: PROPERTY_MANAGER_BEHAVIOR,
  cleaning_service: STANDARD_SERVICE_BEHAVIOR,
  handyman: STANDARD_SERVICE_BEHAVIOR,
  trades_pro: TRADES_DIAGNOSTIC_BEHAVIOR,
  electrician: TRADES_DIAGNOSTIC_BEHAVIOR,
  auto_mechanic: TRADES_DIAGNOSTIC_BEHAVIOR,
  beauty_style: BEAUTY_APPOINTMENT_BEHAVIOR,
  barbershop: BEAUTY_APPOINTMENT_BEHAVIOR,
  spa_skincare: BEAUTY_APPOINTMENT_BEHAVIOR,
  hair_stylist: BEAUTY_APPOINTMENT_BEHAVIOR,
  fitness_pro: CONTINUITY_INTAKE_BEHAVIOR,
  wellness_therapy: CONTINUITY_INTAKE_BEHAVIOR,
  nutrition_diet: CONTINUITY_INTAKE_BEHAVIOR,
  mental_health: CONTINUITY_INTAKE_BEHAVIOR,
  massage_therapist: CONTINUITY_INTAKE_BEHAVIOR,
  care_trust: CONTINUITY_INTAKE_BEHAVIOR,
  pet_services: CONTINUITY_INTAKE_BEHAVIOR,
  tutoring_education: CONTINUITY_INTAKE_BEHAVIOR,
  child_development: CONTINUITY_INTAKE_BEHAVIOR,
  dog_walker: CONTINUITY_INTAKE_BEHAVIOR,
  math_tutor: CONTINUITY_INTAKE_BEHAVIOR,
  private_chef: APPOINTMENT_BEHAVIOR,
  photographer: CREATIVE_PROJECT_BEHAVIOR,
  creative_studio: CREATIVE_PROJECT_BEHAVIOR,
  graphic_design: CREATIVE_PROJECT_BEHAVIOR,
  accountant: PROFESSIONAL_ENGAGEMENT_BEHAVIOR,
  consulting_coaching: PROFESSIONAL_ENGAGEMENT_BEHAVIOR,
  legal_admin: PROFESSIONAL_ENGAGEMENT_BEHAVIOR,
  interior_design: PORTFOLIO_BEHAVIOR,
  web_app_dev: PORTFOLIO_BEHAVIOR,
};

export function getTemplateBehavior(slug = 'default') {
  return BEHAVIOR_BY_SLUG[slug] || STANDARD_SERVICE_BEHAVIOR;
}

export function getLaunchTemplateBehavior(slug = 'default') {
  const behavior = getTemplateBehavior(slug);
  const futureIntents = new Set([
    'maintenance_request',
    'trades_diagnostic',
    'beauty_intake',
    'continuity_intake',
    'creative_intake',
    'professional_intake',
    'tool_rental',
    'consultation',
  ]);
  if (!LAUNCH_VISIBILITY.specializedIntake && futureIntents.has(behavior.primaryIntent)) {
    return STANDARD_SERVICE_BEHAVIOR;
  }
  return behavior;
}

export function getTemplateMode(slug = 'default') {
  return getTemplateBehavior(slug).mode;
}

export const TEMPLATE_BEHAVIORS = {
  property: PROPERTY_MANAGER_BEHAVIOR,
  tradesDiagnostic: TRADES_DIAGNOSTIC_BEHAVIOR,
  beauty: BEAUTY_APPOINTMENT_BEHAVIOR,
  continuity: CONTINUITY_INTAKE_BEHAVIOR,
  appointment: APPOINTMENT_BEHAVIOR,
  creativeProject: CREATIVE_PROJECT_BEHAVIOR,
  professionalEngagement: PROFESSIONAL_ENGAGEMENT_BEHAVIOR,
  toolRental: TOOL_RENTAL_BEHAVIOR,
  portfolio: PORTFOLIO_BEHAVIOR,
  standard: STANDARD_SERVICE_BEHAVIOR,
};
