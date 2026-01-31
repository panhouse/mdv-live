/**
 * WebSocket management for MDV
 */

import { WebSocketServer } from 'ws';

/**
 * Setup WebSocket server
 * @param {http.Server} server - HTTP server instance
 * @returns {WebSocketServer} WebSocket server instance
 */
export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  // Track watched files per client
  const clientWatches = new Map();

  wss.on('connection', (ws) => {
    clientWatches.set(ws, new Set());

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'watch') {
          // Client wants to watch a file
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

  // Add broadcast helper
  wss.broadcast = (data) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    });
  };

  // Add targeted broadcast for file updates
  wss.broadcastFileUpdate = (filePath, data) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        const watches = clientWatches.get(client);
        if (watches && watches.has(filePath)) {
          client.send(message);
        }
      }
    });
  };

  // Store clientWatches for external access
  wss.clientWatches = clientWatches;

  return wss;
}

export default setupWebSocket;
