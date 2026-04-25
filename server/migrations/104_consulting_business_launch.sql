-- OxSteed Business Launch Program - Consulting Requests
-- Stores intake form submissions for the new Business Launch service

CREATE TABLE IF NOT EXISTS consulting_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Contact Information
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  referral_source VARCHAR(100), -- 'marketplace', 'google', 'referral', 'social', 'other'

  -- Skill & Offer
  skill_description TEXT NOT NULL,
  target_market TEXT NOT NULL,
  has_revenue VARCHAR(50), -- 'no', 'informal', 'formal'
  business_name_decided BOOLEAN DEFAULT FALSE,
  business_name VARCHAR(255),
  operating_state VARCHAR(2),

  -- Setup Needs
  setup_items_selected JSONB DEFAULT '[]'::jsonb,
  select_all_chosen BOOLEAN DEFAULT FALSE,
  current_phase INTEGER CHECK (current_phase >= 1 AND current_phase <= 25),
  additional_notes TEXT,
  urgency VARCHAR(100), -- 'exploring', 'two_weeks', 'asap'

  -- Package & Pricing
  package_selected VARCHAR(50), -- 'foundation', 'launch', 'accelerator'
  package_price DECIMAL(10, 2),

  -- Status & Tracking
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
    'pending', 'contacted', 'kickoff_scheduled', 'in_progress', 'completed', 'cancelled'
  )),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_consulting_requests_email ON consulting_requests(email);
CREATE INDEX idx_consulting_requests_user_id ON consulting_requests(user_id);
CREATE INDEX idx_consulting_requests_status ON consulting_requests(status);
CREATE INDEX idx_consulting_requests_package ON consulting_requests(package_selected);
CREATE INDEX idx_consulting_requests_state ON consulting_requests(operating_state);
CREATE INDEX idx_consulting_requests_created_at ON consulting_requests(created_at DESC);

-- Audit log for status changes
CREATE TABLE IF NOT EXISTS consulting_request_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_consulting_audit_request_id ON consulting_request_audit_log(request_id);
CREATE INDEX idx_consulting_audit_admin_id ON consulting_request_audit_log(admin_id);
