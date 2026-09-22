'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE_DIRECTORIES = ['server', 'client'];
const EXCLUDED_DIRECTORY_NAMES = new Set(['node_modules', 'runtime', 'dist']);

function shouldInclude(relativePath, entry) {
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) return false;
  if (entry.name === '.env' || entry.name.startsWith('.env.')) return false;
  return entry.isFile();
}

function collectFiles(rootDir, sourceDirectories = DEFAULT_SOURCE_DIRECTORIES) {
  const files = [];

  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(rootDir, relativePath);
      if (entry.isDirectory()) {
        if (!relativePath.split(path.sep).some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) {
          visit(absolutePath, relativePath);
        }
      } else if (shouldInclude(relativePath, entry)) {
        files.push(relativePath.split(path.sep).join('/'));
      }
    }
  }

  for (const sourceDirectory of sourceDirectories) {
    const absoluteDirectory = path.join(rootDir, sourceDirectory);
    if (fs.existsSync(absoluteDirectory)) visit(absoluteDirectory, sourceDirectory);
  }
  return files.sort();
}

function computeContentRelease(rootDir = path.resolve(__dirname, '..'), sourceDirectories) {
  const digest = crypto.createHash('sha256');
  for (const relativePath of collectFiles(rootDir, sourceDirectories)) {
    const fileDigest = crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, relativePath))).digest('hex');
    // Match sha256sum's stable "hash  path" line format used by prior images.
    digest.update(`${fileDigest}  ${relativePath}\n`);
  }
  return `content-${digest.digest('hex').slice(0, 16)}`;
}

if (require.main === module) {
  process.stdout.write(`${computeContentRelease()}\n`);
}

module.exports = { collectFiles, computeContentRelease };
