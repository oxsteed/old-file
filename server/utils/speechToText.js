/**
 * Speech-to-text transcription via OpenRouter.
 *
 * ⚠️  STATUS: Template for future enhancement
 * This module is not yet integrated into the speech-to-text flow.
 * The current implementation uses browser Web Speech API (free, fast, works now).
 *
 * PLANNED: Replace with a proper audio transcription service (Whisper, AssemblyAI, etc.)
 * when OpenRouter adds audio transcription support via a dedicated endpoint.
 *
 * This file is preserved as a reference implementation for when audio transcription
 * backend support is added.
 */

const logger = require('./logger');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

/**
 * TODO: Implement audio transcription using a proper service.
 *
 * This is a placeholder for future enhancement. Currently:
 * 1. Web Speech API handles transcription in the browser
 * 2. Desktop fallback can be added via Whisper API / AssemblyAI / similar
 *
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} languageHint - Language code hint (en, es, fr, ht, etc)
 * @returns {Promise<{ transcript: string, confidence: number, language: string }>}
 *
 * @throws {Error} Not yet implemented
 */
async function transcribeAudio(audioBuffer, languageHint = 'en') {
  logger.warn('transcribeAudio called but not yet implemented', {
    audioSize: audioBuffer?.length,
    language: languageHint,
  });

  throw new Error(
    'Audio transcription fallback is not yet implemented. ' +
    'Current implementation uses Web Speech API in the browser. ' +
    'To add backend transcription, integrate with Whisper API or AssemblyAI.'
  );
}

module.exports = { transcribeAudio };
