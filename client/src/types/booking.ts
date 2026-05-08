/**
 * Booking Request Types
 */

export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'accepted_cancelled';

export interface BookingRequest {
  id: string;
  customerId: string;
  helperId: string;
  serviceName: string;
  requestedDate: string; // YYYY-MM-DD
  requestedStartTime: string; // HH:MM
  requestedEndTime: string; // HH:MM
  serviceLocation: string;
  description?: string;
  status: BookingStatus;
  expiresAt: string; // ISO timestamp
  confirmationHours: number;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  helperResponseReason?: string | null;
  convertedToJobId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingSlot {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  available: boolean;
}

export interface AvailableSlotsResponse {
  date: string;
  dayOfWeek: string;
  businessHours?: {
    start: string;
    end: string;
    closed?: boolean;
  };
  slots: BookingSlot[];
}

export interface CreateBookingRequest {
  helperId: string;
  serviceName: string;
  requestedDate: string; // YYYY-MM-DD
  requestedStartTime: string; // HH:MM
  requestedEndTime: string; // HH:MM
  serviceLocation: string;
  description?: string;
  confirmationHours?: number; // 1–168, defaults to 24
}

export interface BookingFlowData {
  requestedDate: string;
  requestedStartTime: string;
  requestedEndTime: string;
  serviceName: string;
  serviceLocation: string;
  description: string;
}

export interface BookingRequestPreferences {
  helperId: string;
  autoAcceptEnabled: boolean;
  requireApprovalForNewCustomers: boolean;
  minNoticeHours: number;
}
