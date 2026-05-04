-- Migration 171: Bid Payment Methods & Helper Cancellation Policies
-- Adds payment method selection and cancellation policy configuration

-- Add payment method columns to bids table
ALTER TABLE bids ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT NULL;
-- Values: 'oxsteed' or NULL (for off-platform)

ALTER TABLE bids ADD COLUMN IF NOT EXISTS cancellation_policy JSONB DEFAULT '{}';
-- Structure: { "type": "oxsteed" or "custom", "fee_cap_cents": 1000, "custom_terms": "...", "timing_rules": {...} }

ALTER TABLE bids ADD COLUMN IF NOT EXISTS cancellation_fee_cents INTEGER DEFAULT NULL;
-- Calculated fee amount IF job is cancelled

ALTER TABLE bids ADD COLUMN IF NOT EXISTS cancellation_fee_paid BOOLEAN DEFAULT FALSE;
-- Whether fee was actually collected

-- Create helper_cancellation_policies table
CREATE TABLE IF NOT EXISTS helper_cancellation_policies (
    id SERIAL PRIMARY KEY,
    helper_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    oxsteed_enabled BOOLEAN DEFAULT TRUE,
    custom_enabled BOOLEAN DEFAULT FALSE,
    custom_policy JSONB DEFAULT '{}',
    -- custom_policy structure: { "deposit_percent": 50, "terms": "...", "min_notice_hours": 48 }
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_helper_policies_helper_id ON helper_cancellation_policies(helper_id);
CREATE INDEX IF NOT EXISTS idx_bids_payment_method ON bids(payment_method);
CREATE INDEX IF NOT EXISTS idx_bids_cancellation_fee_paid ON bids(cancellation_fee_paid);

-- Add cancellation columns to jobs table if not present
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;

-- Create index on cancelled_at for query performance
CREATE INDEX IF NOT EXISTS idx_jobs_cancelled_at ON jobs(cancelled_at);

-- Add cancellation columns to appointments table if not present
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;

-- Create index on appointment cancellation status
CREATE INDEX IF NOT EXISTS idx_appointments_cancelled_at ON appointments(cancelled_at);
