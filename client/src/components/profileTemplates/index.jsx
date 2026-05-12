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

// ── Template registry ─────────────────────────────────────────────────────────
// Maps slug → { component, meta }
// 42 templates: 30 original + 11 Batch 1 industries + 1 business-mode template

export const TEMPLATE_REGISTRY = {
  // Free
  default:              { component: DefaultTemplate,            name: 'Default',              category: 'general',  is_free: true  },
  // Home & Property
  property_manager:     { component: TradesProTemplate,          name: 'Property Manager',     category: 'property', is_free: false },
  trades_pro:           { component: TradesProTemplate,          name: 'Trades Pro',           category: 'home',     is_free: false },
  handyman:             { component: HandymanTemplate,           name: 'Handyman',             category: 'home',     is_free: false },
  home_garden:          { component: HomeGardenTemplate,         name: 'Home & Garden',        category: 'home',     is_free: false },
  cleaning_service:     { component: CleaningServiceTemplate,    name: 'Cleaning Service',     category: 'home',     is_free: false },
  pest_control:         { component: PestControlTemplate,        name: 'Pest Control',         category: 'home',     is_free: false },
  moving_hauling:       { component: MovingHaulingTemplate,      name: 'Moving & Hauling',     category: 'home',     is_free: false },
  interior_design:      { component: InteriorDesignTemplate,     name: 'Interior Design',      category: 'home',     is_free: false },
  // Creative & Media
  creative_studio:      { component: CreativeStudioTemplate,     name: 'Creative Studio',      category: 'creative', is_free: false },
  graphic_design:       { component: GraphicDesignTemplate,      name: 'Graphic Design',       category: 'creative', is_free: false },
  music_audio:          { component: MusicAudioTemplate,         name: 'Music & Audio',        category: 'creative', is_free: false },
  writing_copy:         { component: WritingCopyTemplate,        name: 'Writing & Copy',       category: 'creative', is_free: false },
  // Health & Wellness
  fitness_pro:          { component: FitnessProTemplate,         name: 'Fitness Pro',          category: 'health',   is_free: false },
  wellness_therapy:     { component: WellnessTherapyTemplate,    name: 'Wellness & Therapy',   category: 'health',   is_free: false },
  nutrition_diet:       { component: NutritionDietTemplate,      name: 'Nutrition & Diet',     category: 'health',   is_free: false },
  mental_health:        { component: MentalHealthTemplate,       name: 'Mental Health',        category: 'health',   is_free: false },
  // Care & Education
  care_trust:           { component: CareTrustTemplate,          name: 'Care & Trust',         category: 'care',     is_free: false },
  pet_services:         { component: PetServicesTemplate,        name: 'Pet Services',         category: 'care',     is_free: false },
  tutoring_education:   { component: TutoringEducationTemplate,  name: 'Tutoring & Education', category: 'care',     is_free: false },
  child_development:    { component: ChildDevelopmentTemplate,   name: 'Child Development',    category: 'care',     is_free: false },
  // Events & Hospitality
  events_entertainment: { component: EventsEntertainmentTemplate,name: 'Events & Entertainment',category:'events',   is_free: false },
  catering_food:        { component: CateringFoodTemplate,       name: 'Catering & Food',      category: 'events',   is_free: false },
  wedding_services:     { component: WeddingServicesTemplate,    name: 'Wedding Services',     category: 'events',   is_free: false },
  // Beauty & Personal Care
  beauty_style:         { component: BeautyStyleTemplate,        name: 'Beauty & Style',       category: 'beauty',   is_free: false },
  barbershop:           { component: BarbershopTemplate,         name: 'Barbershop',           category: 'beauty',   is_free: false },
  spa_skincare:         { component: SpaSkincareTemplate,        name: 'Spa & Skincare',       category: 'beauty',   is_free: false },
  // Tech & Professional
  tech_it:              { component: TechITTemplate,             name: 'Tech & IT',            category: 'tech',     is_free: false },
  web_app_dev:          { component: WebAppDevTemplate,          name: 'Web & App Dev',        category: 'tech',     is_free: false },
  consulting_coaching:  { component: ConsultingCoachingTemplate, name: 'Consulting & Coaching',category: 'tech',     is_free: false },
  legal_admin:          { component: LegalAdminTemplate,         name: 'Legal & Administrative',category:'tech',     is_free: false },
  // ── Batch 1 — New Industries ─────────────────────────────────────────────────
  electrician:          { component: ElectricianTemplate,        name: 'Electrician',          category: 'trades',   is_free: false },
  photographer:         { component: PhotographerTemplate,       name: 'Photographer',         category: 'creative', is_free: false },
  massage_therapist:    { component: MassageTherapistTemplate,   name: 'Massage Therapist',    category: 'health',   is_free: false },
  auto_mechanic:        { component: AutoMechanicTemplate,       name: 'Auto Mechanic',        category: 'trades',   is_free: false },
  dog_walker:           { component: DogWalkerTemplate,          name: 'Dog Walker',           category: 'care',     is_free: false },
  private_chef:         { component: PrivateChefTemplate,        name: 'Private Chef',         category: 'food',     is_free: false },
  hair_stylist:         { component: HairStylistTemplate,        name: 'Hair Stylist',         category: 'beauty',   is_free: false },
  accountant:           { component: AccountantTemplate,         name: 'Accountant',           category: 'professional', is_free: false },
  math_tutor:           { component: MathTutorTemplate,          name: 'Math Tutor',           category: 'education', is_free: false },
  party_entertainer:    { component: PartyEntertainerTemplate,   name: 'Party Entertainer',    category: 'events',   is_free: false },
  car_dealership:       { component: CarDealershipTemplate,      name: 'Car Dealership',       category: 'automotive', is_free: false },
};

/**
 * Get a template component by slug.
 * Falls back to DefaultTemplate if slug is unknown.
 */
export function getTemplateComponent(slug) {
  return TEMPLATE_REGISTRY[slug]?.component ?? DefaultTemplate;
}

/**
 * Render a profile using the specified template slug.
 * Usage: <ProfileTemplateRenderer slug={activeTemplate} profileData={data} />
 */
export function ProfileTemplateRenderer({ slug = 'default', profileData }) {
  const TemplateComponent = getTemplateComponent(slug);
  return <TemplateComponent profileData={profileData} />;
}

export default TEMPLATE_REGISTRY;
