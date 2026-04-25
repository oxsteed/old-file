-- Track post-session follow-up emails and feedback
CREATE TABLE consulting_session_followups (
  id BIGSERIAL PRIMARY KEY,
  session_scheduled_id BIGINT NOT NULL REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  followup_type VARCHAR(50) NOT NULL CHECK (followup_type IN ('post_session', 'reminder', 'no_show', 'custom')),
  feedback_rating INT CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
  feedback_text TEXT,
  sent_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_session_followups_session ON consulting_session_followups(session_scheduled_id);
CREATE INDEX idx_consulting_session_followups_type ON consulting_session_followups(followup_type);
CREATE INDEX idx_consulting_session_followups_sent_at ON consulting_session_followups(sent_at DESC);
