import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// Regression guard for the video-fallback feature (real user report): a
// video file the browser genuinely cannot decode (MPEG-4 Part 2, HEVC, or
// here — a fake .mp4 that's just text bytes, which reliably triggers the
// same 'error' event a truly-undecodable codec would) must not leave a dead
// black player with no explanation. It should be replaced by a fallback
// card with a download link.
//
// The companion "stays intact for a real playable video" check is simply
// running the existing 11-video.spec.js unchanged (per task instructions) —
// not duplicated here.

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-video-fallback-');
  await seedFiles(fixtureDir, {
    // Not a real container at all — every browser fails to decode this,
    // firing a genuine 'error' event (no timeout/heuristic needed).
    'broken.mp4': 'this is not a real video file, just text bytes\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('video-fallback: an undecodable mp4 shows a fallback card with a download link', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  await expect(page.locator('.tree-item[data-path="broken.mp4"] .name')).toBeVisible();
  await page.locator('.tree-item[data-path="broken.mp4"] [data-action="open"]').click();

  // A <video> player is rendered first, then the browser fails to decode
  // the fake content and fires 'error', at which point the fallback card
  // replaces it. The video->error transition can happen faster than a
  // separate assertion can observe "video visible" under parallel test
  // load, so we only assert the settled end state here (not the transient
  // one) to avoid a race.
  await expect(page.locator('#content .video-fallback')).toBeVisible();
  await expect(page.locator('#content .video-fallback-message')).toContainText('再生できない形式');
  await expect(page.locator('#content video')).toHaveCount(0);

  const downloadLink = page.locator('#content a.preview-download-btn');
  await expect(downloadLink).toBeVisible();
  await expect(downloadLink).toHaveAttribute('href', /\/api\/download\?path=broken\.mp4/);
});
