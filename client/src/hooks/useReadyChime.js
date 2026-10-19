// Persistent ready chime for the queue board. The enable-sound choice is
// stored in localStorage so it survives reloads. Because autoplay policies
// only let a user gesture unlock WebAudio, the context is created and
// resumed on the enable tap; when the saved preference is on, the first
// pointer/key interaction after a reload re-unlocks it. If audio is blocked,
// `audioBlocked` goes true so the page can show a clean re-prompt instead of
// failing silently.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getWebAudioContextClass,
  readSoundPreference,
  writeSoundPreference,
} from '../utils/displayAudio';

function buildChime(context) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.setValueAtTime(880, context.currentTime + 0.14);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.45);
  oscillator.addEventListener('ended', () => {
    try {
      context.close();
    } catch {
      // Context already closed.
    }
  });
}

export function useReadyChime() {
  const [soundEnabled, setSoundEnabled] = useState(() => readSoundPreference());
  const [audioBlocked, setAudioBlocked] = useState(false);
  const contextRef = useRef(null);
  const enabledRef = useRef(soundEnabled);

  useEffect(() => {
    enabledRef.current = soundEnabled;
    writeSoundPreference(soundEnabled);
  }, [soundEnabled]);

  const unlock = useCallback(async () => {
    if (typeof window === 'undefined') return false;
    const ContextClass = getWebAudioContextClass(window);
    if (!ContextClass) return false;
    try {
      if (!contextRef.current || contextRef.current.state === 'closed') {
        contextRef.current = new ContextClass();
      }
      if (contextRef.current.state === 'suspended') {
        await contextRef.current.resume();
      }
      return contextRef.current.state === 'running';
    } catch {
      return false;
    }
  }, []);

  // Re-unlock on the first gesture after a reload when the saved
  // preference is on (autoplay policy requires a gesture).
  useEffect(() => {
    if (!soundEnabled || typeof window === 'undefined') return undefined;
    const onGesture = () => {
      unlock().then((ok) => {
        if (ok) setAudioBlocked(false);
      });
    };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [soundEnabled, unlock]);

  const enableSound = useCallback(async () => {
    const ok = await unlock();
    setAudioBlocked(!ok);
    setSoundEnabled(true);
    return ok;
  }, [unlock]);

  const disableSound = useCallback(() => {
    setSoundEnabled(false);
    setAudioBlocked(false);
  }, []);

  const playChime = useCallback(async () => {
    if (!enabledRef.current) return false;
    const ok = await unlock();
    if (!ok || !contextRef.current) {
      setAudioBlocked(true);
      return false;
    }
    try {
      buildChime(contextRef.current);
      contextRef.current = null;
      return true;
    } catch {
      setAudioBlocked(true);
      return false;
    }
  }, [unlock]);

  useEffect(
    () => () => {
      if (contextRef.current) {
        try {
          contextRef.current.close();
        } catch {
          // Already closed.
        }
        contextRef.current = null;
      }
    },
    [],
  );

  return { soundEnabled, audioBlocked, enableSound, disableSound, playChime };
}
