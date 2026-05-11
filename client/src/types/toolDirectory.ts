/**
 * Tool Rental Directory types and constants.
 *
 * Mirrors the design language of `helperDirectory.ts`: the page surfaces a hero,
 * a tile grid (browse-by-category), an active sub-skill chip strip, a sidebar
 * filter panel, sort controls, active-filter tags, and an empty state.
 *
 * Canonical category strings (English) match the seeded categories on the
 * server (`server/routes/toolRentals.js` → SEED_TOOL_CATEGORIES) so query
 * params stay identical regardless of the user's display language.
 */

// ─── Category catalog (English source of truth) ───────────────────────────────

export const TOOL_CATEGORIES = [
  'Power Tools',
  'Hand Tools',
  'Measuring & Layout',
  'Cutting Tools',
  'Drilling & Fastening',
  'Sanding & Finishing',
  'Welding & Metalwork',
  'Plumbing Tools',
  'Electrical Tools',
  'HVAC Tools',
  'Landscaping & Outdoor',
  'Lawn & Garden',
  'Pressure Washing',
  'Concrete & Masonry',
  'Flooring Tools',
  'Painting Equipment',
  'Scaffolding & Ladders',
  'Lifting & Material Handling',
  'Compressors & Air Tools',
  'Generators & Power',
  'Automotive & Mechanical',
  'Trailers & Hauling',
  'Safety Equipment',
  'Cleaning Equipment',
  'Diagnostic Equipment',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

// ─── Sub-types per category (shown when a tile is selected) ───────────────────

export const TOOL_SUBTYPES_BY_CATEGORY: Record<string, string[]> = {
  'Power Tools':                ['Cordless Drill', 'Impact Driver', 'Circular Saw', 'Reciprocating Saw', 'Angle Grinder', 'Rotary Hammer'],
  'Hand Tools':                 ['Wrench Set', 'Screwdriver Set', 'Hammer', 'Pliers', 'Tool Box', 'Pry Bar'],
  'Measuring & Layout':         ['Laser Level', 'Tape Measure', 'Stud Finder', 'Chalk Line', 'Square', 'Theodolite'],
  'Cutting Tools':               ['Circular Saw', 'Miter Saw', 'Table Saw', 'Jigsaw', 'Chainsaw', 'Tile Saw'],
  'Drilling & Fastening':       ['Hammer Drill', 'Impact Driver', 'Nail Gun', 'Staple Gun', 'Rivet Gun', 'Auger'],
  'Sanding & Finishing':        ['Orbital Sander', 'Belt Sander', 'Drum Sander', 'Polisher', 'Detail Sander', 'Floor Buffer'],
  'Welding & Metalwork':        ['MIG Welder', 'TIG Welder', 'Plasma Cutter', 'Stick Welder', 'Bench Grinder', 'Cut-off Saw'],
  'Plumbing Tools':             ['Pipe Wrench', 'Drain Snake', 'Soldering Torch', 'Pipe Cutter', 'PEX Crimper', 'Pipe Threader'],
  'Electrical Tools':           ['Multimeter', 'Wire Strippers', 'Fish Tape', 'Conduit Bender', 'Voltage Tester', 'Megohmmeter'],
  'HVAC Tools':                 ['Vacuum Pump', 'Recovery Machine', 'Manifold Gauges', 'Leak Detector', 'Refrigerant Scale', 'Coil Cleaner'],
  'Landscaping & Outdoor':      ['Lawn Mower', 'Leaf Blower', 'Hedge Trimmer', 'String Trimmer', 'Edger', 'Tiller'],
  'Lawn & Garden':              ['Riding Mower', 'Aerator', 'Dethatcher', 'Wood Chipper', 'Stump Grinder', 'Sod Cutter'],
  'Pressure Washing':           ['Gas Pressure Washer', 'Electric Pressure Washer', 'Surface Cleaner', 'Sandblaster', 'Hot Water Washer'],
  'Concrete & Masonry':         ['Concrete Mixer', 'Demolition Hammer', 'Floor Saw', 'Trowel Set', 'Concrete Vibrator', 'Tile Cutter'],
  'Flooring Tools':              ['Flooring Nailer', 'Tile Cutter', 'Grout Saw', 'Floor Roller', 'Carpet Stretcher', 'Floor Scraper'],
  'Painting Equipment':         ['Airless Sprayer', 'HVLP Sprayer', 'Paint Pot', 'Drop Cloth', 'Paint Mixer', 'Heat Gun'],
  'Scaffolding & Ladders':      ['Extension Ladder', 'Step Ladder', 'Scaffolding Set', 'Mobile Tower', 'Platform Ladder'],
  'Lifting & Material Handling':['Engine Hoist', 'Hand Truck', 'Pallet Jack', 'Floor Jack', 'Furniture Dolly', 'Appliance Dolly'],
  'Compressors & Air Tools':    ['Air Compressor', 'Pneumatic Nailer', 'Impact Wrench', 'Air Sander', 'Spray Gun', 'Air Hammer'],
  'Generators & Power':         ['Portable Generator', 'Inverter Generator', 'Battery Station', 'Solar Panel', 'Power Bank'],
  'Automotive & Mechanical':    ['Floor Jack', 'OBD Scanner', 'Impact Wrench', 'Engine Hoist', 'Brake Bleeder', 'Tire Changer'],
  'Trailers & Hauling':         ['Utility Trailer', 'Enclosed Trailer', 'Car Trailer', 'Equipment Ramps', 'Tie-down Straps', 'Hitch'],
  'Safety Equipment':           ['Fall Harness', 'Hard Hat', 'Respirator', 'Safety Glasses', 'Hearing Protection', 'Work Gloves'],
  'Cleaning Equipment':         ['Carpet Cleaner', 'Wet/Dry Vacuum', 'Floor Scrubber', 'Steam Cleaner', 'Pressure Washer'],
  'Diagnostic Equipment':       ['Inspection Camera', 'Thermal Imager', 'Moisture Meter', 'Leak Detector', 'Borescope'],
};

// ─── Tile catalog (Browse-by-category UI) ─────────────────────────────────────

export interface ToolCategoryTile {
  id: string;
  label: string;
  icon: string;
  desc: string;
  /** Maps to a value in TOOL_CATEGORIES for filtering */
  category: string;
  /** Sub-types shown when this tile is selected */
  subTypes: string[];
}

export const TOOL_TILES: ToolCategoryTile[] = [
  { id: 'power-tools',   label: 'Power Tools',          icon: '🔋', desc: 'Drills, saws, grinders',           category: 'Power Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Power Tools'] },
  { id: 'hand-tools',    label: 'Hand Tools',           icon: '🔧', desc: 'Wrenches, hammers, pliers',        category: 'Hand Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Hand Tools'] },
  { id: 'cutting',       label: 'Cutting',              icon: '🪚', desc: 'Saws, chainsaws, blades',          category: 'Cutting Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Cutting Tools'] },
  { id: 'drilling',      label: 'Drilling',             icon: '🔩', desc: 'Drills, drivers, nailers',         category: 'Drilling & Fastening',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Drilling & Fastening'] },
  { id: 'sanding',       label: 'Sanding',              icon: '🪵', desc: 'Sanders, polishers, buffers',      category: 'Sanding & Finishing',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Sanding & Finishing'] },
  { id: 'welding',       label: 'Welding',              icon: '⚙️', desc: 'MIG, TIG, plasma, grinders',       category: 'Welding & Metalwork',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Welding & Metalwork'] },
  { id: 'plumbing',      label: 'Plumbing',             icon: '🚿', desc: 'Snakes, wrenches, torches',        category: 'Plumbing Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Plumbing Tools'] },
  { id: 'electrical',    label: 'Electrical',           icon: '⚡', desc: 'Meters, testers, fish tape',       category: 'Electrical Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Electrical Tools'] },
  { id: 'hvac',          label: 'HVAC',                 icon: '❄️', desc: 'Vacuum pumps, gauges, scales',     category: 'HVAC Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['HVAC Tools'] },
  { id: 'landscaping',   label: 'Landscaping',          icon: '🌿', desc: 'Mowers, blowers, trimmers',        category: 'Landscaping & Outdoor',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Landscaping & Outdoor'] },
  { id: 'pressure',      label: 'Pressure Washing',     icon: '💦', desc: 'Pressure washers & cleaners',      category: 'Pressure Washing',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Pressure Washing'] },
  { id: 'concrete',      label: 'Concrete',             icon: '🧱', desc: 'Mixers, demo hammers, trowels',    category: 'Concrete & Masonry',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Concrete & Masonry'] },
  { id: 'flooring',      label: 'Flooring',             icon: '📐', desc: 'Nailers, tile cutters, rollers',   category: 'Flooring Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Flooring Tools'] },
  { id: 'painting',      label: 'Painting',             icon: '🖌️', desc: 'Sprayers, mixers, heat guns',      category: 'Painting Equipment',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Painting Equipment'] },
  { id: 'scaffolding',   label: 'Ladders',              icon: '🪜', desc: 'Ladders & scaffolding',            category: 'Scaffolding & Ladders',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Scaffolding & Ladders'] },
  { id: 'lifting',       label: 'Lifting',              icon: '🏗️', desc: 'Hoists, jacks, dollies',           category: 'Lifting & Material Handling',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Lifting & Material Handling'] },
  { id: 'compressors',   label: 'Air Tools',            icon: '💨', desc: 'Compressors & pneumatics',         category: 'Compressors & Air Tools',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Compressors & Air Tools'] },
  { id: 'generators',    label: 'Generators',           icon: '🔌', desc: 'Generators & power stations',      category: 'Generators & Power',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Generators & Power'] },
  { id: 'automotive',    label: 'Automotive',           icon: '🚗', desc: 'Jacks, scanners, wrenches',        category: 'Automotive & Mechanical',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Automotive & Mechanical'] },
  { id: 'trailers',      label: 'Trailers',             icon: '🚚', desc: 'Trailers, ramps, straps',          category: 'Trailers & Hauling',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Trailers & Hauling'] },
  { id: 'safety',        label: 'Safety Gear',          icon: '🦺', desc: 'Harnesses, helmets, masks',        category: 'Safety Equipment',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Safety Equipment'] },
  { id: 'cleaning',      label: 'Cleaning',             icon: '🧽', desc: 'Vacuums, scrubbers, steam',        category: 'Cleaning Equipment',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Cleaning Equipment'] },
  { id: 'diagnostic',    label: 'Diagnostic',           icon: '📡', desc: 'Cameras, thermal, sensors',        category: 'Diagnostic Equipment',
    subTypes: TOOL_SUBTYPES_BY_CATEGORY['Diagnostic Equipment'] },
];

/** Suggested adjacent categories used by the empty state to recover a search */
export const ADJACENT_TOOL_CATEGORIES: Record<string, string[]> = {
  'Power Tools':              ['Hand Tools', 'Cutting Tools', 'Drilling & Fastening'],
  'Hand Tools':               ['Power Tools', 'Measuring & Layout', 'Plumbing Tools'],
  'Cutting Tools':             ['Power Tools', 'Welding & Metalwork', 'Concrete & Masonry'],
  'Drilling & Fastening':     ['Power Tools', 'Compressors & Air Tools', 'Hand Tools'],
  'Sanding & Finishing':      ['Painting Equipment', 'Cutting Tools', 'Flooring Tools'],
  'Welding & Metalwork':      ['Cutting Tools', 'Automotive & Mechanical', 'Compressors & Air Tools'],
  'Plumbing Tools':           ['HVAC Tools', 'Hand Tools', 'Diagnostic Equipment'],
  'Electrical Tools':         ['HVAC Tools', 'Diagnostic Equipment', 'Generators & Power'],
  'HVAC Tools':               ['Plumbing Tools', 'Electrical Tools', 'Diagnostic Equipment'],
  'Landscaping & Outdoor':    ['Lawn & Garden', 'Pressure Washing', 'Cleaning Equipment'],
  'Lawn & Garden':            ['Landscaping & Outdoor', 'Pressure Washing'],
  'Pressure Washing':         ['Cleaning Equipment', 'Landscaping & Outdoor'],
  'Concrete & Masonry':       ['Cutting Tools', 'Compressors & Air Tools', 'Lifting & Material Handling'],
  'Flooring Tools':           ['Sanding & Finishing', 'Cutting Tools', 'Painting Equipment'],
  'Painting Equipment':       ['Sanding & Finishing', 'Compressors & Air Tools'],
  'Scaffolding & Ladders':    ['Lifting & Material Handling', 'Safety Equipment'],
  'Lifting & Material Handling': ['Scaffolding & Ladders', 'Trailers & Hauling', 'Automotive & Mechanical'],
  'Compressors & Air Tools':  ['Power Tools', 'Painting Equipment', 'Drilling & Fastening'],
  'Generators & Power':       ['Electrical Tools', 'Compressors & Air Tools'],
  'Automotive & Mechanical':  ['Welding & Metalwork', 'Diagnostic Equipment', 'Lifting & Material Handling'],
  'Trailers & Hauling':       ['Lifting & Material Handling', 'Automotive & Mechanical'],
  'Safety Equipment':         ['Scaffolding & Ladders', 'Cleaning Equipment'],
  'Cleaning Equipment':       ['Pressure Washing', 'Safety Equipment'],
  'Diagnostic Equipment':     ['Electrical Tools', 'HVAC Tools', 'Plumbing Tools'],
};

// ─── Conditions ──────────────────────────────────────────────────────────────

export const TOOL_CONDITIONS = ['excellent', 'good', 'fair', 'poor'] as const;
export type ToolCondition = (typeof TOOL_CONDITIONS)[number];

// ─── Sort options ────────────────────────────────────────────────────────────

export type ToolSortOption =
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'most-popular'
  | 'highest-rated';

export const TOOL_SORT_OPTIONS: ToolSortOption[] = [
  'newest',
  'price-asc',
  'price-desc',
  'most-popular',
  'highest-rated',
];

// ─── Distance / price presets ────────────────────────────────────────────────

export const TOOL_PRICE_PRESETS = [
  { key: 'priceUnder25',   range: [0, 25]   as [number, number] },
  { key: 'price25to75',    range: [25, 75]  as [number, number] },
  { key: 'price75to150',   range: [75, 150] as [number, number] },
  { key: 'price150plus',   range: [150, 9999] as [number, number] },
] as const;

// ─── Filter state ────────────────────────────────────────────────────────────

export const DISTANCE_RADIUS_OPTIONS = [5, 10, 25, 50] as const;
export type DistanceRadius = (typeof DISTANCE_RADIUS_OPTIONS)[number] | null;

export interface ToolDirectoryFilters {
  query: string;
  /** Active categories (any-of). For now backend supports a single value; client picks the first. */
  categories: string[];
  /** Active sub-types (any-of). Client-side refinement. */
  subTypes: string[];
  /** Active conditions (any-of). Client-side filter. */
  conditions: ToolCondition[];
  /** [min, max] $ per day; null = no restriction */
  priceRange: [number, number] | null;
  /** Free-text city filter; sent to the backend as `city` */
  city: string;
  /** Radius in miles around city; null = no restriction */
  radius: DistanceRadius;
  /** Quick toggles */
  availableNow: boolean;
  deliveryAvailable: boolean;
  requiresDeposit: boolean | null; // null = any, true = required, false = no deposit
}

export const DEFAULT_TOOL_FILTERS: ToolDirectoryFilters = {
  query: '',
  categories: [],
  subTypes: [],
  conditions: [],
  priceRange: null,
  city: '',
  radius: null,
  availableNow: false,
  deliveryAvailable: false,
  requiresDeposit: null,
};

/** Count active filter groups for badge display */
export function countActiveToolFilters(f: ToolDirectoryFilters): number {
  let n = 0;
  if (f.query)              n++;
  if (f.categories.length)  n++;
  if (f.subTypes.length)    n++;
  if (f.conditions.length)  n++;
  if (f.priceRange)         n++;
  if (f.city)               n++;
  if (f.radius !== null)    n++;
  if (f.availableNow)       n++;
  if (f.deliveryAvailable)  n++;
  if (f.requiresDeposit !== null) n++;
  return n;
}

// ─── Card / listing data ─────────────────────────────────────────────────────

export interface ToolCardData {
  id: number;
  user_id: number;
  name: string;
  category: string;
  description?: string | null;
  daily_rate: number;
  hourly_rate?: number | null;
  weekly_rate?: number | null;
  monthly_rate?: number | null;
  deposit_amount?: number | null;
  condition: ToolCondition | string;
  brand?: string | null;
  model?: string | null;
  is_available: boolean;
  requires_deposit?: boolean;
  delivery_available?: boolean;
  pickup_only?: boolean;
  location_city?: string | null;
  location_state?: string | null;
  image_url?: string | null;
  owner_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  owner_id?: number;
  owner_rating?: number | null;
  avg_rating?: number | null;
  review_count?: number | null;
  avg_response_time_hours?: number | null;
  created_at?: string;
}
