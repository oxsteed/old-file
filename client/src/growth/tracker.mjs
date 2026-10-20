export function uuidv7(now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 5, n = now; i >= 0; i--, n = Math.floor(n / 256))
    bytes[i] = n % 256;
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const SESSION_STORAGE_KEY = "oxsteed.session";
export const SESSION_IDLE_MS = 30 * 60 * 1000;
function parseStoredSession(raw) {
  try {
    const parsed = JSON.parse(raw || "");
    if (
      parsed &&
      typeof parsed.id === "string" &&
      /^[a-f0-9-]{36}$/i.test(parsed.id) &&
      Number.isFinite(parsed.last)
    )
      return parsed;
  } catch {}
  return null;
}
// Returns the persisted session id when one exists and has been active
// within the idle window; null otherwise. Never writes and never throws:
// sessionStorage can be unavailable (blocked cookies, private modes).
export function readSession(storage, now = Date.now()) {
  try {
    const stored = parseStoredSession(storage?.getItem(SESSION_STORAGE_KEY));
    if (stored && now - stored.last <= SESSION_IDLE_MS) return stored.id;
  } catch {}
  return null;
}
// Returns the live session id for an activity event, rotating to a fresh
// UUIDv7 after 30 minutes idle and persisting {id, last} so the session
// survives reloads within the same tab. Storage failures degrade to an
// unpersisted in-memory rotation and never throw.
export function touchSession(storage, now = Date.now()) {
  const existing = readSession(storage, now);
  const id = existing || uuidv7(now);
  try {
    storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id, last: now }));
  } catch {}
  return id;
}
export function routeTemplate(pathname, routes) {
  return (
    [...routes]
      .sort((a, b) => a.includes(":") - b.includes(":") || b.length - a.length)
      .find((route) => {
        const pattern = route
          .split("/")
          .map((part) =>
            part.startsWith(":")
              ? "[^/]+"
              : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/");
        return new RegExp(`^${pattern}/?$`).test(pathname);
      }) || null
  );
}
export function appendBounded(queue, event) {
  const next = [...queue, event];
  while (next.length > 200) {
    const i = next.findIndex((e) => e.name.startsWith("ui."));
    next.splice(i < 0 ? 0 : i, 1);
  }
  return next;
}
export function takeBatch(queue, metadata) {
  const events = [];
  for (const event of queue.slice(0, 20)) {
    const next = [...events, event];
    if (
      new TextEncoder().encode(JSON.stringify({ ...metadata, events: next }))
        .length > 64000
    )
      break;
    events.push(event);
  }
  return events;
}
export function scrubQuery(value) {
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
export function safeProps(name, props, fields, routes) {
  if (
    !fields[name] ||
    !props ||
    Array.isArray(props) ||
    Object.keys(props).some((k) => !fields[name].includes(k))
  )
    return null;
  if ("route" in props && !routes.includes(props.route)) return null;
  if (
    Object.values(props).some(
      (v) => !["string", "number", "boolean"].includes(typeof v),
    )
  )
    return null;
  const value = { ...props };
  if ("query_norm" in value) value.query_norm = scrubQuery(value.query_norm);
  return new TextEncoder().encode(JSON.stringify(value)).length <= 4096
    ? value
    : null;
}
