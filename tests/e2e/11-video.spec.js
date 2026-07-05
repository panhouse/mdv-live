import { test, expect } from '@playwright/test';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeFixtureDir, startServer, removeFixtureDir } from './helpers.js';

// Regression guard for video playback (user report 2026-07-05): the tree ->
// /api/file (mediaUrl) -> <video src="/api/download"> -> Range-request path
// must actually decode and advance. Uses a committed 11KB h264 fixture —
// h264 because that is what browsers can decode (MPEG-4 Part 2 files render
// a dead black player; that is a codec limitation, not an mdv bug).

const here = path.dirname(fileURLToPath(import.meta.url));

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-video-');
  await copyFile(
    path.join(here, 'fixtures', 'tiny-h264.mp4'),
    path.join(fixtureDir, 'demo.mp4')
  );
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('video: an h264 mp4 opens from the tree and actually plays', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  await expect(page.locator('.tree-item[data-path="demo.mp4"] .name')).toBeVisible();
  await page.locator('.tree-item[data-path="demo.mp4"] [data-action="open"]').click();

  const video = page.locator('#content video');
  await expect(video).toBeVisible();

  const result = await video.evaluate(async (v) => {
    await v.play();
    await new Promise((r) => setTimeout(r, 700));
    return {
      currentSrc: v.currentSrc,
      currentTime: v.currentTime,
      videoWidth: v.videoWidth,
      error: v.error ? v.error.message : null
    };
  });

  expect(result.currentSrc).toMatch(/\/api\/download\?path=demo\.mp4/);

  expect(result.error).toBeNull();
  expect(result.videoWidth).toBeGreaterThan(0);   // frames decoded
  expect(result.currentTime).toBeGreaterThan(0);  // playback advanced
});
