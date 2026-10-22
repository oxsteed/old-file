"use strict";
function validate(rules) {
  if (!Array.isArray(rules) || rules.length < 2 || rules.length > 500)
    throw new Error("invalid_jurisdiction_rules");
  const seen = new Set();
  for (const rule of rules) {
    if (
      !rule ||
      !/^(?:unknown|default|[A-Z]{2}(?:-[A-Z0-9]{1,8})?)$/.test(
        rule.code || "",
      ) ||
      seen.has(rule.code) ||
      !["notice", "consent"].includes(rule.activity_basis) ||
      !["notice", "consent"].includes(rule.offers_basis) ||
      typeof rule.sale_share_control !== "boolean" ||
      (rule.reviewed_at !== null &&
        !Number.isFinite(Date.parse(rule.reviewed_at)))
    )
      throw new Error("invalid_jurisdiction_rules");
    seen.add(rule.code);
  }
  const unknown = rules.find((r) => r.code === "unknown");
  if (
    !seen.has("default") ||
    unknown?.activity_basis !== "consent" ||
    unknown.offers_basis !== "consent" ||
    !unknown.sale_share_control
  )
    throw new Error("unknown_jurisdiction_must_fail_closed");
  return rules;
}
async function load(conn) {
  const {
    rows: [setting],
  } = await conn.query(
    "SELECT value FROM platform_settings WHERE key='growth.jurisdiction_rules'",
  );
  if (setting?.value) {
    const rules = JSON.parse(setting.value);
    if (rules.length) return validate(rules);
  }
  return (await conn.query("SELECT * FROM jurisdiction_rules")).rows;
}
module.exports = { validate, load };
