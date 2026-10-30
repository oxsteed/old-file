'use strict';

/**
 * In-house sanctions list ingestion and name screening (licence readiness:
 * sanctions). Public official lists only, no paid vendor:
 *   OFAC SDN + consolidated, UN Security Council (incl. the Haiti 2653
 *   regime), EU, UK, Canada SEMA, plus a custom list kept by two
 *   administrators (Haiti national designations, internal blocks).
 *
 * Safety properties
 *   - A list version is accepted only if it parses and is not drastically
 *     smaller than the active one (truncated downloads are rejected).
 *   - Automated screening clears nobody unless every required, enabled
 *     source is fresh (max_age_hours). Otherwise the result is 'error' and
 *     the money path fails closed (503) with an incident.
 *   - Each screening records the list versions it used and the candidate
 *     matches (evidence for the reviewer and the regulator).
 *   - A new version triggers a rescreen of every known subject whose name is
 *     close to an added name; the first version rescreens everyone known.
 */

const crypto = require('crypto');
const pool = require('../../db');
const AppError = require('../../utils/appError');
const logger = require('../../utils/logger');
const { withTransaction } = require('../../utils/transaction');
const { normalizeName, nameSimilarity, jaroWinkler, tokens } = require('./nameMatching');
const parsers = require('./sanctions/parsers');
const { insertComplianceAudit } = require('./audit');
// SSRF-safe fetcher (spec 13.3): HTTPS only, no credentials, no
// non-default port, every DNS answer must be globally routable with the
// address pinned against rebind, redirects re-validated per hop.
const { fetchFeed } = require('../../growth/partners/feedFetch');

const MATCH_THRESHOLD = () => {
  const v = Number(process.env.OXSTEED_SANCTIONS_MATCH_THRESHOLD || '0.88');
  return Number.isFinite(v) && v >= 0.7 && v <= 1 ? v : 0.88;
};
const MIN_RATIO_OF_PREVIOUS = 0.5;
const FETCH_TIMEOUT_MS = 120000;
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
const FULL_RESCREEN_DELTA = 5000;
const INSERT_CHUNK = 2000;

function sha256(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(String(p || ''));
  return h.digest('hex');
}

function parseFor(format, primary, aux) {
  switch (format) {
    case 'ofac_csv': return parsers.parseOfacCsv(primary, aux || '');
    case 'un_xml': return parsers.parseUnXml(primary);
    case 'eu_xml': return parsers.parseEuXml(primary);
    case 'uk_xml': return parsers.parseUkXml(primary);
    case 'sema_xml': return parsers.parseSemaXml(primary);
    default: throw new Error(`Unsupported list format ${format}`);
  }
}

async function download(url) {
  // Route through the SSRF-safe fetcher instead of bare fetch with
  // redirect:follow: a compromised list host could previously redirect to
  // an internal address (for example cloud metadata). The fetcher pins the
  // source host as the only allowed host, so a cross-host redirect now
  // fails the refresh (recorded by refreshSource, and screening fails
  // closed on stale sources per this module's safety properties) instead
  // of being followed. Timeout and size caps are preserved.
  const host = new URL(url).hostname;
  const { body } = await fetchFeed(url, {
    allowedHosts: [host],
    maxBytes: MAX_DOWNLOAD_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  const text = body.toString('utf8');
  if (text.length > MAX_DOWNLOAD_BYTES) throw new Error('List download too large');
  return text;
}

async function getSource(client, sourceId) {
  const { rows } = await client.query('SELECT * FROM credit_sanctions_list_sources WHERE id = $1', [sourceId]);
  if (!rows[0]) throw new AppError('Unknown sanctions list source', 404, 'sanctions_source_unknown');
  return rows[0];
}

function namesOf(entry) {
  const out = [{ name: entry.primaryName, isPrimary: true, strength: 'strong' }];
  for (const a of entry.aliases) out.push({ name: a.name, isPrimary: false, strength: a.strength });
  return out
    .map((n) => ({ ...n, normalized: normalizeName(n.name) }))
    .filter((n) => n.normalized.length >= 2);
}

/**
 * Replace a source's active entries with a parsed list. Returns the version
 * row. Idempotent on content: the same sha256 only refreshes freshness.
 */
async function ingestParsed(sourceId, parsed, { digest, via = 'fetch', actorUserId = null } = {}) {
  return withTransaction(pool, async (client) => {
    const source = (await client.query('SELECT * FROM credit_sanctions_list_sources WHERE id = $1 FOR UPDATE', [sourceId])).rows[0];
    if (!source) throw new AppError('Unknown sanctions list source', 404, 'sanctions_source_unknown');
    const active = source.active_version_id
      ? (await client.query('SELECT * FROM credit_sanctions_list_versions WHERE id = $1', [source.active_version_id])).rows[0]
      : null;
    if (active && active.sha256 === digest) {
      await client.query(
        'UPDATE credit_sanctions_list_sources SET last_attempt_at = NOW(), last_success_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1',
        [sourceId]
      );
      return { version: active, unchanged: true };
    }
    const entries = parsed.entries || [];
    const minimum = active ? Math.floor(active.entry_count * MIN_RATIO_OF_PREVIOUS) : (via === 'custom' ? 0 : 1);
    if (entries.length < minimum) {
      const reason = `Parsed ${entries.length} entries; active version has ${active ? active.entry_count : 0}. Refusing a truncated list.`;
      await client.query(
        `INSERT INTO credit_sanctions_list_versions (source_id, sha256, entry_count, name_count, status, rejection_reason, ingested_via)
         VALUES ($1, $2, $3, 0, 'rejected', $4, $5)`,
        [sourceId, digest, entries.length, reason, via]
      );
      await client.query(
        'UPDATE credit_sanctions_list_sources SET last_attempt_at = NOW(), last_error = $2, updated_at = NOW() WHERE id = $1',
        [sourceId, reason]
      );
      return { rejected: true, reason };
    }

    const previous = new Set((await client.query(
      'SELECT DISTINCT normalized FROM credit_sanctions_list_names WHERE source_id = $1', [sourceId]
    )).rows.map((r) => r.normalized));

    const publishedAt = parsed.publishedAt && !Number.isNaN(Date.parse(parsed.publishedAt)) ? new Date(parsed.publishedAt).toISOString() : null;
    const { rows: [version] } = await client.query(
      `INSERT INTO credit_sanctions_list_versions (source_id, sha256, entry_count, name_count, published_at, ingested_via)
       VALUES ($1, $2, $3, 0, $4, $5) RETURNING *`,
      [sourceId, digest, entries.length, publishedAt, via]
    );
    await client.query('DELETE FROM credit_sanctions_list_entries WHERE source_id = $1', [sourceId]);

    // Duplicate external ids inside one publication: keep the first.
    const seenIds = new Set();
    const unique = entries.filter((e) => (seenIds.has(e.externalId) ? false : seenIds.add(e.externalId)));
    const current = new Set();
    let nameCount = 0;
    for (let i = 0; i < unique.length; i += INSERT_CHUNK) {
      const chunk = unique.slice(i, i + INSERT_CHUNK);
      const { rows: inserted } = await client.query(
        `INSERT INTO credit_sanctions_list_entries
           (source_id, version_id, external_id, entry_type, primary_name, programs, countries, birth_dates, remarks)
         SELECT $1, $2, e.external_id, e.entry_type, e.primary_name,
                COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(e.programs) x), '{}'),
                COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(e.countries) x), '{}'),
                COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(e.birth_dates) x), '{}'),
                e.remarks
           FROM jsonb_to_recordset($3::jsonb) AS e(external_id text, entry_type text, primary_name text,
                programs jsonb, countries jsonb, birth_dates jsonb, remarks text)
         RETURNING id, external_id`,
        [sourceId, version.id, JSON.stringify(chunk.map((e) => ({
          external_id: e.externalId, entry_type: e.entryType, primary_name: e.primaryName,
          programs: e.programs, countries: e.countries, birth_dates: e.birthDates, remarks: e.remarks,
        })))]
      );
      const idByExternal = new Map(inserted.map((r) => [r.external_id, r.id]));
      const nameRows = [];
      for (const e of chunk) {
        for (const n of namesOf(e)) {
          nameRows.push({ entry_id: idByExternal.get(e.externalId), name: n.name, normalized: n.normalized, is_primary: n.isPrimary, strength: n.strength });
          current.add(n.normalized);
        }
      }
      nameCount += nameRows.length;
      for (let j = 0; j < nameRows.length; j += INSERT_CHUNK * 2) {
        await client.query(
          `INSERT INTO credit_sanctions_list_names (entry_id, source_id, name, normalized, is_primary, strength)
           SELECT n.entry_id, $1, n.name, n.normalized, n.is_primary, n.strength
             FROM jsonb_to_recordset($2::jsonb) AS n(entry_id bigint, name text, normalized text, is_primary boolean, strength text)`,
          [sourceId, JSON.stringify(nameRows.slice(j, j + INSERT_CHUNK * 2))]
        );
      }
    }
    const added = [...current].filter((n) => !previous.has(n));
    const removedCount = [...previous].filter((n) => !current.has(n)).length;
    for (let i = 0; i < added.length; i += INSERT_CHUNK * 2) {
      await client.query(
        `INSERT INTO credit_sanctions_list_deltas (version_id, normalized)
         SELECT $1, x FROM unnest($2::text[]) x ON CONFLICT DO NOTHING`,
        [version.id, added.slice(i, i + INSERT_CHUNK * 2)]
      );
    }
    const { rows: [finalVersion] } = await client.query(
      `UPDATE credit_sanctions_list_versions
          SET name_count = $2, added_name_count = $3, removed_name_count = $4
        WHERE id = $1 RETURNING *`,
      [version.id, nameCount, added.length, removedCount]
    );
    await client.query(
      `UPDATE credit_sanctions_list_versions SET status = 'superseded'
        WHERE source_id = $1 AND id <> $2 AND status = 'active'`,
      [sourceId, version.id]
    );
    await client.query(
      `UPDATE credit_sanctions_list_sources
          SET active_version_id = $2, last_attempt_at = NOW(), last_success_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [sourceId, version.id]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.sanctions.list_ingested',
      actorUserId,
      resourceType: 'credit_sanctions_list_version',
      resourceId: version.id,
      reason: `${sourceId} ${via}`,
      afterState: { sourceId, sha256: digest, entries: entries.length, names: nameCount, added: added.length, removed: removedCount },
    });
    return { version: finalVersion, unchanged: false };
  }, 'credit_sanctions_ingest');
}

async function recordFailure(sourceId, error) {
  await pool.query(
    'UPDATE credit_sanctions_list_sources SET last_attempt_at = NOW(), last_error = $2, updated_at = NOW() WHERE id = $1',
    [sourceId, String(error.message || error).slice(0, 1000)]
  );
}

async function refreshSource(sourceId) {
  const source = await getSource(pool, sourceId);
  if (source.format === 'custom') return rebuildCustomList();
  try {
    const primary = await download(source.url);
    const aux = source.aux_url ? await download(source.aux_url) : '';
    const parsed = parseFor(source.format, primary, aux);
    return await ingestParsed(sourceId, parsed, { digest: sha256(primary, '\u0000', aux), via: 'fetch' });
  } catch (error) {
    await recordFailure(sourceId, error);
    throw error;
  }
}

/** Operator path when a source blocks automated download: ingest a file. */
async function ingestFile(sourceId, { primary, aux = '', actorUserId = null }) {
  const source = await getSource(pool, sourceId);
  if (source.format === 'custom') throw new AppError('The custom list is edited through two-admin entries', 400, 'sanctions_source_custom');
  const parsed = parseFor(source.format, primary, aux);
  return ingestParsed(sourceId, parsed, { digest: sha256(primary, '\u0000', aux), via: 'file', actorUserId });
}

async function rebuildCustomList(actorUserId = null) {
  const { rows } = await pool.query(
    `SELECT * FROM credit_sanctions_custom_entries WHERE removed_at IS NULL ORDER BY created_at`
  );
  const entries = rows.map((r) => parsers.finalize({
    externalId: r.id,
    entryType: r.entry_type,
    primaryName: r.primary_name,
    aliases: (r.aliases || []).map((name) => ({ name, strength: 'strong' })),
    programs: [r.legal_basis],
    countries: r.countries,
    birthDates: r.birth_dates,
    remarks: r.source_reference,
  })).filter(Boolean);
  const digest = sha256(JSON.stringify(entries));
  return ingestParsed('custom_ht', { entries, publishedAt: new Date().toISOString() }, { digest, via: 'custom', actorUserId });
}

async function refreshAllSources() {
  const { rows } = await pool.query(
    `SELECT id, format, required, max_age_hours, last_success_at FROM credit_sanctions_list_sources WHERE enabled = TRUE ORDER BY id`
  );
  const results = {};
  for (const source of rows) {
    try {
      const r = source.format === 'custom' ? await rebuildCustomList() : await refreshSource(source.id);
      results[source.id] = r.rejected ? 'rejected' : r.unchanged ? 'unchanged' : 'updated';
    } catch (error) {
      results[source.id] = `failed: ${error.message}`;
      logger.warn('Sanctions list refresh failed', { sourceId: source.id, error: error.message });
      const stale = !source.last_success_at
        || Date.now() - new Date(source.last_success_at).getTime() > source.max_age_hours * 3600 * 1000 * 0.75;
      if (source.required && stale) {
        await require('../incidentStore').recordIncident({
          type: 'credit_sanctions_list_stale',
          severity: 'critical',
          message: `Sanctions list ${source.id} could not be refreshed and is near or past its freshness limit; automated screening will fail closed.`,
          dedupeKey: `credit-sanctions-stale:${source.id}`,
          details: { sourceId: source.id, error: error.message },
        }).catch(() => {});
      }
    }
  }
  return results;
}

/** Required + enabled sources that are missing or stale. */
async function staleRequiredSources(client = pool) {
  const { rows } = await client.query(
    `SELECT id, last_success_at, max_age_hours, active_version_id
       FROM credit_sanctions_list_sources
      WHERE enabled = TRUE AND required = TRUE
        AND (active_version_id IS NULL OR last_success_at IS NULL
             OR last_success_at < NOW() - (max_age_hours * INTERVAL '1 hour'))`
  );
  return rows.map((r) => r.id);
}

async function activeVersions(client = pool) {
  const { rows } = await client.query(
    `SELECT s.id AS source_id, v.id AS version_id, v.sha256, v.fetched_at
       FROM credit_sanctions_list_sources s
       JOIN credit_sanctions_list_versions v ON v.id = s.active_version_id
      WHERE s.enabled = TRUE`
  );
  return rows.map((r) => ({ source: r.source_id, version: r.version_id, sha256: r.sha256, fetchedAt: r.fetched_at }));
}

/**
 * Candidate retrieval (pg_trgm) + in-house scoring. Returns matches at or
 * above the review threshold, best first.
 */
async function searchName(client, name, { limit = 25, threshold = MATCH_THRESHOLD() } = {}) {
  const normalized = normalizeName(name);
  if (normalized.length < 2) return [];
  const { rows } = await client.query(
    `SELECT n.name AS matched_name, n.normalized, n.strength, n.source_id,
            e.id AS entry_id, e.version_id, e.external_id, e.entry_type, e.primary_name,
            e.programs, e.countries, e.birth_dates,
            similarity(n.normalized, $1) AS trigram
       FROM credit_sanctions_list_names n
       JOIN credit_sanctions_list_entries e ON e.id = n.entry_id
       JOIN credit_sanctions_list_sources s ON s.id = n.source_id AND s.enabled = TRUE
      WHERE n.normalized % $1
      ORDER BY similarity(n.normalized, $1) DESC
      LIMIT 400`,
    [normalized]
  );
  const best = new Map();
  for (const row of rows) {
    const entity = row.entry_type === 'entity' || row.entry_type === 'vessel' || row.entry_type === 'aircraft';
    // A one-word list name ("PIERRE", "BARBECUE") must not match every
    // multi-word customer name that contains it: compare whole strings.
    const listTokens = tokens(row.matched_name, { entity });
    const queryTokens = tokens(name, { entity });
    let score;
    if (listTokens.length < 2 && queryTokens.length >= 2) {
      const a = normalized.replace(/ /g, '');
      const b = row.normalized.replace(/ /g, '');
      score = jaroWinkler(a, b) * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
    } else {
      score = nameSimilarity(name, row.matched_name, { entity });
    }
    if (row.strength === 'weak') score *= 0.95; // low-quality alias: still surfaced, ranked lower
    if (score < threshold) continue;
    const key = `${row.source_id}:${row.external_id}`;
    if (!best.has(key) || best.get(key).score < score) {
      best.set(key, {
        sourceId: row.source_id,
        versionId: row.version_id,
        entryId: row.entry_id,
        externalId: row.external_id,
        entryType: row.entry_type,
        primaryName: row.primary_name,
        matchedName: row.matched_name,
        queryName: name,
        score: Math.round(score * 10000) / 10000,
        programs: row.programs || [],
        countries: row.countries || [],
        birthDates: row.birth_dates || [],
      });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function subjectNames(attributes = {}) {
  const names = [];
  if (attributes.verifiedName) names.push(attributes.verifiedName);
  const full = [attributes.firstName, attributes.lastName].filter(Boolean).join(' ').trim();
  if (full) names.push(full);
  if (attributes.businessName) names.push(attributes.businessName);
  if (attributes.name) names.push(attributes.name);
  if (attributes.holderName) names.push(attributes.holderName);
  return [...new Set(names.map((n) => String(n).trim()).filter((n) => normalizeName(n).length >= 2))];
}

/**
 * Screening provider backed by the in-house lists. Implements the
 * sanctionsScreeningService provider interface and adds evidence.
 */
const inHouseListProvider = {
  name: 'in_house_lists',
  async screenSubject({ subjectType, subjectId, attributes, client = pool }) {
    const stale = await staleRequiredSources(client);
    if (stale.length) {
      return {
        result: 'error',
        reference: null,
        hitContext: `lists_stale:${stale.join(',')}`,
        details: { error: `Required sanctions lists are missing or stale: ${stale.join(', ')}` },
      };
    }
    const names = subjectNames(attributes);
    const versions = await activeVersions(client);
    if (!names.length) {
      return {
        result: 'hit',
        reference: `in_house:${subjectType}:${subjectId}:no_name`,
        hitContext: 'no_name_on_file',
        evidence: { names, matches: [], versions },
      };
    }
    const matches = [];
    for (const name of names) matches.push(...await searchName(client, name));
    matches.sort((a, b) => b.score - a.score);
    const top = matches[0] || null;
    return {
      result: top ? 'hit' : 'clear',
      reference: `in_house:${sha256(JSON.stringify(versions)).slice(0, 16)}`,
      hitContext: top ? `list_match:${top.sourceId}:${top.externalId}:${top.score}` : null,
      evidence: { names, matches: matches.slice(0, 25), versions, topScore: top ? top.score : 0 },
    };
  },
};

/** Persist evidence for an in-house screening (matches, versions, names). */
async function recordScreeningEvidence(client, screening, { subjectType, subjectId, evidence, triggerReason = null }) {
  if (!evidence) return;
  await client.query(
    `UPDATE oxsteed_credit_sanctions_screenings
        SET list_versions = $2, screened_name = $3, top_score = $4, trigger_reason = COALESCE($5, trigger_reason)
      WHERE id = $1`,
    [screening.id, JSON.stringify(evidence.versions || []), (evidence.names || []).join(' | ').slice(0, 1000) || null, evidence.topScore || 0, triggerReason]
  );
  for (const m of evidence.matches || []) {
    await client.query(
      `INSERT INTO credit_sanctions_screening_matches
         (screening_id, source_id, version_id, entry_id, external_id, query_name, matched_name, score, entry_type, programs, countries, birth_dates)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [screening.id, m.sourceId, m.versionId, m.entryId, m.externalId, m.queryName, m.matchedName, m.score, m.entryType, m.programs, m.countries, m.birthDates]
    );
  }
  for (const name of evidence.names || []) {
    await client.query(
      `INSERT INTO credit_sanctions_subject_names (subject_type, subject_id, normalized, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subject_type, subject_id, normalized) DO UPDATE SET updated_at = NOW(), name = EXCLUDED.name`,
      [subjectType, String(subjectId), normalizeName(name), name]
    );
  }
}

// ── Screening request outbox and rescreens ───────────────────────────────

function providerIsInHouse() {
  return require('../sanctionsScreeningService').SANCTIONS_PROVIDER_NAME === 'in_house_lists';
}

async function enqueue(client, subjectType, subjectId, reason, ref = null) {
  await client.query('SELECT credit_sanctions_enqueue($1, $2, $3, $4)', [subjectType, String(subjectId), reason, ref]);
}

async function processScreeningQueue({ limit = 200 } = {}) {
  const screening = require('../sanctionsScreeningService');
  const inHouse = providerIsInHouse();
  const { rows } = await pool.query(
    `SELECT id, subject_type, subject_id, reason FROM credit_sanctions_screening_requests
      WHERE processed_at IS NULL AND attempts < 10
      ORDER BY created_at LIMIT $1`,
    [limit]
  );
  const summary = { processed: 0, hits: 0, errors: 0, deferred: 0 };
  for (const req of rows) {
    if (!inHouse) {
      // The manual provider would turn every signup into a manual hit; wait
      // for the in-house lists (the first list version enqueues everyone).
      await pool.query(
        `UPDATE credit_sanctions_screening_requests SET processed_at = NOW(), outcome = 'deferred_manual_provider' WHERE id = $1`,
        [req.id]
      );
      summary.deferred += 1;
      continue;
    }
    try {
      await withTransaction(pool, async (client) => {
        const locked = await client.query(
          'SELECT id FROM credit_sanctions_screening_requests WHERE id = $1 AND processed_at IS NULL FOR UPDATE SKIP LOCKED', [req.id]
        );
        if (!locked.rows[0]) return;
        const row = await screening.screenSubjectIfStale(client, {
          subjectType: req.subject_type, subjectId: req.subject_id, force: true, triggerReason: req.reason,
        });
        if (row.result === 'hit' && !row.cleared_at) {
          summary.hits += 1;
          const { openComplianceCase } = require('../complianceCaseService');
          await openComplianceCase(client, {
            caseType: 'sanctions_hit',
            subjectType: req.subject_type,
            subjectId: req.subject_id,
            severity: 'high',
            evidence: { screeningId: String(row.id), hitContext: row.hit_context, trigger: req.reason },
            dedupeKey: `sanctions_hit:${req.subject_type}:${req.subject_id}:${row.id}`,
          });
        }
        if (row.result === 'error') throw new Error(row.hit_context || 'screening error');
        await client.query(
          `UPDATE credit_sanctions_screening_requests SET processed_at = NOW(), outcome = $2, attempts = attempts + 1 WHERE id = $1`,
          [req.id, row.result]
        );
      }, 'credit_sanctions_queue');
      summary.processed += 1;
    } catch (error) {
      summary.errors += 1;
      await pool.query(
        `UPDATE credit_sanctions_screening_requests SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [req.id, String(error.message).slice(0, 500)]
      ).catch(() => {});
    }
  }
  return summary;
}

/**
 * After a list update: rescreen subjects whose stored names are close to a
 * name the update added. The first version of a source (or a very large
 * delta) rescreens every known Credit subject.
 */
async function rescreenAfterListChanges() {
  const { rows: versions } = await pool.query(
    `SELECT v.id, v.source_id, v.added_name_count,
            (SELECT COUNT(*) FROM credit_sanctions_list_versions p
              WHERE p.source_id = v.source_id AND p.status = 'superseded') AS prior
       FROM credit_sanctions_list_versions v
      WHERE v.status = 'active' AND v.rescreened_at IS NULL
      ORDER BY v.fetched_at`
  );
  let enqueued = 0;
  for (const v of versions) {
    await withTransaction(pool, async (client) => {
      if (Number(v.prior) === 0 || Number(v.added_name_count) > FULL_RESCREEN_DELTA) {
        const r = await client.query(
          `WITH subjects AS (
             SELECT DISTINCT 'customer'::text AS t, a.customer_id::text AS id
               FROM oxsteed_credit_accounts a WHERE a.customer_id IS NOT NULL
             UNION SELECT DISTINCT 'partner', a.partner_id::text
               FROM oxsteed_credit_accounts a WHERE a.partner_id IS NOT NULL
             UNION SELECT subject_type, subject_id FROM credit_sanctions_subject_names WHERE subject_type <> 'counterparty'
           )
           SELECT credit_sanctions_enqueue(t, id, 'list_update', $1) FROM subjects`,
          [`version:${v.id}`]
        );
        enqueued += r.rowCount;
      } else if (Number(v.added_name_count) > 0) {
        const r = await client.query(
          `SELECT credit_sanctions_enqueue(s.subject_type, s.subject_id, 'list_update', $1)
             FROM (SELECT DISTINCT sn.subject_type, sn.subject_id
                     FROM credit_sanctions_list_deltas d
                     JOIN credit_sanctions_subject_names sn ON sn.normalized % d.normalized
                    WHERE d.version_id = $2 AND sn.subject_type <> 'counterparty') s`,
          [`version:${v.id}`, v.id]
        );
        enqueued += r.rowCount;
      }
      await client.query('UPDATE credit_sanctions_list_versions SET rescreened_at = NOW() WHERE id = $1', [v.id]);
    }, 'credit_sanctions_rescreen');
  }
  return { versions: versions.length, enqueued };
}

// ── Counterparty names (payout account holders, free names) ─────────────

/**
 * Counterparty (account holder) screening is on with the in-house provider,
 * or explicitly with OXSTEED_SANCTIONS_SCREEN_COUNTERPARTIES=true. With the
 * manual provider every customer already needs a human clearance.
 */
async function counterpartyScreeningActive() {
  return providerIsInHouse() || process.env.OXSTEED_SANCTIONS_SCREEN_COUNTERPARTIES === 'true';
}

/**
 * Screen a free-text counterparty name (e.g. the holder of a payout bank
 * account) against the in-house lists. Never throws on a match; returns
 * { clear, screening, matches }. The screening row, its evidence and any
 * case are written on the pool (autocommit) so they survive the caller's
 * transaction rolling back after a refusal.
 */
async function screenCounterpartyName({ name, context = {} }) {
  const normalized = normalizeName(name);
  if (normalized.length < 2) throw new AppError('A counterparty name is required', 400, 'credit_counterparty_name_required');
  const subjectId = sha256(normalized).slice(0, 40);
  const stale = await staleRequiredSources(pool);
  if (stale.length && process.env.OXSTEED_SANCTIONS_COUNTERPARTY_ALLOW_STALE !== 'true') {
    throw new AppError('Sanctions lists are not current; payouts are paused until they refresh.', 503, 'credit_sanctions_lists_stale', { stale });
  }
  const matches = await searchName(pool, name);
  const versions = await activeVersions(pool);
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_sanctions_screenings
       (subject_type, subject_id, provider, result, hit_context, payload_hash, sla_due_at, list_versions, trigger_reason, screened_name, top_score)
     VALUES ('counterparty', $1, 'in_house_lists', $2::varchar, $3, $4,
             CASE WHEN $2::varchar = 'hit' THEN NOW() + INTERVAL '24 hours' ELSE NULL END, $5, $6, $7, $8)
     RETURNING *`,
    [
      subjectId,
      matches.length ? 'hit' : 'clear',
      matches.length ? `list_match:${matches[0].sourceId}:${matches[0].externalId}:${matches[0].score}` : null,
      sha256(JSON.stringify({ normalized, context })),
      JSON.stringify(versions),
      String(context.reason || 'counterparty').slice(0, 40),
      String(name).slice(0, 300),
      matches[0] ? matches[0].score : 0,
    ]
  );
  if (!matches.length) return { clear: true, screening: row, matches };
  await recordScreeningEvidence(pool, row, { subjectType: 'counterparty', subjectId, evidence: { names: [name], matches, versions, topScore: matches[0].score } });
  // A reviewer's clearance of this exact name (false positive) holds for
  // 180 days unless someone confirmed a true match since.
  const { rows: cleared } = await pool.query(
    `SELECT id FROM oxsteed_credit_sanctions_screenings
      WHERE subject_type = 'counterparty' AND subject_id = $1 AND cleared_at IS NOT NULL
        AND cleared_at > NOW() - INTERVAL '180 days'
        AND NOT EXISTS (SELECT 1 FROM oxsteed_credit_sanctions_screenings c
                         WHERE c.subject_type = 'counterparty' AND c.subject_id = $1 AND c.confirmed_at IS NOT NULL AND c.cleared_at IS NULL)
      LIMIT 1`,
    [subjectId]
  );
  if (cleared[0]) return { clear: true, previouslyCleared: true, screening: row, matches };
  if (context.customerId) {
    const { openComplianceCase } = require('../complianceCaseService');
    await openComplianceCase(pool, {
      caseType: 'sanctions_hit',
      subjectType: 'customer',
      subjectId: String(context.customerId),
      severity: 'critical',
      evidence: { screeningId: String(row.id), counterpartyName: String(name).slice(0, 300), matches: matches.slice(0, 5), context },
      dedupeKey: `sanctions_counterparty:${subjectId}:${context.customerId}`,
    });
  }
  return { clear: false, screening: row, matches };
}

/** Throwing variant for payout paths: 403 on an uncleared match. */
async function assertCounterpartyNameClear(client, { name, context = {} }) {
  const outcome = await screenCounterpartyName({ name, context });
  if (outcome.clear) return outcome;
  throw new AppError('This payout is blocked pending sanctions review.', 403, 'credit_sanctions_match', {
    screeningId: String(outcome.screening.id), subjectType: 'counterparty',
  });
}

// ── Custom list (two administrators) ────────────────────────────────────

function validateCustomAdd(payload) {
  const name = String(payload?.primaryName || '').trim();
  if (name.length < 2 || name.length > 300) throw new AppError('primaryName is required', 400, 'validation_failed');
  const type = String(payload?.entryType || 'individual');
  if (!['individual', 'entity', 'vessel', 'aircraft', 'unknown'].includes(type)) throw new AppError('entryType is invalid', 400, 'validation_failed');
  const legalBasis = String(payload?.legalBasis || '').trim();
  if (legalBasis.length < 3) throw new AppError('legalBasis is required (e.g. the Haitian order or the internal decision)', 400, 'validation_failed');
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
  return {
    primaryName: name, entryType: type, legalBasis: legalBasis.slice(0, 500),
    aliases: list(payload.aliases), countries: list(payload.countries), birthDates: list(payload.birthDates),
    sourceReference: payload.sourceReference ? String(payload.sourceReference).slice(0, 1000) : null,
  };
}

async function applyCustomAdd({ client, payload, requestedBy, actorUserId }) {
  const v = validateCustomAdd(payload);
  const { rows: [row] } = await client.query(
    `INSERT INTO credit_sanctions_custom_entries
       (entry_type, primary_name, aliases, countries, birth_dates, legal_basis, source_reference, added_by, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [v.entryType, v.primaryName, v.aliases, v.countries, v.birthDates, v.legalBasis, v.sourceReference, requestedBy, actorUserId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.sanctions.custom_entry_added', actorUserId, resourceType: 'credit_sanctions_custom_entry',
    resourceId: row.id, reason: v.legalBasis, afterState: { ...v, addedBy: requestedBy },
  });
  // Rebuild after commit so the new name is screened promptly.
  setImmediate(() => { rebuildCustomList(actorUserId).catch((e) => logger.warn('custom list rebuild failed', { error: e.message })); });
  return { id: row.id };
}
applyCustomAdd.validate = validateCustomAdd;

function validateCustomRemove(payload) {
  if (!/^[0-9a-f-]{36}$/i.test(String(payload?.entryId || ''))) throw new AppError('entryId is required', 400, 'validation_failed');
  const reason = String(payload?.reason || '').trim();
  if (reason.length < 5) throw new AppError('reason is required', 400, 'validation_failed');
  return { entryId: payload.entryId, reason: reason.slice(0, 1000) };
}

async function applyCustomRemove({ client, payload, requestedBy, actorUserId }) {
  const v = validateCustomRemove(payload);
  const { rows } = await client.query(
    `UPDATE credit_sanctions_custom_entries
        SET removed_at = NOW(), removed_by = $2, removal_approved_by = $3, removal_reason = $4
      WHERE id = $1 AND removed_at IS NULL RETURNING id`,
    [v.entryId, requestedBy, actorUserId, v.reason]
  );
  if (!rows[0]) throw new AppError('Custom entry not found or already removed', 404, 'sanctions_custom_entry_not_found');
  await insertComplianceAudit(client, {
    actionType: 'credit.sanctions.custom_entry_removed', actorUserId, resourceType: 'credit_sanctions_custom_entry',
    resourceId: v.entryId, reason: v.reason, afterState: { removedBy: requestedBy },
  });
  setImmediate(() => { rebuildCustomList(actorUserId).catch((e) => logger.warn('custom list rebuild failed', { error: e.message })); });
  return { id: v.entryId };
}
applyCustomRemove.validate = validateCustomRemove;

function registerOversightActions(register) {
  register('credit_sanctions_custom_entry_add', applyCustomAdd);
  register('credit_sanctions_custom_entry_remove', applyCustomRemove);
}

// ── Admin read models ────────────────────────────────────────────────────

async function listSources(client = pool) {
  const { rows } = await client.query(
    `SELECT s.*, v.sha256, v.entry_count, v.name_count, v.fetched_at AS version_fetched_at, v.published_at,
            v.added_name_count, v.removed_name_count,
            (s.last_success_at IS NOT NULL AND s.last_success_at >= NOW() - (s.max_age_hours * INTERVAL '1 hour')) AS fresh
       FROM credit_sanctions_list_sources s
       LEFT JOIN credit_sanctions_list_versions v ON v.id = s.active_version_id
      ORDER BY s.id`
  );
  return rows;
}

async function listScreeningMatches(client, screeningId) {
  const { rows } = await client.query(
    'SELECT * FROM credit_sanctions_screening_matches WHERE screening_id = $1 ORDER BY score DESC', [screeningId]
  );
  return rows;
}

async function listCustomEntries(client = pool) {
  const { rows } = await client.query('SELECT * FROM credit_sanctions_custom_entries ORDER BY created_at DESC LIMIT 500');
  return rows;
}

module.exports = {
  MATCH_THRESHOLD,
  parseFor,
  ingestParsed,
  ingestFile,
  refreshSource,
  refreshAllSources,
  rebuildCustomList,
  staleRequiredSources,
  activeVersions,
  searchName,
  subjectNames,
  inHouseListProvider,
  recordScreeningEvidence,
  enqueue,
  processScreeningQueue,
  rescreenAfterListChanges,
  counterpartyScreeningActive,
  screenCounterpartyName,
  assertCounterpartyNameClear,
  validateCustomAdd,
  validateCustomRemove,
  applyCustomAdd,
  applyCustomRemove,
  registerOversightActions,
  listSources,
  listScreeningMatches,
  listCustomEntries,
};
