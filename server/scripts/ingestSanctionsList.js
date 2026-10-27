#!/usr/bin/env node
'use strict';

/**
 * Ingest an official sanctions list file when the publisher blocks the
 * automated download (e.g. Global Affairs Canada from some networks).
 *
 *   node scripts/ingestSanctionsList.js --source ca_sema --file sema-lmes.xml
 *   node scripts/ingestSanctionsList.js --source ofac_sdn --file sdn.csv --aux alt.csv
 *
 * The version is recorded with ingested_via='file' and its sha256, exactly
 * like an automated fetch, and the usual truncation guard applies.
 */

const fs = require('fs');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

(async () => {
  const source = arg('source');
  const file = arg('file');
  if (!source || !file) {
    console.error('usage: ingestSanctionsList.js --source <id> --file <path> [--aux <path>]');
    process.exit(2);
  }
  const lists = require('../services/creditCompliance/sanctionsListService');
  const result = await lists.ingestFile(source, {
    primary: fs.readFileSync(file, 'utf8'),
    aux: arg('aux') ? fs.readFileSync(arg('aux'), 'utf8') : '',
  });
  console.log(JSON.stringify({
    source,
    rejected: Boolean(result.rejected),
    reason: result.reason || null,
    unchanged: Boolean(result.unchanged),
    entries: result.version ? result.version.entry_count : null,
    sha256: result.version ? result.version.sha256 : null,
  }));
  await require('../db').end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
