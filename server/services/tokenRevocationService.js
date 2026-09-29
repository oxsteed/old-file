const redis = require('../utils/redis');
const logger = require('../utils/logger');

// Token revocation service for managing JWT blacklist
// When a user logs out or changes password, their tokens are revoked
// immediately, even if they haven't expired yet.
//
// Storage:
// - Redis (if available) for distributed deployments
// - In-memory Set for single-instance deployments
//
// TTL: matches JWT expiry times (15m for access, 7d for refresh)

const tokenBlacklist = new Set(); // Fallback for non-Redis environments

class TokenRevocationService {
  /**
   * Revoke an access token (15-minute TTL)
   */
  async revokeAccessToken(tokenId) {
    const ttl = 15 * 60; // 15 minutes
    return this.revoke(tokenId, ttl, 'access');
  }

  /**
   * Revoke a refresh token (7-day TTL)
   */
  async revokeRefreshToken(tokenId) {
    const ttl = 7 * 24 * 60 * 60; // 7 days
    return this.revoke(tokenId, ttl, 'refresh');
  }

  /**
   * Revoke an impersonation session by JWT jti.
   *
   * Impersonation tokens deliberately skip the standard token blacklist in
   * the auth middleware (they are short-lived and tracked separately), so
   * ending a session must record the jti here; the middleware checks it
   * explicitly for impersonation tokens. TTL matches the 30-minute
   * impersonation JWT lifetime.
   */
  async revokeImpersonationSession(jti) {
    if (!jti) return;
    return this.revoke(`impersonation-jti:${jti}`, 30 * 60, 'impersonation');
  }

  /**
   * Check whether an impersonation session (JWT jti) was revoked via
   * endImpersonation. Only the per-jti entry is consulted; user-level
   * revocation markers do not apply to impersonation tokens.
   */
  async isImpersonationSessionRevoked(jti) {
    if (!jti) return false;
    const tokenId = `impersonation-jti:${jti}`;
    try {
      if (redis) {
        return !!(await redis.get(`revoked:${tokenId}`));
      }
      return tokenBlacklist.has(tokenId);
    } catch (err) {
      logger.error('Failed to check impersonation revocation', { error: err.message });
      return false;
    }
  }

  /**
   * Revoke all tokens for a user (e.g., on password change)
   */
  async revokeAllUserTokens(userId) {
    try {
      if (redis) {
        // Use a user-level revocation key
        const key = `revoked:user:${userId}`;
        const timestamp = Date.now();
        await redis.set(key, timestamp, 'EX', 7 * 24 * 60 * 60); // 7 days
        logger.info('Revoked all user tokens', { userId });
      } else {
        // In-memory fallback: store user ID as marker
        tokenBlacklist.add(`user:${userId}:${Date.now()}`);
        logger.info('Revoked all user tokens (in-memory)', { userId });
      }
    } catch (err) {
      logger.error('Failed to revoke user tokens', { userId, error: err.message });
      // Non-fatal: if revocation fails, token validation will still work
      // via database session checks
    }
  }

  /**
   * Check if a token is revoked.
   *
   * @param {string} tokenId   SHA-256 of the raw token.
   * @param {number|string} userId
   * @param {number} [tokenIat] JWT `iat` claim (seconds). If provided, the
   *   user-level revocation marker only applies to tokens issued BEFORE the
   *   revocation timestamp. Without this, a single logout would lock the user
   *   out for the full user-revocation TTL (7 days) even after a fresh login.
   */
  async isRevoked(tokenId, userId, tokenIat) {
    try {
      if (redis) {
        const [revokedToken, revokedUser] = await Promise.all([
          redis.get(`revoked:${tokenId}`),
          redis.get(`revoked:user:${userId}`),
        ]);
        if (revokedToken) return true;
        if (revokedUser) {
          const revokedAtMs = Number(revokedUser);
          if (!Number.isFinite(revokedAtMs)) return true;
          if (typeof tokenIat !== 'number') return true;
          // iat is seconds; revokedAt is ms. Reject only tokens issued at or
          // before the revocation moment.
          return tokenIat * 1000 <= revokedAtMs;
        }
        return false;
      } else {
        return tokenBlacklist.has(tokenId);
      }
    } catch (err) {
      logger.error('Failed to check token revocation', { tokenId, error: err.message });
      return false;
    }
  }

  /**
   * Internal revoke function
   */
  async revoke(tokenId, ttlSeconds, tokenType) {
    try {
      if (redis) {
        const key = `revoked:${tokenId}`;
        await redis.set(key, tokenType, 'EX', ttlSeconds);
        logger.debug('Token revoked', { tokenId, tokenType, ttl: ttlSeconds });
      } else {
        // In-memory fallback
        tokenBlacklist.add(tokenId);
        // Optionally clean up old entries (simple implementation)
        if (tokenBlacklist.size > 10000) {
          const entriesToRemove = Array.from(tokenBlacklist).slice(0, 1000);
          entriesToRemove.forEach(entry => tokenBlacklist.delete(entry));
        }
        logger.debug('Token revoked (in-memory)', { tokenId, tokenType });
      }
    } catch (err) {
      logger.error('Failed to revoke token', { tokenId, error: err.message });
      // Non-fatal error
    }
  }
}

module.exports = new TokenRevocationService();
