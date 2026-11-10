/**
 * Server-side speech-to-text fallback.
 *
 * STATUS: not available. The client uses the browser Web Speech API.
 *
 * Security review 2026-11-10 F-04: voice notes are personal data, so a
 * server-side transcriber must run on OxSteed's own infrastructure (for
 * example a self-hosted Whisper model next to the Ollama server). Sending
 * audio to an external transcription or AI API is not allowed, so there is
 * deliberately no provider key here.
 */

const logger = require('./logger');
const { AppError } = require('../middleware/errorHandler');

/**
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} languageHint - Language code hint (en, es, fr, ht, etc)
 * @returns {Promise<{ transcript: string, confidence: number, language: string }>}
 * @throws {AppError} 501 transcription_unavailable until a self-hosted
 *   transcriber is deployed.
 */
async function transcribeAudio(audioBuffer, languageHint = 'en') {
  logger.warn('transcribeAudio called but no self-hosted transcriber is deployed', {
    audioSize: audioBuffer?.length,
    language: languageHint,
  });
  throw new AppError('Server-side transcription is not available. Use voice input in your browser.', 501, 'transcription_unavailable');
}

module.exports = { transcribeAudio };
