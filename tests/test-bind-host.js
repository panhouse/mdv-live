import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';

import { startTestServer } from './helpers/server.js';

// Reads (/api/tree, /raw) are not Host-guarded, so the only thing keeping
// project files off the shared Wi-Fi is binding to loopback.
test('server binds to loopback only', async () => {
  const { server, port, stop } = await startTestServer({ files: { 'a.md': '# a' } });
  try {
    assert.equal(server.server.address().address, '127.0.0.1');
    const lan = Object.values(networkInterfaces()).flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    const local = await fetch(`http://127.0.0.1:${port}/api/tree`);
    assert.equal(local.status, 200);
    if (lan) {
      await assert.rejects(fetch(`http://${lan.address}:${port}/api/tree`));
    }
  } finally {
    await stop();
  }
});
