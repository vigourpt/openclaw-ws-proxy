# openclaw-ws-proxy

Minimal WebSocket proxy that bridges any browser-based Mission Control dashboard to the OpenClaw gateway.

**The problem it solves:** OpenClaw's gateway binds to `127.0.0.1:45397` (loopback). Browser-based dashboards can't connect directly to loopback from a remote machine. This proxy runs on the same host as the gateway and exposes a WebSocket endpoint that browsers can reach.

**How it works:**
```
Browser  →  ws://vps:3002/ws?target=ws://127.0.0.1:45397  →  Proxy  →  OpenClaw Gateway
```

## Quick Start

### Docker (recommended)

```bash
# Clone
git clone https://github.com/vigourpt/openclaw-ws-proxy.git
cd openclaw-ws-proxy

# Run
docker compose up -d
```

### Without Docker

```bash
npm install
GATEWAY_WS=ws://127.0.0.1:45397 PORT=3002 node index.js
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_WS` | `ws://127.0.0.1:45397` | OpenClaw gateway WebSocket URL |
| `PORT` | `3002` | Proxy listen port |

## Personalisation

### 1. Find Your Gateway Token

In your OpenClaw config (usually `~/.openclaw/openclaw.json`), look for your gateway token:

```json
{
  "gateway": {
    "token": "YOUR_TOKEN_HERE"
  }
}
```

You'll need this when connecting your Mission Control dashboard.

### 2. Set the Correct Gateway WebSocket URL

If your OpenClaw gateway binds to a different address or port, update `GATEWAY_WS`:

```bash
# Default (same host)
GATEWAY_WS=ws://127.0.0.1:45397

# If gateway is on a different host/port
GATEWAY_WS=ws://192.168.1.100:45397

# If using a Docker container network name
GATEWAY_WS=ws://openclaw-container-name:45397
```

### 3. Point Your Mission Control To the Proxy

In your MC's environment variables, set the gateway WebSocket URL to the proxy address:

```
ws://your-vps-ip:3002/ws?target=ws://127.0.0.1:45397
```

Common env var names across different MCs:
- `NEXT_PUBLIC_GATEWAY_WS`
- `NEXT_PUBLIC_GATEWAY_URL`
- `GATEWAY_URL`

### 4. Choose a Different Port

If port 3002 is already in use:

```bash
PORT=3005 docker compose up -d
# Then update your MC URL to use :3005 instead of :3002
```

### 5. Add Your Domain (Traefik)

If you're using Traefik as a reverse proxy, add this to your Traefik dynamic config (`/docker/traefik/dynamic/ws-proxy.yml`):

```yaml
http:
  routers:
    ws-proxy:
      rule: "Host(`gateway.yourdomain.com`)"
      service: ws-proxy
      tls: true
  services:
    ws-proxy:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3002"
```

Then point your MC to: `wss://gateway.yourdomain.com/ws?target=ws://127.0.0.1:45397`

### 6. Rename the Image

If you want to build under your own Docker Hub / GHCR namespace:

```bash
# Edit docker-compose.yml and change:
image: ghcr.io/vigourpt/openclaw-ws-proxy:latest
# to:
image: your-dockerhub-username/openclaw-ws-proxy:latest

# Then build and push
docker build -t your-dockerhub-username/openclaw-ws-proxy:latest .
docker push your-dockerhub-username/openclaw-ws-proxy:latest
```

## Endpoints

- `GET /health` — Returns `{ "ok": true, "target": "..." }`
- `GET /` — Returns `openclaw-ws-proxy running`
- `WS /ws?target=<gateway-ws-url>` — WebSocket relay

## Tested With

- [NERVE](https://github.com/daggerhashimoto/openclaw-nerve)
- [JARVIS Mission Control](https://github.com/vigourpt/Jarvis-mission-control)
- [Autonomous AI Startup](https://github.com/vigourpt/autonomous-ai-startup)
