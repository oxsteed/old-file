// Pure helpers for the customer food-ordering journey. Kept free of JSX and
// network access so the exact conditions the pages enforce are unit-testable
// with node:test; the server remains the authority and re-validates
// everything (coordinates, required modifiers, reorder contents).

// Delivery address the server accepts (normalizeDeliveryAddress): the
// customer's own city/state/zip/instructions plus the autocomplete
// coordinates. Coordinates must ride along, or radius-limited restaurants
// reject both the quote and the order with delivery_coordinates_required.
export function buildDeliveryAddress({
  line1 = '',
  line2 = '',
  city = '',
  state = '',
  zip = '',
  country = '',
  instructions = '',
  lat = null,
  lng = null,
} = {}) {
  const trimmed = (value) => {
    const text = String(value ?? '').trim();
    return text || undefined;
  };
  const finiteOrNull = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    line1: trimmed(line1),
    line2: trimmed(line2),
    city: trimmed(city),
    state: trimmed(state),
    zip: trimmed(zip),
    country: trimmed(country),
    instructions: trimmed(instructions),
    lat: lat == null || lat === '' ? null : finiteOrNull(lat),
    lng: lng == null || lng === '' ? null : finiteOrNull(lng),
  };
}

// True when the menu item carries at least one required modifier group, in
// which case quick-add must open the modifier modal instead of sending an
// empty modifier list the server will reject.
export function itemHasRequiredModifierGroup(item) {
  const groups = item?.modifierGroups || item?.modifier_groups || [];
  return groups.some((group) => group?.isRequired || group?.is_required);
}

function modifierOptionsById(item) {
  const map = new Map();
  const groups = item?.modifierGroups || item?.modifier_groups || [];
  for (const group of groups) {
    for (const option of group?.options || []) {
      if (option?.id != null) {
        map.set(String(option.id), {
          id: option.id,
          name: option.name,
          priceDeltaCents: Number(option.priceDeltaCents ?? option.price_delta_cents ?? 0) || 0,
        });
      }
    }
  }
  return map;
}

// Rebuild cart lines from a past order against the current menu. Modifiers
// and notes are carried only when the modifier still exists on the current
// menu item; anything dropped is reported so the page can warn instead of
// silently losing a paid customization. Returns { lines, skipped, dropped }.
export function buildReorderLines(pastItems, menuById) {
  const lines = [];
  let skipped = 0;
  const dropped = [];
  for (const item of Array.isArray(pastItems) ? pastItems : []) {
    const menuItemId = item?.menuItemId ?? item?.menu_item_id;
    const menuItem = menuItemId != null ? menuById.get(String(menuItemId)) : null;
    if (!menuItem || menuItem.canOrder === false) {
      skipped += 1;
      continue;
    }
    const optionsById = modifierOptionsById(menuItem);
    const pastIds = item?.modifierIds ?? item?.modifier_ids ?? [];
    const pastNames = item?.modifierNames ?? item?.modifier_names ?? [];
    const carriedIds = [];
    const carriedNames = [];
    let modifierCents = 0;
    (Array.isArray(pastIds) ? pastIds : []).forEach((id, index) => {
      const current = optionsById.get(String(id));
      if (current) {
        carriedIds.push(current.id);
        carriedNames.push(current.name);
        modifierCents += current.priceDeltaCents;
      } else {
        dropped.push(pastNames[index] || String(id));
      }
    });
    const notes = item?.specialInstructions ?? item?.special_instructions ?? item?.notes ?? '';
    lines.push({
      id: `${menuItem.id}::reorder::${carriedIds.join(',')}::${String(notes || '').trim()}`,
      menuItemId: menuItem.id,
      name: menuItem.name,
      creditCategory: menuItem.sectionName || menuItem.category_name || menuItem.category || null,
      unitCents: (Number(menuItem.price_cents) || 0) + modifierCents,
      qty: Number(item?.quantity || 1) || 1,
      photoGrad: menuItem.photoGrad,
      image: menuItem.image_url || null,
      notes: String(notes || '').trim(),
      modifierIds: carriedIds,
      modifierNames: carriedNames,
    });
  }
  return { lines, skipped, dropped };
}

// Public tracking receipt: the server sends itemName/lineTotalCents (never
// name/price_cents), so read those first and only fall back to the legacy
// fields for rows that predate the contract.
export function trackedItemDisplay(item) {
  const quantity = Number(item?.quantity || 0);
  const name = item?.itemName ?? item?.name ?? '';
  const lineTotalCents = item?.lineTotalCents ?? item?.line_total_cents
    ?? (Number(item?.price_cents || 0) * quantity);
  return { name, quantity, lineTotalCents: Number(lineTotalCents) || 0 };
}

export function formatTrackedMoney(cents, currencyCode = 'USD', language) {
  return new Intl.NumberFormat(language || undefined, {
    style: 'currency',
    currency: currencyCode || 'USD',
  }).format(Number(cents || 0) / 100);
}
