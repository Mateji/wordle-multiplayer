# wordle-monorepo

Monorepo for a German Wordle client, a multiplayer server, and shared event contracts.

## Workspace

- `apps/client`: Angular client (`@wordle/client`)
- `apps/server`: Node.js + Socket.IO server (`@wordle/server`)
- `packages/shared`: Shared types/events (`@wordle/shared`)

## Development

Install dependencies from the repository root:

```bash
pnpm install
```

Start all workspace apps in parallel:

```bash
pnpm dev
```

Start only the client:

```bash
pnpm dev:client
```

Start only the server:

```bash
pnpm dev:server
```

## Build

Build all packages:

```bash
pnpm build
```

Build individual packages:

```bash
pnpm --filter @wordle/shared build
pnpm --filter @wordle/server build
pnpm --filter @wordle/client build
```

## Test

Run all tests:

```bash
pnpm test
```

## Deployment

The client resolves the multiplayer server origin in this order:

- `window.__WORDLE_SERVER_URL__`, if you define it before the Angular app boots
- `http://<current-host>:3001` during local browser development on `localhost`, `127.0.0.1`, or `::1`
- the current browser origin for deployed environments

That means a reverse-proxy setup on one shared origin works without extra client changes. If the Socket.IO server lives on a different origin, inject the override before the app starts, for example in the page shell:

```html
<script>
	window.__WORDLE_SERVER_URL__ = 'https://api.example.com';
</script>
```

The server keeps localhost origins open by default for local development. For deployed environments, set a comma-separated allowlist:

```bash
CORS_ALLOWED_ORIGINS=https://wordle.example.com,https://www.wordle.example.com
```

The server port stays configurable through `PORT` and defaults to `3001`.

### Docker Compose workflow

This repository now includes production Docker files for both apps and a root `docker-compose.yml`.

Build and start the full stack locally or on a server:

```bash
pnpm docker:deploy
```

That command runs the workspace build first and then starts Docker Compose with a rebuild.

The available root helper scripts are:

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:up:build
pnpm docker:down
pnpm docker:logs
pnpm docker:deploy
```

Recommended server update workflow:

```bash
git pull
pnpm docker:deploy
```

The Compose setup works like this:

- `client`: Nginx serves the Angular build from `apps/client/dist/wordle/browser`
- `server`: Node runs the compiled backend from `apps/server/dist/index.js`
- Nginx proxies `/socket.io`, `/rooms`, and `/health` to the Node container

For deployed environments, set your allowed browser origin before starting Compose:

```bash
export CORS_ALLOWED_ORIGINS=https://wordle.example.com
pnpm docker:deploy
```

Notes:

- the server keeps room state only in memory, so container restarts reset active rooms
- for HTTPS, place a reverse proxy such as Caddy, Traefik, or Nginx in front of the `client` service, or adapt the Compose file to publish `443`



## Todos
- Maybe add a observer screen, where killed players, or winners can watch the others
- Add sounds when you find a green letter, a sound when you find a yellow letter, a death sound, a sound when another player finds green letters, a countdown sound
- Add Chat and redesign ui