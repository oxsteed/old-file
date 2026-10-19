// Persistent ready-chime state for the queue board. The enable-sound choice
// survives reloads via localStorage; autoplay policies mean the AudioContext
// can only be unlocked from a real user gesture, so the hook re-unlocks on
// the enable tap and on the first pointer/key interaction after a reload.

export const QUEUE_SOUND_STORAGE_KEY = 'oxsteed:queue:sound';

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readSoundPreference(storage = safeStorage()) {
  try {
    return storage ? storage.getItem(QUEUE_SOUND_STORAGE_KEY) === '1' : false;
  } catch {
    return false;
  }
}

export function writeSoundPreference(enabled, storage = safeStorage()) {
  try {
    storage?.setItem(QUEUE_SOUND_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage unavailable: the toggle still works for this session.
  }
}

export function getWebAudioContextClass(win) {
  if (!win) return null;
  return win.AudioContext || win.webkitAudioContext || null;
}
