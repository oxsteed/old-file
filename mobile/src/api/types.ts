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

export type MobileJob = {
  id: string;
  title: string;
  status?: string;
  category_name?: string;
  budget_min?: string | number | null;
  budget_max?: string | number | null;
  location_city?: string | null;
  location_state?: string | null;
  created_at?: string;
};

export type MobileBooking = {
  id: string;
  service_name?: string;
  requested_date?: string;
  requested_start_time?: string;
  requested_end_time?: string;
  service_location?: string;
  status?: string;
  customer_name?: string;
  created_at?: string;
};

export type MobileAppointment = {
  id: string;
  title?: string;
  status?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
};

export type PlannedNeed = {
  id: number;
  title: string;
  category?: string;
  status?: string;
  due_date?: string;
  estimated_cost?: string | number | null;
  reserved_amount?: string | number | null;
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
