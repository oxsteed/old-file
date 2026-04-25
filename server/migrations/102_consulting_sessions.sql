-- Consulting sessions and bookings
CREATE TABLE consulting_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255),
  phone VARCHAR(20),
  current_phase INT,
  service_tier VARCHAR(50) CHECK (service_tier IN ('foundation', 'implementation', 'transformation', 'initial')),
  areas_of_help TEXT[] DEFAULT '{}',
  description TEXT,
  preferred_date DATE,
  preferred_time_slot VARCHAR(50) CHECK (preferred_time_slot IN ('morning', 'afternoon', 'evening', 'flexible')),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  booking_confirmed BOOLEAN DEFAULT FALSE,
  consultant_assigned_id BIGINT,
  scheduled_at TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_sessions_user_id ON consulting_sessions(user_id);
CREATE INDEX idx_consulting_sessions_email ON consulting_sessions(email);
CREATE INDEX idx_consulting_sessions_status ON consulting_sessions(status);
CREATE INDEX idx_consulting_sessions_created_at ON consulting_sessions(created_at DESC);
CREATE INDEX idx_consulting_sessions_preferred_date ON consulting_sessions(preferred_date);

-- Audit log for consulting interactions
CREATE TABLE consulting_audit_log (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT,
  admin_id BIGINT,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_audit_log_session_id ON consulting_audit_log(session_id);
CREATE INDEX idx_consulting_audit_log_admin_id ON consulting_audit_log(admin_id);

-- Add foreign key constraints
ALTER TABLE consulting_sessions ADD CONSTRAINT consulting_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE consulting_sessions ADD CONSTRAINT consulting_sessions_consultant_assigned_id_fkey
  FOREIGN KEY (consultant_assigned_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE consulting_audit_log ADD CONSTRAINT consulting_audit_log_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES consulting_sessions(id) ON DELETE CASCADE;

ALTER TABLE consulting_audit_log ADD CONSTRAINT consulting_audit_log_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL;
