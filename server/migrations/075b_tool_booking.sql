-- Tool rental bookings
CREATE TABLE tool_rentals_bookings (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  total_price DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT end_after_start CHECK (end_date > start_date)
);

CREATE INDEX idx_bookings_tool_id ON tool_rentals_bookings(tool_id);
CREATE INDEX idx_bookings_customer_id ON tool_rentals_bookings(customer_id);
CREATE INDEX idx_bookings_status ON tool_rentals_bookings(status);
