-- Wave 4 (Group 3, item 103, R36): business appointments need an arrival
-- stamp like helper appointments have (appointments.arrived_at), so the
-- provider arrival check-in works for business bookings too.
ALTER TABLE business_appointments ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP WITH TIME ZONE;
