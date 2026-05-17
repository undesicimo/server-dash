# Server Dash

Minimal Bun, React, Tailwind, and shadcn-style dashboard for a Linux server.

It can show:

- Media/app launcher status imported from a Homer `config.yml`
- Storage usage from `df -kP`
- PWA install support for phone home screens

## Local development

Install dependencies:

```bash
bun install
```

Run the backend:

```bash
bun run backend
```

Run the frontend in another terminal:

```bash
bun run dev
```

Open `http://localhost:5173`.

## Configuration

Copy the example env file:

```bash
cp .env.example .env
```

Variables:

```bash
APP_NAME=Server Dash
HOMER_CONFIG_URL=http://your-server.local:4001/assets/config.yml
APP_CHECK_BASE=http://your-server.local
PUBLIC_LAN_HOST=your-server.local
PUBLIC_TAILSCALE_HOST=your-server.example.ts.net
```

`HOMER_CONFIG_URL` is optional. Without it, the app launcher will show an empty-state message.

`APP_CHECK_BASE` is optional. Use it when Homer links point to one hostname, but the container should health-check apps through a different host/IP. The app ports and paths are preserved.

`PUBLIC_LAN_HOST` and `PUBLIC_TAILSCALE_HOST` are optional. If both are set, frontend links are device-aware:

- When opened from `PUBLIC_TAILSCALE_HOST`, app links keep the Tailscale hostname.
- Otherwise app links use `PUBLIC_LAN_HOST`, preserving each app's port/path.

## Docker Compose

Build and run:

```bash
docker compose up --build -d
```

Open `http://localhost:3001`.

The compose file mounts the host root at `/host` read-only and sets `STORAGE_PATH=/host`, so the backend checks host storage with:

```bash
df -kP /host
```

Change `STORAGE_PATH` in `docker-compose.yml` if you want to monitor a different mounted path.

## API

Storage stats:

```bash
GET /api/storage
```

Health check:

```bash
GET /api/health
```

Public frontend config:

```bash
GET /api/config
```

App status:

```bash
GET /api/apps
```
