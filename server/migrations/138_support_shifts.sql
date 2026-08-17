-- Migration 138: Agent shifts and scheduling
-- Enables shift management, clock in/out, break tracking, and availability windows

CREATE TABLE IF NOT EXISTS agent_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  scheduled_start TIME,
  scheduled_end TIME,
  actual_clock_in TIMESTAMP,
  actual_clock_out TIMESTAMP,
  break_start TIMESTAMP,
  break_end TIMESTAMP,
  total_break_minutes INTEGER DEFAULT 0,
  total_worked_minutes INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, clocked_in, on_break, clocked_out, no_show, cancelled
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_shifts_agent ON agent_shifts(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_business ON agent_shifts(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_date ON agent_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_status ON agent_shifts(status);
CREATE INDEX IF NOT EXISTS idx_agent_shifts_agent_date ON agent_shifts(agent_id, shift_date);

-- Shift templates (recurring schedules)
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  day_of_week INTEGER, -- 0=Sunday, 6=Saturday
  start_time TIME,
  end_time TIME,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_business ON shift_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_agent ON shift_templates(agent_id);
