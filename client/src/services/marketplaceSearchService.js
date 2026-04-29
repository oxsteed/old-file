/**
 * Marketplace Search Service
 *
 * Advanced product discovery with intelligent search, filtering, and ranking.
 * Handles:
 * - Full-text search with synonym matching
 * - Skill-based product discovery
 * - Category filtering with hierarchy
 * - Price range filtering
 * - Relevance ranking and sorting
 *
 * Usage:
 *   import { searchService } from './marketplaceSearchService';
 *   const results = await searchService.search('wrench', { skillIds: [1, 2], minPrice: 10 });
 */

import { marketplaceApi } from '../api/marketplaceApi';

export const marketplaceSearchService = {
  /**
   * Advanced product search with relevance ranking
   * Searches across: product names, descriptions, aliases, and skill associations
   *
   * @param {string} query - Search term (min 2 characters)
   * @param {object} options - Filter and sort options
   *   @param {string[]} options.skillIds - Skill IDs to filter by (e.g., [1, 2, 3])
   *   @param {number} options.minPrice - Minimum price in dollars
   *   @param {number} options.maxPrice - Maximum price in dollars
   *   @param {number} options.page - Page number (default: 1)
   *   @param {number} options.limit - Results per page (default: 20, max: 100)
   * @returns {Promise<{data, pagination}>} Ranked search results
   *
   * @example
   *   const results = await searchService.search('drill', {
   *     skillIds: [1],  // Electrician skill
   *     minPrice: 50,
   *     maxPrice: 500,
   *     limit: 9
   *   });
   */
  async search(query, options = {}) {
    if (!query || query.trim().length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }

    const params = {
      q: query.trim(),
      page: options.page || 1,
      limit: Math.min(options.limit || 20, 100),
    };

    if (options.skillIds && options.skillIds.length > 0) {
      params.skillIds = options.skillIds.join(',');
    }

    if (options.minPrice) {
      params.minPrice = parseFloat(options.minPrice);
    }

    if (options.maxPrice) {
      params.maxPrice = parseFloat(options.maxPrice);
    }

    try {
      const response = await marketplaceApi.get('/search', { params });
      return response.data;
    } catch (error) {
      console.error('Search failed:', error);
      throw error;
    }
  },

  /**
   * Browse products with advanced filtering
   * Returns products filtered by category, skill, price range, with sorting options
   *
   * @param {object} filters - Filter options
   *   @param {string} filters.category - Category name to filter by
   *   @param {string[]} filters.skillIds - Skill IDs to filter by
   *   @param {number} filters.minPrice - Minimum price in dollars
   *   @param {number} filters.maxPrice - Maximum price in dollars
   *   @param {string} filters.sortBy - Sort option: newest, price_asc, price_desc, rating, in_carts
   *   @param {number} filters.page - Page number (default: 1)
   *   @param {number} filters.limit - Results per page (default: 20, max: 100)
   * @returns {Promise<{data, pagination}>} Filtered product results
   *
   * @example
   *   const products = await searchService.browse({
   *     category: 'Power Tools',
   *     sortBy: 'rating',
   *     minPrice: 100,
   *     maxPrice: 1000,
   *     limit: 9
   *   });
   */
  async browse(filters = {}) {
    const params = {
      page: filters.page || 1,
      limit: Math.min(filters.limit || 20, 100),
      sortBy: filters.sortBy || 'newest',
    };

    if (filters.category) {
      params.category = filters.category;
    }

    if (filters.skillIds && filters.skillIds.length > 0) {
      params.skillIds = filters.skillIds.join(',');
    }

    if (filters.minPrice) {
      params.minPrice = parseFloat(filters.minPrice);
    }

    if (filters.maxPrice) {
      params.maxPrice = parseFloat(filters.maxPrice);
    }

    try {
      const response = await marketplaceApi.get('/browse', { params });
      return response.data;
    } catch (error) {
      console.error('Browse failed:', error);
      throw error;
    }
  },

  /**
   * Fetch all hierarchical product categories
   * Used for: category grids, filter dropdowns, breadcrumbs
   *
   * @returns {Promise<{data, totalCategories}>} Category tree with parent-child relationships
   *
   * @example
   *   const categories = await searchService.getCategories();
   *   // categories.data[0] = { id: 1, name: 'Tools', children: [...] }
   */
  async getCategories() {
    try {
      const response = await marketplaceApi.get('/categories/hierarchy');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      throw error;
    }
  },

  /**
   * Fetch all available skills with product counts
   * Used for: skill discovery grids, skill-based filters
   *
   * @returns {Promise<{data, pagination}>} Skills sorted by product count (desc)
   *
   * @example
   *   const skills = await searchService.getSkills();
   *   // skills.data[0] = { id: 1, name: 'Electrician', product_count: 145 }
   */
  async getSkills() {
    try {
      const response = await marketplaceApi.get('/skills/all');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      throw error;
    }
  },

  /**
   * Fetch all products associated with a skill
   * Skill-based product discovery (e.g., "Show all electrician products")
   *
   * @param {number} skillId - Skill ID (e.g., 1 for Electrician)
   * @param {object} options - Fetch options
   *   @param {number} options.limit - Max results (default: 50, max: 200)
   *   @param {string} options.sort - Sort by: relevance, rating, price (default: relevance)
   * @returns {Promise<{data, skillId, pagination}>} Products for the skill, sorted by relevance
   *
   * @example
   *   const electricalProducts = await searchService.getProductsBySkill(1, {
   *     limit: 50,
   *     sort: 'rating'
   *   });
   */
  async getProductsBySkill(skillId, options = {}) {
    if (!skillId || isNaN(parseInt(skillId))) {
      throw new Error('Valid skill ID is required');
    }

    const params = {
      limit: Math.min(options.limit || 50, 200),
      sort: options.sort || 'relevance',
    };

    try {
      const response = await marketplaceApi.get(`/by-skill/${skillId}`, { params });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch products by skill:', error);
      throw error;
    }
  },

  /**
   * Fetch single product with all details
   * Includes: basic info, images, ratings, reviews, related products, skills
   *
   * @param {string} productId - Product UUID
   * @returns {Promise<{data}>} Full product details
   *
   * @example
   *   const product = await searchService.getProductDetail('uuid-123');
   */
  async getProductDetail(productId) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    try {
      const response = await marketplaceApi.get(`/${productId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch product detail:', error);
      throw error;
    }
  },

  /**
   * Fetch products related to a specific product
   * Based on shared skills and categories
   *
   * @param {string} productId - Product UUID
   * @param {number} limit - Max results (default: 10, max: 50)
   * @returns {Promise<{data}>} Related products
   *
   * @example
   *   const related = await searchService.getRelatedProducts('uuid-123', 10);
   */
  async getRelatedProducts(productId, limit = 10) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    const params = {
      limit: Math.min(limit, 50),
    };

    try {
      const response = await marketplaceApi.get(`/${productId}/related`, { params });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch related products:', error);
      throw error;
    }
  },

  /**
   * Fetch frequently-bought-together products
   * Products commonly purchased alongside a product
   *
   * @param {string} productId - Product UUID
   * @param {number} limit - Max results (default: 10, max: 50)
   * @returns {Promise<{data}>} Frequently bought together products
   */
  async getFrequentlyBoughtTogether(productId, limit = 10) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    const params = {
      limit: Math.min(limit, 50),
    };

    try {
      const response = await marketplaceApi.get(`/${productId}/frequently-bought`, { params });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch frequently bought together:', error);
      throw error;
    }
  },

  /**
   * Fetch product reviews
   *
   * @param {string} productId - Product UUID
   * @param {object} options - Pagination options
   *   @param {number} options.page - Page number (default: 1)
   *   @param {number} options.limit - Results per page (default: 10, max: 50)
   * @returns {Promise<{data, pagination}>} Paginated reviews
   */
  async getProductReviews(productId, options = {}) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    const params = {
      page: options.page || 1,
      limit: Math.min(options.limit || 10, 50),
    };

    try {
      const response = await marketplaceApi.get(`/${productId}/reviews`, { params });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch reviews:', error);
      throw error;
    }
  },

  /**
   * Submit a product review
   * Requires authentication
   *
   * @param {string} productId - Product UUID
   * @param {object} review - Review data
   *   @param {number} review.rating - Rating 1-5
   *   @param {string} review.title - Review title
   *   @param {string} review.review_text - Review text
   * @returns {Promise<{data}>} Created review
   *
   * @example
   *   await searchService.submitReview('uuid-123', {
   *     rating: 5,
   *     title: 'Great product!',
   *     review_text: 'Works as advertised...'
   *   });
   */
  async submitReview(productId, review) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    if (!review.rating || review.rating < 1 || review.rating > 5) {
      throw new Error('Rating must be 1-5');
    }

    try {
      const response = await marketplaceApi.post(`/${productId}/reviews`, review);
      return response.data;
    } catch (error) {
      console.error('Failed to submit review:', error);
      throw error;
    }
  },

  /**
   * Get recommended products for authenticated user
   * Based on user's helper skills and preferences
   *
   * @returns {Promise<{data}>} Recommended products
   *
   * @example
   *   const recommended = await searchService.getRecommended();
   */
  async getRecommended() {
    try {
      const response = await marketplaceApi.get('/recommended');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch recommended products:', error);
      throw error;
    }
  },
};

/**
 * Usage in components:
 *
 * // Advanced search
 * const results = await marketplaceSearchService.search('power drill', {
 *   skillIds: [1, 2],
 *   minPrice: 50,
 *   maxPrice: 500,
 *   limit: 9
 * });
 *
 * // Skill-based discovery
 * const electricalTools = await marketplaceSearchService.getProductsBySkill(1);
 *
 * // Browse with category filter
 * const powerTools = await marketplaceSearchService.browse({
 *   category: 'Power Tools',
 *   sortBy: 'rating',
 *   limit: 12
 * });
 *
 * // Load categories and skills
 * const categories = await marketplaceSearchService.getCategories();
 * const skills = await marketplaceSearchService.getSkills();
 */

export default marketplaceSearchService;
