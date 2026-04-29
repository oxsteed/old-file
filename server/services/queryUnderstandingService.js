/**
 * Query Understanding Service
 *
 * Amazon-level search intelligence:
 * - Query intent detection (product search vs. question vs. category browse)
 * - Spell correction and fuzzy matching
 * - Query expansion (synonyms, related terms)
 * - Entity recognition (brand, category, attribute)
 * - Semantic understanding (what user really wants)
 * - Facet detection (extract filters from query)
 * - Price range extraction
 * - Typo correction with candidate ranking
 */

const pool = require('../db');
const logger = require('../utils/logger');

class QueryUnderstandingService {
  /**
   * Main entry point: understand and enrich search query
   * Returns: enriched query with intent, entities, expansions
   */
  async understandQuery(query, context = {}) {
    try {
      const normalizedQuery = this.normalizeQuery(query);

      const [
        intent,
        entities,
        facets,
        expansions,
        corrections,
      ] = await Promise.all([
        this.detectIntent(normalizedQuery),
        this.recognizeEntities(normalizedQuery),
        this.extractFacets(normalizedQuery),
        this.expandQuery(normalizedQuery),
        this.correctSpelling(normalizedQuery),
      ]);

      return {
        original: query,
        normalized: normalizedQuery,
        intent,
        entities,
        facets,
        expansions,
        corrections,
        timestamp: new Date(),
      };
    } catch (err) {
      logger.error('Error understanding query', { query, error: err.message });
      return {
        original: query,
        normalized: this.normalizeQuery(query),
        intent: 'product_search',
        entities: [],
        facets: {},
        expansions: [],
        corrections: [],
      };
    }
  }

  /**
   * Normalize query: lowercase, trim, remove extra spaces
   */
  normalizeQuery(query) {
    return (query || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s-]/g, '');
  }

  /**
   * Detect search intent: product_search, category_browse, question, price_lookup
   */
  async detectIntent(query) {
    const intents = {
      category_browse: /^(show|list|browse|find)\s+(all|best|top)\s+(\w+)/,
      price_comparison: /(\$\d+|cheap|expensive|under|over|budget|expensive)/,
      specification_search: /(\bwith\b|\bhave\b|\bhas\b|\binclude\b|\bfeature)/,
      bulk_purchase: /\b(bulk|wholesale|case|pack|dozen|box)\b/,
      brand_search: /^(dewalt|makita|bosch|stanley|craftsman|milwaukee)/i,
      question: /\?$/,
    };

    const scores = {};
    for (const [intent, regex] of Object.entries(intents)) {
      scores[intent] = regex.test(query) ? 1 : 0;
    }

    // Default to product_search
    const topIntent = Object.entries(scores)
      .filter(([_, score]) => score > 0)
      .sort(([_, a], [__, b]) => b - a)[0];

    return {
      primary: topIntent ? topIntent[0] : 'product_search',
      confidence: topIntent ? 0.8 : 0.5,
      all: scores,
    };
  }

  /**
   * Entity recognition: extract brands, categories, attributes from query
   */
  async recognizeEntities(query) {
    const entities = [];

    // Brand recognition
    const brands = ['dewalt', 'makita', 'bosch', 'stanley', 'craftsman', 'milwaukee', 'stanley', 'hart', 'ego', 'ryobi'];
    for (const brand of brands) {
      if (query.includes(brand)) {
        entities.push({
          type: 'brand',
          value: brand,
          confidence: 0.95,
        });
      }
    }

    // Tool type recognition
    const toolPatterns = {
      drill: /drill|driver/,
      saw: /saw|circular|miter|band/,
      sander: /sand|sander/,
      wrench: /wrench|spanner|socket/,
      level: /level|laser/,
      tape: /tape\s+measure|measuring|ruler/,
      hammer: /hammer|mallet/,
    };

    for (const [tool, regex] of Object.entries(toolPatterns)) {
      if (regex.test(query)) {
        entities.push({
          type: 'tool_type',
          value: tool,
          confidence: 0.9,
        });
      }
    }

    // Material/attribute recognition
    const attributePatterns = {
      cordless: /cordless|battery|wireless/,
      corded: /corded|electric|plug/,
      impact: /impact|percussion/,
      precision: /precision|accurate|precise/,
      heavy_duty: /heavy\s+duty|professional|industrial/,
    };

    for (const [attr, regex] of Object.entries(attributePatterns)) {
      if (regex.test(query)) {
        entities.push({
          type: 'attribute',
          value: attr,
          confidence: 0.85,
        });
      }
    }

    return entities;
  }

  /**
   * Extract facets (filters) from query
   * Examples: "drill under 100", "cordless power drill", "best rated wrench"
   */
  async extractFacets(query) {
    const facets = {};

    // Price extraction
    const priceMatch = query.match(/\$?(\d+)(?:\s*-\s*\$?(\d+))?/);
    if (priceMatch) {
      const minPrice = parseInt(priceMatch[1]);
      const maxPrice = priceMatch[2] ? parseInt(priceMatch[2]) : minPrice * 2;
      facets.priceRange = { min: minPrice, max: maxPrice };
    }

    // Rating extraction
    if (/best\s+rated|top\s+rated|highly\s+rated|4\.5\s+star|5\s+star/.test(query)) {
      facets.minRating = 4.5;
    }

    // Sort preference
    if (/best|top|most|popular/.test(query)) {
      facets.sortBy = 'rating';
    } else if (/cheapest|lowest|under/.test(query)) {
      facets.sortBy = 'price_asc';
    } else if (/newest|latest|recent/.test(query)) {
      facets.sortBy = 'newest';
    }

    // Availability
    if (/in\s+stock|available|ready|ship/.test(query)) {
      facets.inStock = true;
    }

    // Skill category
    const skillPatterns = {
      electrician: /electrical|electrician|wire|circuit/,
      plumber: /plumb|drain|pipe|faucet|water/,
      carpenter: /wood|frame|lumber|cabinet|door/,
    };

    for (const [skill, regex] of Object.entries(skillPatterns)) {
      if (regex.test(query)) {
        facets.skill = skill;
      }
    }

    return facets;
  }

  /**
   * Query expansion: generate related search terms
   * Returns alternative queries that might give better results
   */
  async expandQuery(query) {
    const expansions = [];

    // Fetch synonyms from database
    try {
      const result = await pool.query(`
        SELECT DISTINCT alias_name
        FROM product_aliases
        WHERE alias_name ILIKE $1 || '%' OR $1 ILIKE '%' || alias_name
        LIMIT 10
      `, [query.split(' ')[0]]);

      for (const row of result.rows) {
        expansions.push({
          query: query.replace(query.split(' ')[0], row.alias_name),
          type: 'synonym',
          confidence: 0.8,
        });
      }
    } catch (err) {
      logger.debug('Error fetching alias expansions', { error: err.message });
    }

    // Semantic expansions based on patterns
    const semanticExpansions = {
      drill: ['power drill', 'cordless drill', 'drill driver', 'impact drill'],
      wrench: ['socket wrench', 'adjustable wrench', 'open end wrench', 'torque wrench'],
      saw: ['circular saw', 'miter saw', 'hand saw', 'band saw'],
      hammer: ['claw hammer', 'sledge hammer', 'ball pein hammer', 'rubber mallet'],
    };

    const firstWord = query.split(' ')[0];
    if (semanticExpansions[firstWord]) {
      for (const expansion of semanticExpansions[firstWord]) {
        expansions.push({
          query: expansion,
          type: 'semantic',
          confidence: 0.75,
        });
      }
    }

    // Remove duplicates
    return expansions.filter((e, i, arr) => arr.findIndex(x => x.query === e.query) === i);
  }

  /**
   * Spelling correction using Levenshtein distance
   * Generates correction candidates ranked by likelihood
   */
  async correctSpelling(query) {
    const corrections = [];
    const queryTerms = query.split(' ');

    // Fetch all product names and aliases for fuzzy matching
    try {
      const products = await pool.query(`
        SELECT DISTINCT name FROM marketplace_products WHERE is_active = TRUE LIMIT 1000
      `);

      for (const term of queryTerms) {
        if (term.length < 3) continue;

        // Find similar terms using Levenshtein distance
        const candidates = products.rows
          .map(p => ({
            term: p.name.split(' ')[0],
            distance: this.levenshteinDistance(term, p.name.split(' ')[0]),
          }))
          .filter(c => c.distance <= 2 && c.distance > 0)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3);

        for (const candidate of candidates) {
          corrections.push({
            original: term,
            corrected: candidate.term,
            distance: candidate.distance,
            confidence: 1 - (candidate.distance / term.length),
          });
        }
      }
    } catch (err) {
      logger.debug('Error correcting spelling', { error: err.message });
    }

    return corrections;
  }

  /**
   * Levenshtein distance for spell checking
   * Measures similarity between two strings
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Generate search suggestions/autocomplete
   * Returns top suggestions based on popularity and relevance
   */
  async getSuggestions(prefix, limit = 10) {
    try {
      const result = await pool.query(`
        SELECT DISTINCT
          mp.name,
          mp.in_carts_count,
          mp.avg_rating,
          COUNT(*) as frequency
        FROM marketplace_products mp
        WHERE LOWER(mp.name) LIKE $1 AND mp.is_active = TRUE
        GROUP BY mp.name, mp.in_carts_count, mp.avg_rating
        ORDER BY
          frequency DESC,
          mp.in_carts_count DESC,
          mp.avg_rating DESC
        LIMIT $2
      `, [`${prefix.toLowerCase()}%`, limit]);

      return result.rows.map(row => ({
        suggestion: row.name,
        popularity: row.frequency,
        rating: row.avg_rating,
      }));
    } catch (err) {
      logger.error('Error getting suggestions', { prefix, error: err.message });
      return [];
    }
  }

  /**
   * Personalized suggestions based on user's search history
   */
  async getPersonalizedSuggestions(userId, prefix, limit = 10) {
    try {
      const result = await pool.query(`
        SELECT DISTINCT
          mp.name,
          COUNT(sh.id) as search_count,
          MAX(sh.created_at) as last_searched
        FROM marketplace_products mp
        LEFT JOIN search_history sh ON LOWER(sh.query) LIKE LOWER(mp.name || '%')
        WHERE sh.user_id = $1
          AND LOWER(mp.name) LIKE $2
          AND mp.is_active = TRUE
        GROUP BY mp.name
        ORDER BY
          search_count DESC,
          last_searched DESC
        LIMIT $3
      `, [userId, `${prefix.toLowerCase()}%`, limit]);

      return result.rows.map(row => ({
        suggestion: row.name,
        frequency: row.search_count,
        lastSearched: row.last_searched,
      }));
    } catch (err) {
      logger.error('Error getting personalized suggestions', { userId, error: err.message });
      return [];
    }
  }

  /**
   * Log search for analytics and learning
   */
  async logSearch(query, userId = null, resultCount = 0, selectedProductId = null) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS search_history (
          id SERIAL PRIMARY KEY,
          user_id UUID,
          query VARCHAR(255) NOT NULL,
          result_count INTEGER,
          selected_product_id UUID,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_search_history_user
          ON search_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_search_history_query
          ON search_history(query);
      `);

      await pool.query(
        `INSERT INTO search_history (user_id, query, result_count, selected_product_id)
         VALUES ($1, $2, $3, $4)`,
        [userId, query, resultCount, selectedProductId]
      );
    } catch (err) {
      logger.debug('Error logging search', { query, error: err.message });
    }
  }
}

module.exports = new QueryUnderstandingService();
