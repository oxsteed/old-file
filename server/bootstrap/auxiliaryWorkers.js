'use strict';

const SERVICES = [
  ['videoTranscodeWorker', 'startVideoTranscodeWorker', 'stopVideoTranscodeWorker', 'Video transcode worker failed to start; uploads stay quarantined'],
  ['mediaTranscodeWorker', 'startMediaTranscodeWorker', 'stopMediaTranscodeWorker', 'OxSteed Media video worker failed to start; uploads stay quarantined'],
  ['mediaAssetCleanupWorker', 'startMediaAssetCleanupWorker', 'stopMediaAssetCleanupWorker', 'Media asset cleanup worker failed to start; revoked delivery remains blocked'],
  ['abandonedRecoveryWorker', 'startAbandonedRecoveryWorker', 'stopAbandonedRecoveryWorker', 'Abandoned recovery worker failed to start'],
  ['directDraftAssetSweeper', 'startDirectDraftAssetSweeper', 'stopDirectDraftAssetSweeper', 'Direct draft asset sweeper failed to start'],
  ['chatPaymentRequestExpirySweeper', 'startChatPaymentRequestExpirySweeper', 'stopChatPaymentRequestExpirySweeper', 'Chat payment request expiry sweeper failed to start'],
];

function startAuxiliaryWorkers({ workers, log, load = name => require(`../services/${name}`) }) {
  for (const [name, start, stop, warning] of SERVICES) {
    try {
      const service = load(name);
      // Own partial startup too. BackgroundWorkers initiates every stop before
      // awaiting drains, and ApplicationRuntime keeps dependencies open for it.
      workers.handles.push({ stop: () => service[stop]() });
      service[start]();
    } catch (error) { log.warn(warning, { message: error.message }); }
  }
}

module.exports = { startAuxiliaryWorkers, SERVICES };
