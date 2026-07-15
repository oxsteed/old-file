// ─── Helper / Business ──────────────────────────────────────────────────────

export interface Badge {
  id: string;
  label: string;
  /** lucide-react icon name (kebab-case) */
  icon: string;
  variant: 'verified' | 'top_rated' | 'fast_responder' | 'trusted' | 'new';
}

export interface HelperProfile {
  id: string;
  businessName: string;
  ownerName: string;
  tagline: string;
  bio: string;
  /** Full URL or relative path */
  avatar: string;
  coverImage: string;
  rating: number;
  reviewCount: number;
  jobsCompleted: number;
  /** ISO date string */
  memberSince: string;
  verified: boolean;
  /** e.g. "< 1 hour" */
  responseTime: string;
  /** 0–100 */
  responseRate: number;
  badges: Badge[];
  /** Learning certificates earned from completed OxSteed guides. */
  skillBadges?: Array<{
    id: string;
    label: string;
    category: string;
    earnedAt?: string;
  }>;
  categories: string[];
  /** Service city (public) */
  city?: string;
  /** Service state code (public) */
  state?: string;
  /** When true, visitors without an account can send a guest message from the public profile */
  allowGuestContact?: boolean;
  /** When true, helper accepts live chat requests */
  allowLiveChat?: boolean;
  /** When true, helper accepts booking requests */
  allowBooking?: boolean;
  /** When true, helper accepts scheduling requests */
  allowScheduling?: boolean;

  // ── Trust signals (self-reported) ──────────────────────────────────────
  /** Helper claims to have professional license(s) */
  hasLicense?: boolean;
  /** Helper claims to have insurance */
  hasInsurance?: boolean;
  /** Years as member on OxSteed platform */
  yearsInBusiness?: number;
  /** Currently available for new bookings */
  isAvailableNow?: boolean;
  /** Helper's listed specializations/skills */
  specializations?: string[];
  /** "online" | "offline" | "away" */
  availabilityStatus?: 'online' | 'offline' | 'away';
  /** Total jobs attempted */
  totalJobs?: number;
  /** Completion rate 0-100 */
  completionRate?: number;
}

// ─── Services ───────────────────────────────────────────────────────────────

export type PriceUnit = 'hour' | 'flat' | 'starting_at' | 'quote';

export interface Service {
  id: string;
  name: string;
  description: string;
  /** 0 means "get a quote" */
  price: number;
  priceUnit: PriceUnit;
  /** Human-readable duration, e.g. "1–2 hrs" */
  duration?: string;
  popular?: boolean;
  category: string;
}

// ─── Gallery ────────────────────────────────────────────────────────────────

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
  caption?: string;
  type: 'photo' | 'video_thumb';
}

// ─── Hours ──────────────────────────────────────────────────────────────────

export interface DayHours {
  day: string;
  open: string;
  close: string;
  closed: boolean;
}

// ─── Location ───────────────────────────────────────────────────────────────

export interface LocationInfo {
  city: string;
  state: string;
  zip: string;
  serviceRadius: number;
  radiusUnit: 'miles' | 'km';
  servesRemotely: boolean;
  remoteNote?: string;
  /** When set, map centers on helper/business service coordinates */
  serviceLat?: number | null;
  serviceLng?: number | null;
}

// ─── Policies ───────────────────────────────────────────────────────────────

export interface Policy {
  id: string;
  title: string;
  content: string;
  /** lucide-react icon name */
  icon: string;
}

// ─── Reviews ────────────────────────────────────────────────────────────────

export interface HelperReply {
  content: string;
  /** ISO date string */
  date: string;
}

export interface Review {
  id: string;
  authorName: string;
  authorAvatar?: string;
  rating: number;
  /** ISO date string */
  date: string;
  serviceUsed: string;
  content: string;
  helpfulCount: number;
  helperReply?: HelperReply;
  verified: boolean;
}

// ─── FAQs ───────────────────────────────────────────────────────────────────

export interface FAQ {
  id: string;
  question: string;
  answer: string;
}

// ─── Chat ───────────────────────────────────────────────────────────────────

/** Which side the user is addressing */
export type ChatDestination = 'oxsteed' | 'helper';

/**
 * live          - human online and responding
 * ai_assistant  - bot handling the conversation
 * offline       - no one available
 * message_mode  - async / leave a message
 * connecting    - establishing connection
 */
export type ChatStatus =
  | 'live'
  | 'ai_assistant'
  | 'offline'
  | 'message_mode'
  | 'connecting';

/**
 * Who authored a message bubble.
 * user            - the visiting customer
 * oxsteed_ai      - platform bot
 * oxsteed_human   - platform support agent
 * helper_ai       - helper's bot
 * helper_human    - the helper / business owner
 */
export type MessageAuthorType =
  | 'user'
  | 'oxsteed_ai'
  | 'oxsteed_human'
  | 'helper_ai'
  | 'helper_human';

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'document' | 'other';
  /** Bytes */
  size?: number;
}

export interface ChatMessage {
  id: string;
  itemType: 'message';
  authorType: MessageAuthorType;
  content: string;
  /** ISO date string */
  timestamp: string;
  /** Optional fields from legacy/alternate payloads */
  sender_id?: string | number;
  sender_name?: string;
  attachments?: Attachment[];
  isRead?: boolean;
  /** When message was read by recipient (ISO date string) */
  readAt?: string;
}

export type TimelineEventKind =
  | 'booking_event'
  | 'order_event'
  | 'job_status'
  | 'handoff'
  | 'system';

export interface TimelineEvent {
  id: string;
  itemType: TimelineEventKind;
  /** Specific sub-type, e.g. "quote_sent", "booking_confirmed", "human_takeover" */
  eventType: string;
  content: string;
  /** ISO date string */
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** Discriminated union - use itemType to narrow */
export type TimelineItem = ChatMessage | TimelineEvent;

export interface TypingIndicator {
  authorType: MessageAuthorType;
  authorLabel: string;
}

export interface ChatSession {
  id: string;
  destination: ChatDestination;
  /** Combined status for current destination */
  status: ChatStatus;
  helperStatus: ChatStatus;
  oxsteedStatus: ChatStatus;
  timeline: TimelineItem[];
  typing?: TypingIndicator | null;
}

// ─── Section Visibility ─────────────────────────────────────────────────────

export interface SectionVisibility {
  services: boolean;
  gallery: boolean;
  hours: boolean;
  policies: boolean;
  faqs: boolean;
}

// ─── Page-level aggregate ───────────────────────────────────────────────────

export interface HelperProfileData {
  helper: HelperProfile;
  services: Service[];
  gallery: GalleryImage[];
  hours: DayHours[];
  location: LocationInfo;
  policies: Policy[];
  reviews: Review[];
  faqs: FAQ[];
  visibility: SectionVisibility;
  chatSession: ChatSession;
  /** Active profile template slug (default: 'default') */
  activeTemplate?: string;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';
