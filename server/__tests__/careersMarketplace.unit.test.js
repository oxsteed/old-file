'use strict';

// Unit tests for the Careers marketplace logic that needs no database:
// screener parsing and the protected-characteristics guard, résumé text
// extraction (PDF and DOCX), redaction before anything reaches Ollama,
// time-zone slot maths, AI match bands and inputs, plan entitlements,
// interview-room naming, and every new notification template rendering in
// the five supported languages. Flows are covered in
// careersMarketplace.db.test.js.

const zlib = require('zlib');
const screeners = require('../services/careers/marketplace/screeners');
const { extractResumeText, readZipEntry } = require('../services/careers/marketplace/resumeText');
const { redactForModel, parseWork, LIMITS } = require('../services/careers/marketplace/resume');
const { zonedInstant, parseWindows } = require('../services/careers/marketplace/scheduling');
const { band, MATCH_SCHEMA } = require('../services/careers/marketplace/aiMatch');
const { ENTITLEMENTS } = require('../services/careers/marketplace/plans');
const { roomName, MAX_PEERS, MAX_SIGNAL_BYTES } = require('../realtime/careersInterviewRoom');
const { safeReturnTo } = require('../services/careers/marketplace/calendarSync');

describe('screener questions', () => {
  test('presets can be deal-breakers only with an expected answer', () => {
    expect(() => screeners.parseQuestions([{ preset_code: 'years_experience', dealbreaker: true }])).toThrow();
    const [q] = screeners.parseQuestions([{ preset_code: 'years_experience', dealbreaker: true, expected: { min: 2 } }]);
    expect(q).toMatchObject({ kind: 'preset', dealbreaker: true, required: true, expected: { min: 2 } });
  });

  test('custom questions cannot be deal-breakers or ask about protected characteristics', () => {
    expect(() => screeners.parseQuestions([{ prompt: 'Tell us about your grill work', dealbreaker: true }])).toThrow();
    for (const prompt of ['How old are you?', 'Are you married?', 'What church do you attend?', 'Do you have any disability?',
      'What is your national origin?', 'Have you ever been arrested?', 'What is your current salary?', 'Are you pregnant?']) {
      expect(() => screeners.parseQuestions([{ prompt }])).toThrow(/Validation failed/);
    }
    // Job-related wording passes, including childcare roles.
    expect(screeners.parseQuestions([{ prompt: 'Have you cared for children under 5 before?' }])).toHaveLength(1);
  });

  test('at most 10 questions; choice needs two options', () => {
    expect(() => screeners.parseQuestions(Array.from({ length: 11 }, () => ({ prompt: 'Why this job?' })))).toThrow();
    expect(() => screeners.parseQuestions([{ prompt: 'Pick a shift', answer_type: 'choice', choices: ['am'] }])).toThrow();
  });

  test('answers are checked against the requirement', () => {
    const yes = { preset_code: 'drivers_license', answer_type: 'yes_no', dealbreaker: true, expected: { answer: true } };
    expect(screeners.meets(yes, true)).toBe(true);
    expect(screeners.meets(yes, false)).toBe(false);
    const yrs = { preset_code: 'years_experience', answer_type: 'number', dealbreaker: true, expected: { min: 2 } };
    expect(screeners.meets(yrs, 3)).toBe(true);
    expect(screeners.meets(yrs, 1)).toBe(false);
    expect(screeners.meets({ ...yrs, dealbreaker: false }, 1)).toBe(true);
  });
});

describe('résumé text extraction', () => {
  function zipOne(name, content) {
    const data = zlib.deflateRawSync(Buffer.from(content));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 42);
    const centralStart = local.length + nameBuf.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(centralStart, 16);
    return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
  }

  test('DOCX paragraphs become lines', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Line cook &amp; prep</w:t></w:r></w:p><w:p><w:r><w:t>Corner Diner 2022 – 2024</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipOne('word/document.xml', xml);
    expect(readZipEntry(docx, 'word/document.xml').toString()).toBe(xml);
    const out = extractResumeText(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(out.kind).toBe('docx');
    expect(out.text).toContain('Line cook & prep');
    expect(out.text).toContain('Corner Diner');
  });

  test('PDF text, including pdfkit hex strings', async () => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => doc.on('end', r));
    doc.text('Experienced line cook with five years on a busy grill, prep, inventory and food safety. ServSafe certified. Spanish and English.');
    doc.end();
    await done;
    const out = extractResumeText(Buffer.concat(chunks), 'application/pdf');
    expect(out.kind).toBe('pdf');
    expect(out.readable).toBe(true);
    expect(out.text).toMatch(/line cook/i);
  });

  test('unknown or image-only files are not readable', () => {
    expect(extractResumeText(Buffer.from('GIF89a'), 'image/gif').readable).toBe(false);
  });
});

describe('redaction before the model', () => {
  test('contact details and the name are removed; dates stay', () => {
    const text = 'Maria Lopez\nmaria@example.com · (305) 555-0199 · linkedin.com/in/maria\n12 Ocean Drive, Miami FL 33139\nLine cook, Corner Diner 2019 - 2023';
    const out = redactForModel(text, { firstName: 'Maria', lastName: 'Lopez' });
    expect(out).not.toMatch(/Maria|Lopez|example\.com|555-0199|linkedin|Ocean Drive|33139/);
    expect(out).toContain('2019 - 2023');
    expect(out).toContain('Line cook');
  });

  test('structured work entries are validated; limits exist for each kind', () => {
    expect(() => parseWork({ title: 'Cook', employer_name: 'Diner', start_month: '2024-05', end_month: '2023-01' })).toThrow();
    expect(parseWork({ title: 'Cook', employer_name: 'Diner', start_month: '2022-01', is_current: true })).toMatchObject({ end_month: null, is_current: true });
    expect(LIMITS).toEqual(expect.objectContaining({ work: expect.any(Number), education: expect.any(Number), licenses: expect.any(Number) }));
  });
});

describe('scheduling maths', () => {
  test('local wall time to UTC across DST', () => {
    // 9:00 in New York: EST in January (UTC-5), EDT in July (UTC-4).
    expect(zonedInstant(2026, 1, 15, 9 * 60, 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(zonedInstant(2026, 7, 15, 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(zonedInstant(2026, 7, 15, 9 * 60, 'Asia/Dubai').toISOString()).toBe('2026-07-15T05:00:00.000Z');
  });

  test('availability windows are validated', () => {
    expect(() => parseWindows({ timezone: 'Mars/Base', windows: [] })).toThrow();
    expect(() => parseWindows({ timezone: 'America/New_York', windows: [{ weekday: 1, start_minute: 600, end_minute: 605 }] })).toThrow();
    expect(parseWindows({ timezone: 'America/New_York', windows: [{ weekday: 1, start_minute: 540, end_minute: 1020 }] }).windows).toEqual([{ weekday: 1, start: 540, end: 1020 }]);
  });
});

describe('AI match and plans', () => {
  test('scores are shown as bands, never as a bare number', () => {
    expect(band(90)).toBe('strong');
    expect(band(50)).toBe('partial');
    expect(band(10)).toBe('limited');
    expect(MATCH_SCHEMA.required).toEqual(expect.arrayContaining(['score', 'met', 'gaps']));
  });

  test('plan tiers only grow', () => {
    const order = ['free', 'starter', 'growth', 'pro'];
    for (const key of ['candidate_alerts', 'shortlists', 'talent_invites_month', 'agency_clients']) {
      const values = order.map((p) => ENTITLEMENTS[p][key]);
      expect([...values].sort((a, b) => a - b)).toEqual(values);
    }
    expect(ENTITLEMENTS.free.analytics_export).toBe(false);
  });
});

describe('interview room and calendar safety', () => {
  test('room names are derived, not client-chosen; caps are set', () => {
    expect(roomName('abc')).toMatch(/^careers_room_[0-9a-f]{32}$/);
    expect(roomName('abc')).not.toBe(roomName('abd'));
    expect(MAX_PEERS).toBe(4);
    expect(MAX_SIGNAL_BYTES).toBe(16 * 1024);
  });

  test('OAuth return paths stay on our site', () => {
    expect(safeReturnTo('https://evil.example/')).not.toContain('evil');
    expect(safeReturnTo('//evil.example/x')).not.toContain('evil');
    expect(safeReturnTo('/business/5/careers?tab=scheduling')).toBe('/business/5/careers?tab=scheduling');
  });
});

describe('notification templates', () => {
  const TYPES = ['career_job_alert', 'career_followed_employer_opening', 'career_message_from_employer', 'career_message_from_candidate',
    'career_interview_proposed', 'career_interview_reschedule_proposed', 'career_interview_booked', 'career_interview_times_declined',
    'career_interview_reschedule_requested', 'career_interview_rescheduled', 'career_interview_reminder', 'career_interview_reminder_team',
    'career_candidate_alert', 'career_agency_link_requested', 'career_agency_link_approved', 'career_agency_link_declined'];
  test.each(TYPES)('%s renders in every language with no leftover placeholders', (type) => {
    const params = { count: 3, alertName: 'Cooks', firstTitle: 'Grill cook', employerName: 'Market Grill', openingTitle: 'Grill cook',
      applicantLabel: '#12', when: 'Thu 10:00', timezone: 'America/New_York', agencyName: 'Staffing Pros', clientName: 'Market Grill', reason: 'Exam' };
    const { render } = require('../services/careers/notify');
    const seen = new Set();
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const out = render(type, lang, params);
      expect(out.title).toBeTruthy();
      expect(out.body).toBeTruthy();
      expect(`${out.title} ${out.body}`).not.toMatch(/\{[a-zA-Z]+\}/);
      seen.add(out.body);
    }
    // Each language has its own text (no silent English fallback).
    expect(seen.size).toBe(5);
  });
});
