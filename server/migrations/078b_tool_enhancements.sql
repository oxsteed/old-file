-- Tool rentals enhancements
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS image_gallery TEXT[] DEFAULT '{}';
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2) DEFAULT 0;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS views_count INT DEFAULT 0;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS favorites_count INT DEFAULT 0;

-- Owner response time (hours)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_response_time_hours INT DEFAULT 24;

-- SEO metadata
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS seo_slug VARCHAR(255) UNIQUE;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS seo_keywords TEXT;

CREATE INDEX idx_tool_avg_rating ON tool_rentals(avg_rating DESC);
CREATE INDEX idx_tool_views ON tool_rentals(views_count DESC);
