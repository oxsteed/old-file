"use strict";
const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");
const ajv = new Ajv({ allErrors: false, strict: true });
const schemas = new Map();
const elementKeys = new Set(require("./elementKeys.json"));
for (const file of fs.readdirSync(path.join(__dirname, "schemas"))) {
  const schema = require(path.join(__dirname, "schemas", file));
  schemas.set(schema.$id, ajv.compile(schema));
}
function scrubQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/gu, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/gu, " ")
    .replace(
      /\b\d{1,6}\s+[\p{L}\s]{1,60}\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd)\b/giu,
      " ",
    )
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
function validateEvent(event, { domain = false, now = Date.now() } = {}) {
  if (
    !event ||
    Object.keys(event).some(
      (k) =>
        !["event_id", "name", "schema_ver", "occurred_at", "props"].includes(k),
    )
  )
    return null;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      event.event_id || "",
    )
  )
    return null;
  const client = /^(page|screen|ui|search|learn|media|profile|offer)\./.test(
    event.name,
  );
  if (client === domain || event.schema_ver !== 1) return null;
  const check = schemas.get(`${event.name}.v1`);
  const time = new Date(event.occurred_at).getTime();
  if (!Number.isFinite(time) || time > now + 300000 || time < now - 86400000)
    return null;
  if (!check || !check(event.props)) return null;
  if (
    event.props.element_key &&
    event.props.element_key !== "unlabeled" &&
    !elementKeys.has(event.props.element_key)
  )
    return null;
  const props = { ...event.props };
  if ("query_norm" in props) props.query_norm = scrubQuery(props.query_norm);
  return { ...event, occurred_at: new Date(time).toISOString(), props };
}
module.exports = { validateEvent, scrubQuery };
