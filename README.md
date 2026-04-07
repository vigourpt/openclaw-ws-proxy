# openclaw-ws-proxy

Minimal WebSocket proxy that bridges any browser-based Mission Control dashboard to the OpenClaw gateway.

**The problem it solves:** OpenClaw's gateway binds to `127.0.0.1:45397` (loopback). Browser-based dashboards can't connect directly to loopback from a remote machine. This proxy runs on the same host as the gateway and exposes a WebSocket endpoint that browsers can reach.

**How it works:**
```
Browser  →  ws://vps:3002/ws?target=ws://127.0.0.1:45397  →  Proxy  →  OpenClaw Gateway
```

## Setup Wizard (Recommended)

Run the interactive setup wizard — it'll detect your gateway, ask a few questions, and generate the right config:

```bash
git clone https://github.com/vigourpt/openclaw-ws-proxy.git
cd openclaw-ws-proxy
npm install
npm run setup
```

The wizard will:
1. Check if your OpenClaw gateway is reachable
2. Find your gateway token
3. Ask which Mission Control you're using
4. Generate your `.env` and `docker-compose.yml` files
5. Give you the exact URL to paste into your MC

## Manual Setup

### Docker

```bash
git clone https://github.com/vigourpt/openclaw-ws-proxy.git
cd openclaw-ws-proxy
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

In your OpenClaw config (usually `~/.openclaw/openclaw.json`), look for:

```json
{
  "gateway": {
    "token": "YOUR_TOKEN_HERE"
  }
}
```

You'll need this when connecting your Mission Control dashboard.

### 2. Set the Correct Gateway WebSocket URL

```bash
# Same host (default)
GATEWAY_WS=ws://127.0.0.1:45397

# Different host/port
GATEWAY_WS=ws://192.168.1.100:45397

# Docker container network name
GATEWAY_WS=ws://openclaw-container-name:45397
```

### 3. Point Your Mission Control To the Proxy

Set your MC's gateway WebSocket URL to the proxy address:

```
ws://your-vps-ip:3002/ws?target=ws://127.0.0.1:45397
```

Common env var names:
- `NEXT_PUBLIC_GATEWAY_WS`
- `NEXT_PUBLIC_GATEWAY_URL`
- `GATEWAY_URL`

### 4. Choose a Different Port

```bash
PORT=3005 docker compose up -d
# Then update your MC URL to use :3005
```

### 5. Add Your Domain (Traefik)

Add to your Traefik dynamic config (`/docker/traefik/dynamic/ws-proxy.yml`):

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

Then use: `wss://gateway.yourdomain.com/ws?target=ws://127.0.0.1:45397`

### 6. Rename the Image

```bash
# Edit docker-compose.yml — change:
image: ghcr.io/vigourpt/openclaw-ws-proxy:latest
# to:
image: your-dockerhub-username/openclaw-ws-proxy:latest

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
