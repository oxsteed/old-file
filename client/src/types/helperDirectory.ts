import type { PriceUnit } from './helperProfile';

// ─── Filter definitions ───────────────────────────────────────────────────────

export const CATEGORIES = [
  'Landscaping',
  'Cleaning',
  'Painting',
  'Home Repair',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Carpentry',
  'Moving',
  'Pest Control',
  'Auto',
  'Personal Services',
  'Roofing',
  'Flooring',
  'Appliance Repair',
  'Concrete',
  'Welding',
  'Security',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SKILLS_BY_CATEGORY: Record<string, string[]> = {
  Landscaping:         ['Lawn Mowing', 'Tree Trimming', 'Irrigation Systems', 'Landscape Design', 'Mulching', 'Sod Installation', 'Snow Removal', 'Leaf Removal'],
  Cleaning:            ['Deep Cleaning', 'Move-in/Move-out', 'Window Cleaning', 'Carpet Cleaning', 'Upholstery Cleaning', 'Post-Construction Cleanup', 'Pressure Washing'],
  Painting:            ['Interior Painting', 'Exterior Painting', 'Cabinet Painting', 'Deck Staining', 'Wallpaper Removal', 'Faux Finishes', 'Epoxy Floors'],
  'Home Repair':       ['Drywall Repair', 'Tile & Grout', 'Flooring Installation', 'Fixture Installation', 'Door & Window Repair', 'Gutter Cleaning', 'Fence Repair'],
  Electrical:          ['Panel Upgrades', 'Outlet & Switch Installation', 'Lighting Installation', 'Smart Home Wiring', 'Ceiling Fans', 'EV Charger Install', 'Generator Install'],
  Plumbing:            ['Leak Repair', 'Drain Cleaning', 'Water Heater', 'Toilet Repair', 'Pipe Replacement', 'Water Softener', 'Sump Pump'],
  HVAC:                ['AC Repair', 'Furnace Service', 'Duct Cleaning', 'Mini-Split Install', 'Thermostat Install', 'Air Quality Testing'],
  Carpentry:           ['Custom Cabinetry', 'Deck Building', 'Framing', 'Trim & Molding', 'Furniture Repair', 'Stair Repair', 'Wood Floors'],
  Moving:              ['Packing & Unpacking', 'Loading & Unloading', 'Furniture Assembly', 'Piano Moving', 'Junk Removal', 'Storage Solutions'],
  'Pest Control':      ['Rodent Control', 'Termite Treatment', 'Ant & Roach', 'Bed Bug Treatment', 'Wildlife Removal', 'Mosquito Control'],
  Auto:                ['Mobile Detailing', 'Oil Change', 'Tire Services', 'Mobile Mechanic', 'Windshield Repair', 'Battery Replacement'],
  'Personal Services': ['Pet Sitting', 'Dog Walking', 'Grocery Shopping', 'Home Organization', 'Elder Care Assistance', 'Tutoring'],
  Roofing:             ['Roof Repair', 'Roof Replacement', 'Gutter Install', 'Gutter Cleaning', 'Shingle Repair', 'Flat Roof', 'Skylight Install'],
  Flooring:            ['Hardwood Installation', 'Laminate Flooring', 'Tile Installation', 'Carpet Install', 'Vinyl Plank', 'Subfloor Repair', 'Floor Refinishing'],
  'Appliance Repair':  ['Washer & Dryer Repair', 'Refrigerator Repair', 'Dishwasher Repair', 'Oven & Stove Repair', 'Microwave Repair', 'HVAC Appliances'],
  Concrete:            ['Driveway Pour', 'Patio Slab', 'Concrete Repair', 'Stamped Concrete', 'Sidewalk Repair', 'Foundation Crack', 'Retaining Wall'],
  Welding:             ['MIG Welding', 'TIG Welding', 'Metal Fabrication', 'Gate & Fence Welding', 'Structural Welding', 'Pipe Welding', 'Custom Metalwork'],
  Security:            ['Security Camera Install', 'Smart Lock Install', 'Alarm System', 'Motion Sensors', 'Ring/Nest Install', 'Access Control', 'Safe Install'],
};

export const ALL_SKILLS = Object.values(SKILLS_BY_CATEGORY).flat();

// ─── Skill tiles (Browse by Skills UI) ───────────────────────────────────────

export interface SkillTile {
  id: string;
  label: string;
  icon: string;
  desc: string;
  /** Maps to a value in CATEGORIES for filtering */
  category: string;
  /** Sub-skills shown when this tile is selected */
  subSkills: string[];
}

export const SKILL_TILES: SkillTile[] = [
  { id: 'electrical',  label: 'Electrical',       icon: '⚡', desc: 'Outlets, panels, EV chargers',   category: 'Electrical',
    subSkills: ['Panel Upgrades', 'Outlet & Switch Installation', 'Ceiling Fans', 'EV Charger Install', 'Lighting Installation', 'Generator Install'] },
  { id: 'plumbing',    label: 'Plumbing',          icon: '🚿', desc: 'Leaks, drains, water heaters',   category: 'Plumbing',
    subSkills: ['Leak Repair', 'Drain Cleaning', 'Water Heater', 'Toilet Repair', 'Pipe Replacement', 'Sump Pump'] },
  { id: 'hvac',        label: 'HVAC',              icon: '❄️', desc: 'AC, heating, duct work',          category: 'HVAC',
    subSkills: ['AC Repair', 'Furnace Service', 'Mini-Split Install', 'Duct Cleaning', 'Thermostat Install', 'Air Quality Testing'] },
  { id: 'carpentry',   label: 'Carpentry',         icon: '🪚', desc: 'Decks, trim, custom builds',     category: 'Carpentry',
    subSkills: ['Deck Building', 'Custom Cabinetry', 'Trim & Molding', 'Framing', 'Furniture Repair', 'Stair Repair'] },
  { id: 'painting',    label: 'Painting',          icon: '🖌️', desc: 'Interior & exterior',            category: 'Painting',
    subSkills: ['Interior Painting', 'Exterior Painting', 'Cabinet Painting', 'Deck Staining', 'Epoxy Floors', 'Wallpaper Removal'] },
  { id: 'landscaping', label: 'Landscaping',       icon: '🌿', desc: 'Lawn, garden, tree care',        category: 'Landscaping',
    subSkills: ['Lawn Mowing', 'Tree Trimming', 'Irrigation Systems', 'Mulching', 'Sod Installation', 'Snow Removal'] },
  { id: 'cleaning',    label: 'Cleaning',          icon: '✨', desc: 'Deep clean, move-out, regular',  category: 'Cleaning',
    subSkills: ['Deep Cleaning', 'Move-in/Move-out', 'Carpet Cleaning', 'Window Cleaning', 'Pressure Washing', 'Post-Construction Cleanup'] },
  { id: 'moving',      label: 'Moving',            icon: '🚚', desc: 'Packing, loading, hauling',      category: 'Moving',
    subSkills: ['Packing & Unpacking', 'Loading & Unloading', 'Furniture Assembly', 'Junk Removal', 'Piano Moving', 'Storage Solutions'] },
  { id: 'roofing',     label: 'Roofing',           icon: '🏠', desc: 'Repair, replacement, gutters',   category: 'Roofing',
    subSkills: ['Roof Repair', 'Roof Replacement', 'Gutter Install', 'Gutter Cleaning', 'Shingle Repair', 'Skylight Install'] },
  { id: 'flooring',    label: 'Flooring',          icon: '🪵', desc: 'Hardwood, tile, carpet',         category: 'Flooring',
    subSkills: ['Hardwood Installation', 'Tile Installation', 'Laminate Flooring', 'Carpet Install', 'Vinyl Plank', 'Floor Refinishing'] },
  { id: 'pest-control',label: 'Pest Control',      icon: '🐛', desc: 'Rodents, termites, insects',     category: 'Pest Control',
    subSkills: ['Rodent Control', 'Termite Treatment', 'Ant & Roach', 'Bed Bug Treatment', 'Mosquito Control', 'Wildlife Removal'] },
  { id: 'auto',        label: 'Auto Repair',       icon: '🚗', desc: 'Mobile mechanic, detailing',     category: 'Auto',
    subSkills: ['Mobile Mechanic', 'Mobile Detailing', 'Oil Change', 'Tire Services', 'Windshield Repair', 'Battery Replacement'] },
  { id: 'appliance',   label: 'Appliance Repair',  icon: '🔌', desc: 'Washer, dryer, refrigerator',   category: 'Appliance Repair',
    subSkills: ['Washer & Dryer Repair', 'Refrigerator Repair', 'Dishwasher Repair', 'Oven & Stove Repair', 'Microwave Repair'] },
  { id: 'concrete',    label: 'Concrete',          icon: '🏗️', desc: 'Driveways, patios, slabs',       category: 'Concrete',
    subSkills: ['Driveway Pour', 'Patio Slab', 'Concrete Repair', 'Stamped Concrete', 'Sidewalk Repair', 'Retaining Wall'] },
  { id: 'welding',     label: 'Welding',           icon: '⚙️', desc: 'Metal fab, gates, structural',   category: 'Welding',
    subSkills: ['MIG Welding', 'Metal Fabrication', 'Gate & Fence Welding', 'Structural Welding', 'Custom Metalwork', 'Pipe Welding'] },
  { id: 'home-repair', label: 'Home Repair',       icon: '🔨', desc: 'Drywall, fixtures, handyman',    category: 'Home Repair',
    subSkills: ['Drywall Repair', 'Fixture Installation', 'Door & Window Repair', 'Gutter Cleaning', 'Fence Repair', 'Tile & Grout'] },
  { id: 'security',    label: 'Security',          icon: '🔒', desc: 'Cameras, alarms, smart home',    category: 'Security',
    subSkills: ['Security Camera Install', 'Smart Lock Install', 'Alarm System', 'Motion Sensors', 'Ring/Nest Install', 'Access Control'] },
  { id: 'pet-care',    label: 'Pet Care',          icon: '🐾', desc: 'Sitting, walking, grooming',     category: 'Personal Services',
    subSkills: ['Pet Sitting', 'Dog Walking', 'Grocery Shopping', 'Elder Care Assistance'] },
  { id: 'tutoring',    label: 'Tutoring',          icon: '📚', desc: 'Math, reading, test prep',       category: 'Personal Services',
    subSkills: ['Tutoring', 'Home Organization', 'Grocery Shopping', 'Elder Care Assistance'] },
];

/** Suggested adjacent skills for no-results empty state */
export const ADJACENT_SKILLS: Record<string, string[]> = {
  Electrical:          ['HVAC', 'Security', 'Home Repair'],
  Plumbing:            ['HVAC', 'Appliance Repair', 'Home Repair'],
  HVAC:                ['Electrical', 'Plumbing', 'Appliance Repair'],
  Carpentry:           ['Painting', 'Flooring', 'Home Repair'],
  Painting:            ['Carpentry', 'Home Repair', 'Cleaning'],
  Landscaping:         ['Cleaning', 'Concrete', 'Moving'],
  Cleaning:            ['Painting', 'Home Repair', 'Landscaping'],
  Moving:              ['Cleaning', 'Carpentry', 'Home Repair'],
  Roofing:             ['Carpentry', 'Concrete', 'Home Repair'],
  Flooring:            ['Carpentry', 'Painting', 'Home Repair'],
  'Pest Control':      ['Cleaning', 'Home Repair'],
  Auto:                ['Welding', 'Concrete'],
  'Appliance Repair':  ['Electrical', 'Plumbing', 'HVAC'],
  Concrete:            ['Landscaping', 'Carpentry', 'Roofing'],
  Welding:             ['Carpentry', 'Concrete', 'Auto'],
  'Home Repair':       ['Carpentry', 'Painting', 'Electrical'],
  Security:            ['Electrical', 'Home Repair'],
  'Personal Services': ['Cleaning', 'Landscaping'],
};

export const LICENSES = [
  'General Contractor License',
  'Electrical License (Master)',
  'Electrical License (Journeyman)',
  'Plumbing License',
  'HVAC Certification (EPA 608)',
  'Pesticide Applicator License',
  'Home Inspector License',
  'Real Estate License',
  'Cosmetology License',
  'Childcare License',
  'Locksmith License',
  'Roofing License',
] as const;

export type License = (typeof LICENSES)[number];

export const INSURANCE_TYPES = [
  'General Liability ($1M)',
  'General Liability ($2M+)',
  'Workers\' Compensation',
  'Commercial Auto',
  'Professional Liability (E&O)',
  'Bonded',
  'Umbrella Policy',
] as const;

export type InsuranceType = (typeof INSURANCE_TYPES)[number];

export type SortOption =
  | 'best_match'
  | 'highest_rated'
  | 'most_reviews'
  | 'lowest_price'
  | 'fastest_response'
  | 'newest';

export const SORT_LABELS: Record<SortOption, string> = {
  best_match:       'Best Match',
  highest_rated:    'Highest Rated',
  most_reviews:     'Most Reviews',
  lowest_price:     'Lowest Price',
  fastest_response: 'Fastest Response',
  newest:           'Newest Members',
};

export const RATING_OPTIONS = [
  { label: 'Any rating', value: 0 },
  { label: '3.0+', value: 3.0 },
  { label: '3.5+', value: 3.5 },
  { label: '4.0+', value: 4.0 },
  { label: '4.5+', value: 4.5 },
] as const;

export const DISTANCE_OPTIONS = [5, 10, 25, 50, 100] as const;

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface DirectoryFilters {
  query: string;
  categories: string[];
  skills: string[];
  licenses: string[];
  insurance: string[];
  minRating: number;
  /** [min, max] per hour; null = no restriction */
  priceRange: [number, number] | null;
  /** miles; 0 = any */
  maxDistance: number;
  zipCode: string;
  availableToday: boolean;
  backgroundChecked: boolean;
  verified: boolean;
}

export const DEFAULT_FILTERS: DirectoryFilters = {
  query: '',
  categories: [],
  skills: [],
  licenses: [],
  insurance: [],
  minRating: 0,
  priceRange: null,
  maxDistance: 60,
  zipCode: '',
  availableToday: false,
  backgroundChecked: false,
  verified: false,
};

/** Count how many filter groups are active (for badge display) */
export function countActiveFilters(f: DirectoryFilters): number {
  let n = 0;
  if (f.query)              n++;
  if (f.categories.length)  n++;
  if (f.skills.length)      n++;
  if (f.licenses.length)    n++;
  if (f.insurance.length)   n++;
  if (f.minRating > 0)      n++;
  if (f.priceRange)         n++;
  if (f.maxDistance > 0 && f.maxDistance !== 60) n++;
  if (f.availableToday)     n++;
  if (f.backgroundChecked)  n++;
  if (f.verified)           n++;
  return n;
}

// ─── Card / listing data ──────────────────────────────────────────────────────

export interface HelperServiceSummary {
  name: string;
  price: number;
  priceUnit: PriceUnit;
}

export interface HelperCardData {
  id: string;
  businessName: string;
  ownerName: string;
  avatar: string;
  rating: number;
  reviewCount: number;
  jobsCompleted: number;
  /** ISO date string */
  memberSince: string;
  verified: boolean;
  backgroundChecked: boolean;
  categories: string[];
  skills: string[];
  licenses: License[];
  insurance: InsuranceType[];
  topServices: HelperServiceSummary[];
  /** Lowest flat or hourly rate shown on card */
  startingPrice: number;
  startingPriceUnit: PriceUnit;
  /** e.g. "< 1 hour" */
  responseTime: string;
  /** Minutes as number for sorting */
  responseMinutes: number;
  city: string;
  state: string;
  serviceRadius: number;
  /** Straight-line distance from search location in miles (populated at query time) */
  distanceMiles?: number;
  availableToday: boolean;
  shortBio: string;
}

// ─── Directory page state ─────────────────────────────────────────────────────

export interface DirectoryPageState {
  helpers: HelperCardData[];
  filtered: HelperCardData[];
  totalCount: number;
  displayCount: number;
  pageSize: number;
  hasMore: boolean;
  loadState: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
}
