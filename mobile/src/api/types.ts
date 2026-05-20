export type AuthUser = {
  id: string | number;
  first_name?: string;
  last_name?: string;
  email: string;
  role?: "customer" | "helper" | "helper_pro" | "broker" | "admin" | "super_admin" | string;
  email_verified?: boolean;
  onboarding_step?: string;
};

export type AuthResponse = {
  success?: boolean;
  message?: string;
  user?: AuthUser;
  accessToken?: string;
  refreshToken?: string;
  requiresTwoFactor?: boolean;
  mfaToken?: string;
};

export type MobileFeed = {
  user: AuthUser;
  summary: {
    open_jobs: number;
    incoming_booking_requests: number;
    unread_messages: number;
    unread_notifications: number;
    total_orders: number;
    total_spent_cents: number;
    owned_businesses: number;
  };
  jobs: {
    mine: MobileJob[];
    available: MobileJob[];
  };
  bookings: {
    sent: MobileBooking[];
    incoming: MobileBooking[];
  };
  appointments: MobileAppointment[];
  planned_needs: PlannedNeed[];
  conversations: MobileConversation[];
  orders: {
    stats: Record<string, unknown>;
    recent: MobileOrder[];
  };
  businesses: MobileBusiness[];
};

export type HelperDirectoryItem = {
  id: string | number;
  businessName?: string;
  ownerName?: string;
  avatar?: string;
  rating?: number;
  reviewCount?: number;
  jobsCompleted?: number;
  verified?: boolean;
  backgroundChecked?: boolean;
  categories?: string[];
  skills?: string[];
  topServices?: Array<{ name: string; price?: number; priceUnit?: string }>;
  startingPrice?: number;
  startingPriceUnit?: string;
  responseTime?: string;
  city?: string;
  state?: string;
  availableToday?: boolean;
  shortBio?: string;
};

export type HelperProfile = {
  helper: HelperDirectoryItem & {
    tagline?: string;
    bio?: string;
    coverImage?: string;
    allowBooking?: boolean;
    allowScheduling?: boolean;
    responseRate?: number;
    badges?: Array<{ id: string; label: string; variant?: string }>;
  };
  services: Array<{
    id: string;
    name: string;
    description?: string;
    price?: number;
    priceUnit?: string;
    duration?: string;
    popular?: boolean;
  }>;
  gallery: Array<{ id: string; url: string; caption?: string }>;
  policies: Array<{ id: string; title: string; content: string }>;
  reviews: Array<{ id: string; authorName?: string; rating?: number; content?: string; date?: string }>;
};

export type Conversation = {
  id: string | number;
  job_id?: string | number | null;
  customer_id?: string | number;
  helper_id?: string | number;
  status?: string;
  other_user_name?: string;
  other_user_id?: string | number;
  job_title?: string;
  last_message?: string;
  unread_count?: string | number;
  last_message_at?: string;
  helper_business_name?: string;
  conversation_business_name?: string;
};

export type Message = {
  id: string | number;
  conversation_id: string | number;
  sender_id: string | number;
  sender_name?: string;
  content: string;
  created_at?: string;
  is_read?: boolean;
  pending?: boolean;
};

export type Invoice = {
  id: string | number;
  invoice_number?: string;
  client_name?: string;
  client_email?: string;
  status?: string;
  amount_cents?: string | number;
  total?: string | number;
  amount_paid?: string | number;
  issued_at?: string;
  due_at?: string;
  business_name?: string;
  created_at?: string;
};

export type InvoicePaymentIntent = {
  invoiceId: string | number;
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  publishableKey: string;
};

export type BookingPaymentIntent = {
  bookingId: string | number;
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  paymentRequirement: "deposit" | "full";
  publishableKey: string;
};

export type MobileJob = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  category_name?: string;
  budget_type?: string;
  budget_min?: string | number | null;
  budget_max?: string | number | null;
  is_urgent?: boolean;
  urgency?: string;
  location_city?: string | null;
  location_state?: string | null;
  distance_miles?: string | number | null;
  bid_count?: string | number | null;
  client_name?: string;
  created_at?: string;
};

export type MobileBooking = {
  id: string;
  service_name?: string;
  serviceName?: string;
  requested_date?: string;
  requestedDate?: string;
  requested_start_time?: string;
  requestedStartTime?: string;
  requested_end_time?: string;
  requestedEndTime?: string;
  service_location?: string;
  serviceLocation?: string;
  status?: string;
  customer_name?: string;
  customerName?: string | null;
  created_at?: string;
  createdAt?: string;
  payment_status?: string;
  paymentStatus?: string;
  payment_amount_cents?: string | number;
  paymentAmountCents?: string | number;
};

export type MobileAppointment = {
  id: string;
  title?: string;
  service_description?: string;
  job_id?: string | number | null;
  status?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  customer_name?: string;
  helper_name?: string;
  job_title?: string;
};

export type AvailableSlot = {
  startTime: string;
  endTime: string;
  available: boolean;
};

export type PlannedNeed = {
  id: number;
  title: string;
  description?: string;
  category?: string;
  status?: string;
  due_date?: string;
  estimated_cost?: string | number | null;
  reserved_amount?: string | number | null;
  lead_time_days?: number;
  recurrence_type?: string;
  recurrence_interval_days?: number | null;
  days_until_due?: string | number;
};

export type MobileConversation = {
  id: string;
  job_title?: string;
  last_message?: string;
  unread_count?: string | number;
  last_message_at?: string;
};

export type MobileOrder = {
  id: string | number;
  status?: string;
  total_cents?: number;
  created_at?: string;
};

export type MobileBusiness = {
  id: string | number;
  business_name: string;
  business_type?: string;
  active_template?: string;
  is_primary?: boolean;
};

export type RegisterPayload = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: "customer" | "helper";
  language: string;
};

export type JobPostPayload = {
  title: string;
  description: string;
  category_name: string;
  budget_type: "fixed" | "hourly" | "quote";
  budget_min?: number;
  budget_max?: number;
  urgency: "normal" | "urgent" | "emergency";
  location_city: string;
  location_state?: string;
  location_country: string;
};

export type PlannedNeedPayload = {
  title: string;
  description?: string;
  category: "car_care" | "personal_care" | "other";
  due_date: string;
  estimated_cost?: number;
  lead_time_days: number;
  recurrence_type: "none" | "fixed" | "floating";
  recurrence_interval_days?: number;
  notes?: string;
};

export type HelperBid = {
  id: string | number;
  job_id: string | number;
  amount: string | number;
  message?: string;
  status?: "pending" | "accepted" | "rejected" | "withdrawn" | string;
  eta_hours?: string | number | null;
  job_title?: string;
  job_category?: string;
  job_status?: string;
  location_city?: string;
  location_state?: string;
  created_at?: string;
};

export type AvailabilityBlock = {
  id: string | number;
  helper_id?: string | number;
  start_time: string;
  end_time: string;
  type: "available" | "unavailable" | "busy" | string;
  title?: string | null;
  notes?: string | null;
};

export type HelperProfileLite = {
  profile_headline?: string | null;
  bio_short?: string | null;
  bio_long?: string | null;
  profile_photo_url?: string | null;
  cover_photo_url?: string | null;
  service_city?: string | null;
  service_state?: string | null;
  service_zip?: string | null;
  service_radius_miles?: string | number | null;
  hourly_rate_min?: string | number | null;
  hourly_rate_max?: string | number | null;
  rate_preference?: string | null;
  services: Array<{
    id: string | number;
    name: string;
    description?: string;
    price?: string | number;
    price_unit?: string;
    duration?: string;
    category?: string;
  }>;
  policies: Array<{
    id: string | number;
    title: string;
    content: string;
    icon?: string;
  }>;
  gallery: Array<{
    id: string | number;
    url: string;
    caption?: string;
  }>;
};

export type HelperPayment = {
  id: string | number;
  job_id?: string | number;
  job_title?: string;
  amount?: string | number;
  platform_fee?: string | number;
  status?: string;
  payment_hold_status?: string;
  created_at?: string;
  captured_at?: string | null;
};

export type ConnectStatus = {
  connected: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  onboarding_complete?: boolean;
};

export type ReviewEligibility = {
  eligible: boolean;
  already_reviewed: boolean;
  job_status?: string;
};
