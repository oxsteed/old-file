"use strict";
function configurationErrors(env = process.env) {
  const errors = [];
  const requireSecret = (name) => {
    if (typeof env[name] !== "string" || env[name].length < 32)
      errors.push(`${name} must contain at least 32 characters`);
  };
  const collection = env.GROWTH_TRACKING_HARD_OFF === "false",
    campaigns = env.GROWTH_CAMPAIGN_DELIVERY_ENABLED === "true",
    notice = env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED === "true";
  if (collection || campaigns) requireSecret("GROWTH_SUBJECT_PEPPER");
  if (campaigns) requireSecret("GROWTH_LINK_SECRET");
  if (notice && !env.RESEND_API_KEY)
    errors.push("RESEND_API_KEY is required for policy notices");
  if (notice && !env.RESEND_WEBHOOK_SECRET)
    errors.push("RESEND_WEBHOOK_SECRET is required for notice evidence");
  if (collection) {
    if (env.GROWTH_TRUST_CLOUDFLARE !== "true")
      errors.push(
        "Growth collection requires verified origin-locked Cloudflare header trust",
      );
    if (!env.GROWTH_REDIS_URL)
      errors.push("GROWTH_REDIS_URL is required for collection");
    if (!env.GROWTH_CLICKHOUSE_URL)
      errors.push("GROWTH_CLICKHOUSE_URL is required for collection");
    for (const role of ["WRITER", "READER", "RIGHTS", "NIGHTLY"])
      for (const field of ["USER", "PASSWORD"]) {
        const name = `GROWTH_CLICKHOUSE_${role}_${field}`;
        if (!env[name]) errors.push(`${name} is required for collection`);
      }
  }
  if (env.GROWTH_CLICKHOUSE_URL)
    try {
      const url = new URL(env.GROWTH_CLICKHOUSE_URL);
      if (
        (url.protocol !== "https:" && env.NODE_ENV !== "test") ||
        url.username ||
        url.password ||
        url.search ||
        url.pathname !== "/"
      )
        errors.push(
          "GROWTH_CLICKHOUSE_URL must be a TLS origin without credentials or settings",
        );
    } catch {
      errors.push("GROWTH_CLICKHOUSE_URL is invalid");
    }
  for (const name of ["GROWTH_OLLAMA_URL"])
    if (
      env[name] &&
      !require("../services/supportChatProviders").resolveOllamaUrl(env[name])
    )
      errors.push(`${name} is not an approved self-hosted origin`);
  return errors;
}
module.exports = { configurationErrors };
