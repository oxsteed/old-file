'use strict';

/**
 * Parsers for the public sanctions lists. Each returns
 *   { entries: [{ externalId, entryType, primaryName, aliases: [{ name, strength }],
 *                 programs, countries, birthDates, remarks }], publishedAt }
 * Parsers are pure (string in, data out) so fixtures can test them.
 */

const { XMLParser } = require('fast-xml-parser');

const ENTRY_TYPES = new Set(['individual', 'entity', 'vessel', 'aircraft', 'unknown']);

function arr(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    if ('#text' in value) return String(value['#text']).trim();
    return '';
  }
  return String(value).trim();
}

function uniq(values) {
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))];
}

function finalize(entry) {
  const primaryName = String(entry.primaryName || '').replace(/\s+/g, ' ').trim();
  if (!primaryName || !entry.externalId) return null;
  const seen = new Set([primaryName.toLowerCase()]);
  const aliases = [];
  for (const alias of entry.aliases || []) {
    const name = String(alias.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    aliases.push({ name, strength: alias.strength === 'weak' ? 'weak' : 'strong' });
  }
  return {
    externalId: String(entry.externalId),
    entryType: ENTRY_TYPES.has(entry.entryType) ? entry.entryType : 'unknown',
    primaryName,
    aliases,
    programs: uniq(entry.programs || []),
    countries: uniq(entry.countries || []),
    birthDates: uniq(entry.birthDates || []),
    remarks: entry.remarks ? String(entry.remarks).slice(0, 4000) : null,
  };
}

// ── CSV (RFC 4180, as published by OFAC) ─────────────────────────────────
function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(input).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function ofacValue(value) {
  const v = String(value ?? '').trim();
  return v === '-0-' || v === '' ? null : v;
}

const OFAC_TYPES = { individual: 'individual', vessel: 'vessel', aircraft: 'aircraft' };

function ofacReorder(name) {
  // OFAC writes individuals as "LAST, First"; keep both orders as names.
  const m = /^([^,]+),\s*(.+)$/.exec(name);
  return m ? `${m[2]} ${m[1]}` : null;
}

function parseOfacCsv(primaryCsv, aliasCsv = '') {
  const byId = new Map();
  for (const r of parseCsv(primaryCsv)) {
    const id = ofacValue(r[0]);
    const name = ofacValue(r[1]);
    if (!id || !name || !/^\d+$/.test(id)) continue;
    const type = OFAC_TYPES[String(ofacValue(r[2]) || '').toLowerCase()] || 'entity';
    const remarks = ofacValue(r[11]);
    const birthDates = [];
    const countries = [];
    if (remarks) {
      for (const m of remarks.matchAll(/\bDOB\s+([^;]+?)(?:;|\.$|$)/g)) birthDates.push(m[1].trim());
      for (const m of remarks.matchAll(/\b(?:nationality|citizen)\s+([A-Za-z' -]+?)(?:;|\.|$)/gi)) countries.push(m[1].trim());
    }
    const aliases = [];
    if (type === 'individual') {
      const reordered = ofacReorder(name);
      if (reordered) aliases.push({ name: reordered, strength: 'strong' });
    }
    for (const m of String(remarks || '').matchAll(/a\.k\.a\.\s+'([^']+)'/g)) aliases.push({ name: m[1], strength: 'strong' });
    byId.set(id, {
      externalId: id,
      entryType: type,
      primaryName: name,
      aliases,
      programs: String(ofacValue(r[3]) || '').split(/\]\s*\[|[\[\]]/).map((p) => p.trim()).filter(Boolean),
      countries,
      birthDates,
      remarks,
    });
  }
  for (const r of parseCsv(aliasCsv)) {
    const entry = byId.get(ofacValue(r[0]));
    const name = ofacValue(r[3]);
    if (!entry || !name) continue;
    const strength = /weak/i.test(String(ofacValue(r[2]) || '')) || /weak/i.test(String(ofacValue(r[4]) || '')) ? 'weak' : 'strong';
    entry.aliases.push({ name, strength });
    if (entry.entryType === 'individual') {
      const reordered = ofacReorder(name);
      if (reordered) entry.aliases.push({ name: reordered, strength });
    }
  }
  return { entries: [...byId.values()].map(finalize).filter(Boolean), publishedAt: null };
}

// ── XML lists ────────────────────────────────────────────────────────────
function xmlParser(arrayTags) {
  const set = new Set(arrayTags);
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    isArray: (name) => set.has(name),
  });
}

function parseUnXml(xml) {
  const doc = xmlParser([
    'INDIVIDUAL', 'ENTITY', 'INDIVIDUAL_ALIAS', 'ENTITY_ALIAS', 'NATIONALITY', 'VALUE',
    'INDIVIDUAL_DATE_OF_BIRTH', 'INDIVIDUAL_ADDRESS', 'ENTITY_ADDRESS',
  ]).parse(xml);
  const root = doc.CONSOLIDATED_LIST;
  if (!root) throw new Error('UN list: CONSOLIDATED_LIST root missing');
  const entries = [];
  for (const ind of arr(root.INDIVIDUALS?.INDIVIDUAL)) {
    const parts = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((k) => text(ind[k])).filter(Boolean);
    const aliases = arr(ind.INDIVIDUAL_ALIAS).map((a) => ({ name: text(a.ALIAS_NAME), strength: /low/i.test(text(a.QUALITY)) ? 'weak' : 'strong' }));
    const original = text(ind.NAME_ORIGINAL_SCRIPT);
    if (original) aliases.push({ name: original, strength: 'strong' });
    entries.push(finalize({
      externalId: text(ind.REFERENCE_NUMBER) || text(ind.DATAID),
      entryType: 'individual',
      primaryName: parts.join(' '),
      aliases,
      programs: [text(ind.UN_LIST_TYPE)],
      countries: arr(ind.NATIONALITY).flatMap((n) => arr(n.VALUE).map(text)),
      birthDates: arr(ind.INDIVIDUAL_DATE_OF_BIRTH).map((d) => text(d.DATE) || text(d.YEAR) || [text(d.FROM_YEAR), text(d.TO_YEAR)].filter(Boolean).join('-')),
      remarks: text(ind.COMMENTS1),
    }));
  }
  for (const ent of arr(root.ENTITIES?.ENTITY)) {
    entries.push(finalize({
      externalId: text(ent.REFERENCE_NUMBER) || text(ent.DATAID),
      entryType: 'entity',
      primaryName: text(ent.FIRST_NAME),
      aliases: arr(ent.ENTITY_ALIAS).map((a) => ({ name: text(a.ALIAS_NAME), strength: /low/i.test(text(a.QUALITY)) ? 'weak' : 'strong' })),
      programs: [text(ent.UN_LIST_TYPE)],
      countries: arr(ent.ENTITY_ADDRESS).map((a) => text(a.COUNTRY)),
      remarks: text(ent.COMMENTS1),
    }));
  }
  return { entries: entries.filter(Boolean), publishedAt: root['@_dateGenerated'] || null };
}

function parseEuXml(xml) {
  const doc = xmlParser(['sanctionEntity', 'nameAlias', 'regulation', 'citizenship', 'birthdate', 'address']).parse(xml);
  const root = doc.export;
  if (!root) throw new Error('EU list: export root missing');
  const entries = [];
  for (const e of arr(root.sanctionEntity)) {
    const names = arr(e.nameAlias).map((n) => ({ name: n['@_wholeName'], strength: n['@_strong'] === 'false' ? 'weak' : 'strong' })).filter((n) => n.name);
    if (!names.length) continue;
    const code = e.subjectType?.['@_code'];
    entries.push(finalize({
      externalId: e['@_euReferenceNumber'] || e['@_logicalId'],
      entryType: code === 'person' ? 'individual' : code === 'enterprise' ? 'entity' : 'unknown',
      primaryName: names[0].name,
      aliases: names.slice(1),
      programs: arr(e.regulation).map((r) => r['@_programme']),
      countries: arr(e.citizenship).map((c) => c['@_countryIso2Code'] || c['@_countryDescription']),
      birthDates: arr(e.birthdate).map((b) => b['@_birthdate'] || b['@_year']),
      remarks: text(e.remark),
    }));
  }
  return { entries: entries.filter(Boolean), publishedAt: root['@_generationDate'] || null };
}

function parseUkXml(xml) {
  const doc = xmlParser(['Designation', 'Name', 'NonLatinName', 'DOB', 'Nationality', 'Individual']).parse(xml);
  const root = doc.Designations;
  if (!root) throw new Error('UK list: Designations root missing');
  const entries = [];
  for (const d of arr(root.Designation)) {
    const names = arr(d.Names?.Name).map((n) => ({
      name: ['Name1', 'Name2', 'Name3', 'Name4', 'Name5', 'Name6'].map((k) => text(n[k])).filter(Boolean).join(' '),
      primary: /primary/i.test(text(n.NameType)),
      strength: /low/i.test(text(n.AliasStrength)) ? 'weak' : 'strong',
    })).filter((n) => n.name);
    if (!names.length) continue;
    const primary = names.find((n) => n.primary) || names[0];
    const kind = text(d.IndividualEntityShip).toLowerCase();
    const individuals = arr(d.IndividualDetails?.Individual);
    entries.push(finalize({
      externalId: text(d.UniqueID),
      entryType: kind === 'individual' ? 'individual' : kind === 'ship' ? 'vessel' : kind === 'entity' ? 'entity' : 'unknown',
      primaryName: primary.name,
      aliases: [
        ...names.filter((n) => n !== primary),
        ...arr(d.NonLatinNames?.NonLatinName).map((n) => ({ name: text(n.NameNonLatinScript), strength: 'strong' })),
      ],
      programs: [text(d.RegimeName)],
      countries: individuals.flatMap((i) => arr(i.Nationalities?.Nationality).map(text)),
      birthDates: individuals.flatMap((i) => arr(i.DOBs?.DOB).map(text)),
      remarks: text(d.OtherInformation),
    }));
  }
  return { entries: entries.filter(Boolean), publishedAt: text(root.DateGenerated) || null };
}

/**
 * Canada SEMA consolidated list (data-set/record). Records name a person
 * (LastName + GivenName) or an entity/ship (EntityOrShip).
 */
function parseSemaXml(xml) {
  const doc = xmlParser(['record']).parse(xml);
  const root = doc['data-set'] || doc.dataset || doc.DataSet;
  if (!root) throw new Error('SEMA list: data-set root missing');
  const entries = [];
  for (const r of arr(root.record)) {
    const entity = text(r.EntityOrShip);
    const person = [text(r.GivenName), text(r.LastName)].filter(Boolean).join(' ');
    const primaryName = entity || person;
    const aliasText = text(r.Aliases);
    entries.push(finalize({
      externalId: [text(r.Country), text(r.Schedule), text(r.Item)].filter(Boolean).join(':') || primaryName,
      entryType: entity ? (text(r.ShipIMONumber) ? 'vessel' : 'entity') : 'individual',
      primaryName,
      aliases: [
        ...(person && !entity && text(r.LastName) ? [{ name: `${text(r.LastName)} ${text(r.GivenName)}`.trim(), strength: 'strong' }] : []),
        ...aliasText.split(/[;\n]|,\s(?=[A-Z])/).map((a) => ({ name: a.replace(/^(also known as|a\.k\.a\.|aka)\s*/i, ''), strength: 'strong' })),
      ],
      programs: [`SEMA ${text(r.Country)}`.trim()],
      countries: [text(r.Country)],
      birthDates: [text(r.DateOfBirthOrShipBuildDate)],
    }));
  }
  return { entries: entries.filter(Boolean), publishedAt: null };
}

module.exports = { parseCsv, parseOfacCsv, parseUnXml, parseEuXml, parseUkXml, parseSemaXml, finalize };
