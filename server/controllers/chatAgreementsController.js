'use strict';

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const { uploadFile, getSignedDownloadUrl, normalizeStorageKey } = require('../utils/storage');
const {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
  resolveGuestFromRequest,
  isProviderOnConversation,
  isCustomerOnConversation,
} = require('../services/chatThreadAccess');
const {
  RESPOND_ACTIONS,
  ALLOWED_AGREEMENT_MIMES,
  newAgreementToken,
  buildAgreementMarker,
  buildAgreementShareContent,
  canRespondToAgreement,
  normalizeAgreementPayload,
  toPublicAgreementCard,
  redactAgreementForLog,
  scheduleBlockedByAgreements,
} = require('../services/chatAgreements');
const { mirrorLegacyMessage } = require('../services/businessConversationSync');
const { enqueueConversationMessageNotifications } = require('../services/messageNotificationService');
const { withTransaction } = require('../utils/transaction');

function bad(res, status, error, code) {
  return res.status(status).json({ error, code: code || 'error' });
}

function sanitizeScopeId(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

// Uploads are scoped to the conversation (or guest session) they belong to, so
// a caller-supplied attachment key is only accepted when it was minted for this
// scope. This prevents attachment_key escalation across conversations.
function scopedUploadFolder(baseFolder, { conversationId, guestSessionId, businessId, userId }) {
  let scope;
  if (conversationId) scope = `c-${sanitizeScopeId(conversationId)}`;
  else if (guestSessionId) scope = `g-${sanitizeScopeId(guestSessionId)}`;
  else if (businessId) scope = `b-${sanitizeScopeId(businessId)}`;
  else scope = `u-${sanitizeScopeId(userId)}`;
  return `${baseFolder}/${scope}`;
}

// Returns the normalized key when it was minted under this scope's folder,
// otherwise null. Uploaded file bytes always win (minted under the same folder
// by construction); this only gates caller-supplied keys.
function scopedAttachmentKey(attachmentKey, uploadFolder) {
  const normalized = normalizeStorageKey(attachmentKey);
  if (!normalized || !normalized.startsWith(`${uploadFolder}/`)) return null;
  return normalized;
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 64);
}

function getClientRequestId(req) {
  const value = req.get?.('Idempotency-Key')
    || req.body?.clientRequestId
    || req.body?.client_request_id
    || null;
  if (!value) return null;
  const id = String(value).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : false;
}

async function postConversationMessage({ conversationId, senderId, content, senderName, businessId = null, clientMessageId, recipientIds = null }) {
  const { messageRow, replayed } = await withTransaction(pool, async (client) => {
    let messageRow;
    let replayed = false;
    const { rows } = await client.query(
    `INSERT INTO messages (conversation_id, sender_id, content, message_type, client_message_id)
     VALUES ($1, $2, $3, 'text', $4)
     ON CONFLICT (conversation_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [conversationId, senderId, content, clientMessageId || null],
    );
    messageRow = rows[0];
    replayed = !messageRow && Boolean(clientMessageId);
    if (!messageRow && clientMessageId) {
      const replay = await client.query(
      'SELECT * FROM messages WHERE conversation_id = $1 AND client_message_id = $2',
      [conversationId, clientMessageId],
      );
      messageRow = replay.rows[0];
    }
    if (!messageRow) throw new Error('Failed to create agreement chat message');
    if (!replayed) {
      await client.query(
    'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId],
      );
      await enqueueConversationMessageNotifications({
        dbClient: client,
        conversationId,
        messageId: messageRow.id,
        senderId,
        senderName,
        body: content,
        actionUrl: `/messages/${conversationId}`,
        recipientIds,
      });
    }
    return { messageRow, replayed };
  }, 'chat_agreement_message');
  if (replayed) return { ...messageRow, sender_name: senderName };
  const message = { ...messageRow, sender_name: senderName };
  socketService.broadcastToConversation(conversationId, 'message:new', { conversationId, message });
  socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
    conversationId,
    message,
    senderName,
  });
  try {
    await mirrorLegacyMessage?.({
      legacyConversationId: conversationId,
      businessId,
      message,
      senderName,
    });
  } catch (err) {
    logger.warn('[chatAgreements] business mirror failed', { error: err.message });
  }
  return message;
}

async function postGuestMessage({ guestSessionId, senderName, content, helperId, senderType = 'helper', clientMessageId }) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, client_message_id, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderType, senderName, content, clientMessageId || null],
  );
  let msg = rows[0];
  if (!msg && clientMessageId) {
    const replay = await pool.query(
      `SELECT id, session_id, sender_type, sender_name, message, created_at
         FROM guest_profile_chat_messages
        WHERE session_id = $1 AND client_message_id = $2`,
      [guestSessionId, clientMessageId],
    );
    msg = replay.rows[0];
  }
  if (!msg) throw new Error('Failed to create agreement guest message');
  if (rows.length === 0) return msg;
  const createdAt = msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at;
  try {
    socketService.io?.to?.(`guest_session_${guestSessionId}`)?.emit?.('profile_chat:new_message', {
      guestInquiry: true,
      guestSessionId,
      message: {
        id: msg.id,
        content,
        sender_type: senderType,
        sender_name: senderName,
        created_at: createdAt,
      },
      senderName,
    });
    if (helperId) {
      socketService.broadcastToUser(helperId, 'profile_chat:new_message', {
        guestInquiry: true,
        guestSessionId,
        message: {
          id: msg.id,
          content,
          sender_type: senderType,
          sender_name: senderName,
          created_at: createdAt,
        },
        senderName,
      });
    }
  } catch (e) {
    logger.warn('[chatAgreements] guest socket emit failed', { error: e.message });
  }
  return msg;
}

async function loadAgreement(id) {
  const { rows } = await pool.query('SELECT * FROM chat_agreements WHERE id = $1', [id]);
  return rows[0] || null;
}

async function assertProviderCanShare(userId, { conversationId, guestSessionId, businessId, helperId }) {
  if (conversationId) {
    const conv = await assertConversationParticipant(userId, conversationId, { writable: true });
    if (!conv) return { ok: false, status: 403, error: 'Not a conversation participant' };
    const isProvider =
      isProviderOnConversation(userId, conv) ||
      (conv.business_id && (await assertBusinessAccess(userId, conv.business_id)));
    if (!isProvider) return { ok: false, status: 403, error: 'Only the provider can share agreements' };
    return {
      ok: true,
      conversationId,
      helperId: conv.helper_id,
      customerId: conv.customer_id,
      businessId: businessId || conv.business_id,
      conv,
    };
  }
  if (guestSessionId) {
    const g = await assertGuestInquiryAccess(userId, guestSessionId);
    if (!g) return { ok: false, status: 403, error: 'Not allowed for this guest inquiry' };
    return {
      ok: true,
      guestSessionId,
      helperId: g.helper_id,
      businessId: businessId || g.business_id,
      guestInquiry: g,
    };
  }
  if (businessId) {
    const biz = await assertBusinessAccess(userId, businessId);
    if (!biz) return { ok: false, status: 403, error: 'Not allowed for this business' };
    return { ok: true, businessId, helperId: biz.user_id };
  }
  if (helperId && String(helperId) === String(userId)) {
    return { ok: true, helperId: userId };
  }
  return { ok: false, status: 400, error: 'conversationId or guestSessionId required' };
}

async function assertCanViewAgreement(req, row) {
  const userId = req.user?.id;
  const guest = await resolveGuestFromRequest(req);
  const token = String(req.query?.token || req.headers['x-agreement-token'] || req.body?.token || '').trim();
  if (token && row.token && token === row.token) return { ok: true, via: 'token' };
  if (userId && row.conversation_id) {
    const conv = await assertConversationParticipant(userId, row.conversation_id);
    if (conv) return { ok: true, via: 'conversation', conv };
  }
  if (userId && row.guest_session_id) {
    const g = await assertGuestInquiryAccess(userId, row.guest_session_id);
    if (g) return { ok: true, via: 'guest_inquiry' };
  }
  if (userId && row.business_id && (await assertBusinessAccess(userId, row.business_id))) {
    return { ok: true, via: 'business' };
  }
  if (userId && row.helper_id && String(row.helper_id) === String(userId)) {
    return { ok: true, via: 'helper' };
  }
  if (userId && row.shared_by && String(row.shared_by) === String(userId)) {
    return { ok: true, via: 'sharer' };
  }
  if (guest && row.guest_session_id && String(guest.id) === String(row.guest_session_id)) {
    return { ok: true, via: 'guest', guest };
  }
  return { ok: false };
}

async function postAgreementMessage(ctx, content, senderName, userId, clientMessageId) {
  if (ctx.conversationId) {
    return postConversationMessage({
      conversationId: ctx.conversationId,
      senderId: userId,
      content,
      senderName,
      businessId: ctx.businessId,
      clientMessageId,
      recipientIds: [ctx.customerId, ctx.helperId],
    });
  }
  if (ctx.guestSessionId) {
    return postGuestMessage({
      guestSessionId: ctx.guestSessionId,
      senderName,
      content,
      helperId: ctx.helperId,
      senderType: 'helper',
      clientMessageId,
    });
  }
  return null;
}

exports.shareAgreement = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_required');

    const conversationId = req.body.conversationId || req.body.conversation_id || null;
    const guestSessionId = req.body.guestSessionId || req.body.guest_session_id || null;
    const businessId = req.body.businessId || req.body.business_id || null;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return bad(res, 400, 'clientRequestId must be a valid UUID', 'validation_failed');
    }

    const access = await assertProviderCanShare(userId, {
      conversationId,
      guestSessionId,
      businessId,
      helperId: req.body.helperId || userId,
    });
    if (!access.ok) return bad(res, access.status || 403, access.error, 'forbidden');

    const normalized = normalizeAgreementPayload({
      ...req.body,
      hasFile: Boolean(req.file),
      attachment_key: req.body.attachment_key || req.body.attachmentKey,
    });
    if (normalized.error) return bad(res, 400, normalized.error, 'validation_failed');

    let agreement = null;
    let replayed = false;
    if (clientRequestId) {
      const existing = await pool.query(
        'SELECT * FROM chat_agreements WHERE shared_by = $1 AND client_request_id = $2',
        [userId, clientRequestId],
      );
      agreement = existing.rows[0] || null;
      replayed = Boolean(agreement);
    }

    let attachmentKey = agreement?.attachment_key || req.body.attachment_key || req.body.attachmentKey || null;
    let attachmentName = req.body.attachment_name || req.body.attachmentName || null;
    let attachmentMime = req.body.attachment_mime || req.body.attachmentMime || null;
    let attachmentSize = req.body.attachment_size || req.body.attachmentSize || null;

    const uploadFolder = scopedUploadFolder('chat-agreements', {
      conversationId: access.conversationId || conversationId,
      guestSessionId: access.guestSessionId || guestSessionId,
      businessId: access.businessId || businessId,
      userId,
    });

    if (req.file && !agreement) {
      if (!ALLOWED_AGREEMENT_MIMES.has(req.file.mimetype)) {
        return bad(res, 400, 'File type not allowed for agreements', 'invalid_file_type');
      }
      const key = await uploadFile(req.file.buffer, uploadFolder, req.file.originalname, req.file.mimetype);
      if (!key) return bad(res, 503, 'File storage unavailable', 'storage_unavailable');
      attachmentKey = key;
      attachmentName = req.file.originalname;
      attachmentMime = req.file.mimetype;
      attachmentSize = req.file.size;
    }

    // No file uploaded in this request but a caller-supplied attachment key is
    // present: only honor it when it was minted for this conversation scope.
    if (!agreement && !req.file && attachmentKey) {
      const scopedKey = scopedAttachmentKey(attachmentKey, uploadFolder);
      if (!scopedKey) {
        return bad(res, 400, 'attachment_key was not issued for this conversation', 'attachment_key_not_issued_here');
      }
      attachmentKey = scopedKey;
    }

    const senderName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Provider';
    if (!agreement) {
      const token = newAgreementToken();
      const { rows } = await pool.query(
        `INSERT INTO chat_agreements (
           conversation_id, guest_session_id, business_id, helper_id,
           title, body_text, version, token, status, required_before_schedule,
           attachment_key, attachment_name, attachment_mime, attachment_size, shared_by,
           client_request_id
         ) VALUES ($1,$2,$3,$4,$5,$6,1,$7,'shared',$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (shared_by, client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          access.conversationId || null,
          access.guestSessionId || null,
          access.businessId || null,
          access.helperId || userId,
          normalized.title,
          normalized.bodyText,
          token,
          normalized.requiredBeforeSchedule,
          attachmentKey,
          attachmentName,
          attachmentMime,
          attachmentSize,
          userId,
          clientRequestId,
        ],
      );
      agreement = rows[0] || null;
      if (!agreement && clientRequestId) {
        const replay = await pool.query(
          'SELECT * FROM chat_agreements WHERE shared_by = $1 AND client_request_id = $2',
          [userId, clientRequestId],
        );
        agreement = replay.rows[0] || null;
        replayed = true;
      }
    }
    if (!agreement) throw new Error('Failed to create agreement');
    const marker = buildAgreementMarker({
      id: agreement.id,
      token: agreement.token,
      status: agreement.status,
      version: agreement.version,
      title: agreement.title,
    });
    const content = buildAgreementShareContent({
      marker,
      title: agreement.title,
      preface: req.body.preface,
    });
      const messageContext = replayed
      ? {
        conversationId: agreement.conversation_id,
        guestSessionId: agreement.guest_session_id,
        helperId: agreement.helper_id,
        businessId: agreement.business_id,
        recipientIds: [access.conv?.customer_id, access.conv?.helper_id],
      }
      : access;
    const message = await postAgreementMessage(messageContext, content, senderName, userId, clientRequestId);
    if (message) {
      await pool.query('UPDATE chat_agreements SET message_id = $1, updated_at = NOW() WHERE id = $2', [
        String(message.id),
        agreement.id,
      ]);
    }

    logger.info('[chatAgreements] shared', { agreement: redactAgreementForLog(agreement) });
    return res.status(replayed ? 200 : 201).json({
      agreement: toPublicAgreementCard(agreement),
      message,
      marker,
      idempotent: replayed,
    });
  } catch (err) {
    next(err);
  }
};

exports.getAgreement = async (req, res, next) => {
  try {
    const row = await loadAgreement(req.params.id);
    if (!row) return bad(res, 404, 'Agreement not found', 'not_found');
    const access = await assertCanViewAgreement(req, row);
    if (!access.ok) return bad(res, 403, 'Not allowed to view this agreement', 'forbidden');
    return res.json(toPublicAgreementCard(row));
  } catch (err) {
    next(err);
  }
};

exports.downloadAgreement = async (req, res, next) => {
  try {
    const row = await loadAgreement(req.params.id);
    if (!row) return bad(res, 404, 'Agreement not found', 'not_found');
    const access = await assertCanViewAgreement(req, row);
    if (!access.ok) return bad(res, 403, 'Not allowed to download', 'forbidden');
    if (!row.attachment_key) return bad(res, 404, 'No attachment on this agreement', 'no_attachment');
    const url = await getSignedDownloadUrl(row.attachment_key, 600);
    if (!url) return bad(res, 503, 'Download unavailable', 'storage_unavailable');
    return res.json({
      url,
      name: row.attachment_name,
      mimeType: row.attachment_mime,
      size: row.attachment_size,
      expiresIn: 600,
    });
  } catch (err) {
    next(err);
  }
};

exports.respondAgreement = async (req, res, next) => {
  try {
    const action = String(req.body?.action || req.body?.response || '').toLowerCase();
    if (!RESPOND_ACTIONS.has(action)) {
      return bad(res, 400, 'action must be acknowledge, accept, or decline', 'validation_failed');
    }
    const row = await loadAgreement(req.params.id);
    if (!row) return bad(res, 404, 'Agreement not found', 'not_found');

    const gate = canRespondToAgreement(row);
    if (!gate.ok) return bad(res, 409, `Cannot respond: ${gate.reason}`, gate.reason);

    const userId = req.user?.id;
    let guest = await resolveGuestFromRequest(req);
    const token = String(req.body?.token || req.query?.token || '').trim();

    let allowed = false;
    if (token && row.token && token === row.token) allowed = true;
    if (userId && row.conversation_id) {
      const conv = await assertConversationParticipant(userId, row.conversation_id, { writable: true });
      if (conv && isCustomerOnConversation(userId, conv)) allowed = true;
    }
    if (guest && row.guest_session_id && String(guest.id) === String(row.guest_session_id)) {
      allowed = true;
    }
    if (!allowed) {
      if (!userId && !guest) {
        return bad(res, 401, 'Sign in or verify as guest to respond', 'verify_required');
      }
      return bad(res, 403, 'Not allowed to respond to this agreement', 'forbidden');
    }

    // acknowledge is allowed from shared; accept/decline from shared or acknowledged
    if (action === 'acknowledge' && row.status !== 'shared') {
      return bad(res, 409, 'Already responded', 'invalid_status');
    }

    const nextStatus =
      action === 'acknowledge' ? 'acknowledged' : action === 'accept' ? 'accepted' : 'declined';
    const note = String(req.body?.reason || req.body?.note || '').trim().slice(0, 1000) || null;

    const { rows } = await pool.query(
      `UPDATE chat_agreements
          SET status = $1, decline_reason = CASE WHEN $1 = 'declined' THEN $2 ELSE decline_reason END,
              updated_at = NOW()
        WHERE id = $3 RETURNING *`,
      [nextStatus, note, row.id],
    );
    const updated = rows[0];

    const actorName = userId
      ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Customer'
      : guest?.guest_name || 'Guest';
    const actorEmail = userId ? req.user.email : guest?.guest_email || null;

    await pool.query(
      `INSERT INTO chat_agreement_responses (
         agreement_id, action, actor_user_id, actor_guest_session_id,
         actor_name, actor_email, ip_hash, user_agent, note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        updated.id,
        action,
        userId || null,
        guest?.id || null,
        actorName,
        actorEmail,
        hashIp(req.ip),
        String(req.headers['user-agent'] || '').slice(0, 500) || null,
        note,
      ],
    );

    const marker = buildAgreementMarker({
      id: updated.id,
      token: updated.token,
      status: updated.status,
      version: updated.version,
      title: updated.title,
    });
    const statusContent = `Agreement ${nextStatus}: ${updated.title}\n${marker}`;

    if (updated.conversation_id && userId) {
      await postConversationMessage({
        conversationId: updated.conversation_id,
        senderId: userId,
        content: statusContent,
        senderName: actorName,
        businessId: updated.business_id,
        recipientIds: [updated.customer_id, updated.helper_id],
      });
    } else if (updated.guest_session_id) {
      await postGuestMessage({
        guestSessionId: updated.guest_session_id,
        senderName: actorName,
        content: statusContent,
        helperId: updated.helper_id,
        senderType: userId ? 'helper' : 'guest',
      });
    }

    return res.json({
      agreement: toPublicAgreementCard(updated),
      evidence_recorded: true,
    });
  } catch (err) {
    next(err);
  }
};

exports.reviseAgreement = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_required');
    const parent = await loadAgreement(req.params.id);
    if (!parent) return bad(res, 404, 'Agreement not found', 'not_found');

    const access = await assertProviderCanShare(userId, {
      conversationId: parent.conversation_id,
      guestSessionId: parent.guest_session_id,
      businessId: parent.business_id,
      helperId: parent.helper_id,
    });
    if (!access.ok) return bad(res, access.status || 403, access.error, 'forbidden');

    const normalized = normalizeAgreementPayload({
      title: req.body.title || parent.title,
      body_text: req.body.body_text || req.body.bodyText || req.body.terms || parent.body_text,
      required_before_schedule:
        req.body.required_before_schedule ??
        req.body.requiredBeforeSchedule ??
        parent.required_before_schedule,
      hasFile: Boolean(req.file),
      attachment_key: req.body.attachment_key || parent.attachment_key,
    });
    if (normalized.error) return bad(res, 400, normalized.error, 'validation_failed');

    let attachmentKey = parent.attachment_key;
    let attachmentName = parent.attachment_name;
    let attachmentMime = parent.attachment_mime;
    let attachmentSize = parent.attachment_size;

    const uploadFolder = scopedUploadFolder('chat-agreements', {
      conversationId: parent.conversation_id,
      guestSessionId: parent.guest_session_id,
      businessId: parent.business_id,
      userId: parent.helper_id,
    });

    if (req.file) {
      if (!ALLOWED_AGREEMENT_MIMES.has(req.file.mimetype)) {
        return bad(res, 400, 'File type not allowed for agreements', 'invalid_file_type');
      }
      const key = await uploadFile(req.file.buffer, uploadFolder, req.file.originalname, req.file.mimetype);
      if (!key) return bad(res, 503, 'File storage unavailable', 'storage_unavailable');
      attachmentKey = key;
      attachmentName = req.file.originalname;
      attachmentMime = req.file.mimetype;
      attachmentSize = req.file.size;
    }

    // No file uploaded in this request but a caller-supplied attachment key is
    // present: only honor it when it was minted for this conversation scope.
    // The parent's stored key is kept as-is (old unscoped keys keep working).
    if (!req.file) {
      const callerKey = req.body.attachment_key || req.body.attachmentKey || null;
      if (callerKey) {
        const scopedKey = scopedAttachmentKey(callerKey, uploadFolder);
        if (!scopedKey) {
          return bad(res, 400, 'attachment_key was not issued for this conversation', 'attachment_key_not_issued_here');
        }
        attachmentKey = scopedKey;
      }
    }

    await pool.query(
      `UPDATE chat_agreements
          SET status = 'superseded', superseded_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [parent.id],
    );

    const token = newAgreementToken();
    const version = (parseInt(parent.version, 10) || 1) + 1;
    const { rows } = await pool.query(
      `INSERT INTO chat_agreements (
         conversation_id, guest_session_id, business_id, helper_id,
         title, body_text, version, parent_agreement_id, token, status,
         required_before_schedule, attachment_key, attachment_name, attachment_mime,
         attachment_size, shared_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'shared',$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        parent.conversation_id,
        parent.guest_session_id,
        parent.business_id,
        parent.helper_id,
        normalized.title,
        normalized.bodyText,
        version,
        parent.id,
        token,
        normalized.requiredBeforeSchedule,
        attachmentKey,
        attachmentName,
        attachmentMime,
        attachmentSize,
        userId,
      ],
    );
    const agreement = rows[0];
    const reShare = req.body.reshare !== false && req.body.reShare !== false;
    let message = null;
    if (reShare) {
      const marker = buildAgreementMarker({
        id: agreement.id,
        token: agreement.token,
        status: agreement.status,
        version: agreement.version,
        title: agreement.title,
      });
      const content = buildAgreementShareContent({
        marker,
        title: agreement.title,
        preface: req.body.preface || `Updated agreement (v${version}): ${agreement.title}`,
      });
      const senderName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Provider';
      message = await postAgreementMessage(
        {
          conversationId: parent.conversation_id,
          guestSessionId: parent.guest_session_id,
          helperId: parent.helper_id,
          customerId: access.customerId,
          recipientIds: [access.customerId, access.helperId],
        },
        content,
        senderName,
        userId,
      );
      if (message) {
        await pool.query('UPDATE chat_agreements SET message_id = $1, updated_at = NOW() WHERE id = $2', [
          String(message.id),
          agreement.id,
        ]);
      }
    }

    return res.status(201).json({
      agreement: toPublicAgreementCard(agreement),
      superseded_id: parent.id,
      message,
    });
  } catch (err) {
    next(err);
  }
};

exports.checkScheduleAgreementGate = (args) =>
  require('../services/chatAgreements').checkScheduleAgreementGate(pool, args);
