/**
 * openclaw-ws-proxy
 * Minimal WebSocket proxy that bridges browser clients to the OpenClaw gateway.
 *
 * Browser/Websocket client connects to:
 *   ws://proxy-host:3002/ws?target=ws://127.0.0.1:45397
 *
 * The proxy connects to the OpenClaw gateway at GATEWAY_WS and relays all
 * messages bidirectionally. Works with any OpenClaw Mission Control dashboard.
 *
 * Usage:
 *   GATEWAY_WS=ws://127.0.0.1:45397 PORT=3002 node index.js
 *
 * Docker:
 *   docker run -d -p 3002:3002 \
 *     -e GATEWAY_WS=ws://host.docker.internal:45397 \
 *     --network host \
 *     ghcr.io/vigourpt/openclaw-ws-proxy
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = parseInt(process.env.PORT || '3002', 10);
const TARGET = process.env.GATEWAY_WS || 'ws://127.0.0.1:45397';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, target: TARGET }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('openclaw-ws-proxy running\n');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const target = url.searchParams.get('target') || TARGET;
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    relay(clientWs, target);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ws-proxy] Listening on 0.0.0.0:${PORT}`);
  console.log(`[ws-proxy] Target: ${TARGET}`);
  console.log(`[ws-proxy] Browser: ws://localhost:${PORT}/ws?target=${TARGET}`);
});

/**
 * Relay messages between browser WebSocket client and OpenClaw gateway.
 */
function relay(clientWs, targetUrl) {
  let gatewayWs;
  let gatewayOpen = false;
  let handshakeDone = false;
  let savedConnect = null;
  let challengeNonce = null;

  const log = (action, msg) => console.log(`[ws-proxy] ${action}: ${msg}`);

  // ── Connect to gateway ───────────────────────────────────────────────────
  try {
    gatewayWs = new WebSocket(targetUrl, {
      headers: { Origin: 'http://localhost' },
    });
  } catch (err) {
    log('error', `Failed to create gateway WebSocket: ${err.message}`);
    clientWs.close();
    return;
  }

  gatewayWs.on('open', () => {
    gatewayOpen = true;
    log('gateway', `Connected to ${targetUrl}`);

    // Send deferred connect message if we already received one
    if (savedConnect) {
      if (challengeNonce) {
        sendConnect(savedConnect, challengeNonce);
      } else {
        // Wait up to 3s for challenge nonce
        setTimeout(() => {
          if (!handshakeDone) sendConnect(savedConnect, null);
        }, 3000);
      }
    }
  });

  // Gateway → Browser
  gatewayWs.on('message', (data) => {
    // Capture challenge nonce from gateway
    if (!handshakeDone) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'event' && msg.event === 'connect.challenge' && msg.payload?.nonce) {
          challengeNonce = msg.payload.nonce;
          log('gateway', `Got challenge nonce`);
          if (savedConnect && !handshakeDone) sendConnect(savedConnect, challengeNonce);
        }
      } catch {}
    }

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  gatewayWs.on('close', (code, reason) => {
    log('gateway', `Closed code=${code} reason=${reason}`);
    gatewayOpen = false;
    clientWs.close();
  });

  gatewayWs.on('error', (err) => {
    log('error', `Gateway: ${err.message}`);
    if (handshakeDone) clientWs.close();
  });

  // Browser → Gateway
  clientWs.on('message', (data) => {
    if (!gatewayOpen) return;

    if (!handshakeDone) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'req' && msg.method === 'connect' && msg.params) {
          savedConnect = msg;
          log('client', `Saved connect, waiting for nonce...`);
          return; // Wait for nonce
        }
      } catch {}
    }

    gatewayWs.send(data);
  });

  clientWs.on('close', () => {
    log('client', `Disconnected`);
    if (gatewayWs) gatewayWs.close();
  });

  clientWs.on('error', (err) => {
    log('error', `Client: ${err.message}`);
  });

  // ── Dispatch connect to gateway with scopes ───────────────────────────────
  function sendConnect(msg, nonce) {
    if (handshakeDone) return;
    handshakeDone = true;

    const payload = {
      ...msg,
      params: {
        ...(msg.params || {}),
        scopes: ['operator.admin', 'operator.read', 'operator.write'],
      },
    };

    gatewayWs.send(JSON.stringify(payload));
    log('gateway', `Connect sent (nonce=${nonce ? 'yes' : 'no'})`);
  }
}
