-- Migration 140: Knowledge base and canned responses
-- Enables self-service KB articles, search, and pre-written response templates

CREATE TABLE IF NOT EXISTS knowledge_base_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_categories_business ON knowledge_base_categories(business_id);

-- Knowledge base articles
CREATE TABLE IF NOT EXISTS knowledge_base_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES knowledge_base_categories(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  keywords TEXT[], -- Array of search keywords
  language VARCHAR(10) DEFAULT 'en',
  is_published BOOLEAN DEFAULT FALSE,
  is_featured BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0,
  estimated_read_time_minutes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP,
  UNIQUE(business_id, slug, language)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_business ON knowledge_base_articles(business_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_category ON knowledge_base_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_published ON knowledge_base_articles(is_published);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_featured ON knowledge_base_articles(is_featured);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_keywords ON knowledge_base_articles USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_articles_slug ON knowledge_base_articles(slug);

-- Canned responses (pre-written response templates)
CREATE TABLE IF NOT EXISTS canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category VARCHAR(100),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  shortcut VARCHAR(50), -- e.g., "refund_approved" → expands to full response
  language VARCHAR(10) DEFAULT 'en',
  usage_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, shortcut, language)
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_business ON canned_responses(business_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_category ON canned_responses(category);
CREATE INDEX IF NOT EXISTS idx_canned_responses_language ON canned_responses(language);
CREATE INDEX IF NOT EXISTS idx_canned_responses_active ON canned_responses(is_active);
CREATE INDEX IF NOT EXISTS idx_canned_responses_shortcut ON canned_responses(shortcut);

-- Article feedback/ratings
CREATE TABLE IF NOT EXISTS knowledge_base_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES knowledge_base_articles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  helpful BOOLEAN, -- true = helpful, false = not helpful, NULL = no rating
  comment TEXT,
  email VARCHAR(255), -- for anonymous feedback
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_feedback_article ON knowledge_base_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_feedback_user ON knowledge_base_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_feedback_helpful ON knowledge_base_feedback(helpful);

-- Search index materialization (for full-text search optimization)
CREATE TABLE IF NOT EXISTS knowledge_base_search_index (
  id BIGSERIAL PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES knowledge_base_articles(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  search_text TEXT, -- concatenated title + content + keywords for full-text search
  last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_search_index_business ON knowledge_base_search_index(business_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_search_index_text ON knowledge_base_search_index USING GIN(to_tsvector('english', search_text));
