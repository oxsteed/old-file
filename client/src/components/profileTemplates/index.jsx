// client/src/components/profileTemplates/index.js
// Registry of all 42 profile templates

import {
  DefaultTemplate,
  TradesProTemplate,
  HandymanTemplate,
  HomeGardenTemplate,
  CleaningServiceTemplate,
  PestControlTemplate,
  MovingHaulingTemplate,
  InteriorDesignTemplate,
} from './templates/HomeTemplates.jsx';

import {
  CreativeStudioTemplate,
  GraphicDesignTemplate,
  MusicAudioTemplate,
  WritingCopyTemplate,
} from './templates/CreativeTemplates.jsx';

import {
  FitnessProTemplate,
  WellnessTherapyTemplate,
  NutritionDietTemplate,
  MentalHealthTemplate,
} from './templates/HealthTemplates.jsx';

import {
  CareTrustTemplate,
  PetServicesTemplate,
  TutoringEducationTemplate,
  ChildDevelopmentTemplate,
} from './templates/CareTemplates.jsx';

import {
  EventsEntertainmentTemplate,
  CateringFoodTemplate,
  WeddingServicesTemplate,
  BeautyStyleTemplate,
  BarbershopTemplate,
  SpaSkincareTemplate,
  TechITTemplate,
  WebAppDevTemplate,
  ConsultingCoachingTemplate,
  LegalAdminTemplate,
} from './templates/EventsBeautyTechTemplates.jsx';

import {
  ElectricianTemplate,
  PhotographerTemplate,
  MassageTherapistTemplate,
  AutoMechanicTemplate,
  DogWalkerTemplate,
  PrivateChefTemplate,
  HairStylistTemplate,
  AccountantTemplate,
  MathTutorTemplate,
  PartyEntertainerTemplate,
  CarDealershipTemplate,
} from './templates/Batch1Templates.jsx';

export { getTemplateBehavior, getTemplateMode, TEMPLATE_BEHAVIORS } from './templateBehavior.js';

// Template registry
// Maps slug -> { component, meta }
// 42 templates: 30 original + 11 Batch 1 industries + 1 business-mode template

export const TEMPLATE_REGISTRY = {
  default:              { component: DefaultTemplate,            name: 'Default',               category: 'general',      is_free: true },
  property_manager:     { component: TradesProTemplate,          name: 'Property Manager',      category: 'property',     is_free: false },
  trades_pro:           { component: TradesProTemplate,          name: 'Trades Pro',            category: 'home',         is_free: false },
  handyman:             { component: HandymanTemplate,           name: 'Handyman',              category: 'home',         is_free: false },
  home_garden:          { component: HomeGardenTemplate,         name: 'Home & Garden',         category: 'home',         is_free: false },
  cleaning_service:     { component: CleaningServiceTemplate,    name: 'Cleaning Service',      category: 'home',         is_free: false },
  pest_control:         { component: PestControlTemplate,        name: 'Pest Control',          category: 'home',         is_free: false },
  moving_hauling:       { component: MovingHaulingTemplate,      name: 'Moving & Hauling',      category: 'home',         is_free: false },
  interior_design:      { component: InteriorDesignTemplate,     name: 'Interior Design',       category: 'home',         is_free: false },
  creative_studio:      { component: CreativeStudioTemplate,     name: 'Creative Studio',       category: 'creative',     is_free: false },
  graphic_design:       { component: GraphicDesignTemplate,      name: 'Graphic Design',        category: 'creative',     is_free: false },
  music_audio:          { component: MusicAudioTemplate,         name: 'Music & Audio',         category: 'creative',     is_free: false },
  writing_copy:         { component: WritingCopyTemplate,        name: 'Writing & Copy',        category: 'creative',     is_free: false },
  fitness_pro:          { component: FitnessProTemplate,         name: 'Fitness Pro',           category: 'health',       is_free: false },
  wellness_therapy:     { component: WellnessTherapyTemplate,    name: 'Wellness & Therapy',    category: 'health',       is_free: false },
  nutrition_diet:       { component: NutritionDietTemplate,      name: 'Nutrition & Diet',      category: 'health',       is_free: false },
  mental_health:        { component: MentalHealthTemplate,       name: 'Mental Health',         category: 'health',       is_free: false },
  care_trust:           { component: CareTrustTemplate,          name: 'Care & Trust',          category: 'care',         is_free: false },
  pet_services:         { component: PetServicesTemplate,        name: 'Pet Services',          category: 'care',         is_free: false },
  tutoring_education:   { component: TutoringEducationTemplate,  name: 'Tutoring & Education',  category: 'care',         is_free: false },
  child_development:    { component: ChildDevelopmentTemplate,   name: 'Child Development',     category: 'care',         is_free: false },
  events_entertainment: { component: EventsEntertainmentTemplate,name: 'Events & Entertainment',category: 'events',      is_free: false },
  catering_food:        { component: CateringFoodTemplate,       name: 'Catering & Food',       category: 'events',       is_free: false },
  wedding_services:     { component: WeddingServicesTemplate,    name: 'Wedding Services',      category: 'events',       is_free: false },
  beauty_style:         { component: BeautyStyleTemplate,        name: 'Beauty & Style',        category: 'beauty',       is_free: false },
  barbershop:           { component: BarbershopTemplate,         name: 'Barbershop',            category: 'beauty',       is_free: false },
  spa_skincare:         { component: SpaSkincareTemplate,        name: 'Spa & Skincare',        category: 'beauty',       is_free: false },
  tech_it:              { component: TechITTemplate,             name: 'Tech & IT',             category: 'tech',         is_free: false },
  web_app_dev:          { component: WebAppDevTemplate,          name: 'Web & App Dev',         category: 'tech',         is_free: false },
  consulting_coaching:  { component: ConsultingCoachingTemplate, name: 'Consulting & Coaching', category: 'tech',         is_free: false },
  legal_admin:          { component: LegalAdminTemplate,         name: 'Legal & Administrative',category: 'tech',         is_free: false },
  electrician:          { component: ElectricianTemplate,        name: 'Electrician',           category: 'trades',       is_free: false },
  photographer:         { component: PhotographerTemplate,       name: 'Photographer',          category: 'creative',     is_free: false },
  massage_therapist:    { component: MassageTherapistTemplate,   name: 'Massage Therapist',     category: 'health',       is_free: false },
  auto_mechanic:        { component: AutoMechanicTemplate,       name: 'Auto Mechanic',         category: 'trades',       is_free: false },
  dog_walker:           { component: DogWalkerTemplate,          name: 'Dog Walker',            category: 'care',         is_free: false },
  private_chef:         { component: PrivateChefTemplate,        name: 'Private Chef',          category: 'food',         is_free: false },
  hair_stylist:         { component: HairStylistTemplate,        name: 'Hair Stylist',          category: 'beauty',       is_free: false },
  accountant:           { component: AccountantTemplate,         name: 'Accountant',            category: 'professional', is_free: false },
  math_tutor:           { component: MathTutorTemplate,          name: 'Math Tutor',            category: 'education',    is_free: false },
  party_entertainer:    { component: PartyEntertainerTemplate,   name: 'Party Entertainer',     category: 'events',       is_free: false },
  car_dealership:       { component: CarDealershipTemplate,      name: 'Car Dealership',        category: 'automotive',   is_free: false },
};

const CATEGORY_PRESENTATIONS = {
  general: {
    badgeClass: 'border border-white/15 bg-white/8 text-white/80',
    bannerClass: 'border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.16),_transparent_44%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(31,41,55,0.92))]',
    footerClass: 'border-white/10 bg-gray-950/80 text-gray-300',
    railClass: 'bg-white/70',
    audience: 'A clean storefront for local providers who need trust, speed, and a straightforward public profile.',
    highlights: ['Clear services', 'Fast contact', 'Reliable presentation'],
    promise: 'A balanced storefront that works for almost any local provider.',
  },
  property: {
    badgeClass: 'border border-amber-400/30 bg-amber-400/10 text-amber-200',
    bannerClass: 'border-amber-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_42%),linear-gradient(135deg,rgba(28,25,23,0.98),rgba(68,64,60,0.9))]',
    footerClass: 'border-amber-400/20 bg-stone-950/80 text-stone-200',
    railClass: 'bg-amber-300',
    audience: 'Designed for operators managing units, repair reporting, scheduling, and maintenance history.',
    highlights: ['Tenant intake', 'Repair coordination', 'Property records'],
    promise: 'Structured for property operations instead of a generic services page.',
  },
  home: {
    badgeClass: 'border border-sky-400/25 bg-sky-400/10 text-sky-200',
    bannerClass: 'border-sky-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_42%),linear-gradient(135deg,rgba(8,47,73,0.98),rgba(15,23,42,0.92))]',
    footerClass: 'border-sky-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-sky-300',
    audience: 'Made for local service operators who win by showing reliability, coverage, and practical proof of work.',
    highlights: ['Service area clarity', 'Job-ready trust', 'Before-and-after proof'],
    promise: 'Built to feel dependable, local, and easy to hire.',
  },
  trades: {
    badgeClass: 'border border-blue-400/25 bg-blue-400/10 text-blue-200',
    bannerClass: 'border-blue-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.2),_transparent_40%),linear-gradient(135deg,rgba(10,25,47,0.98),rgba(17,24,39,0.94))]',
    footerClass: 'border-blue-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-blue-300',
    audience: 'Geared toward specialists who need authority, licensing signals, and high-confidence first impressions.',
    highlights: ['Licenses and badges', 'Scope confidence', 'Quote-ready presentation'],
    promise: 'Made to feel technical, capable, and professionally field-tested.',
  },
  creative: {
    badgeClass: 'border border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-200',
    bannerClass: 'border-fuchsia-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(217,70,239,0.18),_transparent_42%),linear-gradient(135deg,rgba(58,28,113,0.98),rgba(17,24,39,0.92))]',
    footerClass: 'border-fuchsia-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-fuchsia-300',
    audience: 'Shaped for visual and media-driven profiles where style, proof, and portfolio flow matter as much as pricing.',
    highlights: ['Portfolio storytelling', 'Signature style', 'Consultation conversion'],
    promise: 'Built to feel expressive, memorable, and portfolio-first.',
  },
  health: {
    badgeClass: 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    bannerClass: 'border-emerald-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_42%),linear-gradient(135deg,rgba(6,78,59,0.98),rgba(15,23,42,0.92))]',
    footerClass: 'border-emerald-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-emerald-300',
    audience: 'Centered on calm trust, client care, repeat visits, and service experiences that feel guided rather than transactional.',
    highlights: ['Care-driven trust', 'Repeat booking flow', 'Wellness atmosphere'],
    promise: 'Designed to feel calm, reassuring, and appointment-ready.',
  },
  care: {
    badgeClass: 'border border-rose-300/25 bg-rose-300/10 text-rose-100',
    bannerClass: 'border-rose-300/20 bg-[radial-gradient(circle_at_top_left,_rgba(244,114,182,0.18),_transparent_42%),linear-gradient(135deg,rgba(80,7,36,0.98),rgba(30,41,59,0.92))]',
    footerClass: 'border-rose-300/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-rose-200',
    audience: 'Focused on warmth, reassurance, and the kind of trust signals families look for before they ever make contact.',
    highlights: ['Family reassurance', 'Human warmth', 'Trust-forward messaging'],
    promise: 'Built to feel thoughtful, safe, and relationship-driven.',
  },
  events: {
    badgeClass: 'border border-violet-400/25 bg-violet-400/10 text-violet-200',
    bannerClass: 'border-violet-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(139,92,246,0.18),_transparent_42%),linear-gradient(135deg,rgba(49,46,129,0.98),rgba(17,24,39,0.92))]',
    footerClass: 'border-violet-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-violet-300',
    audience: 'Crafted for experience-led businesses that sell atmosphere, coordination, and polished event energy.',
    highlights: ['Event confidence', 'Visual momentum', 'Package clarity'],
    promise: 'Made to feel celebratory, polished, and high-touch.',
  },
  beauty: {
    badgeClass: 'border border-pink-400/25 bg-pink-400/10 text-pink-200',
    bannerClass: 'border-pink-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.18),_transparent_42%),linear-gradient(135deg,rgba(80,7,36,0.98),rgba(30,41,59,0.92))]',
    footerClass: 'border-pink-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-pink-300',
    audience: 'Built for style-led businesses that need bookings to feel premium, current, and visually dialed in.',
    highlights: ['Premium booking feel', 'Visual polish', 'Repeat client energy'],
    promise: 'Shaped to feel elevated, stylish, and appointment-native.',
  },
  tech: {
    badgeClass: 'border border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
    bannerClass: 'border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_42%),linear-gradient(135deg,rgba(8,47,73,0.98),rgba(17,24,39,0.92))]',
    footerClass: 'border-cyan-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-cyan-300',
    audience: 'Oriented around expertise, structured offers, and a profile that makes complex services easier to buy.',
    highlights: ['Expert positioning', 'Offer structure', 'Consultation-first flow'],
    promise: 'Built to feel sharp, credible, and strategy-forward.',
  },
  professional: {
    badgeClass: 'border border-indigo-400/25 bg-indigo-400/10 text-indigo-200',
    bannerClass: 'border-indigo-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_42%),linear-gradient(135deg,rgba(30,41,59,0.98),rgba(15,23,42,0.92))]',
    footerClass: 'border-indigo-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-indigo-300',
    audience: 'Tailored for advisory and back-office experts who need seriousness, clarity, and immediate credibility.',
    highlights: ['Professional trust', 'Process clarity', 'Outcome framing'],
    promise: 'Made to feel established, precise, and business-grade.',
  },
  education: {
    badgeClass: 'border border-yellow-300/25 bg-yellow-300/10 text-yellow-100',
    bannerClass: 'border-yellow-300/20 bg-[radial-gradient(circle_at_top_left,_rgba(250,204,21,0.16),_transparent_42%),linear-gradient(135deg,rgba(113,63,18,0.98),rgba(30,41,59,0.92))]',
    footerClass: 'border-yellow-300/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-yellow-200',
    audience: 'Created for educators who need approachability, progress framing, and a parent- or student-friendly profile flow.',
    highlights: ['Learning outcomes', 'Encouraging tone', 'Structured progression'],
    promise: 'Built to feel supportive, smart, and confidence-building.',
  },
  food: {
    badgeClass: 'border border-orange-300/25 bg-orange-300/10 text-orange-100',
    bannerClass: 'border-orange-300/20 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.18),_transparent_42%),linear-gradient(135deg,rgba(124,45,18,0.98),rgba(30,41,59,0.92))]',
    footerClass: 'border-orange-300/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-orange-200',
    audience: 'Made for hospitality and culinary pros who sell experience, timing, and taste before the first inquiry.',
    highlights: ['Experience-led offers', 'Taste and presentation', 'Hospitality confidence'],
    promise: 'Designed to feel rich, inviting, and service-driven.',
  },
  automotive: {
    badgeClass: 'border border-red-400/25 bg-red-400/10 text-red-200',
    bannerClass: 'border-red-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(248,113,113,0.18),_transparent_42%),linear-gradient(135deg,rgba(69,10,10,0.98),rgba(17,24,39,0.92))]',
    footerClass: 'border-red-400/20 bg-slate-950/80 text-slate-200',
    railClass: 'bg-red-300',
    audience: 'Framed for vehicle-focused businesses that need confidence, inventory or service visibility, and decision-ready presentation.',
    highlights: ['Vehicle trust', 'Decision-ready details', 'Strong storefront confidence'],
    promise: 'Built to feel bold, capable, and transaction-ready.',
  },
};

const TEMPLATE_PRESENTATION_OVERRIDES = {
  default: { kicker: 'Universal storefront', highlights: ['Flexible layout', 'Clear services', 'Trust-first profile'] },
  property_manager: { kicker: 'Property operations', promise: 'Organized around maintenance, units, and response coordination.', highlights: ['Tenant requests', 'Service windows', 'Repair history'] },
  trades_pro: { kicker: 'Field authority', promise: 'Signals licensing, capability, and serious job readiness from the first screen.', highlights: ['Trade credibility', 'Scope clarity', 'Quote trust'] },
  handyman: { kicker: 'Neighborhood fixer', promise: 'Friendly and practical, with a focus on everyday jobs people want solved fast.', highlights: ['Multi-skill help', 'Fast booking', 'Household fixes'] },
  home_garden: { kicker: 'Outdoor and curb appeal', promise: 'Blends home care and outdoor improvement into a calmer, seasonal storefront.', highlights: ['Seasonal work', 'Outdoor upgrades', 'Care routines'] },
  cleaning_service: { kicker: 'Clean-home confidence', promise: 'Keeps the profile sharp, tidy, and easy to trust for recurring service.', highlights: ['Recurring visits', 'Clean standards', 'Before-and-after confidence'] },
  pest_control: { kicker: 'Urgent problem solving', promise: 'Presents speed, control, and household reassurance for pest response.', highlights: ['Rapid response', 'Inspection flow', 'Prevention trust'] },
  moving_hauling: { kicker: 'Heavy-lift logistics', promise: 'Built to feel efficient, strong, and ready for time-sensitive moves.', highlights: ['Loading help', 'Haul-away jobs', 'Route confidence'] },
  interior_design: { kicker: 'Design transformation', promise: 'Balances inspiration with enough structure to convert style interest into consultations.', highlights: ['Mood and style', 'Project proof', 'Consultation-ready'] },
  creative_studio: { kicker: 'Creative direction', promise: 'Feels like a studio, not a service menu, with stronger emphasis on taste and range.', highlights: ['Creative identity', 'Portfolio curation', 'Brand-ready positioning'] },
  graphic_design: { kicker: 'Brand systems', promise: 'Frames design work around clarity, visual judgment, and polished client outcomes.', highlights: ['Visual systems', 'Campaign assets', 'Design credibility'] },
  music_audio: { kicker: 'Sound and production', promise: 'Leans into atmosphere, technical craft, and polished listening-first presentation.', highlights: ['Recording and mixes', 'Sound direction', 'Creative feel'] },
  writing_copy: { kicker: 'Words that sell', promise: 'Makes language work feel strategic, clean, and obviously outcome-driven.', highlights: ['Messaging clarity', 'Conversion writing', 'Editorial polish'] },
  fitness_pro: { kicker: 'Performance coaching', promise: 'Built to motivate action while still feeling structured and professionally guided.', highlights: ['Training plans', 'Session booking', 'Progress mindset'] },
  wellness_therapy: { kicker: 'Calm practitioner presence', promise: 'Designed to feel restorative, measured, and safe for repeat appointments.', highlights: ['Wellness sessions', 'Gentle trust', 'Repeat care'] },
  nutrition_diet: { kicker: 'Nutrition guidance', promise: 'Positions expertise around realistic progress, health habits, and supportive coaching.', highlights: ['Meal strategy', 'Habit support', 'Guided outcomes'] },
  mental_health: { kicker: 'Private, reassuring care', promise: 'Prioritizes calm trust and clarity without feeling cold or overly clinical.', highlights: ['Calm reassurance', 'Care clarity', 'Trust-sensitive tone'] },
  care_trust: { kicker: 'Dependable care', promise: 'Helps families quickly understand warmth, trust, and everyday dependability.', highlights: ['Family trust', 'Human warmth', 'Reliable care'] },
  pet_services: { kicker: 'Pet-first care', promise: 'Feels friendly, attentive, and easy for owners to trust with routine animal care.', highlights: ['Owner reassurance', 'Routine visits', 'Pet comfort'] },
  tutoring_education: { kicker: 'Guided learning', promise: 'Balances expertise with encouragement so parents and students feel momentum early.', highlights: ['Skill building', 'Session planning', 'Student confidence'] },
  child_development: { kicker: 'Growth-focused support', promise: 'Centers developmental trust, communication, and thoughtful family partnership.', highlights: ['Family communication', 'Supportive progress', 'Child-centered trust'] },
  events_entertainment: { kicker: 'Showtime energy', promise: 'Pushes the profile toward excitement, social proof, and event-ready confidence.', highlights: ['Event atmosphere', 'Crowd energy', 'Booking confidence'] },
  catering_food: { kicker: 'Hospitality and flavor', promise: 'Makes the profile feel appetizing, organized, and capable of handling real events.', highlights: ['Menus and packages', 'Event service', 'Presentation trust'] },
  wedding_services: { kicker: 'Milestone moments', promise: 'Designed to feel elegant, dependable, and worthy of once-in-a-lifetime events.', highlights: ['Ceremony confidence', 'Luxury tone', 'High-stakes trust'] },
  beauty_style: { kicker: 'Beauty bookings', promise: 'Leans into polish, self-expression, and a more elevated appointment feel.', highlights: ['Look curation', 'Booking ease', 'Client retention'] },
  barbershop: { kicker: 'Sharp chair presence', promise: 'Feels clean, confident, and rooted in repeat-client culture.', highlights: ['Cuts and fades', 'Routine visits', 'Neighborhood loyalty'] },
  spa_skincare: { kicker: 'Premium calm', promise: 'Built to feel serene, refined, and premium without losing booking clarity.', highlights: ['Skin rituals', 'Luxury calm', 'Repeat wellness'] },
  tech_it: { kicker: 'Technical clarity', promise: 'Translates technical capability into a profile buyers can understand at a glance.', highlights: ['Problem solving', 'Systems confidence', 'Consultation flow'] },
  web_app_dev: { kicker: 'Product builder', promise: 'Positions software work as strategic delivery rather than generic freelance labor.', highlights: ['Product thinking', 'Build credibility', 'Scope clarity'] },
  consulting_coaching: { kicker: 'Advisory positioning', promise: 'Emphasizes transformation, frameworks, and credibility over generic calls to book.', highlights: ['Guided outcomes', 'Strategic sessions', 'Expert positioning'] },
  legal_admin: { kicker: 'Structured support', promise: 'Feels organized, process-led, and serious enough for legal or administrative work.', highlights: ['Document precision', 'Process trust', 'Professional clarity'] },
  electrician: { kicker: 'Licensed power work', promise: 'Puts technical trust and safety at the center of the first impression.', highlights: ['Safety confidence', 'Wiring expertise', 'Emergency readiness'] },
  photographer: { kicker: 'Visual storytelling', promise: 'Treats the profile like a portfolio-led showcase with booking intent built in.', highlights: ['Gallery impact', 'Shoot style', 'Consultation flow'] },
  massage_therapist: { kicker: 'Restorative care', promise: 'Keeps the tone restorative and trustworthy while still encouraging repeat booking.', highlights: ['Bodywork trust', 'Relaxed booking', 'Wellness atmosphere'] },
  auto_mechanic: { kicker: 'Garage-floor confidence', promise: 'Designed to feel practical, technical, and direct for vehicle owners under pressure.', highlights: ['Repair trust', 'Vehicle expertise', 'Problem diagnosis'] },
  dog_walker: { kicker: 'Routine pet support', promise: 'Makes recurring pet care feel warm, dependable, and easy to arrange.', highlights: ['Walk routines', 'Owner peace of mind', 'Reliable pet care'] },
  private_chef: { kicker: 'Private dining experience', promise: 'Frames the offer as hospitality and personal experience, not just meal prep.', highlights: ['Dining atmosphere', 'Custom menus', 'Event-ready service'] },
  hair_stylist: { kicker: 'Chair-side style', promise: 'Gives the profile a fashion-forward feel with stronger repeat-client energy.', highlights: ['Signature looks', 'Repeat bookings', 'Style confidence'] },
  accountant: { kicker: 'Financial precision', promise: 'Presents financial work with the clarity and seriousness clients expect.', highlights: ['Financial trust', 'Structured service', 'Business confidence'] },
  math_tutor: { kicker: 'Subject mastery', promise: 'Turns tutoring into a clearer growth story for students and families.', highlights: ['Learning progress', 'Confidence building', 'Academic clarity'] },
  party_entertainer: { kicker: 'Live event charisma', promise: 'Feels playful and performance-led while still giving buyers enough booking confidence.', highlights: ['Crowd delight', 'Celebration energy', 'Event booking'] },
  car_dealership: { kicker: 'Automotive storefront', promise: 'Pushes the profile toward inventory confidence, trust, and transaction readiness.', highlights: ['Vehicle showcase', 'Buyer confidence', 'Dealership presence'] },
};

function getTemplateDisplayName(profileData, fallbackName) {
  return (
    profileData?.helper?.businessName ||
    profileData?.helper?.ownerName ||
    profileData?.business?.business_name ||
    fallbackName
  );
}

function getTemplatePresentation(slug = 'default') {
  const registryEntry = TEMPLATE_REGISTRY[slug] || TEMPLATE_REGISTRY.default;
  const categoryPresentation =
    CATEGORY_PRESENTATIONS[registryEntry.category] || CATEGORY_PRESENTATIONS.general;
  const slugPresentation = TEMPLATE_PRESENTATION_OVERRIDES[slug] || {};

  return {
    name: registryEntry.name,
    category: registryEntry.category,
    kicker: slugPresentation.kicker || `${registryEntry.name} template`,
    promise: slugPresentation.promise || categoryPresentation.promise,
    audience: slugPresentation.audience || categoryPresentation.audience,
    highlights: slugPresentation.highlights || categoryPresentation.highlights,
    badgeClass: categoryPresentation.badgeClass,
    bannerClass: categoryPresentation.bannerClass,
    footerClass: categoryPresentation.footerClass,
    railClass: categoryPresentation.railClass,
  };
}

function TemplatePresentationShell({ slug = 'default', profileData, children }) {
  const presentation = getTemplatePresentation(slug);
  const displayName = getTemplateDisplayName(profileData, presentation.name);

  return (
    <div className="space-y-6">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`relative overflow-hidden rounded-[32px] border px-6 py-6 sm:px-8 sm:py-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)] ${presentation.bannerClass}`}>
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${presentation.badgeClass}`}>
                {presentation.kicker}
              </span>
              <h2 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">
                {presentation.promise}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/72 sm:text-[15px]">
                {displayName} is being presented through a more opinionated template shell so customers immediately understand the kind of experience this profile is built to sell.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
              {presentation.highlights.slice(0, 3).map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/12 bg-black/18 px-4 py-3 backdrop-blur-sm"
                >
                  <div className={`mb-3 h-1.5 w-12 rounded-full ${presentation.railClass}`} />
                  <p className="text-sm font-medium text-white">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {children}

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`rounded-[28px] border p-5 sm:p-6 ${presentation.footerClass}`}>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
                Template point of view
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                This profile now carries a stronger {presentation.name.toLowerCase()} identity.
              </h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm leading-7 text-white/70">
                {presentation.audience}
              </p>
              <div className="rounded-2xl border border-white/10 bg-black/18 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                  Experience signals
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {presentation.highlights.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function getTemplateComponent(slug) {
  return TEMPLATE_REGISTRY[slug]?.component ?? DefaultTemplate;
}

export function getTemplatePresentationMeta(slug = 'default') {
  return getTemplatePresentation(slug);
}

export function ProfileTemplateRenderer({ slug = 'default', profileData }) {
  const TemplateComponent = getTemplateComponent(slug);
  const templateMeta = getTemplatePresentation(slug);

  return (
    <TemplatePresentationShell slug={slug} profileData={profileData}>
      <TemplateComponent profileData={profileData} templateMeta={templateMeta} />
    </TemplatePresentationShell>
  );
}

export default TEMPLATE_REGISTRY;
