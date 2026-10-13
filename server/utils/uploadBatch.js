'use strict';

const { AppError } = require('../middleware/errorHandler');
const { uploadFile, deleteFile } = require('./storage');

const MAX_FILES = 5;

async function uploadFilesOrThrow(files, prefix, { code = 'media_upload_failed', label = 'media' } = {}) {
  const selectedFiles = Array.isArray(files) ? files.slice(0, MAX_FILES) : [];
  if (!selectedFiles.length) return [];

  const results = await Promise.allSettled(
    selectedFiles.map((file) => uploadFile(file.buffer, prefix, file.originalname, file.mimetype))
  );
  const keys = results
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
  const failedFiles = results
    .map((result, index) => ({ result, file: selectedFiles[index] }))
    .filter(({ result }) => result.status === 'rejected' || !result.value)
    .map(({ file }) => file.originalname || 'unnamed file');

  if (!failedFiles.length) return keys;

  await Promise.allSettled(keys.map((key) => deleteFile(key)));
  throw new AppError(
    `One or more ${label} files could not be uploaded. Please retry.`,
    502,
    code,
    { failedFiles, totalFiles: selectedFiles.length }
  );
}

module.exports = { MAX_FILES, uploadFilesOrThrow };
