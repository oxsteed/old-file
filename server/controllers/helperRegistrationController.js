const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { sendOTPEmail } = require('../utils/email');
const { generateTokens } = require('../middleware/auth');

const SALT_ROUNDS = 12;
const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone = '') {
  return String(phone).trim();
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function otpExpiryDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + OTP_EXPIRY_MINUTES);
  return d;
}

function registrationSessionId() {
  return crypto.randomUUID();
}

function buildRegistrationPayload(row) {
  if (!row) return null;

  return {
    sessionId: row.session_id,
    userId: row.user_id || null,
    email: row.email,
    phone: row.phone,
    emailVerified: !!row.email_verified,
    otpVerified: !!row.otp_verified,
    accountCreated: !!row.account_created,
    contactUpdated: !!row.contact_updated,
    profileCompleted: !!row.profile_completed,
    tierSelected: !!row.tier_selected,
    w9Completed: !!row.w9_completed,
    termsAccepted: !!row.terms_accepted,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function onboardingStatusFromFlags(userLike) {
  const isComplete =
    !!userLike.profile_completed &&
    !!userLike.tier_selected &&
    !!userLike.w9_completed &&
    !!userLike.terms_accepted;

  if (isComplete) return 'onboarding_complete';

  const hasStarted =
    !!userLike.contact_completed ||
    !!userLike.profile_completed ||
    !!userLike.tier_selected ||
    !!userLike.w9_completed ||
    !!userLike.terms_accepted;

  return hasStarted ? 'onboarding_in_progress' : 'verified_pending_onboarding';
}

function onboardingCompletedFromFlags(userLike) {
  return (
    !!userLike.profile_completed &&
    !!userLike.tier_selected &&
    !!userLike.w9_completed &&
    !!userLike.terms_accepted
  );
}

async function getPendingRegistration(client, sessionId) {
  const { rows } = await client.query(
    `SELECT * FROM pending_registrations WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function ensurePendingRegistration(client, sessionId) {
  const pending = await getPendingRegistration(client, sessionId);
  if (!pending) {
    const err = new Error('Registration session not found');
    err.statusCode = 404;
    throw err;
  }
  return pending;
}

async function getUserById(client, userId) {
  const { rows } = await client.query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function emailExists(client, email, excludeUserId = null) {
  if (excludeUserId) {
    const { rows } = await client.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,
      [email, excludeUserId]
    );
    return !!rows[0];
  }

  const { rows } = await client.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return !!rows[0];
}

async function phoneExists(client, phone, excludeUserId = null) {
  if (!phone) return false;

  if (excludeUserId) {
    const { rows } = await client.query(
      `SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
      [phone, excludeUserId]
    );
    return !!rows[0];
  }

  const { rows } = await client.query(
    `SELECT id FROM users WHERE phone = $1 LIMIT 1`,
    [phone]
  );
  return !!rows[0];
}

async function pendingEmailExists(client, email, excludeSessionId = null) {
  if (excludeSessionId) {
    const { rows } = await client.query(
      `SELECT session_id
       FROM pending_registrations
       WHERE LOWER(email) = LOWER($1)
         AND session_id <> $2
       LIMIT 1`,
      [email, excludeSessionId]
    );
    return !!rows[0];
  }

  const { rows } = await client.query(
    `SELECT session_id
     FROM pending_registrations
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );
  return !!rows[0];
}

async function pendingPhoneExists(client, phone, excludeSessionId = null) {
  if (!phone) return false;

  if (excludeSessionId) {
    const { rows } = await client.query(
      `SELECT session_id
       FROM pending_registrations
       WHERE phone = $1
         AND session_id <> $2
       LIMIT 1`,
      [phone, excludeSessionId]
    );
    return !!rows[0];
  }

  const { rows } = await client.query(
    `SELECT session_id
     FROM pending_registrations
     WHERE phone = $1
     LIMIT 1`,
    [phone]
  );
  return !!rows[0];
}

async function syncPendingFlagsFromUser(client, sessionId, userId) {
  const user = await getUserById(client, userId);
  if (!user) return null;

  const { rows } = await client.query(
    `UPDATE pending_registrations
     SET user_id = $2,
         account_created = true,
         contact_updated = $3,
         profile_completed = $4,
         tier_selected = $5,
         w9_completed = $6,
         terms_accepted = $7,
         updated_at = NOW()
     WHERE session_id = $1
     RETURNING *`,
    [
      sessionId,
      userId,
      !!user.contact_completed,
      !!user.profile_completed,
      !!user.tier_selected,
      !!user.w9_completed,
      !!user.terms_accepted
    ]
  );

  return rows[0] || null;
}

async function updateUserOnboardingState(client, userId) {
  const user = await getUserById(client, userId);
  if (!user) return null;

  const onboardingCompleted = onboardingCompletedFromFlags(user);
  const onboardingStatus = onboardingStatusFromFlags(user);

  const { rows } = await client.query(
    `UPDATE users
     SET onboarding_completed = $2,
         onboarding_status = $3
     WHERE id = $1
     RETURNING *`,
    [userId, onboardingCompleted, onboardingStatus]
  );

  return rows[0] || null;
}

async function createUserFromPendingRegistration(client, pending) {
  if (pending.user_id) {
    return getUserById(client, pending.user_id);
  }

  const { rows } = await client.query(
    `INSERT INTO users (
      first_name,
      last_name,
      email,
      phone,
      password,
      role,
      city,
      state,
      zip_code,
      bio,
      skills,
      experience_years,
      categories,
      service_area,
      helper_tier,
      w9_name,
      w9_tax_classification,
      w9_tin,
      email_verified,
      is_verified,
      onboarding_status,
      onboarding_completed,
      contact_completed,
      profile_completed,
      tier_selected,
      w9_completed,
      terms_accepted
    ) VALUES (
      $1,$2,$3,$4,$5,
      'helper',
      $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
      true,
      false,
      'verified_pending_onboarding',
      false,
      false,
      false,
      false,
      false,
      false
    )
    RETURNING *`,
    [
      pending.first_name,
      pending.last_name,
      pending.email,
      pending.phone,
      pending.password_hash,
      pending.city,
      pending.state,
      pending.zip_code,
      pending.bio,
      pending.skills,
      pending.experience_years,
      pending.categories,
      pending.service_area,
      pending.selected_tier,
      pending.w9_name,
      pending.w9_tax_classification,
      pending.w9_tin
    ]
  );

  return rows[0];
}

exports.startHelperRegistration = async (req, res) => {
  const client = await pool.connect();

  try {
    const { firstName, lastName, email, phone, password, city, state, zipCode } = req.body;

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!firstName || !lastName || !normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and password are required'
      });
    }

    if (await emailExists(client, normalizedEmail)) {
      return res.status(409).json({
        success: false,
        message: 'An account with that email already exists'
      });
    }

    if (await pendingEmailExists(client, normalizedEmail)) {
      return res.status(409).json({
        success: false,
        message: 'A pending registration with that email already exists'
      });
    }

    if (normalizedPhone) {
      if (await phoneExists(client, normalizedPhone)) {
        return res.status(409).json({
          success: false,
          message: 'An account with that phone number already exists'
        });
      }

      if (await pendingPhoneExists(client, normalizedPhone)) {
        return res.status(409).json({
          success: false,
          message: 'A pending registration with that phone number already exists'
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const sessionId = registrationSessionId();

    const { rows } = await client.query(
      `INSERT INTO pending_registrations (
        session_id,
        first_name,
        last_name,
        email,
        phone,
        password_hash,
        city,
        state,
        zip_code,
        user_id,
        account_created,
        contact_updated,
        profile_completed,
        tier_selected,
        w9_completed,
        terms_accepted,
        email_verified,
        otp_verified,
        otp_attempts
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        NULL,false,false,false,false,false,false,false,false,0
      )
      RETURNING *`,
      [
        sessionId,
        firstName,
        lastName,
        normalizedEmail,
        normalizedPhone || null,
        passwordHash,
        city || null,
        state || null,
        zipCode || null
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Helper registration started',
      registration: buildRegistrationPayload(rows[0])
    });
  } catch (error) {
    console.error('startHelperRegistration error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to start helper registration'
    });
  } finally {
    client.release();
  }
};

exports.sendOTP = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required'
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    if (!pending.email) {
      return res.status(400).json({
        success: false,
        message: 'No email found for this registration'
      });
    }

    const otp = generateOTP();
    const expiresAt = otpExpiryDate();

    await client.query(
      `UPDATE pending_registrations
       SET otp_code = $2,
           otp_expires_at = $3,
           otp_attempts = 0,
           otp_verified = false,
           updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, otp, expiresAt]
    );

    await sendOTPEmail(pending.email, otp);

    const updated = await getPendingRegistration(client, sessionId);

    return res.json({
      success: true,
      message: 'Verification code sent',
      registration: buildRegistrationPayload(updated)
    });
  } catch (error) {
    console.error('sendOTP error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to send verification code'
    });
  } finally {
    client.release();
  }
};

exports.resendHelperOTP = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required'
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    if (!pending.email) {
      return res.status(400).json({
        success: false,
        message: 'No email found for this registration'
      });
    }

    const otp = generateOTP();
    const expiresAt = otpExpiryDate();

    await client.query(
      `UPDATE pending_registrations
       SET otp_code = $2,
           otp_expires_at = $3,
           otp_attempts = 0,
           otp_verified = false,
           updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, otp, expiresAt]
    );

    await sendOTPEmail(pending.email, otp);

    const updated = await getPendingRegistration(client, sessionId);

    return res.json({
      success: true,
      message: 'Verification code resent',
      registration: buildRegistrationPayload(updated)
    });
  } catch (error) {
    console.error('resendHelperOTP error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to resend verification code'
    });
  } finally {
    client.release();
  }
};

exports.verifyOTP = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, otp } = req.body;

    if (!sessionId || !otp) {
      return res.status(400).json({
        success: false,
        message: 'sessionId and otp are required'
      });
    }

    await client.query('BEGIN');

    const pending = await ensurePendingRegistration(client, sessionId);

    if (!pending.otp_code) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No verification code has been sent'
      });
    }

    if (pending.otp_attempts >= MAX_OTP_ATTEMPTS) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new code.'
      });
    }

    if (pending.otp_expires_at && new Date(pending.otp_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.'
      });
    }

    if (String(pending.otp_code) !== String(otp).trim()) {
      await client.query(
        `UPDATE pending_registrations
         SET otp_attempts = COALESCE(otp_attempts, 0) + 1,
             updated_at = NOW()
         WHERE session_id = $1`,
        [sessionId]
      );

      await client.query('COMMIT');

      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    if (await emailExists(client, pending.email, pending.user_id || null)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'An account with that email already exists'
      });
    }

    if (pending.phone && await phoneExists(client, pending.phone, pending.user_id || null)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'An account with that phone number already exists'
      });
    }

    let user = pending.user_id ? await getUserById(client, pending.user_id) : null;

    if (!user) {
      user = await createUserFromPendingRegistration(client, pending);
    }

    const pendingUpdate = await client.query(
      `UPDATE pending_registrations
       SET user_id = $2,
           account_created = true,
           otp_verified = true,
           email_verified = true,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING *`,
      [sessionId, user.id]
    );

    user = await updateUserOnboardingState(client, user.id);

    await client.query('COMMIT');

    const tokens = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role
    });

    return res.json({
      success: true,
      message: 'Email verified. Helper account created with limited access until onboarding is complete.',
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        email_verified: user.email_verified,
        onboarding_status: user.onboarding_status,
        onboarding_completed: user.onboarding_completed,
        contact_completed: user.contact_completed,
        profile_completed: user.profile_completed,
        tier_selected: user.tier_selected,
        w9_completed: user.w9_completed,
        terms_accepted: user.terms_accepted
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      registration: buildRegistrationPayload(pendingUpdate.rows[0])
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('verifyOTP rollback error:', rollbackError);
    }

    console.error('verifyOTP error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to verify code'
    });
  } finally {
    client.release();
  }
};

exports.updateContactInfo = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, userId, email, phone, city, state, zipCode } = req.body;

    if (!sessionId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId or userId is required'
      });
    }

    if (userId) {
      const user = await getUserById(client, userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const nextEmail = email ? normalizeEmail(email) : user.email;
      const nextPhone = phone !== undefined ? normalizePhone(phone) : user.phone;

      if (nextEmail !== user.email && await emailExists(client, nextEmail, userId)) {
        return res.status(409).json({
          success: false,
          message: 'An account with that email already exists'
        });
      }

      if (nextPhone && nextPhone !== user.phone && await phoneExists(client, nextPhone, userId)) {
        return res.status(409).json({
          success: false,
          message: 'An account with that phone number already exists'
        });
      }

      await client.query(
        `UPDATE users
         SET email = $2,
             phone = $3,
             city = COALESCE($4, city),
             state = COALESCE($5, state),
             zip_code = COALESCE($6, zip_code),
             contact_completed = true
         WHERE id = $1`,
        [userId, nextEmail, nextPhone || null, city || null, state || null, zipCode || null]
      );

      const updatedUser = await updateUserOnboardingState(client, userId);

      return res.json({
        success: true,
        message: 'Contact info updated',
        user: updatedUser
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    const normalizedEmail = email ? normalizeEmail(email) : pending.email;
    const normalizedPhone = phone !== undefined ? normalizePhone(phone) : pending.phone;

    if (normalizedEmail !== pending.email) {
      if (await emailExists(client, normalizedEmail, pending.user_id || null)) {
        return res.status(409).json({
          success: false,
          message: 'An account with that email already exists'
        });
      }

      if (await pendingEmailExists(client, normalizedEmail, sessionId)) {
        return res.status(409).json({
          success: false,
          message: 'A pending registration with that email already exists'
        });
      }
    }

    if (normalizedPhone && normalizedPhone !== pending.phone) {
      if (await phoneExists(client, normalizedPhone, pending.user_id || null)) {
        return res.status(409).json({
          success: false,
          message: 'An account with that phone number already exists'
        });
      }

      if (await pendingPhoneExists(client, normalizedPhone, sessionId)) {
        return res.status(409).json({
          success: false,
          message: 'A pending registration with that phone number already exists'
        });
      }
    }

    const pendingUpdate = await client.query(
      `UPDATE pending_registrations
       SET email = $2,
           phone = $3,
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           zip_code = COALESCE($6, zip_code),
           contact_updated = true,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING *`,
      [sessionId, normalizedEmail, normalizedPhone || null, city || null, state || null, zipCode || null]
    );

    if (pending.user_id) {
      await client.query(
        `UPDATE users
         SET email = $2,
             phone = $3,
             city = COALESCE($4, city),
             state = COALESCE($5, state),
             zip_code = COALESCE($6, zip_code),
             contact_completed = true
         WHERE id = $1`,
        [pending.user_id, normalizedEmail, normalizedPhone || null, city || null, state || null, zipCode || null]
      );

      await updateUserOnboardingState(client, pending.user_id);
    }

    return res.json({
      success: true,
      message: 'Contact info updated',
      registration: buildRegistrationPayload(pendingUpdate.rows[0])
    });
  } catch (error) {
    console.error('updateContactInfo error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to update contact info'
    });
  } finally {
    client.release();
  }
};

exports.completeProfileStep = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, userId, bio, skills, experienceYears, categories, serviceArea } = req.body;

    if (!sessionId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId or userId is required'
      });
    }

    if (userId) {
      await client.query(
        `UPDATE users
         SET bio = COALESCE($2, bio),
             skills = COALESCE($3, skills),
             experience_years = COALESCE($4, experience_years),
             categories = COALESCE($5, categories),
             service_area = COALESCE($6, service_area),
             profile_completed = true
         WHERE id = $1`,
        [userId, bio || null, skills || null, experienceYears || null, categories || null, serviceArea || null]
      );

      const updatedUser = await updateUserOnboardingState(client, userId);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      return res.json({
        success: true,
        message: 'Profile step completed',
        user: updatedUser
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    const pendingUpdate = await client.query(
      `UPDATE pending_registrations
       SET bio = COALESCE($2, bio),
           skills = COALESCE($3, skills),
           experience_years = COALESCE($4, experience_years),
           categories = COALESCE($5, categories),
           service_area = COALESCE($6, service_area),
           profile_completed = true,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING *`,
      [sessionId, bio || null, skills || null, experienceYears || null, categories || null, serviceArea || null]
    );

    if (pending.user_id) {
      await client.query(
        `UPDATE users
         SET bio = COALESCE($2, bio),
             skills = COALESCE($3, skills),
             experience_years = COALESCE($4, experience_years),
             categories = COALESCE($5, categories),
             service_area = COALESCE($6, service_area),
             profile_completed = true
         WHERE id = $1`,
        [pending.user_id, bio || null, skills || null, experienceYears || null, categories || null, serviceArea || null]
      );

      await updateUserOnboardingState(client, pending.user_id);
    }

    return res.json({
      success: true,
      message: 'Profile step completed',
      registration: buildRegistrationPayload(pendingUpdate.rows[0])
    });
  } catch (error) {
    console.error('completeProfileStep error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to save profile step'
    });
  } finally {
    client.release();
  }
};

exports.selectTierStep = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, userId, selectedTier } = req.body;

    if ((!sessionId && !userId) || !selectedTier) {
      return res.status(400).json({
        success: false,
        message: 'selectedTier and sessionId or userId are required'
      });
    }

    if (userId) {
      await client.query(
        `UPDATE users
         SET helper_tier = $2,
             tier_selected = true
         WHERE id = $1`,
        [userId, selectedTier]
      );

      const updatedUser = await updateUserOnboardingState(client, userId);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      return res.json({
        success: true,
        message: 'Tier selected',
        user: updatedUser
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    const pendingUpdate = await client.query(
      `UPDATE pending_registrations
       SET selected_tier = $2,
           tier_selected = true,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING *`,
      [sessionId, selectedTier]
    );

    if (pending.user_id) {
      await client.query(
        `UPDATE users
         SET helper_tier = $2,
             tier_selected = true
         WHERE id = $1`,
        [pending.user_id, selectedTier]
      );

      await updateUserOnboardingState(client, pending.user_id);
    }

    return res.json({
      success: true,
      message: 'Tier selected',
      registration: buildRegistrationPayload(pendingUpdate.rows[0])
    });
  } catch (error) {
    console.error('selectTierStep error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to save selected tier'
    });
  } finally {
    client.release();
  }
};

exports.completeW9Step = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, userId, w9Name, w9TaxClassification, w9Tin } = req.body;

    if (!sessionId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId or userId is required'
      });
    }

    if (userId) {
      await client.query(
        `UPDATE users
         SET w9_name = COALESCE($2, w9_name),
             w9_tax_classification = COALESCE($3, w9_tax_classification),
             w9_tin = COALESCE($4, w9_tin),
             w9_completed = true
         WHERE id = $1`,
        [userId, w9Name || null, w9TaxClassification || null, w9Tin || null]
      );

      const updatedUser = await updateUserOnboardingState(client, userId);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      return res.json({
        success: true,
        message: 'W-9 step completed',
        user: updatedUser
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    const pendingUpdate = await client.query(
      `UPDATE pending_registrations
       SET w9_name = COALESCE($2, w9_name),
           w9_tax_classification = COALESCE($3, w9_tax_classification),
           w9_tin = COALESCE($4, w9_tin),
           w9_completed = true,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING *`,
      [sessionId, w9Name || null, w9TaxClassification || null, w9Tin || null]
    );

    if (pending.user_id) {
      await client.query(
        `UPDATE users
         SET w9_name = COALESCE($2, w9_name),
             w9_tax_classification = COALESCE($3, w9_tax_classification),
             w9_tin = COALESCE($4, w9_tin),
             w9_completed = true
         WHERE id = $1`,
        [pending.user_id, w9Name || null, w9TaxClassification || null, w9Tin || null]
      );

      await updateUserOnboardingState(client, pending.user_id);
    }

    return res.json({
      success: true,
      message: 'W-9 step completed',
      registration: buildRegistrationPayload(pendingUpdate.rows[0])
    });
  } catch (error) {
    console.error('completeW9Step error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to save W-9 step'
    });
  } finally {
    client.release();
  }
};

exports.acceptTermsStep = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, userId } = req.body;

    if (!sessionId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId or userId is required'
      });
    }

    if (userId) {
      await client.query(
        `UPDATE users
         SET terms_accepted = true
         WHERE id = $1`,
        [userId]
      );

      const updatedUser = await updateUserOnboardingState(client, userId);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      return res.json({
        success: true,
        message: 'Terms accepted',
        user: updatedUser
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    const pendingUpdate = await client.query(
      `UPDATE pending_registrations
       SET terms_accepted = true,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING *`,
      [sessionId]
    );

    if (pending.user_id) {
      await client.query(
        `UPDATE users
         SET terms_accepted = true
         WHERE id = $1`,
        [pending.user_id]
      );

      await updateUserOnboardingState(client, pending.user_id);
    }

    return res.json({
      success: true,
      message: 'Terms accepted',
      registration: buildRegistrationPayload(pendingUpdate.rows[0])
    });
  } catch (error) {
    console.error('acceptTermsStep error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to accept terms'
    });
  } finally {
    client.release();
  }
};

exports.finalizeRegistration = async (req, res) => {
  const client = await pool.connect();

  try {
    const { sessionId, userId } = req.body;

    if (!sessionId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId or userId is required'
      });
    }

    if (userId) {
      const updatedUser = await updateUserOnboardingState(client, userId);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      return res.json({
        success: true,
        message: updatedUser.onboarding_completed
          ? 'Helper onboarding is complete. Full access unlocked.'
          : 'Helper account exists, but onboarding is still incomplete. Keep limited access enabled.',
        user: updatedUser
      });
    }

    const pending = await ensurePendingRegistration(client, sessionId);

    if (!pending.user_id) {
      return res.status(400).json({
        success: false,
        message: 'Account has not been created yet. Complete email verification first.'
      });
    }

    const updatedUser = await updateUserOnboardingState(client, pending.user_id);
    const syncedPending = await syncPendingFlagsFromUser(client, sessionId, pending.user_id);

    return res.json({
      success: true,
      message: updatedUser.onboarding_completed
        ? 'Helper onboarding is complete. Full access unlocked.'
        : 'Helper account exists, but onboarding is still incomplete. Keep limited access enabled.',
      user: updatedUser,
      registration: buildRegistrationPayload(syncedPending)
    });
  } catch (error) {
    console.error('finalizeRegistration error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to finalize helper registration'
    });
  } finally {
    client.release();
  }

  // Alias exports for route compatibility
exports.getCategories = async (req, res) => {
  const categories = [
    'Home Repair', 'Cleaning', 'Landscaping', 'Moving', 'Painting',
    'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'Handyman',
    'Pet Care', 'Tutoring', 'Tech Support', 'Auto Services', 'Other'
  ];
  return res.json({ success: true, categories });
};
exports.updateContact = exports.updateContactInfo;
exports.saveHelperProfile = exports.completeProfileStep;
exports.selectTier = exports.selectTierStep;
exports.submitW9 = exports.completeW9Step;
exports.helperAcceptTerms = exports.acceptTermsStep;
