/**
 * SpeechToTextInput.tsx
 * Speech-to-text input using browser Web Speech API.
 *
 * Features:
 * - Live microphone input with visual feedback
 * - Confidence scoring (0-100%)
 * - Editable transcript before submission
 * - Language context from user preferences
 *
 * Note: Uses Web Speech API (free, fast, browser-native).
 * OpenRouter transcription fallback is planned for future enhancement.
 */

import React, { useRef, useState, useCallback } from 'react';
import TranscriptConfidenceIndicator from './TranscriptConfidenceIndicator';
import { Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SpeechToTextInputProps {
  language?: string; // User's language preference (en, es, fr, ht, etc)
  placeholder?: string;
  onTranscriptReady?: (transcript: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

type SpeechRecognitionEventType = Event & {
  resultIndex: number;
  results: {
    [index: number]: {
      [index: number]: { transcript: string; confidence: number };
      isFinal: boolean;
      length: number;
    };
    length: number;
  };
};

export default function SpeechToTextInput({
  language = 'en',
  placeholder = 'speechToText.placeholder',
  onTranscriptReady,
  onError,
  className = '',
}: SpeechToTextInputProps) {
  const [transcript, setTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation('common');
  const placeholderText = t(placeholder);

  const speechRecognitionRef = useRef<any>(null);

  // Initialize Web Speech API on mount
  React.useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const msg = t('speechToText.errors.unsupported');
      setError(msg);
      onError?.(msg);
      return;
    }

    speechRecognitionRef.current = new SpeechRecognition();
    const recognition = speechRecognitionRef.current;

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.language = language;

    recognition.onstart = () => {
      setIsRecording(true);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEventType) => {
      let interimTranscript = '';
      let finalTranscript = '';
      let maxConfidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const conf = event.results[i][0].confidence;

        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
          maxConfidence = Math.max(maxConfidence, conf);
        } else {
          interimTranscript += transcript;
        }
      }

      const displayText = (finalTranscript || interimTranscript).trim();
      if (displayText) {
        setTranscript(displayText);
        // Use final confidence, or 0.5 for interim results
        setConfidence(maxConfidence > 0 ? maxConfidence : finalTranscript ? 0.8 : 0.5);
        setHasRecorded(true);
      }
    };

    recognition.onerror = (event: any) => {
      const errorMsg = event.error === 'no-speech'
        ? t('speechToText.errors.noSpeech')
        : event.error === 'network'
          ? t('speechToText.errors.network')
          : t('speechToText.errors.generic', { reason: event.error });
      setError(errorMsg);
      onError?.(errorMsg);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    return () => {
      if (recognition) {
        recognition.abort();
      }
    };
  }, [language]);

  const handleToggleRecording = useCallback(() => {
    if (!speechRecognitionRef.current) return;

    if (isRecording) {
      speechRecognitionRef.current.stop();
      setIsRecording(false);
    } else {
      setError(null);
      setTranscript('');
      setConfidence(0);
      speechRecognitionRef.current.start();
    }
  }, [isRecording]);

  const handleClear = () => {
    setTranscript('');
    setConfidence(0);
    setHasRecorded(false);
    setError(null);
  };

  const handleSubmit = () => {
    if (!transcript.trim()) {
      setError(t('speechToText.errors.emptyTranscript'));
      return;
    }
    onTranscriptReady?.(transcript);
    handleClear();
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Microphone button */}
      <button
        type="button"
        onClick={handleToggleRecording}
        disabled={false}
        className={`
          w-full p-3 rounded-lg transition-all flex items-center justify-center gap-2
          ${isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white'
          }
        `}
        title={isRecording ? t('actions.stopRecording') : t('actions.startRecording')}
        aria-label={isRecording ? t('actions.stopRecording') : t('actions.startRecording')}
      >
        {isRecording ? (
          <>
            <Square className="w-4 h-4" />
            <span>{t('actions.stopRecording')}</span>
          </>
        ) : (
          <>
            <Mic className="w-4 h-4" />
            <span>{t('speechToText.clickToSpeak')}</span>
          </>
        )}
      </button>

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <div className="w-2 h-2 bg-red-600 dark:bg-red-400 rounded-full animate-pulse" />
          {t('speechToText.listening')}
        </div>
      )}

      {/* Transcript display and editor */}
      {hasRecorded && (
        <div className="flex flex-col gap-2">
          {/* Confidence indicator */}
          <TranscriptConfidenceIndicator
            confidence={confidence}
            transcript={transcript}
            isImproving={false}
            onRequestImprovement={undefined} // OpenRouter not yet integrated
          />

          {/* Editable transcript */}
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={placeholderText}
            className="w-full px-3 py-2 text-sm border rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 resize-none"
            rows={3}
          />

          {/* Error message */}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!transcript.trim() || isRecording}
              className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('actions.submit')}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={isRecording}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('actions.clear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
