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
  trades_pro: STANDARD_SERVICE_BEHAVIOR,
  electrician: STANDARD_SERVICE_BEHAVIOR,
  auto_mechanic: STANDARD_SERVICE_BEHAVIOR,
  beauty_style: APPOINTMENT_BEHAVIOR,
  barbershop: APPOINTMENT_BEHAVIOR,
  spa_skincare: APPOINTMENT_BEHAVIOR,
  hair_stylist: APPOINTMENT_BEHAVIOR,
  massage_therapist: APPOINTMENT_BEHAVIOR,
  fitness_pro: APPOINTMENT_BEHAVIOR,
  wellness_therapy: APPOINTMENT_BEHAVIOR,
  dog_walker: APPOINTMENT_BEHAVIOR,
  private_chef: APPOINTMENT_BEHAVIOR,
  photographer: PORTFOLIO_BEHAVIOR,
  creative_studio: PORTFOLIO_BEHAVIOR,
  graphic_design: PORTFOLIO_BEHAVIOR,
  interior_design: PORTFOLIO_BEHAVIOR,
  web_app_dev: PORTFOLIO_BEHAVIOR,
};

export function getTemplateBehavior(slug = 'default') {
  return BEHAVIOR_BY_SLUG[slug] || STANDARD_SERVICE_BEHAVIOR;
}

export function getTemplateMode(slug = 'default') {
  return getTemplateBehavior(slug).mode;
}

export const TEMPLATE_BEHAVIORS = {
  property: PROPERTY_MANAGER_BEHAVIOR,
  appointment: APPOINTMENT_BEHAVIOR,
  toolRental: TOOL_RENTAL_BEHAVIOR,
  portfolio: PORTFOLIO_BEHAVIOR,
  standard: STANDARD_SERVICE_BEHAVIOR,
};
