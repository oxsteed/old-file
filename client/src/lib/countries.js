/**
 * Shared international helpers.
 *
 * Single source of truth for country / region / postal-code metadata across
 * the entire client. Mirrors `server/utils/countries.js` - keep them in sync.
 *
 * The seed data was extracted from the consultation-intake page and extended
 * with postal-code conventions, dial codes, and default currencies.
 */

// ── Countries with predefined regions ───────────────────────────────────────
// Region codes/labels match the consultation-intake form for backwards compat.
export const COUNTRIES_WITH_REGIONS = {
  US: {
    name: 'United States',
    regionLabel: 'State',
    regions: ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'],
  },
  CA: {
    name: 'Canada',
    regionLabel: 'Province',
    regions: ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'],
  },
  AU: {
    name: 'Australia',
    regionLabel: 'State',
    regions: ['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'],
  },
  IN: {
    name: 'India',
    regionLabel: 'State',
    regions: ['AN','AP','AR','AS','BR','CG','CH','CT','DD','DL','DN','GA','GJ','HR','HP','JK','JH','KA','KL','LD','MP','MH','MN','ML','MZ','NL','OD','OR','PB','RJ','SK','TG','TR','TN','UP','UT','WB'],
  },
  GB: {
    name: 'United Kingdom',
    regionLabel: 'Region',
    regions: ['England','Scotland','Wales','Northern Ireland'],
  },
  DE: {
    name: 'Germany',
    regionLabel: 'State',
    regions: ['Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse','Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate','Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia'],
  },
  FR: {
    name: 'France',
    regionLabel: 'Region',
    regions: ['Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté','Brittany','Centre-Val de Loire','Corsica','Grand Est','Guadeloupe','Guiana','Hauts-de-France','Île-de-France','La Réunion','Martinique','Mayotte','Normandy','Nouvelle-Aquitaine',"Occitanie",'Pays de la Loire',"Provence-Alpes-Côte d'Azur"],
  },
};

// ── Countries served by the platform ────────────────────────────────────────
// Excludes countries under US sanctions. Expand as the platform launches in
// new markets - the existing `users.country` column is just an ISO-2 string
// so adding entries here is the only required step.
const COUNTRIES_WITHOUT_REGIONS_NAMES = {
  AR: 'Argentina',
  AT: 'Austria',
  BE: 'Belgium',
  BR: 'Brazil',
  CH: 'Switzerland',
  CL: 'Chile',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CZ: 'Czech Republic',
  DK: 'Denmark',
  DO: 'Dominican Republic',
  EC: 'Ecuador',
  EG: 'Egypt',
  ES: 'Spain',
  FI: 'Finland',
  GR: 'Greece',
  HK: 'Hong Kong',
  HT: 'Haiti',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  MX: 'Mexico',
  MY: 'Malaysia',
  NG: 'Nigeria',
  NZ: 'New Zealand',
  PA: 'Panama',
  PE: 'Peru',
  PH: 'Philippines',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SA: 'Saudi Arabia',
  SE: 'Sweden',
  SG: 'Singapore',
  TH: 'Thailand',
  TR: 'Turkey',
  VN: 'Vietnam',
  ZA: 'South Africa',
};

export const ALL_COUNTRIES = {
  ...Object.fromEntries(
    Object.entries(COUNTRIES_WITH_REGIONS).map(([code, data]) => [code, data.name])
  ),
  ...COUNTRIES_WITHOUT_REGIONS_NAMES,
};

export const COUNTRY_CODES_SORTED = Object.keys(ALL_COUNTRIES).sort((a, b) =>
  ALL_COUNTRIES[a].localeCompare(ALL_COUNTRIES[b])
);

// ── Postal-code conventions ─────────────────────────────────────────────────
// Each entry: label shown to the user, regex used for validation (or null
// when the country has no widely-used postal code), and example placeholder.
const POSTAL_RULES = {
  US: { label: 'ZIP code',  regex: /^\d{5}(-\d{4})?$/,                     example: '94110' },
  CA: { label: 'Postal code', regex: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, example: 'M5V 3L9' },
  GB: { label: 'Postcode',  regex: /^[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}$/i, example: 'EC1A 1BB' },
  AU: { label: 'Postcode',  regex: /^\d{4}$/,                              example: '2000' },
  IN: { label: 'PIN code',  regex: /^\d{6}$/,                              example: '110001' },
  DE: { label: 'Postleitzahl', regex: /^\d{5}$/,                           example: '10115' },
  FR: { label: 'Code postal', regex: /^\d{5}$/,                            example: '75001' },
  JP: { label: '郵便番号', regex: /^\d{3}-?\d{4}$/,                         example: '100-0001' },
  BR: { label: 'CEP',       regex: /^\d{5}-?\d{3}$/,                       example: '01310-100' },
  MX: { label: 'CP',        regex: /^\d{5}$/,                              example: '06000' },
  IT: { label: 'CAP',       regex: /^\d{5}$/,                              example: '00100' },
  ES: { label: 'Código postal', regex: /^\d{5}$/,                          example: '28001' },
  NL: { label: 'Postcode',  regex: /^\d{4}\s?[A-Z]{2}$/i,                  example: '1011 AC' },
  PT: { label: 'Código postal', regex: /^\d{4}-\d{3}$/,                    example: '1000-001' },
  SE: { label: 'Postnummer', regex: /^\d{3}\s?\d{2}$/,                     example: '111 22' },
  CH: { label: 'PLZ',       regex: /^\d{4}$/,                              example: '8001' },
  AT: { label: 'PLZ',       regex: /^\d{4}$/,                              example: '1010' },
  BE: { label: 'Postcode',  regex: /^\d{4}$/,                              example: '1000' },
  IE: { label: 'Eircode',   regex: /^[A-Z]\d{2}\s?[A-Z\d]{4}$/i,           example: 'D02 X285' },
  PL: { label: 'Kod pocztowy', regex: /^\d{2}-\d{3}$/,                     example: '00-001' },
  CZ: { label: 'PSČ',       regex: /^\d{3}\s?\d{2}$/,                      example: '110 00' },
  // No mandatory postal code - we still allow free text but skip validation.
  HT: { label: 'Postal code (optional)', regex: null,                      example: 'HT6110' },
  HK: { label: 'Postal code (optional)', regex: null,                      example: '' },
};

// ── Phone dial codes & default currency by country ─────────────────────────
const COUNTRY_META = {
  US: { dial: '1',    currency: 'USD' },
  CA: { dial: '1',    currency: 'CAD' },
  GB: { dial: '44',   currency: 'GBP' },
  AU: { dial: '61',   currency: 'AUD' },
  IN: { dial: '91',   currency: 'INR' },
  DE: { dial: '49',   currency: 'EUR' },
  FR: { dial: '33',   currency: 'EUR' },
  ES: { dial: '34',   currency: 'EUR' },
  IT: { dial: '39',   currency: 'EUR' },
  NL: { dial: '31',   currency: 'EUR' },
  BE: { dial: '32',   currency: 'EUR' },
  IE: { dial: '353',  currency: 'EUR' },
  AT: { dial: '43',   currency: 'EUR' },
  PT: { dial: '351',  currency: 'EUR' },
  GR: { dial: '30',   currency: 'EUR' },
  FI: { dial: '358',  currency: 'EUR' },
  SE: { dial: '46',   currency: 'SEK' },
  DK: { dial: '45',   currency: 'DKK' },
  CH: { dial: '41',   currency: 'CHF' },
  PL: { dial: '48',   currency: 'PLN' },
  CZ: { dial: '420',  currency: 'CZK' },
  HU: { dial: '36',   currency: 'HUF' },
  RO: { dial: '40',   currency: 'RON' },
  BR: { dial: '55',   currency: 'BRL' },
  MX: { dial: '52',   currency: 'MXN' },
  AR: { dial: '54',   currency: 'ARS' },
  CL: { dial: '56',   currency: 'CLP' },
  CO: { dial: '57',   currency: 'COP' },
  CR: { dial: '506',  currency: 'CRC' },
  DO: { dial: '1',    currency: 'DOP' },
  EC: { dial: '593',  currency: 'USD' },
  PA: { dial: '507',  currency: 'PAB' },
  PE: { dial: '51',   currency: 'PEN' },
  HT: { dial: '509',  currency: 'HTG' },
  JP: { dial: '81',   currency: 'JPY' },
  KR: { dial: '82',   currency: 'KRW' },
  HK: { dial: '852',  currency: 'HKD' },
  SG: { dial: '65',   currency: 'SGD' },
  MY: { dial: '60',   currency: 'MYR' },
  TH: { dial: '66',   currency: 'THB' },
  ID: { dial: '62',   currency: 'IDR' },
  PH: { dial: '63',   currency: 'PHP' },
  VN: { dial: '84',   currency: 'VND' },
  EG: { dial: '20',   currency: 'EGP' },
  IL: { dial: '972',  currency: 'ILS' },
  SA: { dial: '966',  currency: 'SAR' },
  TR: { dial: '90',   currency: 'TRY' },
  NG: { dial: '234',  currency: 'NGN' },
  ZA: { dial: '27',   currency: 'ZAR' },
  NZ: { dial: '64',   currency: 'NZD' },
};

// ── Public helpers ──────────────────────────────────────────────────────────

export function getRegionLabel(code) {
  return COUNTRIES_WITH_REGIONS[code]?.regionLabel || 'City';
}

export function getRegionsFor(code) {
  return COUNTRIES_WITH_REGIONS[code]?.regions || null;
}

export function hasRegions(code) {
  return Array.isArray(COUNTRIES_WITH_REGIONS[code]?.regions);
}

export function getPostalLabel(code) {
  return POSTAL_RULES[code]?.label || 'Postal code';
}

export function getPostalRegex(code) {
  return POSTAL_RULES[code]?.regex ?? null;
}

export function getPostalExample(code) {
  return POSTAL_RULES[code]?.example || '';
}

export function hasPostalCode(code) {
  return code != null && code in POSTAL_RULES;
}

export function getDefaultCurrency(code) {
  return COUNTRY_META[code]?.currency || 'USD';
}

export function getDialCode(code) {
  return COUNTRY_META[code]?.dial || '';
}

export function getCountryName(code) {
  return ALL_COUNTRIES[code] || code || '';
}

/**
 * Best-effort browser-locale → ISO country code resolver.
 * Returns null if we cannot confidently identify a supported country.
 */
export function detectCountryFromLocale(fallback = 'US') {
  if (typeof navigator === 'undefined') return fallback;
  const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  for (const lang of langs) {
    const parts = lang.replace('_', '-').split('-');
    const region = parts[1]?.toUpperCase();
    if (region && region in ALL_COUNTRIES) return region;
  }
  return fallback;
}

/**
 * Validate a postal code against the country's regex. Returns true when
 * either the country has no postal code requirement OR the value matches.
 */
export function isValidPostal(country, value) {
  const rule = POSTAL_RULES[country];
  if (!rule) return true;            // unknown country → permissive
  if (rule.regex == null) return true; // postal code optional in this country
  return rule.regex.test(String(value || '').trim());
}

export const SUPPORTED_COUNTRIES = COUNTRY_CODES_SORTED;
