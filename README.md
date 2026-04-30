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



## Todos
- Reconnect Handling after disconnect
- Sort Playerlist in game screen so that the ones with the most green > yellow are sorted to the top, live updates to that list
