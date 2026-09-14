import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? '/tmp/4am-release-qa/node_modules/playwright/index.mjs'
);
const origin = process.env.ARENA_WEB_URL ?? 'http://127.0.0.1:5181';
const events = await (await fetch(origin + '/api/tournaments')).json();
const id = events.tournaments.find((t) => t.policy.publicWatch)?.id;
assert(id, 'A public QA tournament is required.');
const browser = await chromium.launch({ headless: true });
try {
  const c = await browser.newContext({ acceptDownloads: true });
  await c.addInitScript(() => {
    window.captureQA = { mode: 'cancel', tracks: [], audioRemoved: false, requests: 0 };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const q = window.captureQA;
      q.requests++;
      if (q.mode === 'cancel') throw new DOMException('Test picker cancelled', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      let frame = 0;
      const timer = setInterval(() => {
        ctx.fillStyle = frame++ % 2 ? '#174956' : '#264761';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#fff';
        ctx.font = '28px sans-serif';
        ctx.fillText('4AM recording verification', 24, 180);
      }, 100);
      const stream = canvas.captureStream(10),
        video = stream.getVideoTracks()[0];
      const stop = video.stop.bind(video);
      video.stop = () => {
        clearInterval(timer);
        stop();
      };
      const settings = video.getSettings.bind(video);
      video.getSettings = () => ({ ...settings(), displaySurface: 'window' });
      const audio = new AudioContext(),
        osc = audio.createOscillator(),
        destination = audio.createMediaStreamDestination();
      osc.connect(destination);
      osc.start();
      const track = destination.stream.getAudioTracks()[0],
        stopAudio = track.stop.bind(track);
      track.stop = () => {
        q.audioRemoved = true;
        stopAudio();
        osc.stop();
        void audio.close();
      };
      stream.addTrack(track);
      q.tracks = stream.getTracks();
      if (q.mode === 'pending')
        return new Promise((resolve) => {
          q.resolve = () => resolve(stream);
        });
      return stream;
    };
  });
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${origin}/tournaments/${id}/watch`);
  await p.getByRole('button', { name: 'Record tab', exact: true }).click();
  await p
    .getByText(
      'Recording was cancelled or permission was denied. Select Record tab to try again.',
      { exact: true },
    )
    .waitFor();
  await p.evaluate(() => {
    window.captureQA.mode = 'video';
  });
  await p.getByLabel('Include shared tab audio').check();
  await p.getByRole('button', { name: 'Record tab', exact: true }).click();
  await p.getByRole('button', { name: 'Stop recording', exact: true }).waitFor();
  await p.waitForTimeout(1400);
  await p.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const downloadEvent = p.waitForEvent('download');
  await p.getByRole('link', { name: 'Download recording', exact: true }).click();
  const file = await downloadEvent;
  assert(file.suggestedFilename().endsWith('.webm'));
  await file.saveAs('/tmp/4am-tournament-recording.webm');
  assert(await p.evaluate(() => window.captureQA.audioRemoved));
  assert(await p.evaluate(() => window.captureQA.tracks.every((t) => t.readyState === 'ended')));
  await p.evaluate(() => {
    window.captureQA.mode = 'pending';
  });
  await p.getByRole('button', { name: 'Record new clip', exact: true }).click();
  await p.getByRole('link', { name: 'Tournament details', exact: false }).click();
  await p.evaluate(() => window.captureQA.resolve());
  await p.waitForFunction(() => window.captureQA.tracks.every((t) => t.readyState === 'ended'));
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    capturePicker: 'stubbed with generated canvas stream; no real screen or microphone captured',
    mediaRecorder: 'real Chromium MediaRecorder',
    checks: [
      'picker cancellation recovery',
      'WebM recording and download',
      'non-tab audio removed',
      'video/audio tracks stopped',
      'unmount while picker pending cleans returned stream',
    ],
    pageErrors: errors,
  };
  await writeFile('/tmp/4am-tournament-recording-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
