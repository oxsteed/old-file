'use strict';

/**
 * In-house fuzzy name matching for sanctions screening and payout-account
 * holder checks. No vendor: normalisation + Jaro-Winkler on tokens, with a
 * token-set score that tolerates reordered names ("CASTRO RUZ, Fidel" vs
 * "Fidel Castro Ruz"), missing middle names and transliteration noise.
 *
 * Scores are 0..1. Thresholds live with the callers (sanctions uses a
 * configurable review threshold; a holder-name check uses its own).
 */

const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'madam', 'mme', 'mlle', 'm', 'sr', 'sra', 'srta',
  'don', 'dona', 'sheikh', 'shaykh', 'haji', 'hajji', 'general', 'gen', 'col', 'colonel', 'capt', 'captain',
]);
// Particles that are often dropped or merged in transliteration.
const PARTICLES = new Set(['al', 'el', 'bin', 'ibn', 'bint', 'abu', 'de', 'del', 'della', 'da', 'di', 'du', 'la', 'le', 'van', 'von', 'der', 'den', 'y']);
const ENTITY_NOISE = new Set(['ltd', 'limited', 'llc', 'inc', 'corp', 'corporation', 'co', 'company', 'sa', 'sarl', 'srl', 'gmbh', 'ag', 'plc', 'jsc', 'ojsc', 'pjsc', 'ooo', 'zao', 'llp', 'lp', 'the']);

const LETTER_FOLD = Object.freeze({ 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ł': 'l', 'ı': 'i' });

function normalizeName(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  s = s.replace(/[ßæœøđðþłı]/g, (ch) => LETTER_FOLD[ch] || ch);
  s = s.replace(/['’`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  return s;
}

function tokens(value, { dropParticles = false, entity = false } = {}) {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t && !HONORIFICS.has(t) && !(dropParticles && PARTICLES.has(t)) && !(entity && ENTITY_NOISE.has(t)));
}

function jaro(a, b) {
  if (a === b) return a.length ? 1 : 0;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatch = new Array(la).fill(false);
  const bMatch = new Array(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i += 1) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, lb);
    for (let j = lo; j < hi; j += 1) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = true; bMatch[j] = true; matches += 1; break;
      }
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i += 1) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a, b, prefixScale = 0.1) {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] === b[i]) prefix += 1; else break;
  }
  return j + prefix * prefixScale * (1 - j);
}

// Best one-to-one token alignment, averaged over the SHORTER name so a
// missing middle name does not sink the score, then lightly penalised when
// the shorter name covers few of the longer name's tokens.
function tokenSetScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const [short, long] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  const used = new Set();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, idx) => {
      if (used.has(idx)) return;
      let s = jaroWinkler(t, u);
      // Initials: "j" vs "john".
      if (t.length === 1 && u.startsWith(t)) s = Math.max(s, 0.85);
      if (u.length === 1 && t.startsWith(u)) s = Math.max(s, 0.85);
      if (s > best) { best = s; bestIdx = idx; }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  const avg = total / short.length;
  const coverage = short.length / long.length;
  // A single-token name matching one token of a 4-token name is weak.
  const coveragePenalty = short.length === 1 && long.length > 1 ? 0.12 : (1 - coverage) * 0.08;
  return Math.max(0, avg - coveragePenalty);
}

/**
 * Similarity 0..1 between two names. `entity` drops company suffixes.
 */
function nameSimilarity(a, b, { entity = false } = {}) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const compactA = na.replace(/ /g, '');
  const compactB = nb.replace(/ /g, '');
  const whole = jaroWinkler(compactA, compactB);
  const full = tokenSetScore(tokens(a, { entity }), tokens(b, { entity }));
  const noParticles = tokenSetScore(tokens(a, { dropParticles: true, entity }), tokens(b, { dropParticles: true, entity }));
  const sortedA = tokens(a, { entity }).sort().join('');
  const sortedB = tokens(b, { entity }).sort().join('');
  const sortedWhole = sortedA && sortedB ? jaroWinkler(sortedA, sortedB) : 0;
  return Math.min(1, Math.max(whole * 0.97, full, noParticles * 0.98, sortedWhole * 0.97));
}

/** Search key used for trigram candidate retrieval in Postgres. */
function searchKey(value) {
  return tokens(value, { dropParticles: true }).join(' ');
}

module.exports = { normalizeName, tokens, jaro, jaroWinkler, tokenSetScore, nameSimilarity, searchKey };
