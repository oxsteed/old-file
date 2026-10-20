"use strict";
// SSRF-safe fetching for partner catalog feeds (spec 13.3).
//
// Boundaries enforced here, in order, for the initial URL and every redirect:
//   * HTTPS only, no embedded credentials, no non-default port.
//   * Host must be the configured feed host or on the partner allowlist.
//   * Every DNS answer must be a globally routable address (no private,
//     loopback, link-local, CGNAT, multicast or reserved ranges, and no
//     IPv4-mapped IPv6 smuggling). The validated address is pinned into the
//     request via a custom lookup so a rebind between check and connect
//     cannot substitute a private target.
//   * Response size cap and an overall deadline; redirects are re-validated.
const https = require("https");
const dns = require("dns");

const MAX_BYTES_DEFAULT = 25 * 1024 * 1024;
const TIMEOUT_MS_DEFAULT = 30000;
const MAX_REDIRECTS = 3;

function ipv4Public(ip) {
  const parts = String(ip).split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false; // "this" net, private, loopback
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 169 && b === 254) return false; // link-local
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT shared space
  if (a === 192 && b === 0) return false; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function ipv6Public(ip) {
  const value = String(ip).toLowerCase();
  if (value === "::1" || value === "::") return false;
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb"))
    return false; // link-local fe80::/10
  if (/^f[cd]/.test(value)) return false; // unique local fc00::/7
  if (value.startsWith("ff")) return false; // multicast
  if (value.startsWith("2001:db8:")) return false; // documentation
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Public(mapped[1]);
  if (value.includes(".")) return false; // any other embedded IPv4 form: refuse
  return value.includes(":");
}

function isPublicAddress(ip) {
  if (typeof ip !== "string") return false;
  return ip.includes(":") ? ipv6Public(ip) : ipv4Public(ip);
}

function assertSafeUrl(raw, allowedHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("feed_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("feed_url_not_https");
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) throw new Error("feed_host_not_allowed");
  return url;
}

async function lookupAll(host, lookup) {
  const fn =
    lookup ||
    ((hostname, options) =>
      new Promise((resolve, reject) =>
        dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) =>
          err ? reject(err) : resolve(addrs),
        ),
      ));
  const addresses = await fn(host, {});
  if (!Array.isArray(addresses) || !addresses.length)
    throw new Error("feed_dns_empty");
  for (const entry of addresses) {
    const address = typeof entry === "string" ? entry : entry.address;
    if (!isPublicAddress(address)) throw new Error("feed_dns_private");
  }
  return addresses.map((entry) =>
    typeof entry === "string" ? { address: entry, family: entry.includes(":") ? 6 : 4 } : entry,
  );
}

// Default transport: one HTTPS GET with the validated addresses pinned.
function httpsTransport(url, { addresses, maxBytes, deadline }) {
  return new Promise((resolve, reject) => {
    const pinned = (hostname, options, callback) => {
      const list = addresses.map((a) => ({ address: a.address, family: a.family }));
      if (options && options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    };
    const req = https.request(
      url,
      {
        method: "GET",
        lookup: pinned,
        servername: url.hostname,
        headers: { "user-agent": "OxSteedFeedImport/1.0", accept: "*/*" },
      },
      (res) => {
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error("feed_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(Math.max(1, deadline - Date.now()), () =>
      req.destroy(new Error("feed_timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}

async function fetchFeed(rawUrl, options = {}) {
  const {
    allowedHosts,
    maxBytes = MAX_BYTES_DEFAULT,
    timeoutMs = TIMEOUT_MS_DEFAULT,
    lookup,
    transport = httpsTransport,
  } = options;
  if (!Array.isArray(allowedHosts) || !allowedHosts.length)
    throw new Error("feed_host_not_allowed");
  const deadline = Date.now() + timeoutMs;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() > deadline) throw new Error("feed_timeout");
    const url = assertSafeUrl(current, allowedHosts);
    const addresses = await lookupAll(url.hostname, lookup);
    const result = await transport(url, { addresses, maxBytes, deadline });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers?.location || result.headers?.Location;
      if (!location || hop === MAX_REDIRECTS)
        throw new Error("feed_redirect_invalid");
      current = new URL(location, url).href;
      continue;
    }
    if (result.status !== 200) throw new Error(`feed_http_${result.status}`);
    if (!result.body || result.body.length > maxBytes)
      throw new Error("feed_too_large");
    return { body: result.body, finalUrl: url.href };
  }
  throw new Error("feed_redirect_invalid");
}

module.exports = {
  fetchFeed,
  assertSafeUrl,
  isPublicAddress,
  ipv4Public,
  ipv6Public,
  MAX_BYTES_DEFAULT,
};
