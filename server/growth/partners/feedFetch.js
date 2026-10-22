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

// Expand an IPv6 literal to its eight 16-bit groups, numerically, so
// prefix checks cannot be dodged with zero padding or hex spellings
// (2001:0db8::, ::ffff:a00:1). An embedded dotted IPv4 tail becomes the
// last two groups. Returns null for anything unparseable.
function ipv6Groups(ip) {
  let value = String(ip).toLowerCase();
  let tail = [];
  const v4 = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const parts = v4[1].split(".").map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tail = [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
    value = value.slice(0, value.length - v4[1].length);
    if (value.endsWith(":") && !value.endsWith("::")) value = value.slice(0, -1);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (s) =>
    s === "" ? [] : s.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  const head = parse(halves[0]);
  const end = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...end].some((g) => !Number.isInteger(g))) return null;
  if (halves.length === 1) {
    const groups = [...head, ...tail];
    return groups.length === 8 ? groups : null;
  }
  const missing = 8 - (head.length + end.length + tail.length);
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill(0), ...end, ...tail];
}

function ipv6Public(ip) {
  const g = ipv6Groups(ip);
  if (!g) return false;
  if (g.every((n) => n === 0)) return false; // :: unspecified
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return false; // ::1 loopback
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast ff00::/8
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation 2001:db8::/32
  // Embedded IPv4 forms are judged by the IPv4 rules: v4-mapped
  // ::ffff:0:0/96, v4-compatible ::/96, and NAT64 64:ff9b::/96.
  const embedded = () => ipv4Public(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return embedded();
  if (g.slice(0, 6).every((n) => n === 0)) return embedded();
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0)
    return embedded();
  return true;
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
    return { body: result.body, finalUrl: url.href, headers: result.headers || {} };
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
