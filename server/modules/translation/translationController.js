const logger = require('../../utils/logger');
const { authenticate, optionalAuth } = require('../../middleware/auth');
const {
  listLanguages,
  detectLanguage,
  translateText,
  translateLegacyBatch,
  createBatchTranslationJob,
  getTranslationById,
  listTranslationHistory,
  getTranslationJobById,
} = require('./translationService');
const {
  listGlossaries,
  getGlossaryById,
  createGlossary,
  updateGlossary,
  deleteGlossary,
  addGlossaryTerms,
  deleteGlossaryTerm,
} = require('../glossary/glossaryService');

function currentUserId(req) {
  return req.user?.id || null;
}

async function handleTranslate(req, res) {
  try {
    if (Array.isArray(req.body?.texts)) {
      const data = await translateLegacyBatch(req.body, { requesterUserId: currentUserId(req) });
      return res.json(data);
    }

    const data = await translateText(req.body, { requesterUserId: currentUserId(req) });
    return res.json(data);
  } catch (err) {
    logger.warn('Translation request failed', { err: err.message, code: err.code });
    return res.status(err.statusCode || 502).json({
      error: err.code || 'TRANSLATION_FAILED',
      message: err.message || 'Translation service unavailable',
    });
  }
}

async function handleDetectLanguage(req, res) {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      return res.status(400).json({ error: 'TEXT_REQUIRED', message: 'text is required' });
    }
    const result = await detectLanguage(text);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: 'DETECT_FAILED', message: err.message });
  }
}

async function handleLanguages(_req, res) {
  const languages = await listLanguages({ runtimeOnly: true });
  return res.json(languages);
}

async function handleLocales(_req, res) {
  const locales = await listLanguages({ runtimeOnly: false });
  return res.json(locales);
}

async function handleBatch(req, res) {
  try {
    const job = await createBatchTranslationJob(req.body, { requesterUserId: currentUserId(req) });
    return res.status(202).json(job);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.code || 'BATCH_CREATE_FAILED', message: err.message });
  }
}

async function handleGetJob(req, res) {
  const job = await getTranslationJobById(req.params.jobId, currentUserId(req));
  if (!job) {
    return res.status(404).json({ error: 'JOB_NOT_FOUND', message: 'Translation job not found' });
  }
  return res.json(job);
}

async function handleGetTranslation(req, res) {
  const translation = await getTranslationById(req.params.id);
  if (!translation) {
    return res.status(404).json({ error: 'TRANSLATION_NOT_FOUND', message: 'Translation not found' });
  }
  return res.json(translation);
}

async function handleHistory(req, res) {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const result = await listTranslationHistory({
    requesterUserId: req.user.id,
    limit,
    offset,
  });
  // Repository now returns { items, total, limit, offset }; mirror that shape.
  return res.json(result);
}

async function handleListGlossaries(req, res) {
  const items = await listGlossaries(req.user.id);
  return res.json({ items });
}

async function handleGetGlossary(req, res) {
  const glossary = await getGlossaryById(req.params.id, req.user.id);
  if (!glossary) {
    return res.status(404).json({ error: 'GLOSSARY_NOT_FOUND', message: 'Glossary not found' });
  }
  return res.json(glossary);
}

async function handleCreateGlossary(req, res) {
  const { name, domain, sourceLanguage, targetLanguage, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'NAME_REQUIRED', message: 'Glossary name is required' });
  }
  const glossary = await createGlossary({
    ownerUserId: req.user.id,
    name,
    domain,
    sourceLanguage,
    targetLanguage,
    description,
  });
  return res.status(201).json(glossary);
}

async function handleAddGlossaryTerms(req, res) {
  const terms = Array.isArray(req.body?.terms) ? req.body.terms : [];
  if (!terms.length) {
    return res.status(400).json({ error: 'TERMS_REQUIRED', message: 'terms must be a non-empty array' });
  }
  for (const term of terms) {
    if (!term || typeof term !== 'object') {
      return res.status(400).json({ error: 'TERMS_INVALID', message: 'each term must be an object' });
    }
    if (typeof term.sourceTerm !== 'string' || !term.sourceTerm.trim()) {
      return res.status(400).json({ error: 'TERMS_INVALID', message: 'sourceTerm is required on every term' });
    }
    if (typeof term.targetTerm !== 'string' || !term.targetTerm.trim()) {
      return res.status(400).json({ error: 'TERMS_INVALID', message: 'targetTerm is required on every term' });
    }
  }
  const glossary = await addGlossaryTerms(req.params.id, req.user.id, terms);
  if (!glossary) {
    return res.status(404).json({ error: 'GLOSSARY_NOT_FOUND', message: 'Glossary not found' });
  }
  return res.json(glossary);
}

async function handleUpdateGlossary(req, res) {
  const updated = await updateGlossary(req.params.id, req.user.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: 'GLOSSARY_NOT_FOUND', message: 'Glossary not found' });
  }
  return res.json(updated);
}

async function handleDeleteGlossary(req, res) {
  const ok = await deleteGlossary(req.params.id, req.user.id);
  if (!ok) {
    return res.status(404).json({ error: 'GLOSSARY_NOT_FOUND', message: 'Glossary not found' });
  }
  return res.status(204).end();
}

async function handleDeleteGlossaryTerm(req, res) {
  const ok = await deleteGlossaryTerm(req.params.id, req.params.termId, req.user.id);
  if (ok === null) {
    return res.status(404).json({ error: 'GLOSSARY_NOT_FOUND', message: 'Glossary not found' });
  }
  if (!ok) {
    return res.status(404).json({ error: 'TERM_NOT_FOUND', message: 'Glossary term not found' });
  }
  return res.status(204).end();
}

module.exports = {
  optionalAuth,
  authenticate,
  handleTranslate,
  handleDetectLanguage,
  handleLanguages,
  handleLocales,
  handleBatch,
  handleGetJob,
  handleGetTranslation,
  handleHistory,
  handleListGlossaries,
  handleGetGlossary,
  handleCreateGlossary,
  handleUpdateGlossary,
  handleDeleteGlossary,
  handleAddGlossaryTerms,
  handleDeleteGlossaryTerm,
};
