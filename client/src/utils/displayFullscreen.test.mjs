import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFullscreenActive,
  resolveFullscreenExit,
  resolveFullscreenRequest,
} from './displayFullscreen.js';

test('standard requestFullscreen is preferred', () => {
  let standardCalls = 0;
  let webkitCalls = 0;
  const element = {
    requestFullscreen: () => {
      standardCalls += 1;
      return Promise.resolve();
    },
    webkitRequestFullscreen: () => {
      webkitCalls += 1;
    },
  };
  const request = resolveFullscreenRequest(element);
  assert.ok(request);
  request();
  assert.equal(standardCalls, 1);
  assert.equal(webkitCalls, 0);
});

test('webkit prefix is used when standard is missing (Safari)', () => {
  let calls = 0;
  const element = {
    webkitRequestFullscreen: () => {
      calls += 1;
    },
  };
  const request = resolveFullscreenRequest(element);
  assert.ok(request);
  request();
  assert.equal(calls, 1);
});

test('no fullscreen API (iPad Safari) resolves to null', () => {
  assert.equal(resolveFullscreenRequest({}), null);
  assert.equal(resolveFullscreenRequest(null), null);
  assert.equal(resolveFullscreenRequest(undefined), null);
});

test('fullscreen active detects both standard and webkit state', () => {
  assert.equal(isFullscreenActive({ fullscreenElement: {} }), true);
  assert.equal(isFullscreenActive({ webkitFullscreenElement: {} }), true);
  assert.equal(
    isFullscreenActive({ fullscreenElement: null, webkitFullscreenElement: null }),
    false,
  );
  assert.equal(isFullscreenActive({}), false);
  assert.equal(isFullscreenActive(null), false);
});

test('exit resolves the standard API first, then webkit', () => {
  let standardCalls = 0;
  const exit = resolveFullscreenExit({
    exitFullscreen: () => {
      standardCalls += 1;
      return Promise.resolve();
    },
    webkitExitFullscreen: () => {
      throw new Error('should not be called');
    },
  });
  assert.ok(exit);
  exit();
  assert.equal(standardCalls, 1);

  let webkitCalls = 0;
  const webkitExit = resolveFullscreenExit({
    webkitExitFullscreen: () => {
      webkitCalls += 1;
    },
  });
  webkitExit();
  assert.equal(webkitCalls, 1);

  assert.equal(resolveFullscreenExit({}), null);
  assert.equal(resolveFullscreenExit(null), null);
});
