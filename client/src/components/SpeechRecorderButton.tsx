/**
 * SpeechRecorderButton.tsx
 * Low-level microphone button that records audio and returns blob
 * Used by SpeechToTextInput as a child component
 */

import React, { useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type MediaRecorderErrorEvent = Event & { error?: unknown };

interface SpeechRecorderButtonProps {
  onRecordingStart?: () => void;
  onRecordingStop?: (audioBlob: Blob, duration: number) => void;
  isDisabled?: boolean;
  className?: string;
}

export default function SpeechRecorderButton({
  onRecordingStart,
  onRecordingStop,
  isDisabled = false,
  className = '',
}: SpeechRecorderButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation('common');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const startRecording = async () => {
    try {
      setError(null);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      // Create MediaRecorder with best available MIME type
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/wav';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ''; // Use browser default
          }
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event: MediaRecorderErrorEvent) => {
        setError(`Recording error: ${event.error}`);
        stopRecording();
      };

      mediaRecorder.start();
      setIsRecording(true);
      onRecordingStart?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !streamRef.current) return;

    mediaRecorderRef.current.stop();

    // Stop all tracks to release microphone
    streamRef.current.getTracks().forEach(track => track.stop());

    const duration = Date.now() - startTimeRef.current;

    // Get the final blob
    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(chunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || 'audio/webm',
      });
      onRecordingStop?.(audioBlob, duration);
      setIsRecording(false);
    };
  };

  const handleToggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isDisabled || !!error}
        title={isRecording ? t('actions.stopRecording') : t('actions.startRecording')}
        aria-label={isRecording ? t('actions.stopRecording') : t('actions.startRecording')}
        className={`
          p-2.5 rounded-lg transition-all
          ${isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white'
          }
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
        title={isRecording ? 'Stop recording' : 'Start recording'}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isRecording ? (
          <Square className="w-5 h-5" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>

      {isRecording && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <div className="w-2 h-2 bg-red-600 dark:bg-red-400 rounded-full animate-pulse" />
          {t('actions.recording')}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
