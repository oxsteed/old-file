"use strict";
const crypto = require("crypto");
function secret() {
  const s = process.env.GROWTH_LINK_SECRET;
  if (!s || s.length < 32) throw new Error("growth_links_not_configured");
  return s;
}
function mac(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest();
}
function sign(data) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}
function verify(token, now = Date.now()) {
  try {
    if (typeof token !== "string" || token.length > 2000) return null;
    const [body, sig, extra] = token.split(".");
    if (extra) return null;
    const actual = Buffer.from(sig, "base64url"),
      expected = mac(body);
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return Number.isFinite(data.exp) && data.exp > now ? data : null;
  } catch {
    return null;
  }
}
function destination(raw, domains, clickId) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !domains.includes(url.hostname.toLowerCase())
  )
    throw new Error("partner_destination_denied");
  // Only the random click id is appended. No user, email or segment identifier.
  url.searchParams.set("subid", clickId);
  return url.href;
}
module.exports = { sign, verify, destination };
