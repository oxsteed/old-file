'use strict';

// Structured profile + résumé builder + résumé parsing
// (docs/careers/marketplace.md §8).
//   • Work history, education and licences are SELF-REPORTED. They are
//     stored apart from career_profile_facts (OxSteed-verified) and every
//     surface labels them "Self-reported". Licence numbers are never stored.
//   • The résumé PDF puts OxSteed-verified facts in their own section and
//     never mixes them with the worker's own claims. Contact details are
//     included only when the worker asks.
//   • Parsing runs only on the self-hosted, digest-pinned Ollama
//     (CAREERS_AI_RESUME_PARSE_ENABLED). Emails, phones, URLs, street
//     addresses and the worker's name are removed before the model sees the
//     text. Output is a suggestion the worker reviews and imports.

const path = require('path');
const PDFDocument = require('pdfkit');
const { AppError } = require('../../../middleware/errorHandler');
const { generate } = require('../../../growth/ollamaClient');
const { resumeParseConfig } = require('../providers/config');
const { inputHash, logRun } = require('../aiRuns');
const { factsForViewer } = require('../profileFacts');
const { cleanUserText, requireId, notFound, featureOff } = require('./common');
const { extractResumeText } = require('./resumeText');

const LIMITS = { work: 30, education: 10, licenses: 20 };
const FONT_DIR = path.join(__dirname, '../../../assets/fonts');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function fail(field, message) {
  throw new AppError('Validation failed', 400, 'validation_failed', { [field]: message });
}
const t = (v, n) => cleanUserText(v, n).text;

function monthToDate(value, field, { required = false } = {}) {
  if (value == null || value === '') { if (required) fail(field, 'Pick a month'); return null; }
  const s = String(value).slice(0, 7);
  if (!MONTH.test(s)) fail(field, 'Use YYYY-MM');
  return `${s}-01`;
}

function parseWork(b, prefix = 'work') {
  const employer = t(b.employer_name, 160);
  const title = t(b.title, 160);
  if (!employer) fail(`${prefix}.employer_name`, 'Add the employer');
  if (!title) fail(`${prefix}.title`, 'Add your job title');
  const start = monthToDate(b.start_month, `${prefix}.start_month`, { required: true });
  const isCurrent = Boolean(b.is_current);
  const end = isCurrent ? null : monthToDate(b.end_month, `${prefix}.end_month`);
  if (end && end < start) fail(`${prefix}.end_month`, 'End must be after start');
  return { employer_name: employer, title, city: t(b.city, 120) || null, start_month: start, end_month: end, is_current: isCurrent, description: t(b.description, 2000) || null };
}

function year(v, field) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1940 || n > 2100) fail(field, 'Use a 4-digit year');
  return n;
}

function parseEducation(b, prefix = 'education') {
  const school = t(b.school, 160);
  if (!school) fail(`${prefix}.school`, 'Add the school');
  const start = year(b.start_year, `${prefix}.start_year`);
  const end = year(b.end_year, `${prefix}.end_year`);
  if (start && end && end < start) fail(`${prefix}.end_year`, 'End must be after start');
  return { school, credential: t(b.credential, 160) || null, field_of_study: t(b.field_of_study, 160) || null, start_year: start, end_year: end };
}

function parseLicense(b, prefix = 'license') {
  const name = t(b.name, 160);
  if (!name) fail(`${prefix}.name`, 'Add the licence or certificate');
  const day = (v, f) => {
    if (v == null || v === '') return null;
    const s = String(v).slice(0, 10);
    if (!DATE.test(s)) fail(f, 'Use YYYY-MM-DD');
    return s;
  };
  const issued = day(b.issued_on, `${prefix}.issued_on`);
  const expires = day(b.expires_on, `${prefix}.expires_on`);
  if (issued && expires && expires < issued) fail(`${prefix}.expires_on`, 'Expiry must be after issue');
  return { name, issuer: t(b.issuer, 160) || null, region: t(b.region, 80) || null, issued_on: issued, expires_on: expires };
}

const KINDS = {
  work: { table: 'career_profile_work_history', parse: parseWork, cols: ['employer_name', 'title', 'city', 'start_month', 'end_month', 'is_current', 'description'], order: 'is_current DESC, start_month DESC, position' },
  education: { table: 'career_profile_education', parse: parseEducation, cols: ['school', 'credential', 'field_of_study', 'start_year', 'end_year'], order: 'end_year DESC NULLS FIRST, position' },
  licenses: { table: 'career_profile_licenses', parse: parseLicense, cols: ['name', 'issuer', 'region', 'issued_on', 'expires_on'], order: 'position, id' },
};

function kindOf(kind) {
  const k = KINDS[kind];
  if (!k) throw notFound('Not found');
  return k;
}

async function listStructured(db, userId) {
  const out = {};
  for (const [kind, k] of Object.entries(KINDS)) {
    const { rows } = await db.query(
      `SELECT id, ${k.cols.join(', ')}, source, 'self_reported' AS verification FROM ${k.table} WHERE user_id = $1 ORDER BY ${k.order}`,
      [userId]
    );
    out[kind] = rows.map((r) => ({
      ...r,
      ...(r.start_month ? { start_month: String(r.start_month instanceof Date ? r.start_month.toISOString() : r.start_month).slice(0, 7) } : {}),
      ...(r.end_month ? { end_month: String(r.end_month instanceof Date ? r.end_month.toISOString() : r.end_month).slice(0, 7) } : {}),
      ...(r.issued_on ? { issued_on: String(r.issued_on instanceof Date ? r.issued_on.toISOString() : r.issued_on).slice(0, 10) } : {}),
      ...(r.expires_on ? { expires_on: String(r.expires_on instanceof Date ? r.expires_on.toISOString() : r.expires_on).slice(0, 10) } : {}),
    }));
  }
  return out;
}

async function addEntry(db, userId, kind, body, { source = 'self' } = {}) {
  const k = kindOf(kind);
  const v = k.parse(body || {});
  const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM ${k.table} WHERE user_id = $1`, [userId]);
  if (n >= LIMITS[kind]) throw new AppError(`Up to ${LIMITS[kind]} entries`, 409, 'entry_limit');
  const cols = ['user_id', ...k.cols, 'source', 'position'];
  const vals = [userId, ...k.cols.map((c) => v[c]), source, n];
  const { rows: [row] } = await db.query(
    `INSERT INTO ${k.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    vals
  );
  return { id: row.id, ...v, source, verification: 'self_reported' };
}

async function updateEntry(db, userId, kind, id, body) {
  const k = kindOf(kind);
  const entryId = requireId(id, 'Entry not found');
  const v = k.parse(body || {});
  const sets = k.cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const { rowCount } = await db.query(
    `UPDATE ${k.table} SET ${sets}, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [entryId, userId, ...k.cols.map((c) => v[c])]
  );
  if (!rowCount) throw notFound('Entry not found');
  return { id: entryId, ...v, verification: 'self_reported' };
}

async function deleteEntry(db, userId, kind, id) {
  const k = kindOf(kind);
  const { rowCount } = await db.query(`DELETE FROM ${k.table} WHERE id = $1 AND user_id = $2`, [requireId(id, 'Entry not found'), userId]);
  if (!rowCount) throw notFound('Entry not found');
  return { deleted: true };
}

// ── Parsing (Ollama) ────────────────────────────────────────────────────────

const S = (max, pattern) => ({ type: 'string', maxLength: max, ...(pattern ? { pattern } : {}) });
const RESUME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['work_history', 'education', 'licenses', 'skills'],
  properties: {
    work_history: {
      type: 'array', maxItems: 15,
      items: {
        type: 'object', additionalProperties: false,
        required: ['employer_name', 'title', 'start_month', 'end_month', 'is_current'],
        properties: {
          employer_name: S(160), title: S(160), city: S(120),
          start_month: S(7, '^(\\d{4}-(0[1-9]|1[0-2]))?$'), end_month: S(7, '^(\\d{4}-(0[1-9]|1[0-2]))?$'),
          is_current: { type: 'boolean' }, description: S(600),
        },
      },
    },
    education: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object', additionalProperties: false, required: ['school'],
        properties: { school: S(160), credential: S(160), field_of_study: S(160), start_year: { type: 'integer', minimum: 0, maximum: 2100 }, end_year: { type: 'integer', minimum: 0, maximum: 2100 } },
      },
    },
    licenses: {
      type: 'array', maxItems: 10,
      items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: S(160), issuer: S(160), region: S(80) } },
    },
    skills: { type: 'array', maxItems: 20, items: S(60) },
  },
};

function redactForModel(text, { firstName, lastName } = {}) {
  let s = String(text || '');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
  s = s.replace(/\bhttps?:\/\/\S+|\bwww\.\S+|\b(linkedin|github|facebook|instagram)\.com\/\S*/gi, '[link]');
  s = s.replace(/(\+?\d[\d\s().-]{7,}\d)/g, (m) => {
    const digits = m.replace(/\D/g, '');
    // Keep date ranges such as "2019 - 2023" or "03/2019 - 05/2021".
    if (/^(\d{1,2}[./-])?(19|20)\d\d\s*[-–]\s*(\d{1,2}[./-])?(19|20)\d\d$/.test(m.trim())) return m;
    return digits.length >= 9 ? '[phone]' : m;
  });
  s = s.replace(/\b\d{1,6}\s+([A-Za-z0-9.'-]+\s){0,4}(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter|rue|calle|avenida)\b\.?/gi, '[address]');
  s = s.replace(/\b\d{5}(-\d{4})?\b/g, (m) => (Number(m.slice(0, 4)) > 1900 && Number(m.slice(0, 4)) < 2100 && m.length === 4 ? m : '[postal]'));
  for (const name of [firstName, lastName].filter((n) => n && n.length >= 2)) {
    s = s.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[name]');
  }
  return s;
}

async function loadStoredResume(key) {
  // eslint-disable-next-line global-require
  const storage = require('../../../utils/storage');
  const stream = await storage.getObjectStream(key);
  const body = stream?.stream || stream?.Body || stream;
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new AppError('Résumé is too large to read', 413, 'resume_too_large');
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), mime: stream?.contentType || stream?.ContentType || '' };
}

/**
 * Suggest structured entries from the stored résumé (or pasted text). The
 * worker reviews every suggestion before importResume saves anything.
 */
async function parseResume(db, userId, { pastedText = null, generateImpl = generate, loadImpl = loadStoredResume } = {}) {
  if (!resumeParseConfig().enabled) throw featureOff('resume_parse');
  const { rows: [u] } = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
  let text = '';
  if (pastedText) {
    text = cleanUserText(pastedText, 30000).text;
  } else {
    const { rows: [p] } = await db.query('SELECT resume_storage_key FROM career_profiles WHERE user_id = $1', [userId]);
    if (!p?.resume_storage_key) throw new AppError('Upload a résumé or paste its text first', 404, 'not_found');
    const file = await loadImpl(p.resume_storage_key);
    const extracted = extractResumeText(file.buffer, file.mime);
    if (!extracted.readable) return { available: false, reason: 'unreadable_file' };
    text = extracted.text;
  }
  if ((text.match(/\p{L}/gu) || []).length < 80) return { available: false, reason: 'unreadable_file' };
  const data = { resume_text: redactForModel(text, { firstName: u?.first_name, lastName: u?.last_name }).slice(0, 14000) };
  const hash = inputHash({ purpose: 'parse_resume', data });
  const result = await generateImpl({ data, schema: RESUME_SCHEMA, task: 'careers_extract' });
  const runId = await logRun(db, { purpose: 'parse_resume', hash, result, fallbackReason: result ? null : 'model_unavailable' });
  if (!result) return { available: false, reason: 'model_unavailable', runId };
  const o = result.output;
  return {
    available: true,
    runId,
    suggestions: {
      work_history: o.work_history.filter((w) => w.employer_name && w.title && w.start_month),
      education: o.education.filter((e) => e.school).map((e) => ({ ...e, start_year: e.start_year || null, end_year: e.end_year || null })),
      licenses: o.licenses.filter((l) => l.name),
      skills: o.skills,
    },
    verification: 'self_reported',
  };
}

/** Save the suggestions the worker kept (all-or-nothing). */
async function importResume(db, userId, body) {
  const parts = { work: body?.work_history, education: body?.education, licenses: body?.licenses };
  const saved = { work: 0, education: 0, licenses: 0 };
  for (const [kind, list] of Object.entries(parts)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list.slice(0, LIMITS[kind])) {
      await addEntry(db, userId, kind, entry, { source: 'resume_parse' });
      saved[kind] += 1;
    }
  }
  return { saved };
}

// ── Résumé PDF ──────────────────────────────────────────────────────────────

const LABELS = {
  en: { experience: 'Experience', education: 'Education', licenses: 'Licences and certificates', verified: 'Verified by OxSteed', selfReported: 'Self-reported', present: 'Present', summary: 'Summary', skills: 'Skills', footer: 'Items marked "Self-reported" were entered by the candidate and are not verified by OxSteed.' },
  es: { experience: 'Experiencia', education: 'Educación', licenses: 'Licencias y certificados', verified: 'Verificado por OxSteed', selfReported: 'Declarado por el candidato', present: 'Actualidad', summary: 'Resumen', skills: 'Habilidades', footer: 'Los elementos marcados como "Declarado por el candidato" no están verificados por OxSteed.' },
  fr: { experience: 'Expérience', education: 'Formation', licenses: 'Permis et certificats', verified: 'Vérifié par OxSteed', selfReported: 'Déclaré par le candidat', present: 'Aujourd’hui', summary: 'Résumé', skills: 'Compétences', footer: 'Les éléments « Déclaré par le candidat » ne sont pas vérifiés par OxSteed.' },
  ht: { experience: 'Eksperyans', education: 'Edikasyon', licenses: 'Lisans ak sètifika', verified: 'OxSteed verifye', selfReported: 'Kandida a deklare', present: 'Jodi a', summary: 'Rezime', skills: 'Konpetans', footer: 'Eleman ki make "Kandida a deklare" pa verifye pa OxSteed.' },
  ar: { experience: 'الخبرة', education: 'التعليم', licenses: 'التراخيص والشهادات', verified: 'تحقّقت منه OxSteed', selfReported: 'مُصرَّح به ذاتيًا', present: 'حتى الآن', summary: 'نبذة', skills: 'المهارات', footer: 'العناصر المعلَّمة "مُصرَّح به ذاتيًا" أدخلها المرشّح ولم تتحقّق منها OxSteed.' },
};

function factLine(f) {
  const v = f.value || {};
  const label = String(f.fact_type).replace(/_/g, ' ');
  if (v.title) return `${label}: ${v.title}`;
  if (v.average != null) return `${label}: ${v.average} (${v.count || f.sample_size})`;
  if (v.rate != null) return `${label}: ${Math.round(Number(v.rate) * 100)}%`;
  if (v.count != null) return `${label}: ${v.count}`;
  return label;
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Build the résumé PDF. Returns a Buffer. */
async function buildResumePdf(db, userId, { lang = 'en', includeContact = false } = {}) {
  const L = LABELS[lang] || LABELS.en;
  const rtl = lang === 'ar';
  const { rows: [u] } = await db.query('SELECT first_name, last_name, email, phone FROM users WHERE id = $1', [userId]);
  if (!u) throw notFound('Profile not found');
  const { rows: [p] } = await db.query('SELECT headline, summary, skill_codes FROM career_profiles WHERE user_id = $1', [userId]);
  const structured = await listStructured(db, userId);
  const { facts } = await factsForViewer(db, userId, {});

  const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: 'Résumé', Producer: 'OxSteed Careers' } });
  doc.registerFont('Latin', path.join(FONT_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont('LatinBold', path.join(FONT_DIR, 'NotoSans-Bold.ttf'));
  doc.registerFont('Arabic', path.join(FONT_DIR, 'NotoSansArabic-Regular.ttf'));
  doc.registerFont('ArabicBold', path.join(FONT_DIR, 'NotoSansArabic-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));
  const write = (text, { size = 10, bold = false, color = '#111827', gap = 2 } = {}) => {
    if (!text) return;
    const arabic = ARABIC.test(text);
    doc.font(`${arabic ? 'Arabic' : 'Latin'}${bold ? 'Bold' : ''}`).fontSize(size).fillColor(color)
      .text(String(text), { align: rtl || arabic ? 'right' : 'left', ...(arabic ? { features: ['rtla'] } : {}) });
    doc.moveDown(gap / 10);
  };
  const heading = (text) => { doc.moveDown(0.6); write(text, { size: 13, bold: true, color: '#0f766e' }); };

  write(`${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Candidate', { size: 20, bold: true });
  if (p?.headline) write(p.headline, { size: 12, color: '#374151' });
  if (includeContact) write([u.email, u.phone].filter(Boolean).join(' · '), { size: 9, color: '#4b5563' });
  if (p?.summary) { heading(L.summary); write(p.summary); }

  if (facts.length) {
    heading(L.verified);
    for (const f of facts.slice(0, 20)) write(`✓ ${factLine(f)}`, { size: 10 });
  }
  if (structured.work.length) {
    heading(`${L.experience} (${L.selfReported})`);
    for (const w of structured.work) {
      write(`${w.title} — ${w.employer_name}${w.city ? `, ${w.city}` : ''}`, { bold: true });
      write(`${w.start_month} – ${w.is_current ? L.present : (w.end_month || '')}`, { size: 9, color: '#6b7280' });
      if (w.description) write(w.description, { size: 10 });
    }
  }
  if (structured.education.length) {
    heading(`${L.education} (${L.selfReported})`);
    for (const e of structured.education) {
      write([e.credential, e.field_of_study].filter(Boolean).join(', ') || e.school, { bold: true });
      write([e.school, [e.start_year, e.end_year].filter(Boolean).join(' – ')].filter(Boolean).join(' · '), { size: 9, color: '#6b7280' });
    }
  }
  if (structured.licenses.length) {
    heading(`${L.licenses} (${L.selfReported})`);
    for (const l of structured.licenses) {
      write([l.name, l.issuer, l.region].filter(Boolean).join(' · '), { bold: true });
      if (l.expires_on) write(`→ ${l.expires_on}`, { size: 9, color: '#6b7280' });
    }
  }
  if (p?.skill_codes?.length) { heading(L.skills); write(p.skill_codes.map((s) => s.replace(/[_.-]/g, ' ')).join(' · ')); }
  doc.moveDown(1);
  write(L.footer, { size: 8, color: '#6b7280' });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

module.exports = {
  LIMITS,
  RESUME_SCHEMA,
  parseWork,
  parseEducation,
  parseLicense,
  listStructured,
  addEntry,
  updateEntry,
  deleteEntry,
  redactForModel,
  parseResume,
  importResume,
  buildResumePdf,
};
