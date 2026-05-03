const pool = require('../db');
const logger = require('../utils/logger');

// Signals used to detect potential duplicate accounts, scored by weight.
// Any user pair accumulating >= SUSPECT_THRESHOLD is flagged for review.
const SUSPECT_THRESHOLD = 2;

const SIGNAL_WEIGHTS = {
  same_ip:            3, // same last_login_ip (strongest signal)
  same_ip_hash:       2, // same last_known_ip_hash
  same_phone:         3, // same phone number
  same_name:          1, // same first+last name combination
  same_device_terms:  2, // same terms_acceptance_ua (device fingerprint at registration)
  same_didit_hash:    4, // same Didit identity hash (very strong – same real person)
  same_referral:      1, // one referred the other (may be household)
  close_created:      1, // accounts created within 24h of each other
};

// ─── helpers ────────────────────────────────────────────────────────────────

function tableExistsQuery(name) {
  return `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
  ) AS exists`;
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name=$1 AND column_name=$2
    ) AS exists`,
    [table, column]
  );
  return rows[0]?.exists ?? false;
}

// Build a safe SELECT list for users based on what columns actually exist
async function buildUserSelect(client) {
  const always = [
    'id', 'email', 'first_name', 'last_name', 'role',
    'is_active', 'is_banned', 'is_suspended',
    'created_at', 'last_login_at',
  ];
  const optional = [
    'phone', 'phone_number', 'city', 'state', 'country',
    'last_login_ip', 'last_known_ip_hash', 'terms_acceptance_ua',
    'didit_identity_hash', 'referral_code', 'referred_by',
    'profile_photo_url', 'identity_verified',
  ];
  const cols = [...always];
  for (const col of optional) {
    if (await columnExists(client, 'users', col)) cols.push(col);
  }
  return cols.map(c => `u.${c}`).join(', ');
}

// ─── GET /api/admin/one-truth/users ─────────────────────────────────────────
// Returns paginated user list with their businesses.
// Each user row includes business_count and a businesses array.

exports.listUsers = async (req, res) => {
  const client = await pool.connect();
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const filter = req.query.filter || 'all'; // all | flagged | clean

    const userSelect = await buildUserSelect(client);

    // Base WHERE – exclude hard-deleted, exclude admins
    const conditions = [`u.deleted_at IS NULL`, `u.role NOT IN ('admin','super_admin')`];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      conditions.push(`(
        u.email ILIKE $${n}
        OR u.first_name ILIKE $${n}
        OR u.last_name ILIKE $${n}
        OR (u.first_name || ' ' || u.last_name) ILIKE $${n}
      )`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Count total
    const countResult = await client.query(
      `SELECT COUNT(*) FROM users u ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    // Fetch users with business count
    const usersResult = await client.query(
      `SELECT ${userSelect},
        (SELECT COUNT(*) FROM businesses b
         WHERE b.user_id = u.id AND b.deleted_at IS NULL) AS business_count
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    if (usersResult.rows.length === 0) {
      return res.json({ users: [], total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    const userIds = usersResult.rows.map(u => u.id);

    // Fetch businesses for these users
    const bizResult = await client.query(
      `SELECT b.id, b.user_id, b.business_name, b.is_active, b.is_primary,
              b.address_city, b.address_state, b.industry_category,
              b.created_at, b.deleted_at
       FROM businesses b
       WHERE b.user_id = ANY($1)
       ORDER BY b.created_at ASC`,
      [userIds]
    );

    const bizByUser = {};
    for (const biz of bizResult.rows) {
      if (!bizByUser[biz.user_id]) bizByUser[biz.user_id] = [];
      bizByUser[biz.user_id].push(biz);
    }

    const users = usersResult.rows.map(u => ({
      ...u,
      businesses: bizByUser[u.id] || [],
    }));

    res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('oneTruth.listUsers error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load users' });
  } finally {
    client.release();
  }
};

// ─── GET /api/admin/one-truth/suspects ──────────────────────────────────────
// Runs duplicate-account detection and returns flagged user pairs.

exports.listSuspects = async (req, res) => {
  const client = await pool.connect();
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const userSelect = await buildUserSelect(client);

    // Pull all non-admin, non-deleted users with the fields we need for comparison
    const { rows: allUsers } = await client.query(
      `SELECT ${userSelect},
        (SELECT COUNT(*) FROM businesses b WHERE b.user_id=u.id AND b.deleted_at IS NULL) AS business_count
       FROM users u
       WHERE u.deleted_at IS NULL AND u.role NOT IN ('admin','super_admin')
       ORDER BY u.created_at ASC`
    );

    // Build a map for quick lookup
    const userMap = {};
    for (const u of allUsers) userMap[u.id] = u;

    // Compare pairs and accumulate signals
    const suspectPairs = [];
    const seen = new Set();

    for (let i = 0; i < allUsers.length; i++) {
      for (let j = i + 1; j < allUsers.length; j++) {
        const a = allUsers[i];
        const b = allUsers[j];
        const pairKey = `${a.id}:${b.id}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const signals = [];
        let score = 0;

        // Same verified phone
        const phoneA = a.phone || a.phone_number;
        const phoneB = b.phone || b.phone_number;
        if (phoneA && phoneB && phoneA === phoneB) {
          signals.push({ type: 'same_phone', label: 'Same phone number', weight: SIGNAL_WEIGHTS.same_phone });
          score += SIGNAL_WEIGHTS.same_phone;
        }

        // Same login IP
        if (a.last_login_ip && b.last_login_ip && a.last_login_ip === b.last_login_ip) {
          signals.push({ type: 'same_ip', label: 'Same last login IP', weight: SIGNAL_WEIGHTS.same_ip });
          score += SIGNAL_WEIGHTS.same_ip;
        }

        // Same hashed IP from registration/consent
        if (a.last_known_ip_hash && b.last_known_ip_hash && a.last_known_ip_hash === b.last_known_ip_hash) {
          signals.push({ type: 'same_ip_hash', label: 'Same IP hash (registration)', weight: SIGNAL_WEIGHTS.same_ip_hash });
          score += SIGNAL_WEIGHTS.same_ip_hash;
        }

        // Same full name
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase().trim();
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase().trim();
        if (nameA && nameB && nameA === nameB && nameA !== ' ') {
          signals.push({ type: 'same_name', label: 'Same full name', weight: SIGNAL_WEIGHTS.same_name });
          score += SIGNAL_WEIGHTS.same_name;
        }

        // Same device fingerprint at terms acceptance
        if (a.terms_acceptance_ua && b.terms_acceptance_ua && a.terms_acceptance_ua === b.terms_acceptance_ua) {
          signals.push({ type: 'same_device_terms', label: 'Same device at registration', weight: SIGNAL_WEIGHTS.same_device_terms });
          score += SIGNAL_WEIGHTS.same_device_terms;
        }

        // Same Didit identity hash (biometric/ID match)
        if (a.didit_identity_hash && b.didit_identity_hash && a.didit_identity_hash === b.didit_identity_hash) {
          signals.push({ type: 'same_didit_hash', label: 'Same verified identity (Didit)', weight: SIGNAL_WEIGHTS.same_didit_hash });
          score += SIGNAL_WEIGHTS.same_didit_hash;
        }

        // One referred the other
        if (
          (a.referral_code && b.referred_by && a.referral_code === b.referred_by) ||
          (b.referral_code && a.referred_by && b.referral_code === a.referred_by)
        ) {
          signals.push({ type: 'same_referral', label: 'One account referred the other', weight: SIGNAL_WEIGHTS.same_referral });
          score += SIGNAL_WEIGHTS.same_referral;
        }

        // Created within 24 hours of each other
        const msApart = Math.abs(new Date(a.created_at) - new Date(b.created_at));
        if (msApart < 24 * 60 * 60 * 1000) {
          signals.push({ type: 'close_created', label: 'Accounts created within 24h', weight: SIGNAL_WEIGHTS.close_created });
          score += SIGNAL_WEIGHTS.close_created;
        }

        if (score >= SUSPECT_THRESHOLD && signals.length >= 2) {
          suspectPairs.push({
            id: pairKey,
            score,
            signals,
            userA: { ...a, businesses: [] },
            userB: { ...b, businesses: [] },
          });
        }
      }
    }

    // Sort by descending score
    suspectPairs.sort((a, b) => b.score - a.score);

    // Attach businesses to users in flagged pairs
    if (suspectPairs.length > 0) {
      const allIds = [...new Set(suspectPairs.flatMap(p => [p.userA.id, p.userB.id]))];
      const { rows: bizRows } = await client.query(
        `SELECT b.id, b.user_id, b.business_name, b.is_active, b.is_primary,
                b.address_city, b.address_state, b.industry_category, b.created_at
         FROM businesses b WHERE b.user_id = ANY($1) AND b.deleted_at IS NULL`,
        [allIds]
      );
      const bizMap = {};
      for (const biz of bizRows) {
        if (!bizMap[biz.user_id]) bizMap[biz.user_id] = [];
        bizMap[biz.user_id].push(biz);
      }
      for (const pair of suspectPairs) {
        pair.userA.businesses = bizMap[pair.userA.id] || [];
        pair.userB.businesses = bizMap[pair.userB.id] || [];
      }
    }

    const total = suspectPairs.length;
    const paged = suspectPairs.slice(offset, offset + limit);

    res.json({ pairs: paged, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('oneTruth.listSuspects error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to run duplicate detection' });
  } finally {
    client.release();
  }
};

// ─── GET /api/admin/one-truth/stats ─────────────────────────────────────────

exports.getStats = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: userRows } = await client.query(
      `SELECT COUNT(*) AS total_users,
        SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive_users,
        SUM(CASE WHEN is_banned = true THEN 1 ELSE 0 END) AS banned_users
       FROM users WHERE deleted_at IS NULL AND role NOT IN ('admin','super_admin')`
    );

    const { rows: bizRows } = await client.query(
      `SELECT COUNT(*) AS total_businesses,
        SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive_businesses
       FROM businesses WHERE deleted_at IS NULL`
    );

    // Users with more than one account — identified by same email domain is too noisy,
    // so we just count how many suspect pairs we'd find at score >= SUSPECT_THRESHOLD
    const { rows: multiRows } = await client.query(
      `SELECT COUNT(DISTINCT u.id) AS users_with_multi_biz
       FROM users u
       WHERE u.deleted_at IS NULL
         AND u.role NOT IN ('admin','super_admin')
         AND (SELECT COUNT(*) FROM businesses b WHERE b.user_id = u.id AND b.deleted_at IS NULL) > 1`
    );

    res.json({
      totalUsers: parseInt(userRows[0].total_users),
      inactiveUsers: parseInt(userRows[0].inactive_users || 0),
      bannedUsers: parseInt(userRows[0].banned_users || 0),
      totalBusinesses: parseInt(bizRows[0].total_businesses),
      inactiveBusinesses: parseInt(bizRows[0].inactive_businesses || 0),
      usersWithMultipleBusinesses: parseInt(multiRows[0].users_with_multi_biz),
    });
  } catch (err) {
    logger.error('oneTruth.getStats error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load stats' });
  } finally {
    client.release();
  }
};

// ─── GET /api/admin/one-truth/user/:userId ───────────────────────────────────
// Full detail view for a single user: their account + all businesses + any pairs they appear in.

exports.getUserDetail = async (req, res) => {
  const { userId } = req.params;
  const client = await pool.connect();
  try {
    const userSelect = await buildUserSelect(client);

    const { rows: userRows } = await client.query(
      `SELECT ${userSelect} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });

    const user = userRows[0];

    const { rows: businesses } = await client.query(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM jobs j WHERE j.business_id = b.id) AS job_count
       FROM businesses b WHERE b.user_id = $1
       ORDER BY b.created_at ASC`,
      [userId]
    );

    // Recent login history if table exists
    let loginHistory = [];
    const { rows: hasHistory } = await client.query(tableExistsQuery('user_login_history'), ['user_login_history']);
    if (hasHistory[0]?.exists) {
      const { rows } = await client.query(
        `SELECT * FROM user_login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );
      loginHistory = rows;
    }

    res.json({ user, businesses, loginHistory });
  } catch (err) {
    logger.error('oneTruth.getUserDetail error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load user detail' });
  } finally {
    client.release();
  }
};
