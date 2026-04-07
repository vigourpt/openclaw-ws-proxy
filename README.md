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

## Mission Control Setup

Point your MC's gateway URL to the proxy:

```
ws://your-vps-ip:3002/ws?target=ws://127.0.0.1:45397
```

For MCs that use `NEXT_PUBLIC_GATEWAY_WS` / `NEXT_PUBLIC_GATEWAY_URL` env vars:

```bash
NEXT_PUBLIC_GATEWAY_WS=ws://your-vps-ip:3002/ws?target=ws://127.0.0.1:45397
```

## Traefik / Reverse Proxy Setup

Route `gateway.yourdomain.com` to this proxy:

```yaml
# docker/traefik/dynamic/ws-proxy.yml
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

## Endpoints

- `GET /health` — Returns `{ "ok": true, "target": "..." }`
- `GET /` — Returns `openclaw-ws-proxy running`
- `WS /ws?target=<gateway-ws-url>` — WebSocket relay

## Tested With

- [NERVE](https://github.com/daggerhashimoto/openclaw-nerve) — NERVE's UI
- [JARVIS Mission Control](https://github.com/vigourpt/Jarvis-mission-control)
- [Autonomous AI Startup](https://github.com/vigourpt/autonomous-ai-startup)
