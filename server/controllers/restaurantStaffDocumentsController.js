"use strict";

const crypto = require("crypto");
const pool = require("../db");
const { AppError } = require("../middleware/errorHandler");
const { resolveRestaurantAccess } = require("../services/scopeModel");
const permissions = require("../services/permissionsService");
const {
  attachScope,
  staffPredicate,
  assertStaff,
} = require("../services/restaurantReviewScope");
const v = require("../utils/restaurantReviewValidation");
const { strictInteger } = require("../utils/strictInteger");
const { withTransaction } = require("../utils/transaction");
const {
  uploadFile,
  getSignedDownloadUrl,
  deleteFile,
} = require("../utils/storage");
const { enqueueStorageDeletion } = require("../services/storageCleanupService");
const { logBusinessAction } = require("../services/businessAuditLog");
const logger = require("../utils/logger");
const DOC_TYPES = [
  "certificate_food_handler",
  "certificate_allergen",
  "certificate_manager",
  "certificate_other",
  "id_document",
  "policy_handbook",
  "sop_document",
  "other",
];
const STATUSES = ["pending", "verified", "rejected"];

async function access(req, manage = false) {
  const id = v.integer(req.params.restaurantId, "restaurantId");
  const r = await attachScope(
    await resolveRestaurantAccess(req.user.id, id),
    req.user.id,
  );
  r.documentManager = await permissions.hasRestaurantPermission(
    r,
    req.user.id,
    ["restaurant.manage"],
  );
  if (manage && !r.documentManager)
    throw new AppError(
      "Document management permission required",
      403,
      "forbidden",
    );
  return r;
}
function date(value, field) {
  if (value == null || value === "") return null;
  if (
    typeof value !== "string" ||
    !require("../services/restaurantPayrollService").isRealDateString(value)
  )
    v.invalid(field);
  return value;
}
function dates(issued, expires) {
  const issuedOn = date(issued, "issuedOn"),
    expiresOn = date(expires, "expiresOn");
  if (issuedOn && expiresOn && issuedOn > expiresOn) v.invalid("expiresOn");
  return { issuedOn, expiresOn };
}
function page(query = {}) {
  return {
    limit:
      query.limit === undefined ? 50 : v.integer(query.limit, "limit", 1, 100),
    offset:
      query.offset === undefined
        ? 0
        : v.integer(query.offset, "offset", 0, 1000000),
  };
}
async function audit(client, req, r, action, before, after) {
  await logBusinessAction(req, {
    client,
    throwOnError: true,
    business_id: r.business_id,
    action: `restaurant.staff_document.${action}`,
    target_type: "staff_document",
    target_id: after?.id || before?.id,
    before_state: before
      ? {
          id: before.id,
          user_id: before.user_id,
          verification_status: before.verification_status,
          issued_on: before.issued_on,
          expires_on: before.expires_on,
        }
      : null,
    after_state: after
      ? {
          id: after.id,
          user_id: after.user_id,
          verification_status: after.verification_status,
          issued_on: after.issued_on,
          expires_on: after.expires_on,
        }
      : null,
  });
}
async function present(row) {
  const { storage_key, ...rest } = row;
  try {
    return {
      ...rest,
      download_url: await getSignedDownloadUrl(storage_key, 600),
      download_unavailable: false,
    };
  } catch (error) {
    logger.warn("Staff document signing failed", {
      documentId: row.id,
      errorCode: error.code || "storage_unavailable",
    });
    return { ...rest, download_url: null, download_unavailable: true };
  }
}
async function discard(key) {
  if (!key) return;
  if (
    !(await enqueueStorageDeletion(key, "restaurant-unused-upload", {
      graceHours: 0,
    }))
  ) {
    try {
      await deleteFile(key);
    } catch (error) {
      logger.error("Restaurant upload cleanup failed", {
        errorCode: error.code || "storage_unavailable",
      });
    }
  }
}
async function authorizeTarget(r, actor, user, db = pool) {
  if (!r.documentManager && user !== actor)
    throw new AppError("Own documents only", 403, "forbidden");
  await assertStaff(r, user, db);
}
exports.listDocuments = async (req, res, next) => {
  try {
    const r = await access(req),
      p = page(req.query),
      params = [r.id];
    let where = "d.restaurant_id=$1 AND d.deleted_at IS NULL";
    const user = r.documentManager
      ? req.query.userId == null
        ? null
        : v.uuid(req.query.userId, "userId")
      : req.user.id;
    if (user) {
      params.push(user);
      where += ` AND d.user_id=$${params.length}`;
    }
    where += staffPredicate(r, "d.user_id", params);
    if (req.query.expiringDays !== undefined) {
      params.push(v.integer(req.query.expiringDays, "expiringDays", 1, 3650));
      where += ` AND d.expires_on <= CURRENT_DATE + $${params.length}::int`;
    }
    params.push(p.limit + 1, p.offset);
    const { rows } = await pool.query(
      `SELECT d.*,u.first_name,u.last_name FROM restaurant_staff_documents d JOIN users u ON u.id=d.user_id WHERE ${where} ORDER BY d.expires_on NULLS LAST,d.created_at DESC,d.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    // Bounded sequential signing prevents an unbounded storage fan-out.
    const documents = [];
    for (const row of rows.slice(0, p.limit))
      documents.push(await present(row));
    res.json({ documents, ...p, hasMore: rows.length > p.limit });
  } catch (error) {
    next(error);
  }
};
exports.uploadDocument = async (req, res, next) => {
  let key = null;
  try {
    const r = await access(req),
      b = req.body || {},
      title = v.text(b.title, "title", 200);
    if (!DOC_TYPES.includes(b.docType)) v.invalid("docType");
    if (!req.file?.buffer)
      throw new AppError("A document file is required", 400, "file_required");
    const target = b.userId == null ? req.user.id : v.uuid(b.userId, "userId");
    await authorizeTarget(r, req.user.id, target);
    const d = dates(b.issuedOn, b.expiresOn);
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify([target, b.docType, title, d, req.file.mimetype]))
      .update(req.file.buffer)
      .digest("hex");
    const identity =
      req.get?.("Idempotency-Key") || b.idempotencyKey || `upload:${hash}`;
    v.text(identity, "idempotencyKey", 180);
    const find = () =>
      pool.query(
        "SELECT * FROM restaurant_staff_documents WHERE restaurant_id=$1 AND uploaded_by=$2 AND idempotency_key=$3",
        [r.id, req.user.id, identity],
      );
    const replay = (await find()).rows[0];
    if (replay) {
      if (replay.request_hash !== hash || replay.deleted_at)
        throw new AppError(
          "Document retry conflicts",
          409,
          "idempotency_conflict",
        );
      return res.json({ document: await present(replay), replayed: true });
    }
    key = await uploadFile(
      req.file.buffer,
      `restaurants/${r.id}/staff-documents/${target}`,
      req.file.originalname || "document",
      req.file.detectedMime || req.file.mimetype,
    );
    if (!key) throw new AppError("Upload failed", 502, "upload_failed");
    const staged = key;
    const document = await withTransaction(
      pool,
      async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`document:${r.id}:${req.user.id}:${identity}`],
        );
        await authorizeTarget(r, req.user.id, target, client);
        const {
          rows: [existing],
        } = await client.query(
          "SELECT * FROM restaurant_staff_documents WHERE restaurant_id=$1 AND uploaded_by=$2 AND idempotency_key=$3",
          [r.id, req.user.id, identity],
        );
        if (existing) {
          if (existing.request_hash !== hash || existing.deleted_at)
            throw new AppError(
              "Document retry conflicts",
              409,
              "idempotency_conflict",
            );
          return existing;
        }
        const {
          rows: [created],
        } = await client.query(
          `INSERT INTO restaurant_staff_documents(restaurant_id,user_id,doc_type,title,storage_key,original_filename,content_type,size_bytes,issued_on,expires_on,uploaded_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            r.id,
            target,
            b.docType,
            title,
            staged,
            req.file.originalname || null,
            req.file.detectedMime || req.file.mimetype,
            req.file.buffer.length,
            d.issuedOn,
            d.expiresOn,
            req.user.id,
            identity,
            hash,
          ],
        );
        await audit(client, req, r, "uploaded", null, created);
        return created;
      },
      "restaurant_document_upload",
    );
    if (document.storage_key === key) key = null;
    else {
      await discard(key);
      key = null;
    }
    res.status(201).json({ document: await present(document) });
  } catch (error) {
    await discard(key);
    next(error);
  }
};
exports.verifyDocument = async (req, res, next) => {
  try {
    const r = await access(req, true),
      id = v.integer(req.params.documentId, "documentId"),
      b = req.body || {};
    if (
      b.verificationStatus !== undefined &&
      !STATUSES.includes(b.verificationStatus)
    )
      v.invalid("verificationStatus");
    const document = await withTransaction(
      pool,
      async (client) => {
        const {
          rows: [before],
        } = await client.query(
          "SELECT * FROM restaurant_staff_documents WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [id, r.id],
        );
        if (!before)
          throw new AppError("Document not found", 404, "document_not_found");
        await assertStaff(r, before.user_id, client);
        const stored = (value) =>
          value && typeof value.toISOString === "function"
            ? value.toISOString().slice(0, 10)
            : value;
        const d = dates(
          b.issuedOn === undefined ? stored(before.issued_on) : b.issuedOn,
          b.expiresOn === undefined ? stored(before.expires_on) : b.expiresOn,
        );
        const status = b.verificationStatus || before.verification_status;
        const {
          rows: [after],
        } = await client.query(
          `UPDATE restaurant_staff_documents SET verification_status=$3::text,verified_by=CASE WHEN $3::text='verified' THEN $4::uuid ELSE NULL END,verified_at=CASE WHEN $3::text='verified' THEN NOW() ELSE NULL END,issued_on=$5,expires_on=$6,expiry_alert_sent_at=CASE WHEN expires_on IS DISTINCT FROM $6::date THEN NULL ELSE expiry_alert_sent_at END,updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 RETURNING *`,
          [id, r.id, status, req.user.id, d.issuedOn, d.expiresOn],
        );
        await audit(client, req, r, "reviewed", before, after);
        return after;
      },
      "restaurant_document_review",
    );
    res.json({ document: await present(document) });
  } catch (error) {
    next(error);
  }
};
exports.deleteDocument = async (req, res, next) => {
  try {
    const r = await access(req, true),
      id = v.integer(req.params.documentId, "documentId");
    await withTransaction(
      pool,
      async (client) => {
        const {
          rows: [before],
        } = await client.query(
          "SELECT * FROM restaurant_staff_documents WHERE id=$1 AND restaurant_id=$2 FOR UPDATE",
          [id, r.id],
        );
        if (!before)
          throw new AppError("Document not found", 404, "document_not_found");
        await assertStaff(r, before.user_id, client);
        if (before.deleted_at) return;
        if (
          !(await enqueueStorageDeletion(
            before.storage_key,
            "restaurant-document-deleted",
            { client, graceHours: 0 },
          ))
        )
          throw new AppError(
            "Could not queue file cleanup",
            503,
            "storage_unavailable",
          );
        const {
          rows: [after],
        } = await client.query(
          "UPDATE restaurant_staff_documents SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",
          [id],
        );
        await audit(client, req, r, "deleted", before, after);
      },
      "restaurant_document_delete",
    );
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
};
exports.acknowledgeSop = async (req, res, next) => {
  let key = null,
    newAck = false;
  try {
    const r = await access(req),
      id = v.integer(req.params.sopId, "sopId"),
      version = v.integer(req.body?.sopVersion, "sopVersion");
    if (req.file?.buffer?.length) {
      const bytes = req.file.buffer;
      if (bytes.length > 2 * 1024 * 1024)
        throw new AppError("Signature too large", 413, "signature_too_large");
      if (
        bytes.length < 8 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new AppError("PNG signature required", 400, "invalid_signature");
      key = await uploadFile(
        bytes,
        `restaurants/${r.id}/sop-signatures/${req.user.id}`,
        `signature-sop${id}-v${version}.png`,
        "image/png",
      );
      if (!key)
        throw new AppError("Signature upload failed", 502, "upload_failed");
    }
    const staged = key;
    const acknowledgement = await withTransaction(
      pool,
      async (client) => {
        const {
          rows: [sop],
        } = await client.query(
          "SELECT * FROM restaurant_sops WHERE id=$1 AND restaurant_id=$2 AND is_published=TRUE AND archived_at IS NULL FOR SHARE",
          [id, r.id],
        );
        if (!sop) throw new AppError("SOP not found", 404, "sop_not_found");
        if (sop.version !== version)
          throw new AppError(
            "SOP changed; review the current version",
            409,
            "sop_version_conflict",
          );
        await client.query(
          "INSERT INTO restaurant_sop_versions(sop_id,version,title,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [id, version, sop.title, sop.body],
        );
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`sop-sign:${id}:${req.user.id}:${version}`],
        );
        const {
          rows: [existing],
        } = await client.query(
          "SELECT * FROM restaurant_sop_acknowledgements WHERE sop_id=$1 AND user_id=$2 AND sop_version=$3 FOR UPDATE",
          [id, req.user.id, version],
        );
        if (existing) {
          if (staged && !existing.signature_storage_key) {
            const {
              rows: [upgraded],
            } = await client.query(
              "UPDATE restaurant_sop_acknowledgements SET signature_storage_key=$1 WHERE id=$2 AND signature_storage_key IS NULL RETURNING *",
              [staged, existing.id],
            );
            return upgraded || existing;
          }
          return existing;
        }
        newAck = true;
        return (
          await client.query(
            "INSERT INTO restaurant_sop_acknowledgements(restaurant_id,sop_id,user_id,sop_version,signature_storage_key) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [r.id, id, req.user.id, version, staged],
          )
        ).rows[0];
      },
      "restaurant_sop_sign",
    );
    if (acknowledgement.signature_storage_key === key) key = null;
    else {
      await discard(key);
      key = null;
    }
    res.status(newAck ? 201 : 200).json({ acknowledgement });
  } catch (error) {
    await discard(key);
    next(error);
  }
};
exports.listSopAcknowledgements = async (req, res, next) => {
  try {
    const r = await access(req),
      p = page(req.query),
      params = [r.id];
    let where = "ack.restaurant_id=$1";
    if (!r.documentManager) {
      params.push(req.user.id);
      where += ` AND ack.user_id=$${params.length}`;
    }
    where += staffPredicate(r, "ack.user_id", params);
    if (req.query.sopId !== undefined) {
      params.push(v.integer(req.query.sopId, "sopId"));
      where += ` AND ack.sop_id=$${params.length}`;
    }
    params.push(p.limit + 1, p.offset);
    const { rows } = await pool.query(
      `SELECT ack.*,s.title AS sop_title,s.version AS sop_current_version,u.first_name,u.last_name,(ack.sop_version=s.version) AS is_current,sv.body AS signed_body,sv.title AS signed_title FROM restaurant_sop_acknowledgements ack JOIN restaurant_sops s ON s.id=ack.sop_id JOIN users u ON u.id=ack.user_id LEFT JOIN restaurant_sop_versions sv ON sv.sop_id=ack.sop_id AND sv.version=ack.sop_version WHERE ${where} ORDER BY ack.acknowledged_at DESC,ack.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const acknowledgements = [];
    for (const row of rows.slice(0, p.limit)) {
      const { signature_storage_key, ...rest } = row;
      acknowledgements.push({
        ...rest,
        is_mine: row.user_id === req.user.id,
        signature_url: signature_storage_key
          ? await getSignedDownloadUrl(signature_storage_key, 600).catch(
              () => null,
            )
          : null,
      });
    }
    res.json({ acknowledgements, ...p, hasMore: rows.length > p.limit });
  } catch (error) {
    next(error);
  }
};
exports.docTypes = DOC_TYPES;
