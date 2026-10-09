'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, execFile: jest.fn() };
});

const { execFile } = require('child_process');
const {
  extractPoster,
  posterFileReady,
} = require('../services/videoTranscodeWorker');

describe('video transcode poster extraction', () => {
  let tmpDir;
  let sourcePath;
  let posterPath;

  beforeEach(async () => {
    execFile.mockReset();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'poster-test-'));
    sourcePath = path.join(tmpDir, 'source.mp4');
    posterPath = path.join(tmpDir, 'poster.jpg');
    await fsp.writeFile(sourcePath, 'not-a-real-video');
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  test('retries from the first frame when ffmpeg exits 0 without writing a poster', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      const outPath = args[args.length - 1];
      const seekIdx = args.indexOf('-ss');
      const seek = seekIdx >= 0 ? args[seekIdx + 1] : null;
      if (outPath === posterPath && seek !== '0') {
        callback(null, '', '');
        return;
      }
      if (outPath === posterPath && seek === '0') {
        fs.writeFileSync(outPath, 'jpeg');
        callback(null, '', '');
        return;
      }
      callback(null, '', '');
    });

    await extractPoster(sourcePath, posterPath, 1);
    expect(await posterFileReady(posterPath)).toBe(true);
    const posterCalls = execFile.mock.calls.filter((call) => call[1][call[1].length - 1] === posterPath);
    expect(posterCalls.length).toBeGreaterThanOrEqual(2);
  });
});
