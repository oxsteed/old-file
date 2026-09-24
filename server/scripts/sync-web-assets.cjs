'use strict';

const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '../../client/dist/assets');
const storeRoot = path.resolve(
  process.env.WEB_ASSET_STORE || path.join(__dirname, '../runtime/web-assets'),
);
const targetDir = path.join(storeRoot, 'assets');
const retentionMs = 30 * 24 * 60 * 60 * 1000;

function copyIfMissing(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyIfMissing(path.join(source, entry), path.join(target, entry));
    }
    return 1;
  }

  if (!fs.existsSync(target)) {
    fs.copyFileSync(source, target);
    return 1;
  }
  return 0;
}

function removeExpired(dir, cutoff) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      removed += removeExpired(filePath, cutoff);
      if (fs.readdirSync(filePath).length === 0) fs.rmdirSync(filePath);
    } else if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      removed += 1;
    }
  }
  return removed;
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Client asset directory is missing: ${sourceDir}`);
}

fs.mkdirSync(targetDir, { recursive: true });
const copied = copyIfMissing(sourceDir, targetDir);
const removed = removeExpired(targetDir, Date.now() - retentionMs);

console.log(`[web-assets] retained assets synchronized: copied=${copied}, removed=${removed}`);
