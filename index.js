/**
 * openclaw-ws-proxy
 * Minimal WebSocket proxy that bridges any browser-based Mission Control dashboard to the OpenClaw gateway.
 *
 * Browser/Websocket client connects to:
 *   ws://proxy-host:3002/ws?target=ws://127.0.0.1:45397
 *
 * The proxy connects to the OpenClaw gateway at GATEWAY_WS and relays all
 * messages bidirectionally. Works with any OpenClaw Mission Control dashboard.
 *
 * Usage:
 *   GATEWAY_WS=ws://127.0.0.1:45397 PORT=3002 GATEWAY_REMOTE_TOKEN=xxx INJECT_SCOPES=false node index.js
 *
 * Docker:
 *   docker run -d -p 3002:3002 \
 *     -e GATEWAY_WS=ws://host.docker.internal:45397 \
 *     -e GATEWAY_REMOTE_TOKEN=xxx \
 *     -e INJECT_SCOPES=false \
 *     --network host \
 *     ghcr.io/vigourpt/openclaw-ws-proxy
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PORT = parseInt(process.env.PORT || '3002', 10);
const TARGET = process.env.GATEWAY_WS || 'ws://127.0.0.1:45397';
const GATEWAY_TOKEN = process.env.GATEWAY_REMOTE_TOKEN || '';
// INJECT_SCOPES=false preserves the original device-signed connect payload (recommended for Abacus MC)
// INJECT_SCOPES=true (default) forces scopes — only use with clients that don't do device signing
const INJECT_SCOPES = process.env.INJECT_SCOPES !== 'false';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, target: TARGET, injectScopes: INJECT_SCOPES }));
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
  console.log(`[ws-proxy] Inject scopes: ${INJECT_SCOPES}`);
  console.log(`[ws-proxy] Browser: ws://localhost:${PORT}/ws?target=${TARGET}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Device identity for proxy-to-gateway authentication
// ─────────────────────────────────────────────────────────────────────────────

const IDENTITY_FILE = '/tmp/ws-proxy-identity.json';

function deriveDeviceId(publicKey) {
  // OpenClaw uses SHA-256(rawPublicKey).hex as deviceId
  const raw = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw.length % 4 === 2 ? raw + '==' : raw.length % 4 === 3 ? raw + '=' : raw;
  return crypto.createHash('sha256').update(Buffer.from(padded, 'base64')).digest('hex');
}

function generateKeyPair() {
  const { Box } = crypto;
  // Use crypto keygen — generate an Ed25519 key pair
  // Node.js 20+ has crypto.generateKeyPairSync('ed25519')
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // Extract raw 32-byte public key from SPKI DER
  const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  const der = publicKey;
  const raw = der.slice(ED25519_SPKI_PREFIX.length);
  const pubKeyB64 = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { privateKey, publicKey: pubKeyB64 };
}

function loadOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_FILE)) {
    const saved = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
    // Re-derive deviceId from stored public key in case format changed
    saved.deviceId = deriveDeviceId(saved.publicKey);
    return saved;
  }
  const kp = generateKeyPair();
  const deviceId = deriveDeviceId(kp.publicKey);
  const identity = { privateKey: kp.privateKey, publicKey: kp.publicKey, deviceId };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity));
  console.log(`[ws-proxy] Generated new device identity: ${deviceId}`);
  return identity;
}

function signMessage(message, identity) {
  const key = crypto.createPrivateKey(identity.privateKey);
  const signature = crypto.sign(null, Buffer.from(message, 'utf8'), key);
  return signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Relay
// ─────────────────────────────────────────────────────────────────────────────

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

    if (savedConnect) {
      if (challengeNonce) {
        sendConnect(savedConnect, challengeNonce);
      } else {
        setTimeout(() => {
          if (!handshakeDone) sendConnect(savedConnect, null);
        }, 3000);
      }
    }
  });

  // Gateway → Browser
  gatewayWs.on('message', (data) => {
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
          return;
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

  // ── Dispatch connect to gateway ──────────────────────────────────────────
  function sendConnect(msg, nonce) {
    if (handshakeDone) return;
    handshakeDone = true;

    const identity = loadOrCreateIdentity();
    const scopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'];

    if (INJECT_SCOPES) {
      // ── Mode A: scope injection (legacy, no device signing) ─────────────
      // Strip device block before injecting new scopes so gateway doesn't
      // re-verify the (now stale) device signature
      const payload = {
        ...msg,
        params: {
          ...(msg.params || {}),
          scopes,
          device: undefined,
        },
      };
      if (GATEWAY_TOKEN) {
        payload.params.auth = { token: GATEWAY_TOKEN };
      }
      gatewayWs.send(JSON.stringify(payload));
      log('gateway', `Connect sent (scope injection, token=${!!GATEWAY_TOKEN})`);

    } else {
      // ── Mode B: device-signed passthrough (Abacus MC compatible) ─────────
      // Use the proxy's own device identity to sign the connect.
      // The gateway will verify the signature using the proxy's public key.
      const signedAt = Date.now();

      if (nonce) {
        // Build v3 signature payload (pipe-delimited)
        const scopeStr = scopes.join(',');
        const token = GATEWAY_TOKEN || '';
        const sigPayload = [
          'v3',
          identity.deviceId,
          'cli',
          'cli',
          'operator',
          scopeStr,
          String(signedAt),
          token,
          nonce,
          'node',
          '',
        ].join('|');
        const signature = signMessage(sigPayload, identity);

        const payload = {
          ...msg,
          params: {
            ...(msg.params || {}),
            scopes,
            device: {
              id: identity.deviceId,
              publicKey: identity.publicKey,
              signature,
              signedAt,
              nonce,
            },
          },
        };
        if (GATEWAY_TOKEN) {
          payload.params.auth = { token: GATEWAY_TOKEN };
        }
        gatewayWs.send(JSON.stringify(payload));
        log('gateway', `Connect sent (device-signed, deviceId=${identity.deviceId})`);
      } else {
        // No nonce yet — try without device block (token auth only)
        const payload = {
          ...msg,
          params: {
            ...(msg.params || {}),
            scopes,
          },
        };
        if (GATEWAY_TOKEN) {
          payload.params.auth = { token: GATEWAY_TOKEN };
        }
        gatewayWs.send(JSON.stringify(payload));
        log('gateway', `Connect sent (no nonce, token auth only)`);
      }
    }
  }
}
