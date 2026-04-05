/**
 * WebSocket management tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import WebSocket from 'ws';
import { setupWebSocket } from '../src/websocket.js';

describe('WebSocket', () => {
  let server;
  let wss;
  let testPort;
  const openClients = [];

  before(async () => {
    server = http.createServer();
    wss = setupWebSocket(server);
    await new Promise((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, () => {
        testPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    // Close all clients and wait for each to fully close
    await Promise.all(openClients.map(ws =>
      new Promise(resolve => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.on('close', resolve);
        ws.close();
      })
    ));
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });

  function connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connect timeout'));
      }, 3000);
      ws.on('open', () => { clearTimeout(timeout); openClients.push(ws); resolve(ws); });
      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  /** Wait until clientWatches.size reaches the expected count */
  function waitForClientCount(expected, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (wss.clientWatches.size === expected) return resolve();
        if (Date.now() > deadline) return reject(new Error(`clientWatches.size is ${wss.clientWatches.size}, expected ${expected}`));
        setTimeout(check, 10);
      };
      check();
    });
  }

  /** Wait until a predicate on clientWatches is true */
  function waitForWatch(predicate, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        for (const [, watches] of wss.clientWatches) {
          if (predicate(watches)) return resolve();
        }
        if (Date.now() > deadline) return reject(new Error('watch predicate not satisfied'));
        setTimeout(check, 10);
      };
      check();
    });
  }

  it('should accept connections and track in clientWatches', async () => {
    const before = wss.clientWatches.size;
    const ws = await connect();
    await waitForClientCount(before + 1);
  });

  it('should handle watch messages', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'watch', path: 'test.md' }));
    await waitForWatch(w => w.has('test.md'));
  });

  it('should broadcast to all clients', async () => {
    const ws1 = await connect();
    const ws2 = await connect();

    const received = [];
    const p1 = new Promise(resolve => ws1.on('message', (d) => { received.push(JSON.parse(d)); resolve(); }));
    const p2 = new Promise(resolve => ws2.on('message', (d) => { received.push(JSON.parse(d)); resolve(); }));

    wss.broadcast({ type: 'tree_update' });
    await Promise.all([p1, p2]);

    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].type, 'tree_update');
  });

  it('should broadcastFileUpdate only to watching clients', async () => {
    const ws1 = await connect();
    const ws2 = await connect();

    ws1.send(JSON.stringify({ type: 'watch', path: 'target.md' }));
    ws2.send(JSON.stringify({ type: 'watch', path: 'other.md' }));
    await waitForWatch(w => w.has('target.md'));
    await waitForWatch(w => w.has('other.md'));

    const received1 = [];
    const received2 = [];
    ws1.on('message', (d) => received1.push(JSON.parse(d)));
    ws2.on('message', (d) => received2.push(JSON.parse(d)));

    wss.broadcastFileUpdate('target.md', { type: 'file_update', path: 'target.md' });

    // Wait for ws1 to receive, then verify ws2 did not
    await new Promise(resolve => {
      const orig = ws1.on;
      const check = setInterval(() => {
        if (received1.length > 0) { clearInterval(check); resolve(); }
      }, 10);
      setTimeout(() => { clearInterval(check); resolve(); }, 500);
    });

    assert.strictEqual(received1.length, 1, 'ws1 should receive update');
    assert.strictEqual(received2.length, 0, 'ws2 should not receive update');
  });

  it('should clean up clientWatches on close', async () => {
    const before = wss.clientWatches.size;
    const ws = await connect();
    await waitForClientCount(before + 1);

    // Close and wait for cleanup event
    await new Promise(resolve => {
      ws.on('close', resolve);
      ws.close();
    });
    await waitForClientCount(before);
  });

  it('should reject oversized watch paths', async () => {
    const ws = await connect();
    const longPath = 'a'.repeat(1025);
    ws.send(JSON.stringify({ type: 'watch', path: longPath }));

    // Send a valid path after, then wait for that — proves server processed both messages
    ws.send(JSON.stringify({ type: 'watch', path: 'valid.md' }));
    await waitForWatch(w => w.has('valid.md'));

    let found = false;
    for (const [, watches] of wss.clientWatches) {
      if (watches.has(longPath)) found = true;
    }
    assert.ok(!found, 'oversized path should be rejected');
  });

  it('should handle invalid JSON gracefully', async () => {
    const before = wss.clientWatches.size;
    const ws = await connect();
    await waitForClientCount(before + 1);
    ws.send('not json');
    // Send valid message after to prove connection is still alive
    ws.send(JSON.stringify({ type: 'watch', path: 'after-invalid.md' }));
    await waitForWatch(w => w.has('after-invalid.md'));
  });
});
