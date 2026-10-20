"use strict";
// Partner feed parsing and normalization (spec 13.3).
//
// Prices ALWAYS come from the feed. Parsing is exact string math: a feed
// price is a decimal amount in major units with at most two fraction digits
// (the catalog stores integer minor units, price_cents). Anything else is
// rejected per-item, never rounded silently and never invented.

const CANONICAL_FIELDS = [
  "id",
  "name",
  "description",
  "price",
  "currency",
  "url",
  "image_url",
  "category",
  "brand",
  "gtin",
  "availability",
  "country",
];

// Minimal RFC 4180 CSV reader: quoted fields, escaped quotes, CRLF/LF.
function parseCsvRows(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  const src = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])),
  );
}

function parseJsonFeed(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object")
    for (const key of ["items", "products", "entries", "results", "feed"])
      if (Array.isArray(data[key])) return data[key];
  throw new Error("feed_json_shape");
}

function firstArray(value, keys, depth = 0) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || depth > 6) return null;
  for (const key of keys) {
    const child = value[key];
    if (Array.isArray(child)) return child;
    // A feed with exactly one entry parses to a bare object, not an array.
    if (child && typeof child === "object") return [child];
  }
  for (const key of Object.keys(value)) {
    const found = firstArray(value[key], keys, depth + 1);
    if (found) return found;
  }
  return null;
}

// Google Merchant feeds prefix product attributes with "g:". Strip the
// prefix so one field mapping serves every format.
function stripNamespace(record) {
  if (!record || typeof record !== "object") return record;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    const clean = key.includes(":") ? key.split(":").pop() : key;
    out[clean] = value && typeof value === "object" && "#text" in value ? value["#text"] : value;
  }
  return out;
}

function parseXmlFeed(text, format) {
  // fast-xml-parser ships with the AWS SDK dependency tree; load lazily so a
  // missing module fails the run loudly instead of breaking server boot.
  const { XMLParser } = require("fast-xml-parser");
  const doc = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
  }).parse(String(text));
  const items = firstArray(doc, ["item", "product", "entry", "offer"]);
  if (!items) throw new Error("feed_xml_shape");
  return format === "google_merchant" ? items.map(stripNamespace) : items;
}

function parseFeed(body, format) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  if (format === "csv") return parseCsv(text);
  if (format === "json") return parseJsonFeed(text);
  if (format === "xml" || format === "google_merchant")
    return parseXmlFeed(text, format);
  throw new Error("feed_format_unsupported");
}

// "12.99" -> 1299, "12.99 USD" -> {1299, USD}, "1,299.00" -> 129900.
// Returns null for anything that is not an exact two-decimal amount.
function parsePriceToMinor(value) {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  let currency = null;
  const withCurrency = text.match(/^([\d.,]+)\s+([A-Z]{3})$/);
  if (withCurrency) {
    text = withCurrency[1];
    currency = withCurrency[2];
  }
  text = text.replace(/,/g, "");
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const minor =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return { minor, currency };
}

function readPath(record, path) {
  if (typeof path !== "string" || !path) return undefined;
  return path
    .split(".")
    .reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), record);
}

// field_mapping maps canonical field -> source field name (dot paths allowed
// for JSON). Unmapped canonical fields fall back to a same-named source field.
function mapRecord(record, fieldMapping = {}) {
  const out = {};
  for (const field of CANONICAL_FIELDS) {
    const source = fieldMapping[field] || field;
    const value = readPath(record, source);
    if (value !== undefined && value !== null && typeof value !== "object")
      out[field] = String(value).trim();
  }
  return out;
}

function parseAvailability(value) {
  if (value === undefined || value === null || value === "") return true;
  const v = String(value).trim().toLowerCase().replace(/\s+/g, "_");
  if (["in_stock", "instock", "available", "true", "1", "yes", "in-stock"].includes(v))
    return true;
  if (
    ["out_of_stock", "outofstock", "unavailable", "false", "0", "no", "out-of-stock", "discontinued"].includes(v)
  )
    return false;
  if (v === "preorder" || v === "pre_order") return true;
  return true;
}

// One feed record -> one catalog item, or {error} with a stable reason.
// Prices are never defaulted: a missing or unparseable price rejects the row.
function normalizeItem(record, fieldMapping = {}, defaults = {}) {
  const mapped = mapRecord(record, fieldMapping);
  const price = parsePriceToMinor(mapped.price);
  if (!mapped.id) return { error: "missing_id" };
  if (!mapped.name) return { error: "missing_name" };
  if (!price) return { error: "invalid_price" };
  // marketplace_products.price_cents is INTEGER; refuse absurd feed values.
  if (price.minor > 2147483647) return { error: "invalid_price" };
  const currency = (mapped.currency || price.currency || defaults.currency || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "invalid_currency" };
  let url = null;
  if (mapped.url) {
    try {
      const parsed = new URL(mapped.url);
      if (parsed.protocol !== "https:") return { error: "invalid_url" };
      url = parsed.href;
    } catch {
      return { error: "invalid_url" };
    }
  }
  let imageUrl = null;
  if (mapped.image_url) {
    try {
      const parsed = new URL(mapped.image_url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443")) {
        imageUrl = parsed.href;
      }
    } catch {
      // Invalid partner images are omitted; the product remains importable.
    }
  }
  const countryCodes = (mapped.country || "")
    .split(/[,\s]+/)
    .map((c) => c.toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return {
    item: {
      feedItemId: mapped.id.slice(0, 200),
      name: mapped.name.slice(0, 255),
      description: mapped.description ? mapped.description.slice(0, 5000) : null,
      priceCents: price.minor,
      currency,
      affiliateUrl: url,
      categoryPath: mapped.category ? mapped.category.slice(0, 500) : null,
      brand: mapped.brand ? mapped.brand.slice(0, 200) : null,
      gtin: mapped.gtin ? mapped.gtin.slice(0, 32) : null,
      available: parseAvailability(mapped.availability),
      countryCodes: countryCodes.length ? countryCodes : null,
      imageUrl,
      imageDeferred: Boolean(mapped.image_url && !imageUrl),
    },
  };
}

module.exports = {
  CANONICAL_FIELDS,
  parseCsv,
  parseCsvRows,
  parseJsonFeed,
  parseXmlFeed,
  parseFeed,
  parsePriceToMinor,
  mapRecord,
  parseAvailability,
  normalizeItem,
};
