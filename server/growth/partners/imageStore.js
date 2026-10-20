"use strict";

// Partner images are fetched once, scanned, and stored under OxSteed's
// public catalog prefix. The original partner URL never reaches a product
// response, email, or browser bundle.
const feedFetch = require("./feedFetch");
const { scanBuffer } = require("../../services/fileScanService");
const { uploadFile, getPublicUrl } = require("../../utils/storage");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: ".jpg", signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/png", { extension: ".png", signature: (b) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) }],
  ["image/gif", { extension: ".gif", signature: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")) }],
  ["image/webp", { extension: ".webp", signature: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" }],
  ["image/avif", { extension: ".avif", signature: (b) => b.subarray(4, 12).toString("ascii").includes("avif") }],
]);

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function detectImageType(body, declared) {
  const normalized = String(declared || "").split(";", 1)[0].trim().toLowerCase();
  for (const [contentType, spec] of IMAGE_TYPES) {
    if (spec.signature(body) && (!normalized || normalized === contentType)) {
      return { contentType, extension: spec.extension };
    }
  }
  return null;
}

async function storePartnerImage(rawUrl, options = {}) {
  if (!rawUrl) return null;
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Error("partner_image_url_invalid");
  }
  const fetch = options.fetchImage || feedFetch.fetchFeed;
  const result = await fetch(parsed.href, {
    allowedHosts: options.allowedHosts,
    lookup: options.lookup,
    transport: options.transport,
    maxBytes: Math.min(Number(options.maxBytes) || MAX_IMAGE_BYTES, MAX_IMAGE_BYTES),
    timeoutMs: options.timeoutMs,
  });
  const body = result && result.body;
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_IMAGE_BYTES) throw new Error("partner_image_invalid_body");
  const imageType = detectImageType(body, headerValue(result.headers, "content-type"));
  if (!imageType) throw new Error("partner_image_type_invalid");
  const verdict = await (options.scan || scanBuffer)(body);
  if (!verdict || verdict.clean !== true) throw new Error("partner_image_malware_detected");
  const key = await (options.upload || uploadFile)(body, "partner-products", `image${imageType.extension}`, imageType.contentType);
  if (!key) throw new Error("partner_image_storage_failed");
  return {
    key,
    url: (options.publicUrl || getPublicUrl)(key),
    contentType: imageType.contentType,
    bytes: body.length,
  };
}

module.exports = { MAX_IMAGE_BYTES, detectImageType, storePartnerImage };
