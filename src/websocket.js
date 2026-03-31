/**
 * WebSocket management for MDV
 */

import { WebSocketServer, WebSocket } from 'ws';

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
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
  const clientWatches = new Map();

  wss.on('connection', (ws) => {
    clientWatches.set(ws, new Set());

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'watch') {
          if (typeof message.path !== 'string' || message.path.length > 1024) return;
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

export default setupWebSocket;
