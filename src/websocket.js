/**
 * WebSocket management for MDV
 */

import { WebSocketServer, WebSocket } from 'ws';
import { WS_MAX_PAYLOAD, MAX_RELATIVE_PATH_LENGTH } from './config/constants.js';

/**
 * Check if a WebSocket client is ready to receive messages
 * @param {WebSocket} client - WebSocket client
 * @returns {boolean} True if client is open and ready
 */
function isClientReady(client) {
  return client.readyState === WebSocket.OPEN;
}

/**
 * Setup WebSocket server
 * @param {http.Server} server - HTTP server instance
 * @returns {WebSocketServer} WebSocket server instance
 */
export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD });
  const clientWatches = new Map();

  wss.on('connection', (ws) => {
    clientWatches.set(ws, new Set());

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'watch') {
          if (typeof message.path !== 'string' || message.path.length > MAX_RELATIVE_PATH_LENGTH) return;
          const watches = clientWatches.get(ws);
          watches.clear();
          watches.add(message.path);
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      clientWatches.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      clientWatches.delete(ws);
    });
  });

  wss.broadcast = (data) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (isClientReady(client)) {
        client.send(message);
      }
    });
  };

  wss.broadcastFileUpdate = (filePath, data) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (!isClientReady(client)) {
        return;
      }
      const watches = clientWatches.get(client);
      if (watches && watches.has(filePath)) {
        client.send(message);
      }
    });
  };

  wss.clientWatches = clientWatches;

  return wss;
}

/**
 * Broadcast a tree_update event to all connected clients.
 *
 * This is the ONLY place the `tree_update` payload should be constructed.
 * (Today `src/watcher.js` and `src/api/file.js` still build their own copy
 * of this payload inline — they are rewired to call this helper in a later
 * phase of the refactor; see refactoring-2026-07-strategy.md Phase 2.)
 *
 * @param {WebSocketServer} wss - WebSocket server returned by setupWebSocket
 * @returns {void}
 */
export function broadcastTreeUpdate(wss) {
  wss.broadcast({ type: 'tree_update' });
}

export default setupWebSocket;
