// client/src/types/jobDirectory.ts
//
// Filter, sort, and card-data types for the Browse Jobs directory.
// Mirrors the structure of helperDirectory.ts so the UI components on both
// pages can share patterns (skill tiles, sidebar filter panel, sort, etc.).

import { SKILL_TILES, CATEGORIES, ADJACENT_SKILLS } from './helperDirectory';

// Re-export shared constants - the job and helper directories use the same
// skill taxonomy so customers can browse jobs by category and helpers by
// category in the same way.
export { SKILL_TILES, CATEGORIES, ADJACENT_SKILLS };

// ─── Sort options ─────────────────────────────────────────────────────────────

export type JobSortOption =
  | 'newest'
  | 'urgent'
  | 'budget_high'
  | 'budget_low'
  | 'most_bids'
  | 'fewest_bids'
  | 'nearest';

export const JOB_SORT_OPTIONS: JobSortOption[] = [
  'newest',
  'urgent',
  'budget_high',
  'budget_low',
  'most_bids',
  'fewest_bids',
  'nearest',
];

// Sort values supported by /api/jobs backend.
// 'nearest' requires lat/lng — JobListPage omits it from the selector when
// no location is active (so helpers never see it without coords).
export const SERVER_SORT: Record<JobSortOption, string> = {
  newest:       'newest',
  urgent:       'urgent',
  budget_high:  'budget_high',
  budget_low:   'budget_low',
  // Bid-count sorts don't have a backend equivalent yet - fall back to newest
  // and let the client sort what it has after fetching.
  most_bids:    'newest',
  fewest_bids:  'newest',
  nearest:      'nearest',
};

// ─── Posted-within (date filter) ──────────────────────────────────────────────

export type PostedWithin = 'any' | 'today' | 'three_days' | 'week' | 'month';

export const POSTED_WITHIN_OPTIONS: PostedWithin[] = [
  'any',
  'today',
  'three_days',
  'week',
  'month',
];

// ─── Budget presets ───────────────────────────────────────────────────────────

export const JOB_BUDGET_PRESETS: Array<{ key: string; range: [number, number] }> = [
  { key: 'budgetUnder100',   range: [0, 100] },
  { key: 'budget100to500',   range: [100, 500] },
  { key: 'budget500to1500',  range: [500, 1500] },
  { key: 'budget1500plus',   range: [1500, 999999] },
];

// ─── Urgency / priority levels (matches backend `is_urgent` + priority) ───────

export type JobPriority = 'urgent' | 'high' | 'normal' | 'low';

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface JobFilters {
  query: string;
  /** Single category - driven by skill-tile selection (matches j.category_name) */
  category: string;
  /** Sub-skill chips (active when a tile is selected) - folded into `q` server-side */
  skills: string[];
  city: string;
  state: string;
  country: string;
  /** [min, max]; null = no restriction */
  budgetRange: [number, number] | null;
  postedWithin: PostedWithin;
  urgentOnly: boolean;
  hasBids: boolean;
  noBidsYet: boolean;
  /**
   * Geolocation-based radius search. When userLat + userLng are set the backend
   * uses PostGIS ST_DWithin() instead of (or in addition to) city/state text match.
   * radiusMiles defaults to 25 and is capped server-side at 100.
   */
  userLat: number | null;
  userLng: number | null;
  radiusMiles: number;
}

export const DEFAULT_JOB_FILTERS: JobFilters = {
  query: '',
  category: '',
  skills: [],
  city: '',
  state: '',
  country: 'US',
  budgetRange: null,
  postedWithin: 'any',
  urgentOnly: false,
  hasBids: false,
  noBidsYet: false,
  userLat: null,
  userLng: null,
  radiusMiles: 25,
};

/** Count how many filter groups are currently active (for the badge display). */
export function countActiveJobFilters(f: JobFilters): number {
  let n = 0;
  if (f.query)            n++;
  if (f.category)         n++;
  if (f.skills.length)    n++;
  // Radius search counts as the location filter; plain city/state still count individually.
  if (f.userLat !== null) n++;
  else {
    if (f.city)  n++;
    if (f.state) n++;
  }
  // Country is always counted independently (can combine with geo-radius or city/state)
  if (f.country) n++;
  if (f.budgetRange)      n++;
  if (f.postedWithin && f.postedWithin !== 'any') n++;
  if (f.urgentOnly)       n++;
  if (f.hasBids)          n++;
  if (f.noBidsYet)        n++;
  return n;
}

// ─── Card / listing data ──────────────────────────────────────────────────────
//
// JobCardData is the shape returned by `/api/jobs` flattened into the fields
// the card component needs.

export interface JobCardData {
  id: number | string;
  title: string;
  description: string;
  category: string;
  status: string;
  budgetType?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  isUrgent?: boolean;
  priority?: JobPriority;
  city?: string | null;
  state?: string | null;
  /** ISO date - used for "posted N days ago" */
  createdAt: string;
  expiresAt?: string | null;
  bidCount: number;
  clientName?: string | null;
  clientId?: string | null;
}

/** Map a raw `/api/jobs` row to the card shape used by the directory grid. */
export function toJobCardData(row: Record<string, any>): JobCardData {
  return {
    id:           row.id,
    title:        row.title || '',
    description:  row.description || '',
    category:     row.category_name || row.category || '',
    status:       row.status || 'published',
    budgetType:   row.budget_type ?? null,
    budgetMin:    row.budget_min ?? null,
    budgetMax:    row.budget_max ?? null,
    isUrgent:     !!row.is_urgent,
    priority:     row.is_urgent ? 'urgent' : 'normal',
    city:         row.location_city ?? null,
    state:        row.location_state ?? null,
    createdAt:    row.created_at,
    expiresAt:    row.expires_at ?? null,
    bidCount:     Number(row.bid_count) || 0,
    clientName:   row.client_name ?? null,
    clientId:     row.client_id ?? null,
  };
}
