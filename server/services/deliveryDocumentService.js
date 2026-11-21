'use strict';

// Group 9 Slice F (item 489): the authorized document list.
//
// Proof download was participant-gated with a 120-second signed URL
// and item photos with a 3600-second one, but neither had a list or a
// download UI: the detail page named proofs without linking them and
// public tracking showed no documents at all. This service builds the
// one list both surfaces read, reusing exactly those two signed-URL
// paths, TTLs, and gates. It widens nothing: the caller must already
// have established the reader is authorized for the job (participant
// check for the signed-in list, resolved tracking token for the public
// page — D-82). A proof with no stored object (PIN or recipient
// confirmation) lists with url null, so the UI can name it without
// offering a download that cannot exist.

const { getSignedDownloadUrl } = require('../utils/storage');

const PROOF_URL_TTL_SECONDS = 120;
const ITEM_PHOTO_URL_TTL_SECONDS = 3600;

async function listJobDocuments(db, jobId) {
  const [proofs, photos] = await Promise.all([
    db.query(
      `SELECT id, proof_type, verification_status, verified_at, created_at,
              recipient_name, object_key
         FROM delivery_proofs WHERE delivery_job_id = $1 ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
    db.query(
      `SELECT id, object_key, content_type, size_bytes, created_at
         FROM delivery_job_item_photos WHERE delivery_job_id = $1 ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
  ]);

  const documents = [];
  for (const proof of proofs.rows) {
    documents.push({
      kind: 'proof', id: proof.id, proofType: proof.proof_type,
      verificationStatus: proof.verification_status,
      verifiedAt: proof.verified_at, createdAt: proof.created_at,
      recipientName: proof.recipient_name,
      contentType: null, sizeBytes: null,
      url: proof.object_key && proof.verification_status === 'verified'
        ? await getSignedDownloadUrl(proof.object_key, PROOF_URL_TTL_SECONDS).catch(() => null)
        : null,
    });
  }
  for (const photo of photos.rows) {
    documents.push({
      kind: 'item_photo', id: photo.id, proofType: null,
      verificationStatus: null, verifiedAt: null, createdAt: photo.created_at,
      recipientName: null,
      contentType: photo.content_type, sizeBytes: photo.size_bytes,
      url: await getSignedDownloadUrl(photo.object_key, ITEM_PHOTO_URL_TTL_SECONDS).catch(() => null),
    });
  }
  documents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return documents;
}

module.exports = { listJobDocuments, PROOF_URL_TTL_SECONDS, ITEM_PHOTO_URL_TTL_SECONDS };
