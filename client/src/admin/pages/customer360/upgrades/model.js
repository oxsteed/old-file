// Pure helpers for the Customer 360 upgrade panels (tested in node --test).

/** Flatten an event's `changes` into display rows without inventing values. */
export function changeRows(changes) {
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes)
    // Payment rows annotate the customer's side as a plain `role` string and
    // backfilled rows carry a boolean marker; neither is a field change.
    .filter(([field, c]) => !(field === "role" && typeof c === "string") && field !== "backfilled")
    .map(([field, c]) => {
      if (c && typeof c === "object" && c.redacted) return { field, kind: "redacted" };
      if (c && typeof c === "object" && ("to" in c || "from" in c))
        return { field, kind: "value", from: c.from == null ? null : String(c.from), to: c.to == null ? null : String(c.to) };
      if (c && typeof c === "object" && c.changed) return { field, kind: "changed" };
      return { field, kind: "value", from: null, to: c == null ? null : String(c) };
    });
}

/** A translated label for an event type, falling back to a readable form. */
export function eventLabel(event, copy) {
  const type = String(event.event_type || "");
  const [prefix, ...rest] = type.split(".");
  const action = rest.join(".").replace(/[._]/g, " ");
  return copy(`events.types.${prefix}`, { action, defaultValue: type.replace(/[._]/g, " ") });
}
