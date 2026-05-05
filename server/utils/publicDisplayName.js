/**
 * Public-facing display name from Settings → Profile → Display Name Preference.
 * Align with client: HelperDashboard.jsx / Dashboard.jsx / SettingsPage.
 */

function normalizePreference(pref) {
  const p = String(pref || 'first_name').toLowerCase();
  if (p === 'full_name' || p === 'first_name' || p === 'business_name') return p;
  return 'first_name';
}

/**
 * @param {object} row — expects display_name_preference, first_name, last_name, primary_business_name (optional)
 */
function resolvePublicDisplayName(row) {
  const pref = normalizePreference(row.display_name_preference);
  const fn = String(row.first_name || '').trim();
  const ln = String(row.last_name || '').trim();
  const full = [fn, ln].filter(Boolean).join(' ').trim();
  const biz = String(row.primary_business_name || '').trim();

  if (pref === 'business_name') {
    return biz || fn || full || 'OxSteed member';
  }
  if (pref === 'full_name') {
    return full || fn || biz || 'OxSteed member';
  }
  return fn || full || biz || 'OxSteed member';
}

module.exports = { resolvePublicDisplayName, normalizePreference };
