"use strict";
const crypto = require("crypto");
const { SignatureV4 } = require("@smithy/signature-v4");
const { Sha256 } = require("@aws-crypto/sha256-js");
const { HttpRequest } = require("@smithy/protocol-http");

const REGIONS = new Set(["us-east-1", "eu-west-1", "fe-east-1"]);
const HOST_RE = /^webservices\.amazon\.(?:com|ca|co\.uk|de|fr|it|es|co\.jp|in|com\.au|com\.mx)$/;
function config(env = process.env) {
  if (env.GROWTH_AMAZON_ENABLED !== "true") return null;
  const host = String(env.GROWTH_AMAZON_HOST || "").toLowerCase();
  const region = String(env.GROWTH_AMAZON_REGION || "");
  if (!HOST_RE.test(host) || !REGIONS.has(region) || !env.GROWTH_AMAZON_ACCESS_KEY_ID || !env.GROWTH_AMAZON_SECRET_ACCESS_KEY)
    throw new Error("amazon_associates_not_configured");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(env.GROWTH_AMAZON_ASSOCIATE_TAG || ""))
    throw new Error("amazon_associate_tag_invalid");
  return {
    host,
    region,
    associateTag: env.GROWTH_AMAZON_ASSOCIATE_TAG,
    accessKeyId: env.GROWTH_AMAZON_ACCESS_KEY_ID,
    secretAccessKey: env.GROWTH_AMAZON_SECRET_ACCESS_KEY,
  };
}

async function searchItems(keywords, { config: supplied, fetchImpl = global.fetch, trackingTag } = {}) {
  const cfg = supplied || config();
  if (!cfg) return { enabled: false, items: [] };
  if (typeof keywords !== "string" || !keywords.trim() || keywords.length > 120)
    throw new Error("amazon_keywords_invalid");
  const body = JSON.stringify({
    Keywords: keywords.trim(),
    PartnerTag: trackingTag || cfg.associateTag,
    PartnerType: "Associates",
    Resources: ["Images.Primary.Large", "ItemInfo.Title", "Offers.Listings.Price", "DetailPageURL"],
  });
  const request = new HttpRequest({
    protocol: "https:",
    hostname: cfg.host,
    method: "POST",
    path: "/paapi5/searchitems",
    headers: {
      host: cfg.host,
      "content-type": "application/json; charset=UTF-8",
      "x-amz-target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
    },
    body,
  });
  const signed = await new SignatureV4({
    service: "ProductAdvertisingAPI",
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    sha256: Sha256,
  }).sign(request);
  const response = await fetchImpl(`https://${cfg.host}${request.path}`, {
    method: "POST",
    headers: signed.headers,
    body,
  });
  if (!response.ok) throw new Error(`amazon_paapi_http_${response.status}`);
  const payload = await response.json();
  return { enabled: true, items: normalizeItems(payload) };
}

function normalizeItems(payload) {
  return (payload?.SearchResult?.Items || []).slice(0, 10).map((item) => ({
    asin: String(item.ASIN || ""),
    title: String(item.ItemInfo?.Title?.DisplayValue || "").slice(0, 500),
    url: String(item.DetailPageURL || ""),
    image: String(item.Images?.Primary?.Large?.URL || ""),
    price: item.Offers?.Listings?.[0]?.Price?.Amount ?? null,
    currency: item.Offers?.Listings?.[0]?.Price?.Currency ?? null,
  })).filter((item) => /^[A-Z0-9]{10}$/.test(item.asin) && /^https:\/\/(?:www\.)?amazon\./.test(item.url));
}

function parseReport(csv) {
  if (typeof csv !== "string" || csv.length > 20_000_000) throw new Error("amazon_report_invalid");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines.shift().split("\t");
  return lines.map((line) => Object.fromEntries(line.split("\t").map((value, i) => [header[i], value])));
}
function reportEvidence(reportRef, csv) {
  return { report_ref: reportRef, content_sha256: crypto.createHash("sha256").update(csv).digest("hex"), row_count: parseReport(csv).length };
}
function disclosure() {
  return "As an Amazon Associate, OxSteed earns from qualifying purchases.";
}

module.exports = { config, searchItems, normalizeItems, parseReport, reportEvidence, disclosure };
