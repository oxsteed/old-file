"use strict";
const crypto = require("crypto");
function key(kind, value, env = process.env) {
  if (!value) return "";
  const pepper = env.GROWTH_SUBJECT_PEPPER;
  if (!pepper || pepper.length < 32)
    throw new Error("growth_identity_not_configured");
  return crypto
    .createHmac("sha256", pepper)
    .update(`${kind}:${value}`)
    .digest("hex");
}
function ipHash(value, env = process.env) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return key("ip", trimmed, env);
}
function consentLock(subject) {
  if (!/^[a-f0-9]{64}$/.test(subject || ""))
    throw new Error("invalid_growth_subject_key");
  // Bound advisory-lock memory for 20k-row writer batches. Collisions only
  // serialize unrelated withdrawals; they can never grant permission.
  return `growth-consent-bucket:${parseInt(subject.slice(0, 3), 16) % 1024}`;
}
module.exports = { key, ipHash, consentLock };
