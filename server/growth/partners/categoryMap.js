"use strict";
// Reviewed partner category mapping (spec 13.3).
//
// Mapping is rules-first and human-reviewed: partner_category_map rows are
// written only by an admin (or from an approved Ollama proposal in the
// taxonomy workflow). The resolver NEVER guesses: an exact reviewed rule
// wins, then a reviewed rule for a parent path ("Tools" covers
// "Tools > Plumbing > Wrenches"). Anything else stays unmapped so an admin
// can review it; unmapped products still import with their raw
// category_path, they just carry no taxonomy node.
function splitPath(categoryPath) {
  return String(categoryPath || "")
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveCategory(mappings, categoryPath) {
  if (!categoryPath || !Array.isArray(mappings)) return null;
  const byPath = new Map(mappings.map((m) => [m.category_path, m.node_id]));
  const parts = splitPath(categoryPath);
  for (let depth = parts.length; depth >= 1; depth--) {
    const candidate = parts.slice(0, depth).join(" > ");
    if (byPath.has(candidate))
      return {
        nodeId: byPath.get(candidate),
        matchedPath: candidate,
        via: depth === parts.length ? "exact" : "parent",
      };
  }
  return null;
}

module.exports = { resolveCategory, splitPath };
