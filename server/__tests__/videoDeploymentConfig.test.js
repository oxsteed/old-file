'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.coolify.yml'), 'utf8');

describe('production video worker deployment contract', () => {
  test('the final runtime image installs and verifies ffmpeg and ffprobe', () => {
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('FROM '));
    expect(runtimeStage).toMatch(/RUN apk add --no-cache[^\n]*\bffmpeg\b/);
    expect(runtimeStage).toContain('/usr/bin/ffmpeg -version');
    expect(runtimeStage).toContain('/usr/bin/ffprobe -version');
  });

  test('production enables the worker with explicit operator overrides', () => {
    expect(compose).toContain('VIDEO_WORKER_ENABLED: ${VIDEO_WORKER_ENABLED:-1}');
    expect(compose).toContain('FFMPEG_PATH: ${FFMPEG_PATH:-/usr/bin/ffmpeg}');
    expect(compose).toContain('FFPROBE_PATH: ${FFPROBE_PATH:-/usr/bin/ffprobe}');
    expect(compose).toContain('CLAMAV_HOST: ${CLAMAV_HOST:-clamav}');
    expect(compose).toContain('CLAMAV_PORT: ${CLAMAV_PORT:-3310}');
  });

  test('deployment never supplies a synthetic CSAM pass or vendor by default', () => {
    expect(compose).not.toMatch(/CSAM_VENDOR:\s*(?:mock|test|none|disabled|pass)/i);
    expect(compose).not.toMatch(/CSAM_(?:SKIP|BYPASS|FAIL_OPEN)\s*:/i);
  });
});
