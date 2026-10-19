import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEUE_SOUND_STORAGE_KEY,
  getWebAudioContextClass,
  readSoundPreference,
  writeSoundPreference,
} from './displayAudio.js';

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
  };
}

test('sound preference uses the legacy queue board key', () => {
  assert.equal(QUEUE_SOUND_STORAGE_KEY, 'oxsteed:queue:sound');
});

test('sound defaults to off and round-trips', () => {
  const storage = fakeStorage();
  assert.equal(readSoundPreference(storage), false);
  writeSoundPreference(true, storage);
  assert.equal(readSoundPreference(storage), true);
  writeSoundPreference(false, storage);
  assert.equal(readSoundPreference(storage), false);
});

test('a previously enabled board restores sound on after reload', () => {
  const storage = fakeStorage({ [QUEUE_SOUND_STORAGE_KEY]: '1' });
  assert.equal(readSoundPreference(storage), true);
});

test('corrupt or missing values read as off', () => {
  assert.equal(readSoundPreference(fakeStorage()), false);
  assert.equal(
    readSoundPreference(fakeStorage({ [QUEUE_SOUND_STORAGE_KEY]: 'yes' })),
    false,
  );
});

test('missing storage never throws', () => {
  assert.equal(readSoundPreference(null), false);
  writeSoundPreference(true, null);
});

test('standard AudioContext is preferred', () => {
  class FakeAudio {}
  class FakeWebkit {}
  assert.equal(
    getWebAudioContextClass({ AudioContext: FakeAudio, webkitAudioContext: FakeWebkit }),
    FakeAudio,
  );
});

test('webkit prefix is used when standard is missing (older iOS)', () => {
  class FakeWebkit {}
  assert.equal(
    getWebAudioContextClass({ webkitAudioContext: FakeWebkit }),
    FakeWebkit,
  );
});

test('no WebAudio support returns null', () => {
  assert.equal(getWebAudioContextClass({}), null);
  assert.equal(getWebAudioContextClass(null), null);
  assert.equal(getWebAudioContextClass(undefined), null);
});
